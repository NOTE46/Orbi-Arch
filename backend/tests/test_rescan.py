"""Tests for in-place session re-scan route, override preservation, pruning, and security guards."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from orbi.db import OrbiDB
from orbi.schema import Position, RenderSession, SessionOverrides, validate_session
from orbi.server import create_app
from orbi.vault import MemoryKeyVault


def _read_sse_events(client: TestClient, job_id: str) -> list[dict[str, Any]]:
    events = []
    with client.stream("GET", f"/api/scans/{job_id}/events") as resp:
        assert resp.status_code == 200
        for line in resp.iter_lines():
            if line.startswith("data: "):
                data = json.loads(line[6:])
                events.append(data)
                if data.get("event") in ("complete", "error"):
                    break
    return events


def test_rescan_preserves_identity_and_overrides_with_pruning(tmp_path: Path):
    """Test 1: Re-scan preserves session identity & valid overrides while picking up file changes and pruning dead overrides."""
    repo_dir = tmp_path / "test_repo"
    src_dir = repo_dir / "src"
    src_dir.mkdir(parents=True)

    # Initial files: a.py imports b.py
    (src_dir / "a.py").write_text("import src.b\ndef run():\n    return src.b.val()\n", encoding="utf-8")
    (src_dir / "b.py").write_text("def val():\n    return 42\n", encoding="utf-8")

    db = OrbiDB(tmp_path / "test_rescan.db")
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    with TestClient(app) as client:
        # 1. Initial scan
        r_start = client.post("/api/scans", json={"source_type": "local", "target": str(repo_dir), "use_ai": False})
        assert r_start.status_code == 202
        job_id = r_start.json()["job_id"]
        events = _read_sse_events(client, job_id)
        comp = next(e for e in events if e.get("event") == "complete")
        init_sess_data = comp["session"]
        orig_session_id = init_sess_data["session"]["id"]
        orig_created_at = init_sess_data["session"]["created_at"]

        # 2. Rename session & set custom overrides for surviving node (src/a.py) and doomed node (src/b.py)
        overrides = SessionOverrides(
            positions={"src/a.py": {"x": 120.0, "y": 240.0}, "src/b.py": {"x": 300.0, "y": 400.0}},
            renamed={"src/a.py": "Custom Node A", "src/b.py": "Custom Node B"},
        )
        r_patch = client.patch(
            f"/api/sessions/{orig_session_id}",
            json={"name": "My Custom Name", "overrides": overrides.model_dump()},
        )
        assert r_patch.status_code == 200

        # 3. Modify repository on disk: delete b.py, add c.py, update a.py to import c
        (src_dir / "b.py").unlink()
        (src_dir / "c.py").write_text("def val():\n    return 99\n", encoding="utf-8")
        (src_dir / "a.py").write_text("import src.c\ndef run():\n    return src.c.val()\n", encoding="utf-8")

        # 4. Trigger in-place re-scan
        r_rescan = client.post(f"/api/sessions/{orig_session_id}/rescan", json={"use_ai": False})
        assert r_rescan.status_code == 202
        rescan_job_id = r_rescan.json()["job_id"]
        rescan_events = _read_sse_events(client, rescan_job_id)
        rescan_comp = next(e for e in rescan_events if e.get("event") == "complete")
        rescanned_sess_data = rescan_comp["session"]
        rescanned = RenderSession.model_validate(rescanned_sess_data)

        # Assert identity preservation
        assert rescanned.session.id == orig_session_id
        assert rescanned.session.name == "My Custom Name"
        assert rescanned.session.created_at == orig_created_at

        # Assert nodes updated (src/c.py present, src/b.py gone)
        node_ids = {n.id for n in rescanned.nodes}
        assert "src/c.py" in node_ids
        assert "src/b.py" not in node_ids
        assert "src/a.py" in node_ids

        # Assert edge updated (a -> c)
        lld_pairs = {(e.source, e.target) for e in rescanned.edges if e.scope == "lld"}
        assert ("src/a.py", "src/c.py") in lld_pairs
        assert ("src/a.py", "src/b.py") not in lld_pairs

        # Assert overrides: src/a.py preserved, src/b.py pruned
        assert rescanned.overrides.positions.get("src/a.py") == Position(x=120.0, y=240.0)
        assert rescanned.overrides.renamed.get("src/a.py") == "Custom Node A"
        assert "src/b.py" not in rescanned.overrides.positions
        assert "src/b.py" not in rescanned.overrides.renamed

        # Assert valid session & database updated in-place without duplication
        assert validate_session(rescanned) == []
        r_list = client.get("/api/sessions")
        assert r_list.status_code == 200
        all_sessions = r_list.json()
        assert len(all_sessions) == 1
        assert all_sessions[0]["session"]["id"] == orig_session_id
        assert all_sessions[0]["session"]["name"] == "My Custom Name"


def test_rescan_error_and_security_guards(tmp_path: Path):
    """Test 2: Error cases, Origin CSRF blocking, missing directory rejection, and demo session guard."""
    repo_dir = tmp_path / "guarded_repo"
    repo_dir.mkdir(parents=True)
    (repo_dir / "mod.py").write_text("def fn(): pass\n", encoding="utf-8")

    db = OrbiDB(tmp_path / "test_guards.db")
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    with TestClient(app) as client:
        # 1. Nonexistent session -> 404
        r_404 = client.post("/api/sessions/nonexistent_session/rescan")
        assert r_404.status_code == 404
        assert "not found" in r_404.json()["detail"].lower()

        # 2. Create a valid session
        r_start = client.post("/api/scans", json={"source_type": "local", "target": str(repo_dir), "use_ai": False})
        assert r_start.status_code == 202
        events = _read_sse_events(client, r_start.json()["job_id"])
        sess_id = next(e for e in events if e.get("event") == "complete")["session"]["session"]["id"]

        # 3. Origin CSRF guard: evil origin returns 403
        r_evil = client.post(
            f"/api/sessions/{sess_id}/rescan",
            headers={"Origin": "https://evil.attacker.com"},
            json={"use_ai": False},
        )
        assert r_evil.status_code == 403
        assert r_evil.json()["detail"] == "Forbidden origin"

        # 4. Demo session cannot be rescanned
        demo_session = db.get_session(sess_id)
        assert demo_session is not None
        demo_session.session.is_demo = True
        demo_session.session.id = "demo_test_sess"
        db.upsert_session(demo_session)
        r_demo = client.post("/api/sessions/demo_test_sess/rescan")
        assert r_demo.status_code == 422
        assert "demo" in r_demo.json()["detail"].lower()

        # 5. Deleted target path -> 422
        shutil.rmtree(repo_dir)
        r_deleted = client.post(f"/api/sessions/{sess_id}/rescan", json={"use_ai": False})
        assert r_deleted.status_code == 422
