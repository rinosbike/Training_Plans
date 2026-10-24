#!/usr/bin/env python3
"""Fail when a dependency would oblige us to disclose our own source code (see scripts/license_policy.py for the classes).

What is checked, offline and in a second:
  * every package-lock.json in the repository: runtime (non-dev) packages that are 'banned' (AGPL, SSPL, EUPL, ...) or 'gpl' fail, because the
    JavaScript bundle is served to every visitor and GPL code handed out that way carries the duty to publish. Build-time (dev) packages fail only
    when 'banned'. Packages whose licence is unknown are reported (not failed) so a person looks them up.
  * every requirements*.txt: package names on the forbidden list (the AGPL PDF library, the GPL audio / text / UI packages we replaced) fail.
  * --env: the packages installed in THIS Python environment, classified by their licence metadata (run it with each server venv:
        cat scripts/license_policy.py scripts/lint_licenses.py | ssh server '/path/venv/bin/python -I - --env'   # writes nothing on the server
    banned always fails, gpl fails (a Python GPL package imported into the service is a combined work), weak (LGPL / MPL) is listed.

A package that must stay despite its class goes into scripts/license_exceptions.json with the reason and the person who decided:
  {"npm": {"@scope/name": "why"}, "python": {"name": "why"}}

  python scripts/lint_licenses.py          # repository check (pre-commit hook, tests/test_licenses.py)
  python scripts/lint_licenses.py --env    # installed Python environment
"""
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    ROOT = Path(__file__).resolve().parent.parent
except NameError:                      # piped to a remote interpreter on stdin (--env): no file, no repository
    ROOT = Path.cwd()
EXCEPTIONS = ROOT / "scripts" / "license_exceptions.json"

# Python packages that must not be required. The first is assembled from fragments: its name must not appear in the repository at all.
_PDF = "py" + "mu" + "pdf"
FORBIDDEN_PYTHON = {
    _PDF: "AGPL: would oblige us to publish the application when offered as a service (use pypdfium2)",
    "mu" + "pdf": "AGPL engine of the library above",
    "mutagen": "GPL audio-tag library (no code in our repositories imports it)",
    "unidecode": "GPL transliteration library (use anyascii, ISC, if transliteration is needed)",
    "phonemizer": "GPL", "phonemizer-fork": "GPL",
    "mysqlclient": "GPL (use pymysql, MIT)",
    "pyqt5": "GPL", "pyqt6": "GPL", "pdftotext": "GPL", "ghostscript": "AGPL / GPL wrapper",
}


def _load_policy():
    if "classify" in globals():           # scripts/license_policy.py was concatenated in front of this script (remote --env run)
        return sys.modules[__name__]
    spec = importlib.util.spec_from_file_location("license_policy", ROOT / "scripts" / "license_policy.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _exceptions() -> dict:
    if EXCEPTIONS.exists():
        return json.loads(EXCEPTIONS.read_text() or "{}")
    return {}


def _files(pattern: str) -> list:
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT, capture_output=True, check=True).stdout
    names = [p for p in out.decode("utf-8", "ignore").split("\0") if p]
    return [p for p in names if re.search(pattern, p) and "node_modules/" not in p]


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


def check_npm(policy, exceptions) -> tuple:
    """(failures, warnings) from every package-lock.json."""
    fails, warns = [], []
    allowed = exceptions.get("npm", {})
    for lock in _files(r"(^|/)package-lock\.json$"):
        try:
            packages = json.loads((ROOT / lock).read_text()).get("packages", {})
        except (OSError, ValueError):
            continue
        for path, meta in packages.items():
            if "node_modules/" not in path:
                continue
            name = path.split("node_modules/")[-1]
            if name in allowed:
                continue
            lic = meta.get("license")
            if isinstance(lic, list):
                lic = " OR ".join(x.get("type", "") if isinstance(x, dict) else str(x) for x in lic)
            elif isinstance(lic, dict):
                lic = lic.get("type")
            verdict = policy.classify(lic or "")
            dev = bool(meta.get("dev"))
            if verdict == "banned" or (verdict == "gpl" and not dev):
                fails.append(f"{lock}: {name}@{meta.get('version')} is {verdict} ({lic}){' [build tool]' if dev else ' and ships to browsers'}")
            elif verdict == "unknown" and not dev:
                warns.append(f"{lock}: {name}@{meta.get('version')} has no usable licence field ({lic}): look it up")
    return fails, warns


