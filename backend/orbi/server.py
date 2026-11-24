"""FastAPI application providing strictly local REST and SSE endpoints."""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from orbi.api_models import (
    AppSettings,
    HealthResponse,
    LanguagePackStatus,
    ProviderConfig,
    ProviderId,
    ProviderKeyRequest,
    ScanStartRequest,
    ScanStartResponse,
    SessionPatchRequest,
)
from orbi.db import OrbiDB
from orbi.graph_builder import build_render_session
from orbi.lang_packs import PACK_CATALOG, delete_pack, get_pack_def, install_pack, list_packs
from orbi.repo_adapter import clone_github_repo, resolve_local_repo
from orbi.scanner import clear_parser_cache, scan_repository
from orbi.schema import RenderSession, SessionOverrides, validate_session
from orbi.security import validate_github_url, validate_local_path
from orbi.synthesizer import enrich_session_with_ai
from orbi.vault import KeyVault, OSKeyVault, is_local_base_url, mask_key_hint, validate_base_url

ALLOWED_ORIGIN = "http://127.0.0.1:5173"


def create_app(
    db: OrbiDB | None = None,
    vault: KeyVault | None = None,
    llm_transport: httpx.AsyncBaseTransport | None = None,
    cache_dir: Path | None = None,
) -> FastAPI:
    database = db or OrbiDB()
    key_vault = vault or OSKeyVault()
    app = FastAPI(title="ORBI Architecture Engine", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[ALLOWED_ORIGIN],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin and origin != ALLOWED_ORIGIN:
                return JSONResponse({"detail": "Forbidden origin"}, status_code=403)
        return await call_next(request)

    jobs: dict[str, dict[str, Any]] = {}

    @app.get("/api/health", response_model=HealthResponse)
    def get_health() -> HealthResponse:
        return HealthResponse(status="ok", version="0.1.0", db_path=str(database.db_path), keyring_available=key_vault.is_available())

    @app.get("/api/languages", response_model=list[LanguagePackStatus])
    def get_languages() -> list[LanguagePackStatus]:
        return list_packs(cache_dir)

    @app.post("/api/languages/{pack_id}/install", response_model=LanguagePackStatus)
    def install_language(pack_id: str) -> LanguagePackStatus:
        if not get_pack_def(pack_id):
            raise HTTPException(status_code=404, detail="Unknown language pack")
        try:
            return install_pack(pack_id, cache_dir)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.delete("/api/languages/{pack_id}", response_model=LanguagePackStatus)
    def delete_language(pack_id: str) -> LanguagePackStatus:
        if not get_pack_def(pack_id):
            raise HTTPException(status_code=404, detail="Unknown language pack")
        return delete_pack(pack_id, cache_dir, on_evict=lambda pid, grammars: clear_parser_cache(grammars))

    @app.get("/api/sessions", response_model=list[RenderSession])
    def list_sessions() -> list[RenderSession]:
        return database.list_sessions()

    @app.get("/api/sessions/{session_id}", response_model=RenderSession)
    def get_session(session_id: str) -> RenderSession:
        session = database.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    @app.patch("/api/sessions/{session_id}", response_model=RenderSession)
    def patch_session(session_id: str, req: SessionPatchRequest) -> RenderSession:
        if req.name is not None and not req.name.strip():
            raise HTTPException(status_code=422, detail="Session name cannot be empty")
        session = database.update_session(session_id, name=req.name, overrides=req.overrides)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    @app.delete("/api/sessions/{session_id}")
    def delete_session(session_id: str) -> dict[str, bool]:
        if not database.delete_session(session_id):
            raise HTTPException(status_code=404, detail="Session not found")
        return {"deleted": True}

    @app.get("/api/settings", response_model=AppSettings)
    def get_settings() -> AppSettings:
        return database.load_settings()

    @app.put("/api/settings", response_model=AppSettings)
    def put_settings(settings: AppSettings) -> AppSettings:
        return database.save_settings(settings)

    @app.put("/api/providers/{provider}/key", response_model=ProviderConfig)
    def put_provider_key(provider: ProviderId, req: ProviderKeyRequest) -> ProviderConfig:
        settings = database.load_settings()
        if provider not in settings.providers:
            raise HTTPException(status_code=422, detail="Invalid provider ID")
        cfg = settings.providers[provider]
        if req.base_url is not None:
            err = validate_base_url(req.base_url)
            if err:
                raise HTTPException(status_code=422, detail=err)
            cfg.baseUrl = req.base_url.strip()
        key = req.api_key.strip()
        if provider in ("openai", "anthropic") and not key and not cfg.configured:
            raise HTTPException(status_code=422, detail=f"{provider.capitalize()} requires an API key")
        if provider == "custom" and (not cfg.baseUrl or (not key and not cfg.configured)):
            raise HTTPException(status_code=422, detail="Custom provider requires both Base URL and API Key")
        if key:
            key_vault.set_key(provider, key)
            cfg.configured, cfg.hint = True, mask_key_hint(key)
        cfg.isLocal = is_local_base_url(cfg.baseUrl)
        database.save_settings(settings)
        return cfg

    @app.delete("/api/providers/{provider}/key", response_model=ProviderConfig)
    def delete_provider_key(provider: ProviderId) -> ProviderConfig:
        settings = database.load_settings()
        if provider not in settings.providers:
            raise HTTPException(status_code=422, detail="Invalid provider ID")
        key_vault.delete_key(provider)
        cfg = settings.providers[provider]
        cfg.configured, cfg.hint = (provider == "ollama"), None
        if provider == "ollama":
            cfg.baseUrl = "http://127.0.0.1:11434"
        cfg.isLocal = is_local_base_url(cfg.baseUrl)
        database.save_settings(settings)
        return cfg

    async def _run_scan_job(
        source_type: str,
        target: str,
        use_ai: bool,
        job: dict[str, Any],
        existing_session: RenderSession | None = None,
    ) -> None:
        def emit(data: dict[str, Any]) -> None:
            job["events"].append(data)

        try:
            emit({"event": "progress", "progress": 0.15, "message": "Resolving repository..."})
            repo = await asyncio.to_thread(resolve_local_repo if source_type == "local" else clone_github_repo, target)
            emit({"event": "progress", "progress": 0.40, "message": "Parsing AST & imports..."})
            scan = await asyncio.to_thread(scan_repository, repo, cache_dir)
            emit({"event": "progress", "progress": 0.65, "message": "Building verified graph..."})
            session, structural_ir = await asyncio.to_thread(build_render_session, scan)

            warnings: list[str] = []
            if scan.missing_packs:
                labels = ", ".join(p["label"] for p in PACK_CATALOG if p["id"] in scan.missing_packs)
                warnings.append(f"Missing language pack(s): {labels} — AST edges skipped for those files (may use more AI tokens). Install them in Settings -> Languages.")

            ai_applied = False
            if use_ai:
                emit({"event": "progress", "progress": 0.80, "message": "Synthesizing architecture..."})
                settings = database.load_settings()
                res = await enrich_session_with_ai(
                    session, structural_ir, settings, database, key_vault,
                    progress_cb=lambda msg, p: emit({"event": "progress", "progress": p, "message": msg}), transport=llm_transport,
                )
                session, warnings, ai_applied = res.session, warnings + res.warnings, res.ai_applied

            if existing_session is not None:
                session.session.id = existing_session.session.id
                session.session.name = existing_session.session.name
                session.session.created_at = existing_session.session.created_at
                valid_ids = {c.id for c in session.containers} | {n.id for n in session.nodes}
                kept_positions = {k: v for k, v in existing_session.overrides.positions.items() if k in valid_ids}
                kept_renamed = {k: v for k, v in existing_session.overrides.renamed.items() if k in valid_ids}
                session.overrides = SessionOverrides(positions=kept_positions, renamed=kept_renamed)
                errs = validate_session(session)
                if errs:
                    raise ValueError(f"Rescanned session failed validation: {'; '.join(errs)}")

            database.upsert_session(session)
            emit({"event": "complete", "progress": 1.0, "session": session.model_dump(), "warnings": warnings, "ai_applied": ai_applied})
            job["status"] = "complete"
        except Exception as e:
            emit({"event": "error", "message": str(e)})
            job["status"] = "error"
        finally:
            job["done"].set()

    @app.post("/api/scans", response_model=ScanStartResponse, status_code=202)
    async def start_scan(req: ScanStartRequest) -> JSONResponse:
        try:
            validate_local_path(req.target) if req.source_type == "local" else validate_github_url(req.target)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

        if len(jobs) >= 20:
            del jobs[next(iter(jobs))]

        job_id = f"job_{uuid.uuid4().hex[:10]}"
        job = {"id": job_id, "status": "running", "events": [], "done": asyncio.Event()}
        jobs[job_id] = job
        asyncio.create_task(_run_scan_job(req.source_type, req.target, req.use_ai, job))
        return JSONResponse(status_code=202, content={"job_id": job_id, "status": "running"})

    @app.post("/api/sessions/{session_id}/rescan", response_model=ScanStartResponse, status_code=202)
    async def rescan_session(session_id: str, body: dict[str, Any] | None = Body(default=None)) -> JSONResponse:
        existing = database.get_session(session_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Session not found")
        if existing.session.is_demo:
            raise HTTPException(status_code=422, detail="Demo sessions cannot be rescanned")

        source_type = existing.session.source_type
        target = existing.session.source_ref
        try:
            validate_local_path(target) if source_type == "local" else validate_github_url(target)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

        use_ai = bool((body or {}).get("use_ai", True))
        if len(jobs) >= 20:
            del jobs[next(iter(jobs))]

        job_id = f"job_{uuid.uuid4().hex[:10]}"
        job = {"id": job_id, "status": "running", "events": [], "done": asyncio.Event()}
        jobs[job_id] = job
        asyncio.create_task(_run_scan_job(source_type, target, use_ai, job, existing_session=existing))
        return JSONResponse(status_code=202, content={"job_id": job_id, "status": "running"})

    @app.get("/api/scans/{job_id}/events")
    async def get_scan_events(job_id: str) -> StreamingResponse:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail="Scan job not found")
        job = jobs[job_id]

        async def event_generator():
            idx = 0
            while True:
                while idx < len(job["events"]):
                    ev = job["events"][idx]
                    idx += 1
                    yield f"data: {json.dumps(ev)}\n\n"
                    if ev.get("event") in ("complete", "error"):
                        return
                if job["done"].is_set():
                    break
                await asyncio.sleep(0.05)

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    return app


try:
    app = create_app()
except Exception:
    app = None

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
