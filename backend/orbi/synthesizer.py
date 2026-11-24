"""Two-tier LLM synthesis pipeline with bounded concurrency and strict guardrails."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from orbi.api_models import AppSettings, ModelTierConfig
from orbi.db import OrbiDB
from orbi.llm import LLMError, chat_json
from orbi.schema import (
    InferredEdge,
    RenderSession,
    StructuralIR,
    validate_session,
)
from orbi.vault import KeyVault

VALID_CATEGORIES = {"frontend", "api", "service", "data", "external"}


@dataclass
class SynthesisResult:
    session: RenderSession
    ai_applied: bool
    warnings: list[str] = field(default_factory=list)


def _is_tier_runnable(tier: ModelTierConfig, vault: KeyVault) -> bool:
    if not tier.model.strip():
        return False
    if tier.provider in ("openai", "anthropic", "custom"):
        return bool(vault.get_key(tier.provider))
    if tier.provider == "ollama":
        return True
    return False


async def enrich_session_with_ai(
    session: RenderSession,
    ir: StructuralIR,
    settings: AppSettings,
    db: OrbiDB,
    vault: KeyVault,
    progress_cb: Callable[[str, float], None] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SynthesisResult:
    """Enrich deterministic AST graph using 2-tier synthesis with anti-hallucination guardrails."""
    cheap_runnable = _is_tier_runnable(settings.cheapModel, vault)
    strong_runnable = _is_tier_runnable(settings.strongModel, vault)

    if not cheap_runnable and not strong_runnable:
        return SynthesisResult(
            session=session,
            ai_applied=False,
            warnings=["AI synthesis skipped (no model configured); showing deterministic AST graph."],
        )

    # Work on a copy of the session
    working_session = RenderSession.model_validate(session.model_dump())
    warnings: list[str] = []
    ai_applied = False

    # Tier 1: Cheap/Fast Module Summaries
    if cheap_runnable:
        if progress_cb:
            progress_cb("Summarizing subsystems...", 0.82)

        sem = asyncio.Semaphore(3)

        async def summarize_container(c_dict: dict[str, Any]) -> None:
            nonlocal ai_applied
            c_id = c_dict["id"]
            cont_nodes = [n for n in working_session.nodes if n.container_id == c_id]
            sig_data = [{"file": n.id, "symbols": [s.name for s in n.symbols]} for n in cont_nodes]
            raw_hash = hashlib.sha256(json.dumps(sig_data, sort_keys=True).encode("utf-8")).hexdigest()[:16]
            cache_key = f"{raw_hash}:{settings.cheapModel.provider}:{settings.cheapModel.model.strip()}"

            cached = db.get_cached_summary(cache_key)
            if cached:
                _apply_tier1_summary(c_id, cached, working_session)
                ai_applied = True
                return

            sys_prompt = "You are a concise software architect. Return JSON with label, summary, and file_summaries."
            user_prompt = f"Summarize subsystem {c_id}:\n{json.dumps(sig_data)}\nReturn format:\n{{\"label\": str, \"summary\": str, \"file_summaries\": {{\"<rel/path>\": str}}}}"

            async with sem:
                try:
                    res = await chat_json(
                        settings.cheapModel.provider,
                        settings.cheapModel.model,
                        sys_prompt,
                        user_prompt,
                        settings,
                        vault,
                        transport=transport,
                    )
                    db.set_cached_summary(cache_key, res)
                    _apply_tier1_summary(c_id, res, working_session)
                    ai_applied = True
                except LLMError as e:
                    warnings.append(f"Subsystem {c_id} summary skipped: {e}")

        await asyncio.gather(*(summarize_container(c) for c in ir.containers))

    # Tier 2: Strong Architecture Synthesis
    if strong_runnable:
        if progress_cb:
            progress_cb("Synthesizing system relationships...", 0.90)

        sys_prompt = (
            "You are a principal system architect. Analyze structural subsystems and verified imports. "
            "Propose at most 6 high-level inferred relationships between subsystems that explain architecture dataflow. "
            "Return JSON: {\"containers\": [{\"id\": str, \"label\": str, \"category\": str, \"summary\": str}], "
            "\"inferred_edges\": [{\"source\": str, \"target\": str, \"label\": str, \"reason\": str}]}"
        )
        user_prompt = f"System IR:\n{ir.model_dump_json(indent=2)}"

        try:
            res = await chat_json(
                settings.strongModel.provider,
                settings.strongModel.model,
                sys_prompt,
                user_prompt,
                settings,
                vault,
                transport=transport,
            )
            _apply_tier2_synthesis(res, working_session)
            ai_applied = True
        except LLMError as e:
            warnings.append(f"Architecture synthesis skipped: {e}")

    # Recompute stats
    v_count = sum(1 for e in working_session.edges if e.provenance == "verified")
    i_count = sum(1 for e in working_session.edges if e.provenance == "inferred")
    working_session.session.stats.files_scanned = len(working_session.nodes)
    working_session.session.stats.verified_edges = v_count
    working_session.session.stats.inferred_edges = i_count

    # Safety Validation: Revert cleanly to original if validation fails
    errs = validate_session(working_session)
    if errs:
        warnings.append(f"AI synthesis produced invalid graph ({'; '.join(errs)}); reverted to deterministic graph.")
        return SynthesisResult(session=session, ai_applied=False, warnings=warnings)

    return SynthesisResult(session=working_session, ai_applied=ai_applied, warnings=warnings)


def _apply_tier1_summary(c_id: str, data: dict[str, Any], session: RenderSession) -> None:
    for c in session.containers:
        if c.id == c_id:
            if isinstance(data.get("summary"), str) and data["summary"].strip():
                c.summary = data["summary"].strip()[:140]
            if isinstance(data.get("label"), str) and data["label"].strip():
                c.label = data["label"].strip()[:50]
            break

    file_summaries = data.get("file_summaries")
    if isinstance(file_summaries, dict):
        for node in session.nodes:
            if node.container_id == c_id and node.id in file_summaries:
                s = file_summaries[node.id]
                if isinstance(s, str) and s.strip():
                    node.summary = s.strip()[:140]


def _apply_tier2_synthesis(data: dict[str, Any], session: RenderSession) -> None:
    existing_c_ids = {c.id for c in session.containers}
    for c_item in data.get("containers", []):
        if not isinstance(c_item, dict):
            continue
        c_id = c_item.get("id")
        if c_id not in existing_c_ids:
            continue
        target_c = next(c for c in session.containers if c.id == c_id)
        if isinstance(c_item.get("summary"), str) and c_item["summary"].strip():
            target_c.summary = c_item["summary"].strip()[:140]
        if isinstance(c_item.get("label"), str) and c_item["label"].strip():
            target_c.label = c_item["label"].strip()[:50]
        cat = c_item.get("category")
        if isinstance(cat, str) and cat.strip() in VALID_CATEGORIES:
            target_c.category = cat.strip()  # type: ignore

    # Anti-hallucination edge guardrails
    existing_hld_pairs = {(e.source, e.target) for e in session.edges if e.scope == "hld"}
    inferred_count = 0

    for edge_dict in data.get("inferred_edges", []):
        if not isinstance(edge_dict, dict) or inferred_count >= 12:
            continue
        src = edge_dict.get("source")
        tgt = edge_dict.get("target")
        reason = edge_dict.get("reason")
        label = edge_dict.get("label") or "relies on"

        if (
            not isinstance(src, str)
            or not isinstance(tgt, str)
            or not isinstance(reason, str)
            or src not in existing_c_ids
            or tgt not in existing_c_ids
            or src == tgt
            or (src, tgt) in existing_hld_pairs
            or not reason.strip()
        ):
            continue

        session.edges.append(
            InferredEdge(
                id=f"hld_inf:{src}->{tgt}",
                scope="hld",
                source=src,
                target=tgt,
                label=str(label).strip()[:40],
                provenance="inferred",
                reason=reason.strip()[:200],
            )
        )
        existing_hld_pairs.add((src, tgt))
        inferred_count += 1
