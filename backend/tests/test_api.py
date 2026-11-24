"""Comprehensive test suite for ORBI FastAPI endpoints, SSE scan jobs, and AI synthesis."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient
from orbi.api_models import ModelTierConfig
from orbi.db import OrbiDB
from orbi.schema import SessionOverrides, validate_session
from orbi.server import create_app
from orbi.vault import MemoryKeyVault

REPO_ROOT = Path(__file__).resolve().parents[2]


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


def test_health_and_origin_security_guard(tmp_path: Path):
    """Test 1: Healthcheck endpoint and strict Origin CSRF middleware."""
    db = OrbiDB(tmp_path / "test_sec.db")
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    with TestClient(app) as client:
        # 1. Healthcheck
        r_health = client.get("/api/health")
        assert r_health.status_code == 200
        data = r_health.json()
        assert data["status"] == "ok"
        assert data["version"] == "0.1.0"
        assert data["keyring_available"] is True

        # 2. Mutating requests with evil origin are blocked with 403
        r_evil = client.delete("/api/sessions/sess_fake", headers={"Origin": "https://evil.attacker.com"})
        assert r_evil.status_code == 403
        assert r_evil.json()["detail"] == "Forbidden origin"

        r_evil_post = client.post(
            "/api/scans",
            json={"source_type": "local", "target": str(tmp_path)},
            headers={"Origin": "https://evil.attacker.com"},
        )
        assert r_evil_post.status_code == 403

        # 3. Request with allowed origin passes through
        r_ok_origin = client.delete("/api/sessions/sess_fake", headers={"Origin": "http://127.0.0.1:5173"})
        assert r_ok_origin.status_code == 404  # Passes origin check, fails on missing session

        # 4. Invalid GitHub URL rejected early with 422
        r_bad_url = client.post("/api/scans", json={"source_type": "github", "target": "git@github.com:o/r.git"})
        assert r_bad_url.status_code == 422


def test_write_only_api_key_vault_and_settings_persistence(tmp_path: Path):
    """Test 2: Write-only API key handling, hint masking, and loopback derivation."""
    db_file = tmp_path / "test_vault.db"
    db = OrbiDB(db_file)
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    secret_key = "sk-supersecret1234567890abcd"

    with TestClient(app) as client:
        # Save OpenAI key
        r_put = client.put("/api/providers/openai/key", json={"api_key": secret_key})
        assert r_put.status_code == 200
        resp_data = r_put.json()
        assert resp_data["configured"] is True
        assert resp_data["hint"] == "••••abcd"
        assert "apiKey" not in resp_data
        assert "api_key" not in resp_data
        assert secret_key not in json.dumps(resp_data)

        # Assert raw key is in MemoryKeyVault but NEVER in raw SQLite DB bytes
        assert vault.get_key("openai") == secret_key
        raw_db_bytes = db_file.read_bytes()
        assert secret_key.encode("utf-8") not in raw_db_bytes

        # Delete OpenAI key
        r_del = client.delete("/api/providers/openai/key")
        assert r_del.status_code == 200
        del_data = r_del.json()
        assert del_data["configured"] is False
        assert del_data["hint"] is None
        assert vault.get_key("openai") is None

        # Base URL validation & isLocal derivation
        r_ollama_remote = client.put("/api/providers/ollama/key", json={"base_url": "http://192.168.1.50:11434"})
        assert r_ollama_remote.status_code == 200
        assert r_ollama_remote.json()["isLocal"] is False

        r_ollama_local = client.put("/api/providers/ollama/key", json={"base_url": "http://127.0.0.1:8080"})
        assert r_ollama_local.status_code == 200
        assert r_ollama_local.json()["isLocal"] is True

        # Invalid URL returns 422
        r_bad_base = client.put("/api/providers/ollama/key", json={"base_url": "ftp://localhost:11434"})
        assert r_bad_base.status_code == 422


def test_end_to_end_deterministic_scan_sse_and_crud(tmp_path: Path):
    """Test 3: Deterministic scan with SSE progress streaming and full session CRUD (0 LLM tokens)."""
    # Create simple fixture repo
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    (repo_dir / "app.py").write_text("import util\ndef main(): return util.add(1, 2)\n", encoding="utf-8")
    (repo_dir / "util.py").write_text("def add(a, b): return a + b\n", encoding="utf-8")

    db = OrbiDB(tmp_path / "test_crud.db")
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    with TestClient(app) as client:
        # Start scan with use_ai=True (fallback path since models are blank by default)
        r_start = client.post("/api/scans", json={"source_type": "local", "target": str(repo_dir), "use_ai": True})
        assert r_start.status_code == 202
        job_id = r_start.json()["job_id"]

        # Stream SSE events
        events = _read_sse_events(client, job_id)
        assert len(events) >= 3
        progress_events = [e for e in events if e.get("event") == "progress"]
        complete_events = [e for e in events if e.get("event") == "complete"]
        assert len(progress_events) >= 2
        assert len(complete_events) == 1

        comp = complete_events[0]
        assert comp["ai_applied"] is False
        assert comp["progress"] == 1.0
        session_data = comp["session"]
        assert len(session_data["nodes"]) == 2
        assert len(session_data["edges"]) >= 1

        sess_id = session_data["session"]["id"]

        # Verify session persistence via GET /api/sessions and GET /api/sessions/{id}
        r_list = client.get("/api/sessions")
        assert r_list.status_code == 200
        assert any(s["session"]["id"] == sess_id for s in r_list.json())

        r_get = client.get(f"/api/sessions/{sess_id}")
        assert r_get.status_code == 200
        assert r_get.json()["session"]["name"] == "repo"

        # Update name and overrides via PATCH
        overrides = SessionOverrides(
            positions={"c_root": {"x": 100.0, "y": 200.0}},
            renamed={"c_root": "Core Root"},
        )
        r_patch = client.patch(f"/api/sessions/{sess_id}", json={"name": "Renamed Repo", "overrides": overrides.model_dump()})
        assert r_patch.status_code == 200
        patched = r_patch.json()
        assert patched["session"]["name"] == "Renamed Repo"
        assert patched["overrides"]["renamed"]["c_root"] == "Core Root"

        # Empty name returns 422
        r_empty_name = client.patch(f"/api/sessions/{sess_id}", json={"name": "   "})
        assert r_empty_name.status_code == 422

        # Delete session
        r_del = client.delete(f"/api/sessions/{sess_id}")
        assert r_del.status_code == 200
        assert r_del.json() == {"deleted": True}

        # Confirm 404 after deletion
        r_get_missing = client.get(f"/api/sessions/{sess_id}")
        assert r_get_missing.status_code == 404


def test_mocked_two_tier_ai_synthesis_and_guardrails(tmp_path: Path):
    """Test 4: Two-tier AI synthesis with mocked httpx transport and anti-hallucination guardrails."""
    repo_dir = tmp_path / "ai_repo"
    api_dir = repo_dir / "api"
    api_dir.mkdir(parents=True)
    lib_dir = repo_dir / "lib"
    lib_dir.mkdir(parents=True)

    (api_dir / "server.py").write_text("import lib.core\ndef serve(): pass\n", encoding="utf-8")
    (lib_dir / "core.py").write_text("def run(): pass\n", encoding="utf-8")

    db = OrbiDB(tmp_path / "test_ai.db")
    vault = MemoryKeyVault({"openai": "sk-mock-key-12345"})

    # Configure cheap and strong models
    settings = db.load_settings()
    settings.cheapModel = ModelTierConfig(provider="openai", model="gpt-4o-mini")
    settings.strongModel = ModelTierConfig(provider="openai", model="gpt-4o")
    db.save_settings(settings)

    call_stats = {"tier1": 0, "tier2": 0}

    def mock_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        messages_text = json.dumps(body.get("messages", []))

        if "Summarize subsystem" in messages_text:
            call_stats["tier1"] += 1
            content = json.dumps({
                "label": "Enhanced Subsystem",
                "summary": "AI generated concise summary",
                "file_summaries": {"api/server.py": "Main API server entrypoint"},
            })
        else:
            call_stats["tier2"] += 1
            content = json.dumps({
                "containers": [{"id": "c_api", "label": "API Tier", "category": "api", "summary": "REST and event gateway"}],
                "inferred_edges": [
                    # 1. Valid inferred edge in reverse direction (not overlapping verified c_api->c_lib)
                    {"source": "c_lib", "target": "c_api", "label": "callbacks", "reason": "Heartbeat and notification callbacks"},
                    # 2. Overlapping existing verified edge -> must be rejected
                    {"source": "c_api", "target": "c_lib", "label": "imports", "reason": "Duplicate verified edge"},
                    # 3. Nonexistent container -> must be rejected
                    {"source": "c_api", "target": "c_fake", "label": "depends on", "reason": "Nonexistent target"},
                ],
            })

        resp_payload = {
            "choices": [{"message": {"content": content}}]
        }
        return httpx.Response(200, json=resp_payload)

    mock_transport = httpx.MockTransport(mock_handler)
    app = create_app(db=db, vault=vault, llm_transport=mock_transport)

    with TestClient(app) as client:
        # First scan: executes AI synthesis
        r1 = client.post("/api/scans", json={"source_type": "local", "target": str(repo_dir), "use_ai": True})
        assert r1.status_code == 202
        events1 = _read_sse_events(client, r1.json()["job_id"])
        comp1 = next(e for e in events1 if e.get("event") == "complete")

        assert comp1["ai_applied"] is True
        session1 = comp1["session"]

        # Validate graph integrity
        from orbi.schema import RenderSession
        rs1 = RenderSession.model_validate(session1)
        assert validate_session(rs1) == []

        # Anti-hallucination guardrail checks:
        # Valid edge c_lib -> c_api was accepted with provenance="inferred"
        inferred = [e for e in rs1.edges if e.provenance == "inferred"]
        assert len(inferred) == 1
        assert inferred[0].source == "c_lib"
        assert inferred[0].target == "c_api"
        assert inferred[0].reason == "Heartbeat and notification callbacks"

        # Illegal edges were rejected
        assert not any(e.target == "c_fake" for e in rs1.edges)
        verified_pairs = [(e.source, e.target) for e in rs1.edges if e.provenance == "verified"]
        assert ("c_api", "c_lib") in verified_pairs

        first_tier1_calls = call_stats["tier1"]
        assert first_tier1_calls >= 1

        # Second scan on same repo: hits analysis_cache, so tier 1 calls should not increase
        r2 = client.post("/api/scans", json={"source_type": "local", "target": str(repo_dir), "use_ai": True})
        assert r2.status_code == 202
        events2 = _read_sse_events(client, r2.json()["job_id"])
        comp2 = next(e for e in events2 if e.get("event") == "complete")
        assert comp2["ai_applied"] is True
        assert call_stats["tier1"] == first_tier1_calls  # Cache hit!


def test_real_readonly_api_scan_frontend(tmp_path: Path):
    """Test 5: Live read-only scan of frontend via the API."""
    db = OrbiDB(tmp_path / "test_frontend.db")
    vault = MemoryKeyVault()
    app = create_app(db=db, vault=vault)

    with TestClient(app) as client:
        r = client.post("/api/scans", json={"source_type": "local", "target": str(REPO_ROOT / "frontend"), "use_ai": False})
        assert r.status_code == 202
        job_id = r.json()["job_id"]

        events = _read_sse_events(client, job_id)
        comp = next(e for e in events if e.get("event") == "complete")
        assert comp["ai_applied"] is False

        from orbi.schema import RenderSession
        session = RenderSession.model_validate(comp["session"])
        assert validate_session(session) == []
        assert len(session.nodes) >= 20
        assert len(session.edges) >= 50
        assert session.session.stats.files_scanned >= 20
        assert session.session.stats.verified_edges >= 50

        # Verify persisted in database
        persisted = db.get_session(session.session.id)
        assert persisted is not None
        assert persisted.session.id == session.session.id
