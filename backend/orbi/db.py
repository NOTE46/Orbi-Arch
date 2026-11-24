"""SQLite database persistence for RenderSessions, settings, and analysis cache."""

from __future__ import annotations

import datetime
import json
import sqlite3
from pathlib import Path
from typing import Any

from orbi.api_models import AppSettings, ModelTierConfig, ProviderConfig
from orbi.schema import RenderSession, SessionOverrides
from orbi.vault import is_local_base_url

DEFAULT_DB_PATH = Path.home() / ".orbi" / "orbi.db"


def default_settings() -> AppSettings:
    """Return default application settings matching frontend defaults."""
    return AppSettings(
        theme="system",
        fontSize="lg",
        customFontSize=18,
        autosave=True,
        cheapModel=ModelTierConfig(provider="ollama", model=""),
        strongModel=ModelTierConfig(provider="ollama", model=""),
        providers={
            "ollama": ProviderConfig(
                provider="ollama",
                label="Local (Ollama / llama.cpp)",
                isLocal=True,
                configured=True,
                baseUrl="http://127.0.0.1:11434",
            ),
            "openai": ProviderConfig(
                provider="openai",
                label="OpenAI",
                isLocal=False,
                configured=False,
            ),
            "anthropic": ProviderConfig(
                provider="anthropic",
                label="Anthropic",
                isLocal=False,
                configured=False,
            ),
            "custom": ProviderConfig(
                provider="custom",
                label="Custom (OpenAI-compatible)",
                isLocal=False,
                configured=False,
            ),
        },
    )


class OrbiDB:
    """Thread-safe SQLite store using stdlib sqlite3."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = (db_path or DEFAULT_DB_PATH).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        with self._get_conn() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS analysis_cache (
                    cache_key TEXT PRIMARY KEY,
                    summary_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )

    def list_sessions(self) -> list[RenderSession]:
        with self._get_conn() as conn:
            rows = conn.execute("SELECT payload_json FROM sessions ORDER BY created_at DESC;").fetchall()
            return [RenderSession.model_validate_json(r["payload_json"]) for r in rows]

    def get_session(self, session_id: str) -> RenderSession | None:
        with self._get_conn() as conn:
            row = conn.execute("SELECT payload_json FROM sessions WHERE id = ?;", (session_id,)).fetchone()
            return RenderSession.model_validate_json(row["payload_json"]) if row else None

    def upsert_session(self, session: RenderSession) -> None:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        payload = session.model_dump_json()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO sessions (id, name, created_at, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json;
                """,
                (session.session.id, session.session.name, session.session.created_at, now_iso, payload),
            )

    def update_session(
        self,
        session_id: str,
        name: str | None = None,
        overrides: SessionOverrides | None = None,
    ) -> RenderSession | None:
        session = self.get_session(session_id)
        if not session:
            return None

        if name is not None:
            clean_name = name.strip()
            if not clean_name:
                raise ValueError("Session name cannot be empty")
            session.session.name = clean_name[:80]

        if overrides is not None:
            session.overrides = overrides

        self.upsert_session(session)
        return session

    def delete_session(self, session_id: str) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE id = ?;", (session_id,))
            return cur.rowcount > 0

    def load_settings(self) -> AppSettings:
        defaults = default_settings()
        with self._get_conn() as conn:
            row = conn.execute("SELECT value_json FROM app_state WHERE key = 'settings';").fetchone()
            if not row:
                return defaults
            try:
                raw_dict = json.loads(row["value_json"])
            except Exception:
                return defaults

        # Cleanse any stray apiKey if ever present in payload
        for p in raw_dict.get("providers", {}).values():
            if isinstance(p, dict):
                p.pop("apiKey", None)
                p.pop("api_key", None)

        settings = AppSettings.model_validate({**defaults.model_dump(), **raw_dict})
        settings.customFontSize = max(14, min(26, settings.customFontSize))

        # Recompute isLocal dynamically for every provider
        for p in settings.providers.values():
            p.isLocal = is_local_base_url(p.baseUrl)

        return settings

    def save_settings(self, settings: AppSettings) -> AppSettings:
        # Enforce isLocal recomputation and bounds
        settings.customFontSize = max(14, min(26, settings.customFontSize))
        for p in settings.providers.values():
            p.isLocal = is_local_base_url(p.baseUrl)

        # Drop any apiKey before persisting
        data = settings.model_dump()
        for p in data.get("providers", {}).values():
            if isinstance(p, dict):
                p.pop("apiKey", None)
                p.pop("api_key", None)

        now_json = json.dumps(data)
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO app_state (key, value_json)
                VALUES ('settings', ?)
                ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json;
                """,
                (now_json,),
            )
        return settings

    def get_cached_summary(self, cache_key: str) -> dict[str, Any] | None:
        with self._get_conn() as conn:
            row = conn.execute("SELECT summary_json FROM analysis_cache WHERE cache_key = ?;", (cache_key,)).fetchone()
            if not row:
                return None
            try:
                return json.loads(row["summary_json"])
            except Exception:
                return None

    def set_cached_summary(self, cache_key: str, data: dict[str, Any]) -> None:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO analysis_cache (cache_key, summary_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    summary_json = excluded.summary_json,
                    updated_at = excluded.updated_at;
                """,
                (cache_key, json.dumps(data), now_iso),
            )
