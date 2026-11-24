"""Comprehensive tests for Language Pack Management, Multi-Language AST support, and cache isolation."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from orbi.db import OrbiDB
from orbi.graph_builder import build_render_session, resolve_import_target
from orbi.lang_packs import (
    PACK_CATALOG,
    _matches_grammar,
    delete_pack,
    find_grammar_files,
    install_pack,
    is_pack_installed,
)
from orbi.scanner import clear_parser_cache, scan_repository
from orbi.schema import RawImport, RepoContext
from orbi.server import create_app
from orbi.vault import MemoryKeyVault


def test_catalog_and_isolated_install_delete_lifecycle(tmp_path: Path):
    """Test 1: Catalog consistency, strict grammar stem matching, and cache lifecycle."""
    # 1. Verify 7 packs in catalog
    pack_ids = [p["id"] for p in PACK_CATALOG]
    assert pack_ids == ["python", "ts_js", "c_cpp", "java", "go", "rust", "csharp"]

    # 2. Verify strict stem matching (c vs cpp vs c_sharp)
    assert _matches_grammar("tree_sitter_c", "c") is True
    assert _matches_grammar("tree_sitter_cpp", "c") is False
    assert _matches_grammar("tree_sitter_c_sharp", "c") is False
    assert _matches_grammar("tree_sitter_csharp", "c") is False

    assert _matches_grammar("tree_sitter_cpp", "cpp") is True
    assert _matches_grammar("tree_sitter_c", "cpp") is False

    assert _matches_grammar("tree_sitter_c_sharp", "c_sharp") is True
    assert _matches_grammar("tree_sitter_csharp", "c_sharp") is True
    assert _matches_grammar("tree_sitter_c", "c_sharp") is False

    # 3. Create dummy DLLs in isolated tmp_path
    cache_dir = tmp_path / "cache"
    libs_dir = cache_dir / "libs"
    libs_dir.mkdir(parents=True)

    c_dll = libs_dir / "tree_sitter_c.dll"
    cpp_dll = libs_dir / "tree_sitter_cpp.dll"
    cs_dll = libs_dir / "tree_sitter_c_sharp.dll"

    c_dll.write_bytes(b"c_dummy")
    cpp_dll.write_bytes(b"cpp_dummy")
    cs_dll.write_bytes(b"cs_dummy")

    # Verify find_grammar_files strictness
    c_files = find_grammar_files("c", cache_dir)
    assert len(c_files) == 1
    assert c_files[0].name == "tree_sitter_c.dll"

    cpp_files = find_grammar_files("cpp", cache_dir)
    assert len(cpp_files) == 1
    assert cpp_files[0].name == "tree_sitter_cpp.dll"

    cs_files = find_grammar_files("c_sharp", cache_dir)
    assert len(cs_files) == 1
    assert cs_files[0].name == "tree_sitter_c_sharp.dll"

    # Both c and cpp are needed for c_cpp pack
    assert is_pack_installed("c_cpp", cache_dir) is True
    assert is_pack_installed("csharp", cache_dir) is True
    assert is_pack_installed("rust", cache_dir) is False

    # 4. Mock install_pack with custom downloader
    def dummy_downloader(pack_id: str, dest_dir: Path):
        dest_libs = dest_dir / "libs"
        dest_libs.mkdir(parents=True, exist_ok=True)
        if pack_id == "rust":
            (dest_libs / "tree_sitter_rust.dll").write_bytes(b"rust_dll_bytes")

    st = install_pack("rust", cache_dir, downloader=dummy_downloader)
    assert st.installed is True
    assert st.size_bytes == len(b"rust_dll_bytes")
    assert is_pack_installed("rust", cache_dir) is True

    # 5. Delete pack
    evicted: list[tuple[str, list[str]]] = []
    del_st = delete_pack("rust", cache_dir, on_evict=lambda pid, gs: evicted.append((pid, gs)))
    assert del_st.installed is False
    assert is_pack_installed("rust", cache_dir) is False
    assert len(evicted) == 1
    assert evicted[0] == ("rust", ["rust"])


def test_zero_silent_download_and_missing_pack_fallback(tmp_path: Path):
    """Test 2: Zero silent downloads, parser cache eviction, and missing pack tracking."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True)

    repo_dir = tmp_path / "sample_repo"
    repo_dir.mkdir()
    (repo_dir / "main.py").write_text("import os\n\ndef run():\n    pass\n", encoding="utf-8")
    (repo_dir / "server.go").write_text('package main\nimport "fmt"\nfunc main() {}\n', encoding="utf-8")
    (repo_dir / "lib.rs").write_text("pub fn test() {}\n", encoding="utf-8")
    (repo_dir / "Service.cs").write_text("namespace App;\nclass Service {}\n", encoding="utf-8")

    # Create dummy Python grammar in cache so Python is detected as installed
    libs_dir = cache_dir / "libs"
    libs_dir.mkdir(parents=True)
    (libs_dir / "tree_sitter_python.dll").write_bytes(b"dummy_python_dll")
    # We do not install go, rust, or csharp in cache_dir!

    repo_ctx = RepoContext(
        root_path=repo_dir,
        source_type="local",
        source_ref=str(repo_dir),
        repo_name="sample_repo",
        commit_sha="HEAD",
        dirty=False,
    )

    # If scanner attempted to download uninstalled grammars, it would fail or hit network.
    # We ensure 0 network calls by patching tslp.get_language to raise if called on uninstalled grammars.
    with patch("tree_sitter_language_pack.get_language") as mock_get_lang:
        mock_get_lang.side_effect = RuntimeError("Should not be called for uninstalled grammars!")

        scan = scan_repository(repo_ctx, cache_dir=cache_dir)

        # Scanner parsed repo and recorded missing packs without calling get_language
        assert len(scan.files) == 4
        assert scan.missing_packs == ["csharp", "go", "rust"]

        # Python file was not parsed with tree-sitter since get_language was mocked, but symbols are empty
        for f in scan.files:
            if f.rel_path != "main.py":
                assert f.symbols == []
                assert f.imports == []

    # Clear parser cache test
    clear_parser_cache()
    clear_parser_cache(["python"])


