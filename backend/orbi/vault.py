"""Write-only OS Credential Manager vault and URL helpers."""

from __future__ import annotations

import re
import urllib.parse
from typing import Protocol

import keyring
import keyring.errors

SERVICE_NAME = "orbi-arch"


def mask_key_hint(raw_key: str) -> str:
    """Mask raw API key, showing only last 4 chars if length >= 12."""
    trimmed = raw_key.strip()
    if len(trimmed) < 12:
        return "••••"
    return "••••" + trimmed[-4:]


def validate_base_url(url: str) -> str | None:
    """Validate http/https URL with non-empty hostname, returning error or None."""
    if not url or not isinstance(url, str):
        return "URL must be a non-empty string"
    try:
        parsed = urllib.parse.urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return "URL must use http or https protocol"
        if not parsed.hostname:
            return "URL must include a valid hostname"
        return None
    except Exception:
        return "Invalid URL format"


def is_local_base_url(url: str | None) -> bool:
    """Check if URL points strictly to localhost or loopback interface."""
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urllib.parse.urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        host = (parsed.hostname or "").strip()
        if host.startswith("[") and host.endswith("]"):
            host = host[1:-1]
        if host in ("localhost", "::1", "0.0.0.0"):
            return True
        return bool(re.match(r"^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$", host))
    except Exception:
        return False


class KeyVault(Protocol):
    """Abstract protocol for credential vault storage."""

    def set_key(self, provider: str, raw_key: str) -> None:
        ...

    def get_key(self, provider: str) -> str | None:
        ...

    def delete_key(self, provider: str) -> None:
        ...

    def is_available(self) -> bool:
        ...


class OSKeyVault:
    """Real OS Keyring implementation (Windows Credential Manager / macOS Keychain)."""

    def set_key(self, provider: str, raw_key: str) -> None:
        keyring.set_password(SERVICE_NAME, provider, raw_key)

    def get_key(self, provider: str) -> str | None:
        return keyring.get_password(SERVICE_NAME, provider)

    def delete_key(self, provider: str) -> None:
        try:
            keyring.delete_password(SERVICE_NAME, provider)
        except (keyring.errors.PasswordDeleteError, keyring.errors.KeyringError, Exception):
            pass

    def is_available(self) -> bool:
        try:
            kr = keyring.get_keyring()
            name = type(kr).__name__.lower()
            return "null" not in name and "fail" not in name
        except Exception:
            return False


class MemoryKeyVault:
    """In-memory key vault strictly for isolated unit testing."""

    def __init__(self, initial: dict[str, str] | None = None) -> None:
        self._keys: dict[str, str] = dict(initial or {})

    def set_key(self, provider: str, raw_key: str) -> None:
        self._keys[provider] = raw_key

    def get_key(self, provider: str) -> str | None:
        return self._keys.get(provider)

    def delete_key(self, provider: str) -> None:
        self._keys.pop(provider, None)

    def is_available(self) -> bool:
        return True
