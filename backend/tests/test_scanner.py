"""Comprehensive test suite for security guard, AST scanner, and graph builder."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from orbi.graph_builder import scan_local_repo
from orbi.repo_adapter import resolve_local_repo
from orbi.scanner import scan_repository
from orbi.schema import validate_session
from orbi.security import (
    MAX_FILE_BYTES,
    is_safe_repo_file,
    validate_github_url,
    validate_local_path,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_security_and_isolation(tmp_path: Path):
    """Test 1: Verify strict security boundaries, secret file blocking, and URL validation."""
    # Create valid file
    (tmp_path / "main.py").write_text("def run():\n    return 42\n", encoding="utf-8")

    # Create blocked secret and config files
    (tmp_path / ".env").write_text("SECRET=123\n", encoding="utf-8")
    (tmp_path / ".env.local").write_text("LOCAL=456\n", encoding="utf-8")
    (tmp_path / "private.key").write_text("KEY\n", encoding="utf-8")
    (tmp_path / "id_rsa").write_text("SSH_KEY\n", encoding="utf-8")

    # Create blocked directory and file inside it
    nm_dir = tmp_path / "node_modules"
    nm_dir.mkdir()
    (nm_dir / "bad.js").write_text("console.log('bad');\n", encoding="utf-8")

    # Create oversized file (>512 KB)
    oversized = tmp_path / "large.py"
    oversized.write_bytes(b"# pad\n" * ((MAX_FILE_BYTES // 6) + 100))

    # Create binary file with NUL bytes
    binary_file = tmp_path / "binary.py"
    binary_file.write_bytes(b"x = 1\x00\x00\x00")

    # Test outside path check
    outside_file = tmp_path.parent / "outside.py"
    outside_file.write_text("print('outside')\n", encoding="utf-8")
    assert not is_safe_repo_file(tmp_path, outside_file)

    # Symlink escape test if OS permits symlink creation
    try:
        symlink_file = tmp_path / "sym_escape.py"
        os.symlink(str(outside_file), str(symlink_file))
        assert not is_safe_repo_file(tmp_path, symlink_file)
    except (OSError, NotImplementedError):
        pass  # Windows unprivileged developer mode symlink fallback

    repo = resolve_local_repo(str(tmp_path))
    scan = scan_repository(repo)

    scanned_rel_paths = {f.rel_path for f in scan.files}
    assert "main.py" in scanned_rel_paths
    assert ".env" not in scanned_rel_paths
    assert ".env.local" not in scanned_rel_paths
    assert "private.key" not in scanned_rel_paths
    assert "id_rsa" not in scanned_rel_paths
    assert "node_modules/bad.js" not in scanned_rel_paths
    assert "large.py" not in scanned_rel_paths
    assert "binary.py" not in scanned_rel_paths
    assert "sym_escape.py" not in scanned_rel_paths
    assert len(scan.files) == 1

    # GitHub URL validation tests
    canonical, owner, repo_name = validate_github_url("https://github.com/facebook/react")
    assert canonical == "https://github.com/facebook/react"
    assert owner == "facebook"
    assert repo_name == "react"

    canonical2, _, _ = validate_github_url("https://github.com/owner/repo.git")
    assert canonical2 == "https://github.com/owner/repo"

    invalid_urls = [
        "git@github.com:owner/repo.git",
        "ssh://github.com/owner/repo",
        "http://github.com/owner/repo",
        "https://user:token@github.com/owner/repo",
        "https://github.com/owner/repo?ref=main",
        "https://github.com/owner/repo#readme",
        "https://github.com/../etc",
        "",
        "not_a_url",
    ]
    for bad_url in invalid_urls:
        with pytest.raises(ValueError):
            validate_github_url(bad_url)

    # Local path validation
    with pytest.raises(ValueError):
        validate_local_path("")
    with pytest.raises(ValueError):
        validate_local_path("C:/nonexistent_orbi_dir_xyz")
    with pytest.raises(ValueError):
        validate_local_path("test; rm -rf /")


def test_synthetic_multi_language_repo(tmp_path: Path):
    """Test 2: Multi-language repo (Python + TS/TSX) with relative/absolute imports and AST extraction."""
    # 1. api/routes.py importing services/orders.py
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    (api_dir / "routes.py").write_text(
        "from fastapi import APIRouter\n"
        "from services.orders import OrderService\n"
        "from .helper import format_response\n\n"
        "router = APIRouter()\n\n"
        "def get_routes():\n"
        "    return []\n",
        encoding="utf-8",
    )
    (api_dir / "helper.py").write_text(
        "def format_response(data):\n    return {'data': data}\n",
        encoding="utf-8",
    )

    # 2. services/orders.py
    services_dir = tmp_path / "services"
    services_dir.mkdir()
    (services_dir / "orders.py").write_text(
        "class OrderService:\n"
        "    def create_order(self, item_id: int):\n"
        "        return item_id\n",
        encoding="utf-8",
    )

    # 3. web/App.tsx importing ./components/Button and ../lib/api.js (mapping to lib/api.ts)
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    (web_dir / "App.tsx").write_text(
        "import React from 'react';\n"
        "import { Button } from './components/Button';\n"
        "import { fetchData } from '../lib/api.js';\n\n"
        "export function App() {\n"
        "    return <Button />;\n"
        "}\n",
        encoding="utf-8",
    )
    btn_dir = web_dir / "components"
    btn_dir.mkdir()
    (btn_dir / "Button.tsx").write_text(
        "export function Button() {\n    return <button>Click</button>;\n}\n",
        encoding="utf-8",
    )

    # 4. lib/api.ts
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir()
    (lib_dir / "api.ts").write_text(
        "export interface ApiResponse {\n    ok: boolean;\n}\n\n"
        "export function fetchData(): ApiResponse {\n    return { ok: true };\n}\n",
        encoding="utf-8",
    )

    session, structural_ir = scan_local_repo(str(tmp_path))

    # Assert session validity
    validation_errors = validate_session(session)
    assert validation_errors == [], f"Validation errors: {validation_errors}"
    assert session.session.is_demo is False
    assert len(session.nodes) == 6

    # Check symbols
    node_map = {n.id: n for n in session.nodes}
    assert "api/routes.py" in node_map
    assert any(s.name == "get_routes" and s.line >= 1 for s in node_map["api/routes.py"].symbols)
    assert "services/orders.py" in node_map
    assert any(s.name == "OrderService" and s.kind == "class" for s in node_map["services/orders.py"].symbols)

    # Check edges and evidence
    verified_lld = [e for e in session.edges if e.scope == "lld" and e.provenance == "verified"]
    lld_pairs = {(e.source, e.target) for e in verified_lld}
    assert ("api/routes.py", "services/orders.py") in lld_pairs
    assert ("api/routes.py", "api/helper.py") in lld_pairs
    assert ("web/App.tsx", "web/components/Button.tsx") in lld_pairs
    assert ("web/App.tsx", "lib/api.ts") in lld_pairs

    # Check evidence on an edge
    routes_to_orders = next(e for e in verified_lld if e.source == "api/routes.py" and e.target == "services/orders.py")
    assert len(routes_to_orders.evidence) >= 1
    assert routes_to_orders.evidence[0].file == "api/routes.py"
    assert routes_to_orders.evidence[0].line == 2

    # Verify HLD edges rolled up across containers
    verified_hld = [e for e in session.edges if e.scope == "hld" and e.provenance == "verified"]
    assert len(verified_hld) >= 1

    # Verify StructuralIR
    assert structural_ir.repo_name == tmp_path.name
    assert len(structural_ir.containers) == len(session.containers)
    assert len(structural_ir.verified_hld_edges) == len(verified_hld)


def test_real_world_self_scan_frontend():
    """Test 3: Live read-only self-scan of frontend."""
    frontend_path = str(REPO_ROOT / "frontend")
    assert Path(frontend_path).exists(), f"Frontend directory {frontend_path} must exist"

    t0 = time.perf_counter()
    session, structural_ir = scan_local_repo(frontend_path)
    scan_duration_ms = (time.perf_counter() - t0) * 1000

    # Strict contract validation
    errs = validate_session(session)
    assert errs == [], f"Validation errors on frontend scan: {errs}"

    # Metric assertions
    assert session.session.is_demo is False
    assert len(session.nodes) >= 15, f"Expected >= 15 files scanned, got {len(session.nodes)}"
    assert session.session.stats.files_scanned >= 15

    lld_edges = [e for e in session.edges if e.scope == "lld" and e.provenance == "verified"]
    hld_edges = [e for e in session.edges if e.scope == "hld" and e.provenance == "verified"]
    assert len(session.edges) >= 15, f"Expected >= 15 verified edges, got {len(session.edges)}"
    assert session.session.stats.inferred_edges == 0

    # Security check: no node_modules or dist in scanned files
    for n in session.nodes:
        assert "node_modules" not in n.id, f"node_modules leaked into nodes: {n.id}"
        assert not n.id.startswith("dist/"), f"dist leaked into nodes: {n.id}"

    # Landmark files exist
    node_ids = {n.id for n in session.nodes}
    assert "src/App.tsx" in node_ids, "src/App.tsx must be scanned"
    assert "src/lib/graph.ts" in node_ids, "src/lib/graph.ts must be scanned"

    # Evidence check
    assert len(hld_edges) >= 1, "Expected at least 1 verified HLD edge"
    for hld in hld_edges:
        assert len(hld.evidence) >= 1
        assert hld.evidence[0].line >= 1

    # Crisp 4-line summary
    print("\n" + "=" * 60)
    print("ORBI ARCHITECTURE ENGINE — LIVE SELF-SCAN REPORT")
    print(f"Target: {frontend_path} | Scan Duration: {scan_duration_ms:.1f} ms")
    print(f"Scanned Files: {len(session.nodes)} across {len(session.containers)} HLD Containers")
    print(f"Verified Edges: {len(lld_edges)} LLD / {len(hld_edges)} HLD (Total: {len(session.edges)})")
    print("=" * 60 + "\n")


def test_import_resolution_and_empty_repo_guards(tmp_path: Path):
    """Test 4: Regression tests for @/ TS alias, Python subfolder-root imports, and empty repo guard."""
    # 1. Empty repo test
    empty_dir = tmp_path / "empty_repo"
    empty_dir.mkdir()
    (empty_dir / "README.md").write_text("# Just docs\n", encoding="utf-8")
    with pytest.raises(ValueError, match="No Python, TypeScript, or JavaScript files found"):
        scan_local_repo(str(empty_dir))

    # 2. Repo with TS @/ alias and Python subfolder-root import
    repo_dir = tmp_path / "real_style_repo"
    repo_dir.mkdir()

    # TS files: frontend/src/pages/Home.tsx importing @/lib/api -> frontend/src/lib/api.ts
    fe_pages = repo_dir / "frontend" / "src" / "pages"
    fe_pages.mkdir(parents=True)
    fe_lib = repo_dir / "frontend" / "src" / "lib"
    fe_lib.mkdir(parents=True)

    (fe_lib / "api.ts").write_text("export function getApi() { return 'ok'; }\n", encoding="utf-8")
    (fe_pages / "Home.tsx").write_text(
        "import React from 'react';\n"
        "import { getApi } from '@/lib/api';\n\n"
        "export function Home() { return <div>{getApi()}</div>; }\n",
        encoding="utf-8",
    )

    # Python files: backend/api/routes.py doing from services.orders import create_order -> backend/services/orders.py
    be_api = repo_dir / "backend" / "api"
    be_api.mkdir(parents=True)
    be_services = repo_dir / "backend" / "services"
    be_services.mkdir(parents=True)

    (be_services / "orders.py").write_text("def create_order(): return 123\n", encoding="utf-8")
    (be_api / "routes.py").write_text(
        "from services.orders import create_order\n\n"
        "def handle_order():\n"
        "    return create_order()\n",
        encoding="utf-8",
    )

    session, _ = scan_local_repo(str(repo_dir))
    errs = validate_session(session)
    assert errs == []

    verified_lld = [e for e in session.edges if e.scope == "lld" and e.provenance == "verified"]
    pairs = {(e.source, e.target) for e in verified_lld}

    # Verify TS @/ alias resolved
    assert ("frontend/src/pages/Home.tsx", "frontend/src/lib/api.ts") in pairs

    # Verify Python subfolder-root import resolved
    assert ("backend/api/routes.py", "backend/services/orders.py") in pairs


def test_test_files_are_independent_nodes_without_edges(tmp_path: Path):
    """Test 5: Verify test files are grouped in c_tests with 0 dependency edges to or from production."""
    repo_dir = tmp_path / "repo_with_tests"
    repo_dir.mkdir()

    src_dir = repo_dir / "src"
    src_dir.mkdir()
    tests_dir = repo_dir / "tests"
    tests_dir.mkdir()

    # Production files
    (src_dir / "service.py").write_text("def do_service():\n    return 42\n", encoding="utf-8")
    (src_dir / "api.py").write_text("from .service import do_service\n\ndef run():\n    return do_service()\n", encoding="utf-8")
    (src_dir / "utils.ts").write_text("export function helper(): string { return 'ok'; }\n", encoding="utf-8")

    # Test files (one in tests/, one colocated in src/)
    (tests_dir / "test_service.py").write_text("from src.service import do_service\n\ndef test_srv():\n    assert do_service() == 42\n", encoding="utf-8")
    (src_dir / "utils.test.ts").write_text("import { helper } from './utils';\n\ntest('helper', () => { expect(helper()).toBe('ok'); });\n", encoding="utf-8")

    session, _ = scan_local_repo(str(repo_dir))
    errs = validate_session(session)
    assert errs == []

    # All 5 files exist in session.nodes
    node_map = {n.id: n for n in session.nodes}
    assert len(session.nodes) == 5
    expected_files = {
        "src/service.py",
        "src/api.py",
        "src/utils.ts",
        "tests/test_service.py",
        "src/utils.test.ts",
    }
    assert set(node_map.keys()) == expected_files

    # Containers check
    c_map = {c.id: c for c in session.containers}
    assert "c_tests" in c_map
    assert c_map["c_tests"].label == "Tests"

    # Test files live inside "c_tests"
    assert node_map["tests/test_service.py"].container_id == "c_tests"
    assert node_map["src/utils.test.ts"].container_id == "c_tests"

    # Production files live in production container(s)
    assert node_map["src/service.py"].container_id != "c_tests"
    assert node_map["src/api.py"].container_id != "c_tests"
    assert node_map["src/utils.ts"].container_id != "c_tests"

    # Production edge is present
    lld_pairs = {(e.source, e.target) for e in session.edges if e.scope == "lld"}
    assert ("src/api.py", "src/service.py") in lld_pairs

    # ZERO edges have tests/test_service.py, src/utils.test.ts, or "c_tests" as source or target
    for e in session.edges:
        assert e.source not in ("tests/test_service.py", "src/utils.test.ts", "c_tests")
        assert e.target not in ("tests/test_service.py", "src/utils.test.ts", "c_tests")

    # Self-scan on backend
    backend_path = Path(__file__).resolve().parent.parent
    be_session, _ = scan_local_repo(str(backend_path))
    assert validate_session(be_session) == []
    be_node_map = {n.id: n for n in be_session.nodes}
    assert "tests/test_scanner.py" in be_node_map
    assert be_node_map["tests/test_scanner.py"].container_id == "c_tests"
    for e in be_session.edges:
        assert e.source != "c_tests" and not e.source.startswith("tests/")
        assert e.target != "c_tests" and not e.target.startswith("tests/")


def test_flat_repo_promotes_modules_to_connected_hld_with_independent_tests(tmp_path: Path):
    """Test 6: Flat repo promotion for small repos (Case A), large repos (Case B), and real backend self-scan."""
    # --- Case A: Small flat repo (root-level Python app <= 16 files) ---
    repo_a = tmp_path / "flat_small_repo"
    repo_a.mkdir()
    (repo_a / "main.py").write_text("import control\nimport cvfile\n\ndef run():\n    control.step()\n    cvfile.load()\n", encoding="utf-8")
    (repo_a / "gui.py").write_text("import cvfile\n\ndef render():\n    cvfile.load()\n", encoding="utf-8")
    (repo_a / "control.py").write_text("def step():\n    pass\n", encoding="utf-8")
    (repo_a / "cvfile.py").write_text("def load():\n    pass\n", encoding="utf-8")

    tests_dir = repo_a / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_main.py").write_text("import main\n\ndef test_run():\n    main.run()\n", encoding="utf-8")

    session_a, _ = scan_local_repo(str(repo_a))
    assert validate_session(session_a) == []

    # 4 promoted production containers + 1 c_tests container = 5 containers
    c_map_a = {c.id: c for c in session_a.containers}
    assert len(session_a.containers) == 5
    assert "c_tests" in c_map_a
    assert c_map_a["c_tests"].label == "Tests"

    # Production modules promoted into distinct HLD containers
    node_map_a = {n.id: n for n in session_a.nodes}
    assert node_map_a["main.py"].container_id == "c_mod_main"
    assert node_map_a["gui.py"].container_id == "c_mod_gui"
    assert node_map_a["control.py"].container_id == "c_mod_control"
    assert node_map_a["cvfile.py"].container_id == "c_mod_cvfile"
    assert node_map_a["tests/test_main.py"].container_id == "c_tests"

    # Category and summary checks
    assert c_map_a["c_mod_gui"].category == "frontend"
    for mod_id in ("c_mod_main", "c_mod_gui", "c_mod_control", "c_mod_cvfile"):
        assert not c_map_a[mod_id].summary.startswith("Subsystem with 1")

    # Zero edges touch tests or c_tests
    for e in session_a.edges:
        assert e.source not in ("tests/test_main.py", "c_tests")
        assert e.target not in ("tests/test_main.py", "c_tests")

    # Verified HLD edges exist between the promoted modules
    hld_pairs_a = {(e.source, e.target) for e in session_a.edges if e.scope == "hld"}
    assert ("c_mod_main", "c_mod_control") in hld_pairs_a
    assert ("c_mod_main", "c_mod_cvfile") in hld_pairs_a
    assert ("c_mod_gui", "c_mod_cvfile") in hld_pairs_a

    # --- Real self-scan check on backend ---
    backend_path = Path(__file__).resolve().parent.parent
    be_session, _ = scan_local_repo(str(backend_path))
    assert validate_session(be_session) == []
    assert len(be_session.containers) >= 10
    be_hld_edges = [e for e in be_session.edges if e.scope == "hld"]
    assert len(be_hld_edges) >= 10
    for e in be_session.edges:
        assert e.source != "c_tests" and not e.source.startswith("tests/")
        assert e.target != "c_tests" and not e.target.startswith("tests/")

    # --- Case B: Large flat repo (> 16 files) ---
    repo_b = tmp_path / "flat_large_repo"
    repo_b.mkdir()
    # 20 flat files across 4 categories (gui_*, api_*, db_*, svc_*)
    for i in range(5):
        (repo_b / f"gui_{i}.py").write_text(f"def render_{i}(): pass\n", encoding="utf-8")
        (repo_b / f"api_{i}.py").write_text(f"def route_{i}(): pass\n", encoding="utf-8")
        (repo_b / f"db_{i}.py").write_text(f"def query_{i}(): pass\n", encoding="utf-8")
        (repo_b / f"svc_{i}.py").write_text(f"def compute_{i}(): pass\n", encoding="utf-8")

    session_b, _ = scan_local_repo(str(repo_b))
    assert validate_session(session_b) == []
    # Assert it groups into multiple architectural layer containers (2..6) rather than 20 individual cards
    assert 2 <= len(session_b.containers) <= 6
    b_c_ids = {c.id for c in session_b.containers}
    assert b_c_ids.issubset({"c_layer_frontend", "c_layer_api", "c_layer_data", "c_layer_service", "c_layer_external"})



