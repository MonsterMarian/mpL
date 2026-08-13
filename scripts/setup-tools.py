#!/usr/bin/env python3
"""setup-tools — check (and optionally install) everything the Web Harness needs.

    python scripts/setup-tools.py             # check only, changes nothing
    python scripts/setup-tools.py --install   # install what is missing
    python scripts/setup-tools.py --install --only impeccable,pillow
    python scripts/setup-tools.py --json

Writes .webharness/tools.json so the gates know what is actually available and
can say "impeccable not installed" instead of silently skipping it.

Check-only is the default on purpose: installing packages changes the machine,
and that is the human's call.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(".webharness")
TOOLS_FILE = STATE_DIR / "tools.json"


def run(cmd: list[str], timeout: int = 600) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8")
        return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()
    except FileNotFoundError:
        return 127, f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    except OSError as exc:
        return 1, str(exc)


def version_of(exe: str, flag: str = "--version") -> str | None:
    if not shutil.which(exe):
        return None
    code, out = run([exe, flag], timeout=60)
    return out.splitlines()[0].strip() if code == 0 and out else None


# --- individual tools --------------------------------------------------------


def check_python() -> dict:
    v = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    ok = sys.version_info >= (3, 9)
    return {
        "name": "python",
        "required": True,
        "ok": ok,
        "version": v,
        "why": "runs the harness hooks and scripts",
        "fix": "install Python 3.9+ and make sure `python` is on PATH",
    }


def check_node() -> dict:
    v = version_of("node")
    ok = bool(v)
    major = 0
    if v:
        try:
            major = int(v.lstrip("v").split(".")[0])
        except ValueError:
            major = 0
    return {
        "name": "node",
        "required": False,
        "ok": ok and major >= 22,
        "version": v,
        "why": "impeccable CLI needs Node 22.12+",
        "fix": "install Node 22 LTS from nodejs.org",
    }


def check_impeccable() -> dict:
    exe = shutil.which("impeccable")
    v = version_of("impeccable") if exe else None
    return {
        "name": "impeccable",
        "required": False,
        "ok": bool(exe),
        "version": v,
        "why": "60 external design-slop detectors; used by slop-lint and the refinement loop",
        "fix": "npm install -g impeccable",
        "install": [["npm", "install", "-g", "impeccable"]],
    }


def check_impeccable_skills() -> dict:
    # The skills install writes into .claude/ (project scope) or ~/.claude (user scope).
    candidates = [
        Path(".claude/skills/impeccable"),
        Path(".claude/commands/impeccable"),
        Path.home() / ".claude" / "skills" / "impeccable",
    ]
    found = next((p for p in candidates if p.exists()), None)
    return {
        "name": "impeccable-skills",
        "required": False,
        "ok": found is not None,
        "version": str(found) if found else None,
        "why": "/impeccable polish, audit, typeset, live — human-driven design passes",
        "fix": "npx impeccable skills install -y --providers=claude --scope=project --no-hooks",
        # --no-hooks matters: impeccable ships its own hook manifests and they
        # would sit alongside the harness's five enforcement hooks.
        "install": [
            ["npx", "impeccable", "skills", "install", "-y",
             "--providers=claude", "--scope=project", "--no-hooks"]
        ],
    }


def check_taste_skill() -> dict:
    """taste-skill is markdown only — no detector, so it cannot join the refinement loop."""
    roots = [Path(".claude/skills"), Path.home() / ".claude" / "skills"]
    found = None
    for root in roots:
        if not root.is_dir():
            continue
        for child in root.iterdir():
            if "taste" in child.name.lower():
                found = child
                break
        if found:
            break
    return {
        "name": "taste-skill",
        "required": False,
        "ok": found is not None,
        "version": str(found) if found else None,
        "why": "generative design skill (G3/G5) — a second opinion alongside impeccable; no detector",
        "fix": "npx skills add https://github.com/Leonxlnx/taste-skill",
        "install": [["npx", "skills", "add", "https://github.com/Leonxlnx/taste-skill"]],
    }


def check_pillow() -> dict:
    try:
        import PIL  # noqa: F401
        from PIL import Image  # noqa: F401

        v = getattr(__import__("PIL"), "__version__", "unknown")
        ok = True
    except ImportError:
        v, ok = None, False
    return {
        "name": "pillow",
        "required": False,
        "ok": ok,
        "version": v,
        "why": "scripts/frames.py — scroll-sequence frame processing (G4 route C)",
        "fix": "pip install pillow",
        "install": [[sys.executable, "-m", "pip", "install", "pillow"]],
    }


def check_mcp(name: str, needle: str, why: str, fix: str) -> dict:
    """Look for an MCP server in the usual Claude Code config locations."""
    hits = []
    for cfg in [
        Path(".mcp.json"),
        Path(".claude/settings.json"),
        Path(".claude/settings.local.json"),
        Path.home() / ".claude.json",
        Path.home() / ".claude" / "settings.json",
    ]:
        if not cfg.is_file():
            continue
        try:
            if needle.lower() in cfg.read_text(encoding="utf-8", errors="ignore").lower():
                hits.append(cfg.as_posix())
        except OSError:
            continue
    return {
        "name": name,
        "required": False,
        "ok": bool(hits),
        "version": hits[0] if hits else None,
        "why": why,
        "fix": fix,
        "manual": True,
    }


def check_git() -> dict:
    v = version_of("git")
    return {
        "name": "git",
        "required": False,
        "ok": bool(v),
        "version": v,
        "why": "history, rollback, and the /audit drift check",
        "fix": "install git",
    }


CHECKS = [
    check_python,
    check_node,
    check_git,
    check_impeccable,
    check_impeccable_skills,
    check_taste_skill,
    check_pillow,
    lambda: check_mcp(
        "higgsfield-mcp",
        "higgsfield",
        "image and video generation for G4 assets",
        "higgsfield.ai -> MCP & CLI -> paste the command into Claude Code",
    ),
    lambda: check_mcp(
        "browser-mcp",
        "browser",
        "real rendering, console, network and screenshots for G6 verification",
        "built into Claude Code (Browser pane) — no install needed in most setups",
    ),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="Check/install Web Harness tooling")
    ap.add_argument("--install", action="store_true", help="install what is missing (changes the machine)")
    ap.add_argument("--only", default=None, help="comma-separated tool names")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    wanted = {n.strip() for n in args.only.split(",")} if args.only else None

    results = [c() for c in CHECKS]
    if wanted:
        results = [r for r in results if r["name"] in wanted]

    if args.install:
        for r in results:
            if r["ok"] or not r.get("install"):
                continue
            print(f"\ninstalling {r['name']} …")
            for cmd in r["install"]:
                code, out = run(cmd)
                tail = "\n".join(out.splitlines()[-4:])
                print(f"  $ {' '.join(cmd)}\n  -> exit {code}\n{tail}")
                if code != 0:
                    print(f"  FAILED — install {r['name']} yourself: {r['fix']}")
                    break
        # re-check so the report and tools.json reflect reality
        results = [c() for c in CHECKS]
        if wanted:
            results = [r for r in results if r["name"] in wanted]

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    TOOLS_FILE.write_text(
        json.dumps(
            {
                "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "tools": {r["name"]: {"ok": r["ok"], "version": r["version"]} for r in results},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    if args.json:
        print(json.dumps({"tools": results}, indent=2))
        return 0

    print("\nWeb Harness — tooling\n")
    for r in results:
        mark = "ok  " if r["ok"] else ("MISS" if not r["required"] else "FAIL")
        ver = f" ({r['version']})" if r["version"] else ""
        print(f"  [{mark}] {r['name']}{ver}")
        print(f"         {r['why']}")
        if not r["ok"]:
            print(f"         fix: {r['fix']}")

    missing_required = [r for r in results if r["required"] and not r["ok"]]
    missing_optional = [r for r in results if not r["required"] and not r["ok"]]

    print(f"\nwrote {TOOLS_FILE.as_posix()}")

    if missing_required:
        print("\nBLOCKED — required tooling missing. The harness will not run correctly.")
        return 1
    if missing_optional and not args.install:
        names = ", ".join(r["name"] for r in missing_optional)
        print(f"\nMissing (optional): {names}")
        print("Install the automatable ones with:  python scripts/setup-tools.py --install")
        print("MCPs and skills marked `manual` you install yourself — see SETUP.md.")
        return 2

    print("\nReady. Next: /intake <client or old site URL>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
