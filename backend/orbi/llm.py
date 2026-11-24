"""Lightweight direct REST LLM client using httpx (zero AI SDKs)."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from orbi.api_models import AppSettings, ProviderId
from orbi.vault import KeyVault, validate_base_url


class LLMError(RuntimeError):
    """Raised on LLM request failure or bad response format (never contains API keys)."""
    pass


def extract_json_object(text: str) -> dict[str, Any]:
    """Strip markdown code blocks and parse first JSON object cleanly."""
    clean = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", clean)
    if match:
        clean = match.group(1).strip()

    try:
        data = json.loads(clean)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    start = clean.find("{")
    end = clean.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(clean[start : end + 1])
            if isinstance(data, dict):
                return data
        except Exception as e:
            raise LLMError(f"Failed to parse JSON response: {e}") from None

    raise LLMError("No valid JSON object found in LLM response")


async def chat_json(
    provider: ProviderId,
    model: str,
    system_prompt: str,
    user_prompt: str,
    settings: AppSettings,
    vault: KeyVault,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 45.0,
) -> dict[str, Any]:
    """Execute direct REST chat completion requesting JSON."""
    clean_model = model.strip()
    if not clean_model:
        raise LLMError("Model name not configured")

    headers: dict[str, str] = {"Content-Type": "application/json"}
    endpoint: str
    body: dict[str, Any]

    if provider == "ollama":
        cfg = settings.providers.get("ollama")
        base = (cfg.baseUrl if cfg and cfg.baseUrl else "http://127.0.0.1:11434").rstrip("/")
        endpoint = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
        key = vault.get_key("ollama")
        if key:
            headers["Authorization"] = f"Bearer {key}"
        body = {
            "model": clean_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
            "stream": False,
        }
    elif provider == "openai":
        key = vault.get_key("openai")
        if not key:
            raise LLMError("OpenAI API key not configured in vault")
        endpoint = "https://api.openai.com/v1/chat/completions"
        headers["Authorization"] = f"Bearer {key}"
        body = {
            "model": clean_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
    elif provider == "custom":
        cfg = settings.providers.get("custom")
        if not cfg or not cfg.baseUrl:
            raise LLMError("Custom provider base URL not configured")
        err = validate_base_url(cfg.baseUrl)
        if err:
            raise LLMError(f"Invalid custom base URL: {err}")
        key = vault.get_key("custom")
        if not key:
            raise LLMError("Custom provider API key not configured in vault")
        base = cfg.baseUrl.rstrip("/")
        endpoint = f"{base}/chat/completions" if base.endswith("/v1") else f"{base}/v1/chat/completions"
        headers["Authorization"] = f"Bearer {key}"
        body = {
            "model": clean_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
    elif provider == "anthropic":
        key = vault.get_key("anthropic")
        if not key:
            raise LLMError("Anthropic API key not configured in vault")
        endpoint = "https://api.anthropic.com/v1/messages"
        headers["x-api-key"] = key
        headers["anthropic-version"] = "2023-06-01"
        body = {
            "model": clean_model,
            "max_tokens": 1500,
            "temperature": 0.1,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
    else:
        raise LLMError(f"Unsupported provider: {provider}")

    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            resp = await client.post(endpoint, json=body, headers=headers)
            if resp.status_code >= 400:
                raise LLMError(f"Provider {provider} returned HTTP error {resp.status_code}")
            data = resp.json()
    except httpx.RequestError as e:
        raise LLMError(f"Network error connecting to {provider}: {type(e).__name__}") from None

    try:
        if provider == "anthropic":
            content_text = data["content"][0]["text"]
        else:
            content_text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise LLMError(f"Malformed response format from provider {provider}") from None

    return extract_json_object(content_text)
