"""Security guard for read-only repository scanning and secret blocking."""

from __future__ import annotations

import fnmatch
import re
from pathlib import Path

MAX_FILE_BYTES: int = 512 * 1024  # 512 KB
MAX_SCAN_FILES: int = 500

BLOCKED_DIRS: set[str] = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".vite",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "coverage",
    ".orbi",
    "target",
    "vendor",
    ".idea",
    ".vscode",
}

BLOCKED_FILE_PATTERNS: set[str] = {
    ".env",
    ".env.*",
    "*.env",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
    "*.kdbx",
    "*.crt",
    "id_rsa*",
    "id_ed25519*",
    "id_ecdsa*",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "secrets.*",
    "*credentials*.json",
    "*service-account*.json",
}

SHELL_METACHUTE_PATTERN = re.compile(r'[;|&`$<>\r\n\0]')
GITHUB_URL_PATTERN = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")


def is_blocked_dir(name: str) -> bool:
    """Check if directory name matches any blocked directory segment."""
    return name.lower() in BLOCKED_DIRS


def is_blocked_file(name: str) -> bool:
    """Check if file name matches any blocked secret or sensitive pattern."""
    lname = name.lower()
    return any(fnmatch.fnmatch(lname, pat.lower()) for pat in BLOCKED_FILE_PATTERNS)


def is_safe_repo_file(root: Path, candidate: Path) -> bool:
    """Validate candidate file strictly inside root, non-blocked, within size and non-binary."""
    try:
        root_res = root.resolve()
        cand_res = candidate.resolve()
    except (OSError, RuntimeError):
        return False

    if not cand_res.is_relative_to(root_res):
        return False

    rel = cand_res.relative_to(root_res)
    for part in rel.parts[:-1]:
        if is_blocked_dir(part):
            return False

    if is_blocked_file(rel.name):
        return False

    if not cand_res.is_file():
        return False

    try:
        st = cand_res.stat()
        if st.st_size > MAX_FILE_BYTES or st.st_size == 0:
            return False
    except OSError:
        return False

    try:
        with cand_res.open("rb") as f:
            chunk = f.read(4096)
            if b"\x00" in chunk:
                return False
    except OSError:
        return False

    return True


def validate_local_path(raw: str) -> Path:
    """Validate and resolve local repository path, rejecting invalid or shell characters."""
    clean = (raw or "").strip()
    if not clean:
        raise ValueError("Empty repository path")
    if SHELL_METACHUTE_PATTERN.search(clean):
        raise ValueError("Invalid characters in repository path")

    p = Path(clean).resolve()
    if not p.exists() or not p.is_dir():
        raise ValueError(f"Path does not exist or is not a directory: {clean}")
    return p


def validate_github_url(raw: str) -> tuple[str, str, str]:
    """Validate GitHub HTTPS repository URL and return (canonical_url, owner, repo)."""
    clean = (raw or "").strip()
    if not clean:
        raise ValueError("Empty GitHub URL")

    if any(clean.startswith(prefix) for prefix in ("git@", "ssh://", "http://")):
        raise ValueError("Only HTTPS GitHub URLs are supported (e.g. https://github.com/owner/repo)")

    if "@" in clean or "?" in clean or "#" in clean or any(c.isspace() for c in clean):
        raise ValueError("Invalid characters or query in GitHub URL")

    m = GITHUB_URL_PATTERN.match(clean)
    if not m:
        raise ValueError("Invalid GitHub repository URL format")

    owner, repo = m.group(1), m.group(2)
    if owner in {".", ".."} or repo in {".", ".."}:
        raise ValueError("Invalid owner or repository name in GitHub URL")

    canonical_url = f"https://github.com/{owner}/{repo}"
    return canonical_url, owner, repo


def to_repo_rel_posix(root: Path, file_path: Path) -> str:
    """Normalize file_path relative to root as forward-slash repo-relative path."""
    rel = file_path.resolve().relative_to(root.resolve())
    posix = rel.as_posix()
    if posix.startswith("./"):
        posix = posix[2:]
    return posix
