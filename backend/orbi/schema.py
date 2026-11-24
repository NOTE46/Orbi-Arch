"""Render schema and internal pipeline models mirroring frontend contracts."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

# Public Render Schema Models (1-to-1 with frontend/src/types/schema.ts)
SupportedLanguage = Literal[
    "python",
    "typescript",
    "javascript",
    "c",
    "cpp",
    "java",
    "go",
    "rust",
    "csharp",
    "other",
]


class EdgeEvidence(BaseModel):
    file: str
    line: int = Field(ge=1)


class CodeSymbol(BaseModel):
    kind: Literal["class", "function", "method", "const"]
    name: str
    line: int = Field(ge=1)
    summary: str = ""


class HldContainer(BaseModel):
    id: str
    label: str
    category: Literal["frontend", "api", "service", "data", "external"]
    summary: str = ""


class LldFileNode(BaseModel):
    id: str
    container_id: str
    label: str
    language: SupportedLanguage
    summary: str = ""
    line_count: int = Field(ge=1)
    symbols: list[CodeSymbol] = Field(default_factory=list)


class VerifiedEdge(BaseModel):
    id: str
    scope: Literal["hld", "lld"]
    source: str
    target: str
    label: str = ""
    provenance: Literal["verified"] = "verified"
    evidence: list[EdgeEvidence] = Field(min_length=1)


class InferredEdge(BaseModel):
    id: str
    scope: Literal["hld", "lld"]
    source: str
    target: str
    label: str = ""
    provenance: Literal["inferred"] = "inferred"
    reason: str


ArchEdge = Annotated[VerifiedEdge | InferredEdge, Field(discriminator="provenance")]


class Position(BaseModel):
    x: float
    y: float


class SessionOverrides(BaseModel):
    positions: dict[str, Position] = Field(default_factory=dict)
    renamed: dict[str, str] = Field(default_factory=dict)


class SessionStats(BaseModel):
    files_scanned: int = 0
    verified_edges: int = 0
    inferred_edges: int = 0


class SessionMeta(BaseModel):
    id: str
    name: str
    source_type: Literal["local", "github"]
    source_ref: str
    commit_sha: str
    dirty: bool | None = None
    is_demo: bool | None = None
    created_at: str
    stats: SessionStats


class RenderSession(BaseModel):
    schema_version: Literal["0.1"] = "0.1"
    session: SessionMeta
    containers: list[HldContainer]
    nodes: list[LldFileNode]
    edges: list[ArchEdge]
    overrides: SessionOverrides = Field(default_factory=SessionOverrides)


# Internal Pipeline Handoff Models
class RepoContext(BaseModel):
    root_path: Path
    source_type: Literal["local", "github"]
    source_ref: str
    repo_name: str
    commit_sha: str
    dirty: bool


class RawImport(BaseModel):
    module: str
    line: int = Field(ge=1)
    is_relative: bool


class ScannedFile(BaseModel):
    rel_path: str
    language: SupportedLanguage
    sha256: str
    line_count: int = Field(ge=1)
    symbols: list[CodeSymbol] = Field(default_factory=list)
    imports: list[RawImport] = Field(default_factory=list)


class ScanResult(BaseModel):
    repo: RepoContext
    files: list[ScannedFile]
    skipped_count: int = 0
    truncated: bool = False
    missing_packs: list[str] = Field(default_factory=list)


class StructuralIR(BaseModel):
    repo_name: str
    commit_sha: str
    containers: list[dict[str, Any]]
    verified_hld_edges: list[dict[str, Any]]


def is_valid_repo_path(p: str) -> bool:
    if not p or not isinstance(p, str):
        return False
    if "\\" in p or p.startswith("/") or p.startswith("./") or re.match(r"^[a-zA-Z]:", p):
        return False
    return ".." not in p.split("/")


def validate_session(session: RenderSession) -> list[str]:
    """Validate RenderSession with 100% parity to frontend validateSession()."""
    errs: list[str] = []
    if session.schema_version != "0.1":
        errs.append('schema_version must be "0.1"')

    c_ids: set[str] = set()
    n_ids: set[str] = set()
    e_ids: set[str] = set()
    c_counts: dict[str, int] = {}

    for c in session.containers or []:
        if not c.id:
            errs.append("Container id empty")
        if c.id in c_ids:
            errs.append(f"Duplicate container id {c.id}")
        c_ids.add(c.id)
        c_counts[c.id] = 0

    node_map: dict[str, LldFileNode] = {}
    for n in session.nodes or []:
        if not n.id:
            errs.append("Node id empty")
        if n.id in n_ids:
            errs.append(f"Duplicate node id {n.id}")
        if n.id in c_ids:
            errs.append(f"Node id {n.id} collides with container id")
        if not is_valid_repo_path(n.id):
            errs.append(f"Invalid node repo path {n.id}")
        if n.container_id not in c_ids:
            errs.append(f"Node {n.id} references missing container {n.container_id}")
        else:
            c_counts[n.container_id] = c_counts.get(n.container_id, 0) + 1

        for s in n.symbols or []:
            if not isinstance(s.line, int) or s.line < 1 or s.line > n.line_count:
                errs.append(f"Symbol {s.name} line out of bounds in {n.id}")

        n_ids.add(n.id)
        node_map[n.id] = n

    for c_id, count in c_counts.items():
        if count == 0:
            errs.append(f"Container {c_id} has no nodes")

    edge_pairs: set[str] = set()
    for e in session.edges or []:
        if not e.id:
            errs.append("Edge id empty")
        if e.id in e_ids:
            errs.append(f"Duplicate edge id {e.id}")
        e_ids.add(e.id)
        if e.source == e.target:
            errs.append(f"Self loop in edge {e.id}")
        pair = f"{e.scope}:{e.source}->{e.target}"
        if pair in edge_pairs:
            errs.append(f"Duplicate directed pair {pair}")
        edge_pairs.add(pair)

        if e.scope == "hld":
            if e.source not in c_ids or e.target not in c_ids:
                errs.append(f"HLD edge {e.id} endpoints not in containers")
        elif e.scope == "lld":
            if e.source not in n_ids or e.target not in n_ids:
                errs.append(f"LLD edge {e.id} endpoints not in nodes")
        else:
            errs.append(f"Edge {e.id} invalid scope {e.scope}")

        if e.provenance == "verified":
            if not getattr(e, "evidence", None) or len(e.evidence) == 0:
                errs.append(f"Verified edge {e.id} missing evidence")
            for ev in getattr(e, "evidence", []) or []:
                if not is_valid_repo_path(ev.file):
                    errs.append(f"Invalid evidence path {ev.file}")
                n = node_map.get(ev.file)
                if not n:
                    errs.append(f"Evidence file {ev.file} not found")
                else:
                    if not isinstance(ev.line, int) or ev.line < 1 or ev.line > n.line_count:
                        errs.append(f"Evidence line out of bounds for {ev.file}")
                    if e.scope == "lld" and ev.file != e.source:
                        errs.append(f"LLD evidence {ev.file} != source {e.source}")
                    if e.scope == "hld" and n.container_id != e.source:
                        errs.append(f"HLD evidence {ev.file} not in source container {e.source}")
        elif e.provenance == "inferred":
            reason = getattr(e, "reason", "")
            if not reason or not reason.strip():
                errs.append(f"Inferred edge {e.id} missing reason")
        else:
            errs.append(f"Edge {e.id} invalid provenance {e.provenance}")

    for k in (session.overrides.positions if session.overrides else {}).keys():
        if k not in c_ids and k not in n_ids:
            errs.append(f"Override position key {k} unknown")
    for k in (session.overrides.renamed if session.overrides else {}).keys():
        if k not in c_ids and k not in n_ids:
            errs.append(f"Override renamed key {k} unknown")

    # Stats validation across both scopes
    v_count = sum(1 for e in session.edges if e.provenance == "verified")
    i_count = sum(1 for e in session.edges if e.provenance == "inferred")
    s_stats = session.session.stats if session.session else None
    if (
        not s_stats
        or s_stats.files_scanned != len(session.nodes)
        or s_stats.verified_edges != v_count
        or s_stats.inferred_edges != i_count
    ):
        errs.append("Session stats mismatch")

    return errs
