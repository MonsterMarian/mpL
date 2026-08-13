#!/usr/bin/env python3
"""slop-lint — mechanical pass over the anti-slop catalogue.

    python scripts/slop-lint.py                # lint the default roots
    python scripts/slop-lint.py site/          # lint a path
    python scripts/slop-lint.py --tier banned  # hard bans only
    python scripts/slop-lint.py --json         # machine-readable
    python scripts/slop-lint.py --no-impeccable  # skip the external detector

Exit codes: 0 clean · 1 hard bans found · 2 only soft tells found.

Two engines:
  - the rules below: project guardrails, content truth, the violet-gradient hue check
  - `impeccable detect`: 60 external detector rules, if it is installed (scripts/setup-tools.py)

Findings waived in harness/slop-waivers.md are filtered out — that is how a deliberate design
choice stops being reported forever.

Even with both engines this is a floor, never a substitute for reading the page.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

WAIVER_FILE = "harness/slop-waivers.md"
# - [S26] site/styles.css — cards use the locked 16px radius from chosen.md
WAIVER_RE = re.compile(r"^\s*[-*]\s*\[([A-Za-z0-9_.-]+)\]\s*(\S+)", re.MULTILINE)

DEFAULT_ROOTS = ["site", "src", "variants", "public", "index.html"]
SUFFIXES = {".html", ".htm", ".css", ".scss", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", ".astro", "vendor", ".webharness"}

# Harness dev tooling, not product code. Linting it produces noise that can never be
# fixed (it is meant to look like a tool) and BANNED hits here would stall the
# refinement loop. The variants themselves are still linted — only the board is not.
SKIP_FILES = {
    "variants/board.html",
    "taste/index.html",
    "src/dev/tweaks-bar.js",
    "src/dev/tweaks-bar.css",
    "src/dev/tweaks.spec.js",
}

# (id, surface, tier, pattern, message)
RULES = [
    # --- typography ---
    ("T01", "typography", "banned", r"font-family:[^;]*\bInter\b", "Inter as the primary face"),
    ("T05", "typography", "tell", r"text-transparent[^\"']*bg-clip-text|background-clip:\s*text", "gradient-filled headline"),
    ("T03", "typography", "tell", r"font-size:\s*\d+(\.\d+)?px", "hard px type size — use the scale in tokens.css"),
    ("T07", "typography", "tell", r"line-height:\s*1\.5\b", "line-height 1.5 applied indiscriminately"),
    ("T09", "typography", "tell", r"fonts\.googleapis\.com[^\"']*family=([^\"'&]*\|){3,}", "4+ font families"),

    # --- colour ---
    ("C11", "colour", "banned", r"from-purple-\d{3}\s+to-pink-\d{3}", "purple->pink gradient (slop signature #1)"),
    ("C11b", "colour", "banned", r"from-blue-\d{3}\s+to-purple-\d{3}", "blue->purple gradient"),
    ("C11c", "colour", "banned", r"from-indigo-\d{3}\s+to-(purple|pink|fuchsia|violet)-\d{3}", "indigo->purple gradient"),
    ("C13", "colour", "tell", r"#0f172a|#1e293b|\bslate-9\d{2}\b", "default slate dark palette"),
    # White page backgrounds are normal; pure-black *text* is the actual tell.
    ("C17", "colour", "tell", r"(?<!background-)(?<!background)color:\s*#000(000)?\b", "pure black text — pull it in from the extreme"),
    ("C19", "colour", "tell", r"backdrop-filter:\s*blur|backdrop-blur", "glassmorphism card"),

    # --- spatial ---
    ("S26", "spatial", "tell", r"rounded-2xl|rounded-3xl|border-radius:\s*(1[6-9]|2\d|3\d)px", "one large radius on everything"),
    ("S27", "spatial", "tell", r"shadow-2xl|box-shadow:[^;]*rgba\(0,\s*0,\s*0,\s*0\.[3-9]", "heavy generic drop shadow"),
    ("S22", "spatial", "tell", r"grid-cols-3[^\"']*\bgap-(6|8)\b", "default three-feature-card row"),

    # --- responsiveness ---
    # `<head[\s>]` not `<head` — the latter also matches <header>, which every real page has,
    # and R31 is BANNED, so a false hit would block the refinement loop forever.
    # Lookahead scans the whole document: a viewport meta anywhere satisfies it.
    ("R31", "responsiveness", "banned", r"<head[\s>](?![\s\S]*name=[\"']viewport)", "missing viewport meta"),
    ("R34", "responsiveness", "tell", r"(height|min-height):\s*100vh\b", "100vh on mobile — use svh/dvh"),
    ("R33", "responsiveness", "tell", r"width:\s*(1[2-9]|[2-9])\d{2}px\s*;", "fixed px layout width"),
    ("R38", "responsiveness", "tell", r"<img(?![^>]*\bwidth=)(?![^>]*\bsrcset=)[^>]*>", "img without intrinsic width/height"),

    # --- interaction ---
    ("I40", "interaction", "tell", r"outline:\s*(none|0)\s*;(?![^}]*outline-offset)", "focus outline removed with no replacement"),
    ("I43", "interaction", "tell", r"<a[^>]*href=[\"']#[\"'][^>]*class=[\"'][^\"']*(btn|cta|button)", "dead CTA (href=\"#\")"),
    ("I44", "interaction", "banned", r"randomuser\.me|i\.pravatar\.cc|thispersondoesnotexist", "fake testimonial avatars"),
    ("I44b", "interaction", "tell", r"\bTrusted by\b|\bAs seen in\b", "social-proof band — only ship real logos"),

    # --- motion ---
    ("M45", "motion", "tell", r"transition:\s*all\b", "transition: all"),
    ("M46", "motion", "tell", r"animate-pulse|animate-bounce", "canned attention animation"),
    ("M49", "motion", "tell", r"transition[^;]*\blinear\b", "linear easing"),

    # --- UX writing ---
    ("W52", "writing", "banned", r"\bElevate your\b|\bUnlock the power of\b|\bSupercharge your\b|\bSeamlessly integrate\b", "AI marketing filler"),
    ("W52b", "writing", "banned", r"\bTake your .{3,30} to the next level\b", "AI marketing filler"),
    ("W53", "writing", "banned", r"\bGet Started Free\b[\s\S]{0,400}\bLearn More\b", "default two-button hero pair"),
    ("W54", "writing", "banned", r"Lorem ipsum", "lorem ipsum in a shipped file"),
    ("W55", "writing", "banned", r"placeholder\.com|via\.placeholder|placehold\.it|placekitten", "placeholder image service"),
    ("W57", "writing", "tell", r"\bThe future of\b|\bReimagine\b|\bRevolutioniz", "headline that says nothing specific"),

    # --- from ui-ux-pro-max (see .claude/skills/ui-ux-pro-max/SKILL.md) ---
    # Only the mechanically checkable ones. The rest are a read-through in /verify.
    ("U01", "accessibility", "banned", r"user-scalable\s*=\s*no|maximum-scale\s*=\s*1", "zoom disabled — never acceptable"),
    ("U02", "accessibility", "tell", r"<button(?![^>]*aria-label)[^>]*>\s*<(svg|img|i)\b", "icon-only button without aria-label"),
    # U03 needs to know whether a <label for="..."> exists elsewhere in the document,
    # which no single regex can do — implemented as placeholder_labelled() below.
    ("U04", "touch", "tell", r"(width|height):\s*(1\d|2\d|3[0-9])px[^;]*;[^}]*cursor:\s*pointer", "touch target under 44px"),
    ("U05", "typography", "tell", r"font-size:\s*(\d|1[0-5])px", "body text under 16px — iOS auto-zooms"),
    ("U06", "style", "tell", r'>\s*[\U0001F300-\U0001FAFF☀-➿]\s*<', "emoji used as an icon — use SVG"),
    ("U07", "animation", "tell", r"transition[^;]*\b([5-9]\d{2}|\d{4,})ms\b|animation[^;]*\b([5-9]\d{2}|\d{4,})ms\b", "animation over 500ms"),
    # [^;{}]* not [^;]* — otherwise the match runs past the closing brace into the next
    # rule and a class named `.top` reads as "animating top".
    ("U08", "animation", "tell", r"transition:[^;{}]*\b(width|height|top|left|margin)\b", "animating layout properties — use transform"),
    ("U09", "layout", "tell", r"z-index:\s*(\d{4,})", "z-index out of any sane scale"),
    ("U10", "typography", "tell", r"letter-spacing:\s*-0\.0[5-9]|letter-spacing:\s*-[1-9]", "tracking too tight for body text"),
]

# A missing-viewport rule only makes sense on a full document.
DOC_ONLY = {"R31"}

# --- C12: the violet gradient -----------------------------------------------
# Regex cannot see hue, and the slop signature is a hue arc: blue -> violet ->
# pink. Kept in sync with .claude/hooks/pre_tool_guard.py (deliberately
# duplicated so this script stays runnable on its own).

GRADIENT_RE = re.compile(r"(?:linear|radial|conic)-gradient\(([^()]*(?:\([^()]*\)[^()]*)*)\)", re.IGNORECASE)
HEX_RE = re.compile(r"#([0-9a-f]{3}|[0-9a-f]{6})\b", re.IGNORECASE)
RGB_RE = re.compile(r"rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)", re.IGNORECASE)

SLOP_ARC = (215, 345)
MIN_SPAN = 25


def hue_of(r: int, g: int, b: int):
    """Hue in degrees, or None for greys and near-greys."""
    r, g, b = r / 255, g / 255, b / 255
    mx, mn = max(r, g, b), min(r, g, b)
    delta = mx - mn
    if mx == 0 or delta / mx < 0.25:
        return None
    if mx == r:
        h = ((g - b) / delta) % 6
    elif mx == g:
        h = (b - r) / delta + 2
    else:
        h = (r - g) / delta + 4
    return h * 60


def gradient_stops(body: str) -> list[float]:
    hues = []
    for m in HEX_RE.finditer(body):
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        hue = hue_of(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
        if hue is not None:
            hues.append(hue)
    for m in RGB_RE.finditer(body):
        hue = hue_of(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if hue is not None:
            hues.append(hue)
    return hues


# --- U03: placeholder standing in for a label --------------------------------
INPUT_RE = re.compile(r"<input\b[^>]*>", re.IGNORECASE)
ATTR_RE = re.compile(r'(\w[\w-]*)\s*=\s*["\']([^"\']*)["\']', re.IGNORECASE)
LABEL_FOR_RE = re.compile(r'<label\b[^>]*\bfor\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)

# Inputs that carry no user-visible text by nature.
UNLABELLED_TYPES = {"hidden", "submit", "button", "reset", "image"}


def find_placeholder_labels(text: str):
    """Yield (index, snippet) for inputs whose only label is their placeholder.

    Needs whole-document context: a <label for="x"> may sit anywhere relative to
    the input it labels, so a single regex over the tag cannot decide this.
    """
    labelled = {m.group(1) for m in LABEL_FOR_RE.finditer(text)}
    for m in INPUT_RE.finditer(text):
        attrs = {k.lower(): v for k, v in ATTR_RE.findall(m.group(0))}
        if attrs.get("type", "text").lower() in UNLABELLED_TYPES:
            continue
        if not attrs.get("placeholder"):
            continue
        if attrs.get("aria-label") or attrs.get("aria-labelledby") or attrs.get("title"):
            continue
        if attrs.get("id") and attrs["id"] in labelled:
            continue
        yield m.start(), m.group(0)[:80].replace("\n", " ")


def find_violet_gradients(text: str):
    """Yield (index, matched_text) for gradients traversing the blue->pink arc."""
    for m in GRADIENT_RE.finditer(text):
        hues = gradient_stops(m.group(1))
        if len(hues) < 2:
            continue
        if all(SLOP_ARC[0] <= h <= SLOP_ARC[1] for h in hues) and (max(hues) - min(hues)) >= MIN_SPAN:
            yield m.start(), m.group(0)[:80].replace("\n", " ")


def iter_files(roots: list[str]) -> list[Path]:
    out: list[Path] = []
    for root in roots:
        p = Path(root)
        if p.is_file():
            if p.suffix.lower() in SUFFIXES:
                out.append(p)
            continue
        if not p.is_dir():
            continue
        for f in p.rglob("*"):
            if f.is_file() and f.suffix.lower() in SUFFIXES:
                if not any(part in SKIP_DIRS for part in f.parts):
                    out.append(f)
    return sorted({f for f in set(out) if f.as_posix() not in SKIP_FILES})


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def lint(files: list[Path], tier_filter: str | None) -> list[dict]:
    findings = []
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        is_doc = "<html" in text.lower() or "<!doctype" in text.lower()

        if not tier_filter or tier_filter == "banned":
            for index, matched in find_violet_gradients(text):
                findings.append(
                    {
                        "id": "C12",
                        "surface": "colour",
                        "tier": "banned",
                        "file": path.as_posix(),
                        "line": line_of(text, index),
                        "message": "gradient traverses the blue/violet/pink arc",
                        "match": matched,
                    }
                )
                break

        if not tier_filter or tier_filter == "tell":
            for index, matched in find_placeholder_labels(text):
                findings.append(
                    {
                        "id": "U03",
                        "surface": "accessibility",
                        "tier": "tell",
                        "file": path.as_posix(),
                        "line": line_of(text, index),
                        "message": "placeholder used as the label",
                        "match": matched,
                    }
                )
                break

        for rid, surface, tier, pattern, message in RULES:
            if tier_filter and tier != tier_filter:
                continue
            if rid in DOC_ONLY and not is_doc:
                continue
            for m in re.finditer(pattern, text, flags=re.IGNORECASE):
                findings.append(
                    {
                        "id": rid,
                        "surface": surface,
                        "tier": tier,
                        "file": path.as_posix(),
                        "line": line_of(text, m.start()),
                        "message": message,
                        "match": m.group(0)[:80].replace("\n", " "),
                    }
                )
                break  # one finding per rule per file — the point is the pattern, not the count
    return findings


def load_waivers() -> set[tuple[str, str]]:
    """(rule_id, path) pairs the human has explicitly signed off on."""
    path = Path(WAIVER_FILE)
    if not path.is_file():
        return set()
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return set()
    return {(m.group(1).upper(), m.group(2)) for m in WAIVER_RE.finditer(text)}


def is_waived(finding: dict, waivers: set[tuple[str, str]]) -> bool:
    # BANNED findings are project law: only the human may amend harness/guardrails.md.
    # A waiver line pointing at one is ignored, not honoured.
    if finding.get("tier") == "banned":
        return False
    rid = str(finding.get("id", "")).upper()
    fpath = finding.get("file", "")
    return (rid, fpath) in waivers or (rid, "*") in waivers


def rejected_waivers(findings: list[dict], waivers: set[tuple[str, str]]) -> list[dict]:
    """Waivers that try to excuse a hard ban — reported so they cannot pass silently."""
    return [
        f
        for f in findings
        if f.get("tier") == "banned"
        and ((str(f.get("id", "")).upper(), f.get("file", "")) in waivers
             or (str(f.get("id", "")).upper(), "*") in waivers)
    ]


def run_impeccable(roots: list[str]) -> tuple[list[dict], str | None]:
    """Run `impeccable detect --json`. Returns (findings, unavailable_reason)."""
    exe = shutil.which("impeccable")
    cmd = [exe, "detect", "--json", *roots] if exe else None
    if cmd is None:
        npx = shutil.which("npx")
        if not npx:
            return [], "not installed (and npx not on PATH) — run scripts/setup-tools.py --install"
        # --no-install: never silently download a package mid-lint.
        cmd = [npx, "--no-install", "impeccable", "detect", "--json", *roots]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, encoding="utf-8")
    except (OSError, subprocess.TimeoutExpired) as exc:
        return [], f"failed to run ({exc.__class__.__name__})"

    out = (proc.stdout or "").strip()
    if not out:
        return [], f"no output (exit {proc.returncode}); {(proc.stderr or '').strip()[:120]}"

    # v3 emits a bare array. Be tolerant anyway: the shape is not contractual across versions.
    start = min((i for i in (out.find("["), out.find("{")) if i != -1), default=-1)
    if start == -1:
        return [], "output was not JSON — check `impeccable detect --json` manually"
    try:
        data = json.loads(out[start:])
    except (json.JSONDecodeError, ValueError):
        return [], "output was not JSON — check `impeccable detect --json` manually"

    raw = data
    if isinstance(data, dict):
        for key in ("findings", "results", "issues", "violations", "detections"):
            if isinstance(data.get(key), list):
                raw = data[key]
                break
        else:
            raw = []

    root = Path.cwd().resolve()
    findings = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue

        # `antipattern` is v3's rule id; the others are older/other shapes.
        rid = item.get("antipattern") or item.get("rule") or item.get("id") or item.get("code") or "IMP"

        # Paths come back absolute; waivers are keyed on project-relative POSIX paths.
        fpath = str(item.get("file") or item.get("path") or "?")
        try:
            fpath = Path(fpath).resolve().relative_to(root).as_posix()
        except (ValueError, OSError):
            fpath = Path(fpath).as_posix()

        severity = str(item.get("severity", "")).lower()
        findings.append(
            {
                "id": str(rid),
                "surface": str(item.get("category") or item.get("surface") or "impeccable"),
                "tier": "banned" if severity in {"error", "high", "critical"} else "tell",
                "file": fpath,
                "line": item.get("line") or item.get("lineNumber") or 0,
                # `name` is a label; `description` is a paragraph. Prefer the label.
                "message": str(item.get("name") or item.get("message") or item.get("title") or item.get("description") or "")[:160],
                "match": str(item.get("snippet") or item.get("match") or "")[:80].replace("\n", " "),
                "engine": "impeccable",
            }
        )
    return findings, None


def main() -> int:
    ap = argparse.ArgumentParser(description="Anti-slop lint (see reference/anti-slop.md)")
    ap.add_argument("paths", nargs="*", default=None, help="files or directories to lint")
    ap.add_argument("--tier", choices=["banned", "tell"], help="only this tier")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--no-impeccable", action="store_true", help="skip the external detector")
    ap.add_argument("--show-waived", action="store_true", help="include waived findings")
    args = ap.parse_args()

    roots = args.paths or [r for r in DEFAULT_ROOTS if Path(r).exists()]
    if not roots:
        # Must still be valid JSON in --json mode: the refinement loop parses this,
        # and a plain-text line here would read as "lint broken" and block the turn.
        if args.json:
            print(json.dumps({"files": 0, "impeccable": "not run", "waived": 0,
                              "rejected_waivers": [], "findings": []}, indent=2))
        else:
            print("slop-lint: nothing to lint (no site/ src/ variants/ public/ index.html found)")
        return 0

    files = iter_files(roots)
    findings = lint(files, args.tier)
    for f in findings:
        f["engine"] = "harness"

    imp_note = "skipped (--no-impeccable)"
    if not args.no_impeccable:
        imp_findings, imp_note = run_impeccable(roots)
        if args.tier:
            imp_findings = [f for f in imp_findings if f["tier"] == args.tier]
        findings.extend(imp_findings)
        if imp_note is None:
            imp_note = f"{len(imp_findings)} findings"

    waivers = load_waivers()
    rejected = rejected_waivers(findings, waivers)
    waived = [f for f in findings if is_waived(f, waivers)]
    if not args.show_waived:
        findings = [f for f in findings if not is_waived(f, waivers)]

    if args.json:
        print(
            json.dumps(
                {
                    "files": len(files),
                    "impeccable": imp_note,
                    "waived": len(waived),
                    "rejected_waivers": [
                        {"id": f["id"], "file": f["file"]} for f in rejected
                    ],
                    "findings": findings,
                },
                indent=2,
            )
        )
    else:
        banned = [f for f in findings if f["tier"] == "banned"]
        tells = [f for f in findings if f["tier"] == "tell"]

        print(f"slop-lint — {len(files)} files scanned · impeccable: {imp_note}")
        if waived and not args.show_waived:
            print(f"           {len(waived)} finding(s) waived in {WAIVER_FILE}")
        if rejected:
            print(f"\n  WAIVER REJECTED ({len(rejected)}) — BANNED findings cannot be waived:")
            for f in rejected:
                print(f"    [{f['id']}] {f['file']} — remove this line from {WAIVER_FILE}")
            print("    Only the human may change a hard ban, by amending harness/guardrails.md.")
        print()
        for label, group in (("BANNED", banned), ("TELL", tells)):
            if not group:
                continue
            print(f"{label} ({len(group)})")
            for f in sorted(group, key=lambda x: (x["file"], x["line"])):
                engine = f.get("engine", "harness")
                print(f"  {f['file']}:{f['line']}  [{f['id']} {f['surface']}/{engine}] {f['message']}")
                if f["match"]:
                    print(f"      > {f['match']}")
            print()

        if not findings:
            print("clean — no catalogued patterns found.")
        print("Waive a deliberate choice by adding a line to harness/slop-waivers.md:")
        print("  - [S26] site/styles.css — cards use the locked 16px radius from chosen.md")
        print("Reminder: the detectors cover the mechanical half. Read the page too.")
        print("The three-second test is the one that matters.")

    if any(f["tier"] == "banned" for f in findings):
        return 1
    return 2 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
