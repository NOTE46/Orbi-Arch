"""Deterministic Multi-Language Tree-sitter AST scanner."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import tree_sitter_language_pack as tslp
from tree_sitter import Parser

from orbi.extractors import extract_ast
from orbi.lang_packs import DEFAULT_CACHE_DIR, EXT_TO_SPEC, SECONDARY_EXTENSIONS, is_grammar_installed
from orbi.schema import RepoContext, ScannedFile, ScanResult
from orbi.security import MAX_SCAN_FILES, is_blocked_dir, is_safe_repo_file, to_repo_rel_posix

EXT_MAP = {k: (v[1], v[2]) for k, v in EXT_TO_SPEC.items()}
_PARSERS: dict[str, Parser] = {}


def clear_parser_cache(grammars: list[str] | None = None) -> None:
    if grammars is None:
        _PARSERS.clear()
    else:
        for g in grammars:
            _PARSERS.pop(g, None)


def _obtain_parser(grammar: str) -> Parser:
    if grammar not in _PARSERS:
        lang = tslp.get_language(grammar)
        _PARSERS[grammar] = Parser(lang)
    return _PARSERS[grammar]


def scan_repository(repo: RepoContext, cache_dir: Path | None = None) -> ScanResult:
    """Walk repo root deterministically, parse supported files via Tree-sitter, and extract symbols/imports."""
    root_path = repo.root_path.resolve()
    c_dir = (cache_dir or DEFAULT_CACHE_DIR).resolve()
    if c_dir.exists():
        try:
            tslp.configure(tslp.PackConfig(cache_dir=str(c_dir)))
        except Exception:
            pass

    scanned_files: list[ScannedFile] = []
    secondary_candidates: list[tuple[Path, bytes, str]] = []
    missing_packs_set: set[str] = set()
    skipped_count = 0
    truncated = False

    for dirpath, dirnames, filenames in os.walk(root_path, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if not is_blocked_dir(d))
        filenames.sort()

        for filename in filenames:
            file_path = Path(dirpath) / filename
            ext = file_path.suffix.lower()

            if ext not in EXT_TO_SPEC:
                if ext in SECONDARY_EXTENSIONS and is_safe_repo_file(root_path, file_path):
                    try:
                        raw_bytes = file_path.read_bytes()
                        text = raw_bytes.decode("utf-8", errors="replace")
                        if len(secondary_candidates) < MAX_SCAN_FILES:
                            secondary_candidates.append((file_path, raw_bytes, text))
                    except Exception:
                        pass
                continue

            if not is_safe_repo_file(root_path, file_path):
                skipped_count += 1
                continue

            if len(scanned_files) >= MAX_SCAN_FILES:
                truncated = True
                break

            try:
                raw_bytes = file_path.read_bytes()
                text = raw_bytes.decode("utf-8", errors="replace")
            except Exception:
                skipped_count += 1
                continue

            pack_id, language, grammar = EXT_TO_SPEC[ext]
            if is_grammar_installed(grammar, c_dir):
                try:
                    parser = _obtain_parser(grammar)
                    tree = parser.parse(raw_bytes)
                    symbols, imports = extract_ast(grammar, tree.root_node, raw_bytes)
                except Exception:
                    symbols, imports = [], []
            else:
                missing_packs_set.add(pack_id)
                symbols, imports = [], []

            rel_posix = to_repo_rel_posix(root_path, file_path)
            line_count = max(1, len(text.splitlines()))
            sha256 = hashlib.sha256(raw_bytes).hexdigest()

            scanned_files.append(
                ScannedFile(
                    rel_path=rel_posix,
                    language=language,
                    sha256=sha256,
                    line_count=line_count,
                    symbols=symbols,
                    imports=imports,
                )
            )

        if truncated:
            break

    # Secondary extension fallback if 0 primary files found
    if not scanned_files and secondary_candidates:
        for file_path, raw_bytes, text in secondary_candidates:
            if len(scanned_files) >= MAX_SCAN_FILES:
                truncated = True
                break
            rel_posix = to_repo_rel_posix(root_path, file_path)
            scanned_files.append(
                ScannedFile(
                    rel_path=rel_posix,
                    language="other",
                    sha256=hashlib.sha256(raw_bytes).hexdigest(),
                    line_count=max(1, len(text.splitlines())),
                    symbols=[],
                    imports=[],
                )
            )

    scanned_files.sort(key=lambda f: f.rel_path)

    return ScanResult(
        repo=repo,
        files=scanned_files,
        skipped_count=skipped_count,
        truncated=truncated,
        missing_packs=sorted(missing_packs_set),
    )
