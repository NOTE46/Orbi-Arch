"""Deterministic HLD and LLD graph builder (0 LLM tokens)."""

from __future__ import annotations

import datetime
import posixpath
import re
import uuid
from typing import Any

from orbi.repo_adapter import resolve_local_repo
from orbi.scanner import scan_repository
from orbi.schema import (
    EdgeEvidence,
    HldContainer,
    LldFileNode,
    RawImport,
    RenderSession,
    ScannedFile,
    ScanResult,
    SessionMeta,
    SessionOverrides,
    SessionStats,
    StructuralIR,
    VerifiedEdge,
    validate_session,
)

CATEGORY_KEYWORDS = {
    "frontend": {"components", "ui", "pages", "views", "web", "client", "frontend"},
    "api": {"api", "routes", "routers", "controllers", "endpoints", "server"},
    "data": {"db", "data", "models", "store", "mocks", "schema", "types", "migrations"},
    "external": {"integrations", "clients", "adapters", "external", "providers"},
}


def resolve_import_target(source_file: str, imp: RawImport, language: str, known_files: set[str]) -> str | None:
    src_dir, mod = posixpath.dirname(source_file), imp.module

    if language in ("typescript", "javascript"):
        suffixes = ("", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", "/index.jsx")

        def _ts(bases: list[str]) -> str | None:
            for b in bases:
                norm = posixpath.normpath(b)
                for c in ([norm, re.sub(r"\.(?:jsx?|mjs)$", "", norm)] if re.search(r"\.(?:jsx?|mjs)$", norm) else [norm]):
                    for s in suffixes:
                        if c + s in known_files:
                            return c + s
            return None

        if imp.is_relative or mod.startswith(("./", "../")):
            return _ts([posixpath.join(src_dir, mod)])
        if mod.startswith(("@/", "~/")):
            rel_mod = mod[2:]
            parts = [p for p in src_dir.split("/") if p]
            ancestors = ["/".join(parts[:i]) for i in range(len(parts), 0, -1) if parts[i - 1] == "src"]
            return _ts([posixpath.join(b, rel_mod) if b else rel_mod for b in ancestors + ["src", "frontend/src", "web/src", "client/src", "app", ""]])
        parts = [p for p in src_dir.split("/") if p]
        return _ts([mod] + [posixpath.join("/".join(parts[:i]), mod) for i in range(len(parts), 0, -1)])

    if language == "python":
        suffixes = ("", ".py", "/__init__.py")

        def _py(cand: str) -> str | None:
            for s in suffixes:
                if cand + s in known_files:
                    return cand + s
            if "/" in cand:
                p = posixpath.dirname(cand)
                for s in suffixes:
                    if p + s in known_files:
                        return p + s
            return None

        if imp.is_relative:
            dots = len(mod) - len(mod.lstrip("."))
            rem = mod[dots:].replace(".", "/")
            parts = [p for p in src_dir.split("/") if p]
            levels = dots - 1
            if levels > len(parts):
                return None
            target_parts = parts[: len(parts) - levels] if levels > 0 else parts
            if rem:
                target_parts.append(rem)
            cand = "/".join(target_parts)
            return _py(cand) if cand else None
        parts = [p for p in src_dir.split("/") if p]
        search_dirs = ["/".join(parts[:i]) for i in range(len(parts), 0, -1)] + ["", "src", "app", "lib", "backend", "backend/src"]
        rel = mod.replace(".", "/")
        for d in search_dirs:
            res = _py(posixpath.join(d, rel) if d else rel)
            if res:
                return res
        return None

    if language in ("c", "cpp"):
        if imp.is_relative and (t := posixpath.normpath(posixpath.join(src_dir, mod))) in known_files:
            return t
        if mod in known_files:
            return mod
        for d in ("include", "src", "inc", "common"):
            if (cand := posixpath.normpath(posixpath.join(d, mod))) in known_files:
                return cand
        return next((f for f in known_files if f.endswith("/" + mod) or f == mod), None)

    if language == "java":
        rel = mod.replace(".", "/") + ".java"
        if rel in known_files:
            return rel
        for d in ("src/main/java", "src/test/java", "src", "app/src/main/java"):
            if (cand := posixpath.normpath(posixpath.join(d, rel))) in known_files:
                return cand
        return next((f for f in known_files if f.endswith("/" + rel)), None)

    if language == "go":
        if imp.is_relative:
            cand = sorted(f for f in known_files if posixpath.dirname(f) == posixpath.normpath(posixpath.join(src_dir, mod)))
            return cand[0] if cand else None
        clean_mod = mod.strip("/")
        return next((f for f in sorted(known_files) if posixpath.dirname(f) in (clean_mod, clean_mod.lstrip("/")) or posixpath.dirname(f).endswith("/" + clean_mod)), None)

    if language == "rust":
        if imp.is_relative:
            for c in (posixpath.normpath(posixpath.join(src_dir, f"{mod}.rs")), posixpath.normpath(posixpath.join(src_dir, mod, "mod.rs"))):
                if c in known_files:
                    return c
        if mod.startswith("crate::"):
            sub = mod[7:].replace("::", "/")
            for base in (posixpath.dirname(src_dir), "src", ""):
                for s in (f"{sub}.rs", f"{sub}/mod.rs", f"{posixpath.dirname(sub)}.rs"):
                    if (cand := (posixpath.normpath(posixpath.join(base, s)) if base else s)) in known_files:
                        return cand
        return None

    if language in ("csharp", "c_sharp"):
        cls_name = mod.split(".")[-1] + ".cs"
        if f_match := next((f for f in sorted(known_files) if posixpath.basename(f) == cls_name), None):
            return f_match
        rel = mod.replace(".", "/")
        return next((f for f in sorted(known_files) if posixpath.dirname(f).endswith(rel)), None)

    return None


def is_test_file(rel_path: str) -> bool:
    parts = rel_path.lower().split("/")
    if any(p in {"test", "tests", "__tests__", "spec", "specs", "e2e"} for p in parts[:-1]):
        return True
    name = parts[-1]
    if name == "conftest.py" or name.startswith("test_") or name.endswith("_test.py"):
        return True
    if ".test." in name or ".spec." in name or name.endswith("_test.go"):
        return True
    return name.endswith(("test.java", "tests.java", "test.cs", "tests.cs"))


LAYER_INFO = {
    "frontend": ("c_layer_frontend", "Frontend & UI"),
    "api": ("c_layer_api", "API & Routing"),
    "service": ("c_layer_service", "Core Services"),
    "data": ("c_layer_data", "Data & Models"),
    "external": ("c_layer_external", "External & Adapters"),
}


def _infer_file_category(stem: str) -> str:
    s = stem.lower()
    words = set(re.split(r"[^a-z0-9]+", s)) | set(re.findall(r"[a-z]+", re.sub(r"([A-Z])", r" \1", stem).lower()))

    def m(kws: tuple[str, ...]) -> bool:
        return any(k in words or (len(k) >= 3 and any(k in w for w in words)) for k in kws)

    if m(("ui", "gui", "view", "page", "component", "frontend", "web", "client", "widget")):
        return "frontend"
    if m(("api", "server", "route", "router", "controller", "endpoint", "gateway", "handler")):
        return "api"
    if m(("db", "database", "data", "model", "schema", "store", "cache", "migration", "state", "type", "mock")):
        return "data"
    if m(("llm", "adapter", "vault", "external", "provider", "integration", "webhook", "auth", "repo_adapter")):
        return "external"
    return "service"


def _dir_container_id(rel_path: str) -> str:
    p = rel_path.split("/")
    slug = f"{p[0]}_{p[1]}" if p[0] in ("src", "app", "packages", "pkg") and len(p) >= 3 else (f"{p[0]}_root" if p[0] in ("src", "app", "packages", "pkg") else (p[0] if len(p) >= 2 else "root"))
    return f"c_{re.sub(r'[^a-zA-Z0-9_]', '_', slug).lower()}"


def assign_containers(files: list[ScannedFile]) -> tuple[list[HldContainer], dict[str, str]]:
    file_map: dict[str, str] = {}
    test_files, prod_files = [f for f in files if is_test_file(f.rel_path)], [f for f in files if not is_test_file(f.rel_path)]
    dir_grouped: dict[str, list[ScannedFile]] = {}
    for f in prod_files:
        dir_grouped.setdefault(_dir_container_id(f.rel_path), []).append(f)

    containers: list[HldContainer] = []
    if len(dir_grouped) == 1 and len(prod_files) >= 2:
        known_node_ids = {f.rel_path for f in files}
        if len(prod_files) <= 16:
            used_ids: set[str] = set()
            for f in sorted(prod_files, key=lambda x: x.rel_path):
                stem = posixpath.splitext(posixpath.basename(f.rel_path))[0]
                clean = re.sub(r"[^a-zA-Z0-9_]", "_", stem).lower() or "file"
                c_id, cnt = f"c_mod_{clean}", 2
                while c_id in used_ids or c_id in known_node_ids:
                    c_id, cnt = f"c_mod_{clean}_{cnt}", cnt + 1
                used_ids.add(c_id)
                file_map[f.rel_path] = c_id
                summ = f"Defines {', '.join(s.name for s in f.symbols[:3])}" if f.symbols else f"{f.line_count} line{'s' if f.line_count != 1 else ''} · 0 symbols"
                containers.append(HldContainer(id=c_id, label=posixpath.basename(f.rel_path), category=_infer_file_category(stem), summary=summ))
        else:
            layers: dict[str, list[ScannedFile]] = {}
            for f in prod_files:
                layers.setdefault(_infer_file_category(posixpath.splitext(posixpath.basename(f.rel_path))[0]), []).append(f)
            if len(layers) >= 2:
                for cat in ("frontend", "api", "service", "data", "external"):
                    if cat in layers:
                        c_id, label = LAYER_INFO[cat]
                        file_map.update({f.rel_path: c_id for f in layers[cat]})
                        containers.append(HldContainer(id=c_id, label=label, category=cat, summary=f"Subsystem with {len(layers[cat])} file{'s' if len(layers[cat]) != 1 else ''}"))
            else:
                only_cat = next(iter(layers))
                s_files = sorted(prod_files, key=lambda x: x.rel_path)
                k = min(4, max(2, (len(s_files) + 5) // 6))
                sz = (len(s_files) + k - 1) // k
                for i, chunk in enumerate([s_files[j : j + sz] for j in range(0, len(s_files), sz)], 1):
                    c1, c2, c_id = posixpath.basename(chunk[0].rel_path)[0].upper(), posixpath.basename(chunk[-1].rel_path)[0].upper(), f"c_group_{i}"
                    file_map.update({f.rel_path: c_id for f in chunk})
                    lbl = f"Modules {c1}-{c2}" if c1 != c2 else f"Modules {c1}"
                    containers.append(HldContainer(id=c_id, label=lbl, category=only_cat, summary=f"Subsystem with {len(chunk)} file{'s' if len(chunk) != 1 else ''}"))
    else:
        for c_id, c_files in sorted(dir_grouped.items()):
            tokens = set(c_id[2:].split("_"))
            cat = next((c for c, kws in CATEGORY_KEYWORDS.items() if tokens & kws), "service")
            title = " ".join(w.capitalize() for w in c_id[2:].split("_"))
            file_map.update({f.rel_path: c_id for f in c_files})
            containers.append(HldContainer(id=c_id, label=title, category=cat, summary=f"Subsystem with {len(c_files)} file{'s' if len(c_files) != 1 else ''}"))

    if test_files:
        file_map.update({f.rel_path: "c_tests" for f in test_files})
        containers.append(HldContainer(id="c_tests", label="Tests", category="service", summary=f"Test suite with {len(test_files)} file{'s' if len(test_files) != 1 else ''}"))

    return sorted(containers, key=lambda c: c.id), file_map


def rollup_verified_hld_edges(nodes: list[LldFileNode], lld_edges: list[VerifiedEdge]) -> list[VerifiedEdge]:
    node_to_c = {n.id: n.container_id for n in nodes}
    pairs: dict[str, dict[str, Any]] = {}
    for e in lld_edges:
        src_c, tgt_c = node_to_c.get(e.source), node_to_c.get(e.target)
        if not src_c or not tgt_c or src_c == tgt_c:
            continue
        p = pairs.setdefault(f"{src_c}->{tgt_c}", {"source": src_c, "target": tgt_c, "evidence": [], "seen": set()})
        for ev in e.evidence:
            if (ev.file, ev.line) not in p["seen"]:
                p["seen"].add((ev.file, ev.line))
                p["evidence"].append(ev)

    return sorted([
        VerifiedEdge(id=f"hld:{p['source']}->{p['target']}", scope="hld", source=p["source"], target=p["target"], label="connects to", provenance="verified", evidence=p["evidence"])
        for p in pairs.values() if p["evidence"]
    ], key=lambda x: x.id)


def build_render_session(scan: ScanResult) -> tuple[RenderSession, StructuralIR]:
    if len(scan.files) == 0:
        raise ValueError("No supported source code files found in this repository. (No Python, TypeScript, or JavaScript files found.)")

    known_files = {f.rel_path for f in scan.files}
    containers, file_map = assign_containers(scan.files)
    nodes = [
        LldFileNode(
            id=f.rel_path, container_id=file_map[f.rel_path], label=posixpath.basename(f.rel_path),
            language=f.language, summary=f"Exports {', '.join(s.name for s in f.symbols[:3])}" if f.symbols else f"Module with {len(f.symbols)} symbols",
            line_count=f.line_count, symbols=f.symbols,
        )
        for f in scan.files
    ]

    lld_map: dict[str, dict[str, Any]] = {}
    for f in scan.files:
        if is_test_file(f.rel_path):
            continue
        for imp in f.imports:
            target = resolve_import_target(f.rel_path, imp, f.language, known_files)
            if not target or target == f.rel_path or is_test_file(target):
                continue
            pair_k = f"{f.rel_path}->{target}"
            p = lld_map.setdefault(pair_k, {"source": f.rel_path, "target": target, "evidence": [], "lines": set()})
            if imp.line not in p["lines"]:
                p["lines"].add(imp.line)
                p["evidence"].append(EdgeEvidence(file=f.rel_path, line=imp.line))

    lld_edges = [
        VerifiedEdge(id=f"lld:{e['source']}->{e['target']}", scope="lld", source=e["source"], target=e["target"], label="imports", provenance="verified", evidence=e["evidence"])
        for _, e in sorted(lld_map.items())
    ]
    hld_edges = rollup_verified_hld_edges(nodes, lld_edges)
    all_edges: list[Any] = lld_edges + hld_edges
    meta = SessionMeta(
        id=f"sess_{uuid.uuid4().hex[:8]}", name=scan.repo.repo_name, source_type=scan.repo.source_type, source_ref=scan.repo.source_ref,
        commit_sha=scan.repo.commit_sha, dirty=scan.repo.dirty, is_demo=False, created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        stats=SessionStats(files_scanned=len(nodes), verified_edges=len(all_edges), inferred_edges=0),
    )
    session = RenderSession(schema_version="0.1", session=meta, containers=containers, nodes=nodes, edges=all_edges, overrides=SessionOverrides())
    errs = validate_session(session)
    if errs:
        raise ValueError(f"Constructed session failed validation: {'; '.join(errs)}")

    structural_ir = StructuralIR(repo_name=scan.repo.repo_name, commit_sha=scan.repo.commit_sha, containers=[c.model_dump() for c in containers], verified_hld_edges=[e.model_dump() for e in hld_edges])
    return session, structural_ir


def scan_local_repo(raw_path: str) -> tuple[RenderSession, StructuralIR]:
    return build_render_session(scan_repository(resolve_local_repo(raw_path)))
