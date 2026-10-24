"""Licence policy: nothing we run or ship may oblige us to disclose our own source code.

classify(text) -> one of
  'banned'        network copyleft or source-available: AGPL, SSPL, EUPL, OSL, RPL, CPAL, Commons Clause, BUSL, Elastic. Offering the product as a service
                  would oblige us to publish the application (or forbids the service). Never allowed, in any environment.
  'gpl'           GPL (not LGPL, not AGPL). No disclosure duty while it only runs on our servers, but a duty as soon as we DISTRIBUTE the code: the
                  JavaScript bundle served to browsers, the packaged desktop runner, anything handed to a customer. Allowed server-side only.
  'weak'          LGPL / MPL / EPL / CDDL: allowed when used unmodified as a library (dynamic link / separate file); reviewed when bundled into a
                  distributed artefact.
  'permissive'    MIT / BSD / Apache / ISC / PSF / Unlicense / CC0 / zlib / ...
  'unknown'       no usable licence text: must be looked up by a person.

A package that offers a choice ("GPL or LGPL or MPL", "AGPL or commercial licence") is judged by its most permissive allowed option only when that
option is named explicitly; a dual licence whose free option is the AGPL is 'banned' unless we hold the commercial licence.
"""
from __future__ import annotations

import re

_BANNED = re.compile(
    r"\bagpl\b|affero|\bsspl\b|server side public|\beupl\b|european union public|\bosl[- ]?3|open software licen[cs]e|\brpl\b|reciprocal public|"
    r"\bcpal\b|common public attribution|commons clause|\bbusl\b|business source|elastic licen[cs]e|sleepycat|\bcc[- ]by[- ]nc",
    re.I)
_LGPL = re.compile(r"\blgpl\b|lesser general public|library general public", re.I)
_GPL = re.compile(r"\bgpl\b|gnu general public|general public licen[cs]e|\bgplv[23]", re.I)
_WEAK = re.compile(r"\bmpl\b|mozilla public|\bepl\b|eclipse public|\bcddl\b|common development and distribution|\bcpl\b|\bapsl\b", re.I)
_PERMISSIVE = re.compile(
    r"\bmit\b|\bbsd\b|apache|\bisc\b|\bpsf\b|python software foundation|unlicense|public domain|\bcc0\b|\bzlib\b|\bhpnd\b|\bwtfpl\b|\bpil\b|"
    r"historical permission|\bpostgresql\b|\bblueoak\b|\bartistic\b|\bboost\b|\bpython-2\.0\b|0bsd|\bfreetype\b|\bofl\b|open font|curl|x11|"
    r"creative commons attribution|\bcc[- ]by\b|\bupl\b|universal permissive|\bncsa\b|\bmit-0\b|\bbsl-1\.0\b",
    re.I)
# A choice that is satisfied by a permissive or weak option ("MIT OR GPL", "GPL or LGPL or MPL") is not a GPL obligation.
_OPTION_SPLIT = re.compile(r"\s+(?:or|/|,|\|)\s+|\bOR\b", re.I)


def classify(text: str) -> str:
    t = (text or "").strip()
    if len(t) > 400:       # a whole licence text in the metadata field: its title is in the first lines
        t = " ".join(t.split())[:300]
    if not t or t.lower() in {"unknown", "none", "n/a", "see license file", "see license in license", "other/proprietary license"}:
        return "unknown"
    # dual / multi licence: judge each named option, take the most permissive one we may choose
    options = [o for o in _OPTION_SPLIT.split(t) if o.strip()]
    if len(options) > 1:
        ranked = {"permissive": 0, "weak": 1, "gpl": 2, "banned": 3, "unknown": 4}
        verdicts = [classify(o) for o in options]
        known = [v for v in verdicts if v != "unknown"]
        if known:
            best = min(known, key=ranked.__getitem__)
            # "AGPL or commercial licence": the commercial option is unknown to this check, so it stays banned
            return best
    if _BANNED.search(t):
        return "banned"
    if _LGPL.search(t):
        return "weak"
    if _GPL.search(t):
        # GPL with a linking / classpath / bootloader exception is still 'gpl' for distribution purposes; flagged for a person
        return "gpl"
    if _WEAK.search(t):
        return "weak"
    if _PERMISSIVE.search(t):
        return "permissive"
    return "unknown"


def worst(classes) -> str:
    order = ["permissive", "weak", "unknown", "gpl", "banned"]
    return max(classes, key=order.index) if classes else "permissive"
