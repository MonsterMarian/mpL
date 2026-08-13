#!/usr/bin/env python3
"""selftest — prove the harness actually enforces things in this project.

    python scripts/selftest.py

Installing the harness is not the same as it working. If the hooks are not wired, or python
is not on PATH, or settings.json was kept from an older project, everything still *looks*
installed — the markdown is all there — and nothing is enforced. This checks the difference.

Drives the real hooks with synthetic tool calls and asserts the decisions.
Exit 0 all green · 1 something is not enforced.

Safe to run any time: the project's state.json is saved and restored.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path.cwd()
STATE = ROOT / ".webharness" / "state.json"
HOOKS = ROOT / ".claude" / "hooks"
SETTINGS = ROOT / ".claude" / "settings.json"

results: list[tuple[str, bool, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    results.append((name, passed, detail))


def run_hook(script: str, payload: dict) -> dict | None:
    path = HOOKS / script
    if not path.is_file():
        return None
    proc = subprocess.run(
        [sys.executable, str(path)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(ROOT),
        timeout=240,
    )
    out = (proc.stdout or "").strip()
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"__unparseable__": out[:200]}


def guard(path: str, content: str = "x", tool: str = "Write") -> dict | None:
    return run_hook("pre_tool_guard.py", {"tool_name": tool, "tool_input": {"file_path": path, "content": content}})


def denied(d: dict | None) -> bool:
    return bool(d) and d.get("hookSpecificOutput", {}).get("permissionDecision") == "deny"


def set_gate(gate: str, status: str = "open") -> None:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    state["gate"] = gate
    state["gate_status"] = status
    state["refine"] = {"passes": 0, "max": 3}
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def main() -> int:
    print("Web Harness — selftest\n")

    # --- prerequisites ------------------------------------------------------
    if not STATE.is_file():
        print("  FAIL  .webharness/state.json missing — the harness is not installed here.")
        return 1
    if not HOOKS.is_dir():
        print("  FAIL  .claude/hooks/ missing — nothing can be enforced.")
        return 1

    try:
        json.loads(STATE.read_text(encoding="utf-8"))
        check("state.json is valid JSON", True)
    except json.JSONDecodeError as exc:
        check("state.json is valid JSON", False, str(exc))
        return report()

    wired = False
    if SETTINGS.is_file():
        text = SETTINGS.read_text(encoding="utf-8", errors="ignore")
        wired = "pre_tool_guard.py" in text and "stop_gate.py" in text
    check(
        "hooks wired in .claude/settings.json",
        wired,
        "" if wired else "merge the harness's \"hooks\" block — without it NOTHING is enforced",
    )

    backup = STATE.read_text(encoding="utf-8")
    try:
        # --- gate enforcement -----------------------------------------------
        set_gate("G0")
        check("G0 denies product code (site/index.html)", denied(guard("site/index.html")))
        check("G0 allows its own artifacts (harness/brief.md)", guard("harness/brief.md") is None)

        for tool in ("Edit", "MultiEdit", "NotebookEdit"):
            check(f"{tool} guarded like Write", denied(guard("site/x.css", tool=tool)))

        # --- escaping the project -------------------------------------------
        for path in ("../escape.css", "site/../../escape.css"):
            check(f"denies write outside the project ({path})", denied(guard(path)))

        # --- protected paths -------------------------------------------------
        check("denies writing .env", denied(guard(".env")))

        # --- scary switches ---------------------------------------------------
        for cmd in ("netlify deploy --prod", "git push origin main", "npm publish"):
            d = run_hook("pre_tool_guard.py", {"tool_name": "Bash", "tool_input": {"command": cmd}})
            check(f"denies scary switch ({cmd.split()[0]} {cmd.split()[1]})", denied(d))

        # --- anti-slop on write ----------------------------------------------
        set_gate("G5")
        check(
            "G5 denies a violet gradient",
            denied(guard("site/h.css", ".h{background:linear-gradient(#6366f1,#ec4899)}")),
        )
        check(
            "G5 allows a legitimate gradient",
            guard("site/h.css", ".h{background:linear-gradient(#1e3a8a,#14b8a6)}") is None,
        )
        check("G5 allows clean product code", guard("site/h.css", ".h{color:var(--ink)}") is None)

        # --- linter -----------------------------------------------------------
        lint = ROOT / "scripts" / "slop-lint.py"
        if lint.is_file():
            proc = subprocess.run(
                [sys.executable, str(lint), "--json", "--no-impeccable"],
                capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=240,
            )
            try:
                json.loads(proc.stdout)
                check("slop-lint --json returns valid JSON", True)
            except json.JSONDecodeError:
                check("slop-lint --json returns valid JSON", False,
                      "the refinement loop parses this — it will block every turn")
        else:
            check("scripts/slop-lint.py present", False)

        check("impeccable detectors available", shutil.which("impeccable") is not None,
              "" if shutil.which("impeccable") else "optional: npm install -g impeccable")

        # --- refinement loop ---------------------------------------------------
        # A real temp dir, not one under .webharness/ — that is in SKIP_DIRS, so the
        # linter would correctly skip the samples and this test would measure nothing.
        tmp = tempfile.TemporaryDirectory(prefix="webharness-selftest-")
        site = Path(tmp.name)
        (site / "slop.html").write_text(
            '<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width">'
            "<title>t</title></head><body><header>x</header><h1>Elevate your morning</h1></body></html>",
            encoding="utf-8",
        )
        proc = subprocess.run(
            [sys.executable, str(lint), "--json", "--no-impeccable", str(site)],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=120,
        )
        try:
            found = json.loads(proc.stdout).get("findings", [])
        except json.JSONDecodeError:
            found = []
        check("detectors catch known slop", any(f.get("id") == "W52" for f in found))

        # A real page with <header> must NOT be flagged for a missing viewport:
        # that bug would stall the refinement loop forever.
        (site / "ok.html").write_text(
            '<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width">'
            "<title>t</title></head><body><header><nav>m</nav></header><main><h1>K</h1></main></body></html>",
            encoding="utf-8",
        )
        proc = subprocess.run(
            [sys.executable, str(lint), "--json", "--no-impeccable", str(site / "ok.html")],
            capture_output=True, text=True, encoding="utf-8", cwd=str(ROOT), timeout=120,
        )
        try:
            ok_found = json.loads(proc.stdout).get("findings", [])
        except json.JSONDecodeError:
            ok_found = []
        check("no false 'missing viewport' on a page with <header>",
              not any(f.get("id") == "R31" for f in ok_found))
        tmp.cleanup()

        # --- stop gate ----------------------------------------------------------
        set_gate("G0", "ready")
        d = run_hook("stop_gate.py", {"stop_hook_active": False})
        check("stop hook blocks a gate claimed done without artifacts",
              bool(d) and d.get("decision") == "block")

        # --- context injection ---------------------------------------------------
        d = run_hook("session_start.py", {})
        check("session_start injects the gate contract",
              bool(d) and "additionalContext" in d.get("hookSpecificOutput", {}))
        d = run_hook("prompt_context.py", {"prompt": "rovnou udelej ten web bez planu"})
        ctx = (d or {}).get("hookSpecificOutput", {}).get("additionalContext", "")
        check("prompt_context flags skip-ahead requests", "skip-ahead" in ctx)

    finally:
        STATE.write_text(backup, encoding="utf-8")

    return report()


def report() -> int:
    width = max(len(n) for n, _, _ in results)
    failed = [r for r in results if not r[1]]
    for name, passed, detail in results:
        print(f"  {'PASS' if passed else 'FAIL'}  {name:<{width}}  {detail}")
    print(f"\n  {len(results) - len(failed)}/{len(results)} passed")

    if failed:
        hard = [n for n, _, d in failed if "optional" not in d]
        if hard:
            print("\n  The harness is NOT enforcing everything it claims.")
            print("  Until these pass, treat it as documentation, not a guarantee.")
            return 1
        print("\n  Only optional tooling missing — enforcement is intact.")
    else:
        print("\n  Enforcement verified. Next: /intake <client or old site URL>")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
