#!/usr/bin/env python3
"""Fail when the repository names or imports a PDF library whose licence forces publication of a network service.

That library is licensed under the AGPL: offering the product as a service would oblige us to disclose the whole application, so it must not be
used, installed, imported or even mentioned anywhere in the repository (code, comments, docs, Guide text, requirements, migrations, tests).
Use pypdfium2 (Apache-2.0 / BSD) instead.

If a file ever has to be exempted while it is migrated, list it in scripts/banned_libs_pending.txt (the list may only shrink: a listed
file with no mention left must be removed from it).

  python scripts/lint_no_banned_libs.py      # check (also run by the pre-commit hook and tests/test_no_banned_libs.py)

The banned names are assembled from fragments below so that this file contains none of them itself.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PENDING = ROOT / "scripts" / "banned_libs_pending.txt"

_A, _B, _C = "py", "mu", "pdf"
_M, _Z = "fi", "tz"
BANNED = re.compile(
    rf"{_A}_?{_B}_?{_C}"                                        # the package / product name, any case, with or without separators
    rf"|\b{_B}_?{_C}\b"                                         # its engine name
    rf"|^\s*(?:import|from)\s+{_M}{_Z}\b"                       # its import name
    rf"|\b{_M}{_Z}\.(?:open|Rect|Document|Matrix|Pixmap|Page|Point|TextPage)\b",
    re.IGNORECASE | re.MULTILINE,
)
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".woff", ".woff2", ".ttf", ".eot", ".mp4",
                 ".lock", ".map", ".pkl", ".bin", ".xlsx", ".xls", ".docx", ".pptx"}
SKIP_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
SKIP_DIRS = ("node_modules/", "frontend/dist/", ".next/", "venv/", ".venv/")


def tracked_and_new() -> list:
    """Every file git knows plus new files not yet added (so a mention is caught before the commit), minus ignored ones."""
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8", "ignore").split("\0") if p]


def mentions(path: str) -> list:
    """[(line number, line)] of the banned names in one file ([] for binary or skipped files)."""
    p = ROOT / path
    if p.suffix.lower() in SKIP_SUFFIXES or p.name in SKIP_NAMES or any(path.startswith(d) or f"/{d}" in f"/{path}" for d in SKIP_DIRS):
        return []
    try:
        if not p.is_file() or p.stat().st_size > 8_000_000:
            return []
        text = p.read_bytes().decode("utf-8", "ignore")
    except OSError:
        return []
    if "\0" in text:
        return []
    hits = []
    for number, line in enumerate(text.splitlines(), 1):
        if BANNED.search(line):
            hits.append((number, line.strip()[:140]))
    return hits


def pending() -> set:
    if not PENDING.exists():
        return set()
    return {ln.strip() for ln in PENDING.read_text().splitlines() if ln.strip() and not ln.lstrip().startswith("#")}


def check() -> list:
    """The list of problems ([] = clean)."""
    allowed, problems, seen = pending(), [], set()
    for path in tracked_and_new():
        hits = mentions(path)
        if not hits:
            continue
        seen.add(path)
        if path not in allowed:
            first = hits[0]
            problems.append(f"{path}:{first[0]}: banned PDF library named ({len(hits)} place{'s' if len(hits) > 1 else ''}): {first[1]}")
    for path in sorted(allowed - seen):
        problems.append(f"{path}: listed in scripts/banned_libs_pending.txt but no longer contains a mention: remove it from the list")
    return problems


def main() -> int:
    problems = check()
    if not problems:
        return 0
    print("Banned PDF library (AGPL: would force us to publish the application when offered as a service):", file=sys.stderr)
    for line in problems:
        print("  " + line, file=sys.stderr)
    print("Use pypdfium2. Do not name the library in code, comments, docs or requirements.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