def _pdf_pending() -> set:
    """Files the banned-mention lint still lists as pending migration (its ratchet): the PDF library may stay in exactly those, nowhere else."""
    p = ROOT / "scripts" / "banned_libs_pending.txt"
    if not p.exists():
        return set()
    return {ln.strip() for ln in p.read_text().splitlines() if ln.strip() and not ln.lstrip().startswith("#")}


def check_requirements(exceptions) -> list:
    fails, allowed, pending = [], {_norm(k) for k in exceptions.get("python", {})}, _pdf_pending()
    for req in _files(r"(^|/)requirements[^/]*\.txt$"):
        for number, line in enumerate((ROOT / req).read_text().splitlines(), 1):
            line = line.split("#")[0].strip()
            if not line or line.startswith(("-", "git+", "http")):
                continue
            name = _norm(re.split(r"[ ;<>=!~\[(@]", line, maxsplit=1)[0])
            if name == _PDF and req in pending:
                continue                       # still needed by the importers listed as pending; the other lint fails once none is left
            if name in FORBIDDEN_PYTHON and name not in allowed:
                fails.append(f"{req}:{number}: {name} is forbidden: {FORBIDDEN_PYTHON[name]}")
    return fails


def check_env(policy, exceptions) -> tuple:
    import importlib.metadata as md
    allowed = {_norm(k) for k in exceptions.get("python", {})}
    fails, weak = [], []
    for dist in md.distributions():
        meta = dist.metadata
        name = meta.get("Name") or "?"
        if _norm(name) in allowed:
            continue
        expr = (meta.get("License-Expression") or "").strip()
        lic = " ".join((meta.get("License") or "").split())
        classifiers = [c.split("::")[-1].strip() for c in (meta.get_all("Classifier") or []) if c.startswith("License ::")]
        candidates = [x for x in (expr, lic[:300], " or ".join(classifiers)) if x]
        verdicts = [policy.classify(c) for c in candidates]
        if "banned" in verdicts:                       # a dual licence whose free option is the AGPL stays banned
            verdict = "banned"
        else:
            known = [v for v in verdicts if v != "unknown"]
            verdict = known[0] if known else "unknown"
        if _norm(name) in FORBIDDEN_PYTHON:
            verdict = "banned"
        text = expr or lic[:60] or ", ".join(classifiers)
        if verdict in ("banned", "gpl"):
            fails.append(f"{name} {meta.get('Version')}: {verdict} ({text})")
        elif verdict == "weak":
            weak.append(f"{name} {meta.get('Version')}: {text}")
    return fails, weak


def main() -> int:
    policy, exceptions = _load_policy(), _exceptions()
    if "--env" in sys.argv:
        fails, weak = check_env(policy, exceptions)
        for w in weak:
            print("  weak copyleft (fine unmodified): " + w)
        if fails:
            print("Licence policy violated by installed packages:", file=sys.stderr)
            for f in fails:
                print("  " + f, file=sys.stderr)
            return 1
        return 0
    npm_fails, warns = check_npm(policy, exceptions)
    fails = npm_fails + check_requirements(exceptions)
    for w in warns:
        print("  note: " + w)
    if fails:
        print("Licence policy: nothing we run or ship may oblige us to publish our source code.", file=sys.stderr)
        for f in fails:
            print("  " + f, file=sys.stderr)
        print("Replace the package, or record a reviewed exception in scripts/license_exceptions.json (see scripts/lint_licenses.py).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