def test_multi_language_import_resolution_and_tier2_fallback(tmp_path: Path):
    """Test 3: Import resolution across C/C++, Java, Go, Rust, C# and Tier-2 file fallback."""
    known_files = {
        "src/native/engine.cpp",
        "src/native/engine.hpp",
        "include/common.h",
        "src/main/java/com/example/api/UserController.java",
        "src/main/java/com/example/service/UserService.java",
        "pkg/util/helper.go",
        "cmd/app/main.go",
        "src/parser/mod.rs",
        "src/parser/ast.rs",
        "App/Services/AuthService.cs",
        "App/Controllers/AuthController.cs",
    }

    # 1. C / C++ relative and include resolution
    t_cpp = resolve_import_target(
        "src/native/engine.cpp",
        RawImport(module="engine.hpp", line=1, is_relative=True),
        "cpp",
        known_files,
    )
    assert t_cpp == "src/native/engine.hpp"

    t_c_inc = resolve_import_target(
        "src/native/engine.cpp",
        RawImport(module="common.h", line=2, is_relative=False),
        "cpp",
        known_files,
    )
    assert t_c_inc == "include/common.h"

    # 2. Java package import resolution
    t_java = resolve_import_target(
        "src/main/java/com/example/api/UserController.java",
        RawImport(module="com.example.service.UserService", line=3, is_relative=False),
        "java",
        known_files,
    )
    assert t_java == "src/main/java/com/example/service/UserService.java"

    # 3. Go package import resolution
    t_go = resolve_import_target(
        "cmd/app/main.go",
        RawImport(module="pkg/util", line=4, is_relative=False),
        "go",
        known_files,
    )
    assert t_go == "pkg/util/helper.go"

    # 4. Rust mod and use resolution
    t_rust_mod = resolve_import_target(
        "src/parser/mod.rs",
        RawImport(module="ast", line=1, is_relative=True),
        "rust",
        known_files,
    )
    assert t_rust_mod == "src/parser/ast.rs"

    t_rust_use = resolve_import_target(
        "src/main.rs",
        RawImport(module="crate::parser::ast", line=2, is_relative=True),
        "rust",
        known_files,
    )
    assert t_rust_use == "src/parser/ast.rs"

    # 5. C# namespace / class resolution
    t_cs = resolve_import_target(
        "App/Controllers/AuthController.cs",
        RawImport(module="App.Services.AuthService", line=1, is_relative=False),
        "csharp",
        known_files,
    )
    assert t_cs == "App/Services/AuthService.cs"

    # 6. Tier-2 fallback: repository with 0 Tier-1 files, but with .rb, .sql, .sh
    tier2_repo = tmp_path / "tier2_repo"
    tier2_repo.mkdir()
    (tier2_repo / "script.rb").write_text("puts 'hello'\n", encoding="utf-8")
    (tier2_repo / "schema.sql").write_text("CREATE TABLE users (id INT);\n", encoding="utf-8")
    (tier2_repo / "deploy.sh").write_text("#!/bin/bash\necho deploy\n", encoding="utf-8")

    t2_ctx = RepoContext(
        root_path=tier2_repo,
        source_type="local",
        source_ref=str(tier2_repo),
        repo_name="tier2_repo",
        commit_sha="HEAD",
        dirty=False,
    )

    t2_scan = scan_repository(t2_ctx)
    assert len(t2_scan.files) == 3
    for f in t2_scan.files:
        assert f.language == "other"
        assert f.symbols == []
        assert f.imports == []

    # Verify session builds cleanly without error
    session, ir = build_render_session(t2_scan)
    assert len(session.nodes) == 3
    assert len(session.containers) >= 1


