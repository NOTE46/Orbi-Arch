"""Read-only repository adapters for local paths and GitHub repositories."""

from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

from orbi.schema import RepoContext
from orbi.security import validate_github_url, validate_local_path


def resolve_local_repo(raw_path: str) -> RepoContext:
    """Resolve and validate a local repository directory, reading git metadata read-only."""
    root_path = validate_local_path(raw_path)
    commit_sha = "nogit00"
    dirty = True

    try:
        p_sha = subprocess.run(
            ["git", "-C", str(root_path), "rev-parse", "--short=7", "HEAD"],
            shell=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if p_sha.returncode == 0 and p_sha.stdout.strip():
            commit_sha = p_sha.stdout.strip()[:7]

        p_status = subprocess.run(
            ["git", "-C", str(root_path), "status", "--porcelain"],
            shell=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if p_status.returncode == 0:
            dirty = bool(p_status.stdout.strip())
    except (subprocess.SubprocessError, OSError):
        pass

    return RepoContext(
        root_path=root_path,
        source_type="local",
        source_ref=str(root_path),
        repo_name=root_path.name,
        commit_sha=commit_sha,
        dirty=dirty,
    )


def clone_github_repo(raw_url: str, cache_dir: Path | None = None) -> RepoContext:
    """Clone or safely refresh a GitHub repository read-only in an isolated cache directory."""
    canonical_url, owner, repo = validate_github_url(raw_url)
    sha_suffix = hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()[:8]
    base_cache = (cache_dir or Path.home() / ".orbi" / "repos").resolve()
    base_cache.mkdir(parents=True, exist_ok=True)
    target_dir = base_cache / f"{owner}__{repo}__{sha_suffix}"

    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

    if not target_dir.exists():
        p_clone = subprocess.run(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--single-branch",
                "--no-tags",
                "-c",
                "core.symlinks=false",
                canonical_url,
                str(target_dir),
            ],
            shell=False,
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
        if p_clone.returncode != 0:
            raise RuntimeError(f"Failed to clone repository: {p_clone.stderr.strip() or 'Unknown git error'}")
    else:
        # Refresh existing shallow clone read-only
        p_fetch = subprocess.run(
            ["git", "-C", str(target_dir), "fetch", "--depth", "1", "origin"],
            shell=False,
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        if p_fetch.returncode == 0:
            subprocess.run(
                ["git", "-C", str(target_dir), "reset", "--hard", "FETCH_HEAD"],
                shell=False,
                capture_output=True,
                text=True,
                timeout=15,
                env=env,
            )

    commit_sha = "main000"
    p_sha = subprocess.run(
        ["git", "-C", str(target_dir), "rev-parse", "--short=7", "HEAD"],
        shell=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if p_sha.returncode == 0 and p_sha.stdout.strip():
        commit_sha = p_sha.stdout.strip()[:7]

    return RepoContext(
        root_path=target_dir,
        source_type="github",
        source_ref=canonical_url,
        repo_name=repo,
        commit_sha=commit_sha,
        dirty=False,
    )
