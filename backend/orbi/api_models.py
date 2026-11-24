"""API request, response, and settings models mirroring frontend schema."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from orbi.schema import SessionOverrides

ThemeMode = Literal["light", "dark", "system"]
FontSizeMode = Literal["auto", "sm", "md", "lg", "custom"]
ProviderId = Literal["ollama", "openai", "anthropic", "custom"]


class ModelTierConfig(BaseModel):
    provider: ProviderId
    model: str = ""


class ProviderConfig(BaseModel):
    provider: ProviderId
    label: str
    isLocal: bool
    configured: bool
    hint: str | None = None
    baseUrl: str | None = None


class AppSettings(BaseModel):
    theme: ThemeMode = "system"
    fontSize: FontSizeMode = "lg"
    customFontSize: int = Field(default=18, ge=14, le=26)
    autosave: bool = True
    cheapModel: ModelTierConfig = Field(default_factory=lambda: ModelTierConfig(provider="ollama", model=""))
    strongModel: ModelTierConfig = Field(default_factory=lambda: ModelTierConfig(provider="ollama", model=""))
    providers: dict[ProviderId, ProviderConfig] = Field(default_factory=dict)


class ScanStartRequest(BaseModel):
    source_type: Literal["local", "github"]
    target: str
    use_ai: bool = True


class ScanStartResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running"] = "running"


class SessionPatchRequest(BaseModel):
    name: str | None = None
    overrides: SessionOverrides | None = None


class ProviderKeyRequest(BaseModel):
    api_key: str = ""
    base_url: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = "0.1.0"
    db_path: str
    keyring_available: bool


class LanguagePackStatus(BaseModel):
    id: str
    label: str
    extensions: list[str]
    grammars: list[str]
    installed: bool
    size_bytes: int = 0