def test_fastapi_languages_endpoints_and_sse_warning(tmp_path: Path):
    """Test 4: FastAPI language pack endpoints, Origin CSRF guard, and SSE scan warning."""
    db = OrbiDB(tmp_path / "test_lang.db")
    vault = MemoryKeyVault()
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True)

    app = create_app(db=db, vault=vault, cache_dir=cache_dir)

    with TestClient(app) as client:
        # 1. GET /api/languages
        r_get = client.get("/api/languages")
        assert r_get.status_code == 200
        packs = r_get.json()
        assert len(packs) == 7
        assert {p["id"] for p in packs} == {"python", "ts_js", "c_cpp", "java", "go", "rust", "csharp"}

        # 2. Unknown pack 404
        r_404 = client.post("/api/languages/unknown/install", headers={"Origin": "http://127.0.0.1:5173"})
        assert r_404.status_code == 404

        r_del_404 = client.delete("/api/languages/unknown", headers={"Origin": "http://127.0.0.1:5173"})
        assert r_del_404.status_code == 404

        # 3. Origin guard blocks evil origin
        r_evil_inst = client.post("/api/languages/c_cpp/install", headers={"Origin": "https://evil.com"})
        assert r_evil_inst.status_code == 403

        r_evil_del = client.delete("/api/languages/c_cpp", headers={"Origin": "https://evil.com"})
        assert r_evil_del.status_code == 403

        # 4. SSE scan with missing pack emits warning
        repo_dir = tmp_path / "sse_repo"
        repo_dir.mkdir()
        (repo_dir / "main.go").write_text("package main\n", encoding="utf-8")

        r_scan = client.post(
            "/api/scans",
            json={"source_type": "local", "target": str(repo_dir), "use_ai": False},
            headers={"Origin": "http://127.0.0.1:5173"},
        )
        assert r_scan.status_code == 202
        job_id = r_scan.json()["job_id"]

        events = []
        with client.stream("GET", f"/api/scans/{job_id}/events") as resp:
            assert resp.status_code == 200
            for line in resp.iter_lines():
                if line.startswith("data: "):
                    ev = json.loads(line[6:])
                    events.append(ev)
                    if ev.get("event") in ("complete", "error"):
                        break

        complete_ev = next((e for e in events if e.get("event") == "complete"), None)
        assert complete_ev is not None
        warnings = complete_ev.get("warnings", [])
        assert any("Missing language pack(s): Go" in w for w in warnings)


