"""Deterministic Language Pack Catalog and Cache Management."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from orbi.api_models import LanguagePackStatus
from orbi.schema import SupportedLanguage

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "treesitter"

PACK_CATALOG: list[dict[str, Any]] = [
    {"id": "python", "label": "Python", "extensions": [".py"], "grammars": ["python"]},
    {"id": "ts_js", "label": "TypeScript / JavaScript", "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"], "grammars": ["typescript", "tsx", "javascript"]},
    {"id": "c_cpp", "label": "C / C++", "extensions": [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"], "grammars": ["c", "cpp"]},
    {"id": "java", "label": "Java", "extensions": [".java"], "grammars": ["java"]},
    {"id": "go", "label": "Go", "extensions": [".go"], "grammars": ["go"]},
    {"id": "rust", "label": "Rust", "extensions": [".rs"], "grammars": ["rust"]},
    {"id": "csharp", "label": "C#", "extensions": [".cs"], "grammars": ["c_sharp"]},
]

EXT_TO_SPEC: dict[str, tuple[str, SupportedLanguage, str]] = {
    ".py": ("python", "python", "python"),
    ".ts": ("ts_js", "typescript", "typescript"),
    ".tsx": ("ts_js", "typescript", "tsx"),
    **{ext: ("ts_js", "javascript", "javascript") for ext in (".js", ".jsx", ".mjs", ".cjs")},
    ".c": ("c_cpp", "c", "c"),
    ".h": ("c_cpp", "c", "c"),
    **{ext: ("c_cpp", "cpp", "cpp") for ext in (".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx")},
    ".java": ("java", "java", "java"),
    ".go": ("go", "go", "go"),
    ".rs": ("rust", "rust", "rust"),
    ".cs": ("csharp", "csharp", "c_sharp"),
}

SECONDARY_EXTENSIONS: set[str] = {
    ".rb", ".php", ".kt", ".kts", ".swift", ".dart", ".scala",
    ".lua", ".vue", ".svelte", ".html", ".css", ".sql", ".sh",
}


def get_pack_def(pack_id: str) -> dict[str, Any] | None:
    return next((p for p in PACK_CATALOG if p["id"] == pack_id), None)


def _matches_grammar(stem: str, grammar: str) -> bool:
    s, g = stem.lower(), grammar.lower()
    if s.startswith("lib"):
        s = s[3:]
    if s.startswith("tree_sitter_"):
        s = s[12:]
    if g == "c":
        return s == "c"
    if g == "cpp":
        return s == "cpp"
    if g in ("c_sharp", "csharp"):
        return s in ("c_sharp", "csharp")
    return s == g or s.startswith(f"{g}_")


def _get_removed_markers(cache_dir: Path) -> set[str]:
    marker_file = cache_dir / ".removed_packs.json"
    if not marker_file.is_file():
        return set()
    try:
        data = json.loads(marker_file.read_text(encoding="utf-8"))
        return set(data) if isinstance(data, list) else set()
    except Exception:
        return set()


def _set_removed_markers(cache_dir: Path, markers: set[str]) -> None:
    marker_file = cache_dir / ".removed_packs.json"
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        if markers:
            marker_file.write_text(json.dumps(sorted(markers)), encoding="utf-8")
        elif marker_file.exists():
            marker_file.unlink()
    except Exception:
        pass


def find_grammar_files(grammar: str, cache_dir: Path | None = None) -> list[Path]:
    c_dir = (cache_dir or DEFAULT_CACHE_DIR).resolve()
    if not c_dir.exists() or grammar in _get_removed_markers(c_dir):
        return []
    valid = {".dll", ".so", ".dylib"}
    try:
        return sorted([p for p in c_dir.rglob("*") if p.is_file() and p.suffix.lower() in valid and _matches_grammar(p.stem, grammar)])
    except Exception:
        return []


def is_grammar_installed(grammar: str, cache_dir: Path | None = None) -> bool:
    return len(find_grammar_files(grammar, cache_dir)) > 0


def is_pack_installed(pack_id: str, cache_dir: Path | None = None) -> bool:
    pack = get_pack_def(pack_id)
    return bool(pack and all(is_grammar_installed(g, cache_dir) for g in pack["grammars"]))


def list_packs(cache_dir: Path | None = None) -> list[LanguagePackStatus]:
    c_dir = (cache_dir or DEFAULT_CACHE_DIR).resolve()
    statuses: list[LanguagePackStatus] = []
    for p in PACK_CATALOG:
        g_files = [f for g in p["grammars"] for f in find_grammar_files(g, c_dir)]
        installed = len(p["grammars"]) > 0 and all(is_grammar_installed(g, c_dir) for g in p["grammars"])
        size = sum(f.stat().st_size for f in g_files if f.exists()) if installed else 0
        statuses.append(
            LanguagePackStatus(
                id=p["id"], label=p["label"], extensions=p["extensions"],
                grammars=p["grammars"], installed=installed, size_bytes=size,
            )
        )
    return statuses


def install_pack(
    pack_id: str,
    cache_dir: Path | None = None,
    downloader: Callable[[str, Path], None] | None = None,
) -> LanguagePackStatus:
    pack = get_pack_def(pack_id)
    if not pack:
        raise ValueError(f"Unknown language pack: {pack_id}")
    c_dir = (cache_dir or DEFAULT_CACHE_DIR).resolve()
    c_dir.mkdir(parents=True, exist_ok=True)

    markers = _get_removed_markers(c_dir)
    markers.difference_update(pack["grammars"])
    _set_removed_markers(c_dir, markers)

    if downloader is not None:
        downloader(pack_id, c_dir)
    else:
        import tree_sitter_language_pack as tslp
        tslp.configure(tslp.PackConfig(cache_dir=str(c_dir)))
        for g in pack["grammars"]:
            tslp.download(["csharp" if g == "c_sharp" else g])

    return next((s for s in list_packs(c_dir) if s.id == pack_id), LanguagePackStatus(
        id=pack["id"], label=pack["label"], extensions=pack["extensions"],
        grammars=pack["grammars"], installed=is_pack_installed(pack_id, c_dir), size_bytes=0,
    ))


def delete_pack(
    pack_id: str,
    cache_dir: Path | None = None,
    on_evict: Callable[[str, list[str]], None] | None = None,
) -> LanguagePackStatus:
    pack = get_pack_def(pack_id)
    if not pack:
        raise ValueError(f"Unknown language pack: {pack_id}")
    c_dir = (cache_dir or DEFAULT_CACHE_DIR).resolve()
    g_files = [f for g in pack["grammars"] for f in find_grammar_files(g, c_dir)]
    failed_grammars: set[str] = set()

    for f in g_files:
        try:
            f.unlink()
        except (PermissionError, OSError):
            for g in pack["grammars"]:
                if _matches_grammar(f.stem, g):
                    failed_grammars.add(g)

    if failed_grammars:
        markers = _get_removed_markers(c_dir)
        markers.update(failed_grammars)
        _set_removed_markers(c_dir, markers)

    if on_evict:
        on_evict(pack_id, pack["grammars"])

    return next((s for s in list_packs(c_dir) if s.id == pack_id), LanguagePackStatus(
        id=pack["id"], label=pack["label"], extensions=pack["extensions"],
        grammars=pack["grammars"], installed=False, size_bytes=0,
    ))