def test_install_pack_downloads_as_list_not_str(tmp_path: Path):
    """Verify install_pack passes list[str] to tslp.download for Rust binding compatibility."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True)

    with (
        patch("tree_sitter_language_pack.configure") as mock_conf,
        patch("tree_sitter_language_pack.download") as mock_dl,
    ):
        st = install_pack("csharp", cache_dir)
        mock_conf.assert_called_once()
        mock_dl.assert_called_once_with(["csharp"])
        call_arg = mock_dl.call_args[0][0]
        assert isinstance(call_arg, list)
        assert call_arg == ["csharp"]
        assert not isinstance(call_arg, str)
        assert st.id == "csharp"


def test_cross_platform_grammar_detection_and_no_c_false_match(tmp_path: Path):
    """Verify Linux (.so), macOS (.dylib), and Windows (.dll) recognition and strict 'c' matching."""
    cache_dir = tmp_path / "cache"
    libs_dir = cache_dir / "libs"
    libs_dir.mkdir(parents=True)

    # 1. Stem matching unit checks across prefixes and extensions
    assert _matches_grammar("libtree_sitter_python", "python") is True
    assert _matches_grammar("python", "python") is True
    assert _matches_grammar("libpython", "python") is True
    assert _matches_grammar("tree_sitter_python", "python") is True
    assert _matches_grammar("libtree_sitter_c", "c") is True
    assert _matches_grammar("libc", "c") is True
    assert _matches_grammar("c", "c") is True
    assert _matches_grammar("libtree_sitter_rust", "rust") is True
    assert _matches_grammar("libtree_sitter_javascript_orchard", "javascript") is True

    # Strict isolation for C: cpp, c_sharp, csharp never match c
    assert _matches_grammar("libtree_sitter_cpp", "c") is False
    assert _matches_grammar("libcpp", "c") is False
    assert _matches_grammar("libtree_sitter_csharp", "c") is False
    assert _matches_grammar("libtree_sitter_c_sharp", "c") is False
    assert _matches_grammar("libcsharp", "c") is False
    assert _matches_grammar("libc_sharp", "c") is False

    # 2. Filesystem checks in isolated tmp_path
    (libs_dir / "libtree_sitter_python.so").write_bytes(b"linux_python")
    (libs_dir / "libtree_sitter_c.so").write_bytes(b"linux_c")
    (libs_dir / "libtree_sitter_cpp.so").write_bytes(b"linux_cpp")
    (libs_dir / "libtree_sitter_csharp.so").write_bytes(b"linux_csharp")
    (libs_dir / "libtree_sitter_rust.dylib").write_bytes(b"macos_rust")
    (libs_dir / "tree_sitter_typescript.dll").write_bytes(b"win_ts")
    (libs_dir / "tree_sitter_tsx.dll").write_bytes(b"win_tsx")
    (libs_dir / "tree_sitter_javascript_orchard.dll").write_bytes(b"win_js")

    # Verify find_grammar_files
    py_files = find_grammar_files("python", cache_dir)
    assert len(py_files) == 1
    assert py_files[0].name == "libtree_sitter_python.so"

    c_files = find_grammar_files("c", cache_dir)
    assert len(c_files) == 1
    assert c_files[0].name == "libtree_sitter_c.so"

    cpp_files = find_grammar_files("cpp", cache_dir)
    assert len(cpp_files) == 1
    assert cpp_files[0].name == "libtree_sitter_cpp.so"

    cs_files = find_grammar_files("c_sharp", cache_dir)
    assert len(cs_files) == 1
    assert cs_files[0].name == "libtree_sitter_csharp.so"

    rust_files = find_grammar_files("rust", cache_dir)
    assert len(rust_files) == 1
    assert rust_files[0].name == "libtree_sitter_rust.dylib"

    # Verify is_pack_installed
    assert is_pack_installed("python", cache_dir) is True
    assert is_pack_installed("c_cpp", cache_dir) is True
    assert is_pack_installed("csharp", cache_dir) is True
    assert is_pack_installed("rust", cache_dir) is True
    assert is_pack_installed("ts_js", cache_dir) is True
    assert is_pack_installed("go", cache_dir) is False


