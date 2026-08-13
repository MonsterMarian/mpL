#!/usr/bin/env python3
"""init-project — install the Web Harness into a project.

    python scripts/init-project.py /path/to/my-site --name "Kumbal"
    python scripts/init-project.py .                # install into the current folder
    python scripts/init-project.py . --force        # overwrite existing harness files

Copies .claude/, reference/, templates/, scripts/, prompts/, CLAUDE.md, AGENTS.md,
opencode.json; creates harness/, taste/, variants/, plans/, playbooks/, decisions.md
and a fresh .webharness/state.json at G0.

Never touches your source code, package.json, or .git.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent

COPY_TREES = [".claude", "reference", "templates", "prompts", "scripts"]
COPY_FILES = ["CLAUDE.md", "AGENTS.md", "SETUP.md", "opencode.json"]
MAKE_DIRS = ["harness", "taste", "variants", "plans", "playbooks", ".webharness"]
# Seeded from templates/ so the refinement loop has somewhere to write waivers on day one.
SEED_FROM_TEMPLATE = {"slop-waivers.md": "harness/slop-waivers.md"}

DECISIONS_HEADER = """# Decisions

Every design and technical decision, with its reason and who made it.
An entry is added when a gate closes, when a lock is set, and whenever a
guardrail is deliberately changed.

| Date | Gate | Decision | Reason | Decided by |
|---|---|---|---|---|
"""

GITIGNORE = """# Web Harness
.webharness/cache/
variants/**/node_modules/
taste/*.psd
"""


def copy_tree(src: Path, dst: Path, force: bool) -> tuple[int, int]:
    copied = skipped = 0
    for item in src.rglob("*"):
        if item.is_dir():
            continue
        if "__pycache__" in item.parts:
            continue
        target = dst / item.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not force:
            skipped += 1
            continue
        shutil.copy2(item, target)
        copied += 1
    return copied, skipped


def main() -> int:
    ap = argparse.ArgumentParser(description="Install the Web Harness into a project")
    ap.add_argument("target", help="project folder")
    ap.add_argument("--name", default=None, help="project name (default: folder name)")
    ap.add_argument("--force", action="store_true", help="overwrite existing harness files")
    args = ap.parse_args()

    target = Path(args.target).resolve()
    if target == HARNESS_ROOT:
        sys.exit("init-project: refusing to install the harness into itself")
    target.mkdir(parents=True, exist_ok=True)
    name = args.name or target.name

    total_copied = total_skipped = 0

    for tree in COPY_TREES:
        src = HARNESS_ROOT / tree
        if not src.is_dir():
            continue
        c, s = copy_tree(src, target / tree, args.force)
        total_copied += c
        total_skipped += s
        print(f"  {tree}/  +{c} copied, {s} kept")

    for f in COPY_FILES:
        src = HARNESS_ROOT / f
        if not src.is_file():
            continue
        dst = target / f
        if dst.exists() and not args.force:
            print(f"  {f}  kept (exists)")
            total_skipped += 1
            continue
        shutil.copy2(src, dst)
        total_copied += 1
        print(f"  {f}  +copied")

    # CLAUDE.md carries the project name.
    claude_md = target / "CLAUDE.md"
    if claude_md.is_file():
        text = claude_md.read_text(encoding="utf-8")
        if "{{PROJECT_NAME}}" in text:
            claude_md.write_text(text.replace("{{PROJECT_NAME}}", name), encoding="utf-8")
            print(f"  CLAUDE.md  project name set to {name!r}")

    for d in MAKE_DIRS:
        (target / d).mkdir(parents=True, exist_ok=True)

    for template_name, dest_rel in SEED_FROM_TEMPLATE.items():
        src = HARNESS_ROOT / "templates" / template_name
        dst = target / dest_rel
        if src.is_file() and not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            print(f"  {dest_rel}  created")

    decisions = target / "decisions.md"
    if not decisions.exists():
        decisions.write_text(DECISIONS_HEADER, encoding="utf-8")
        print("  decisions.md  created")

    gitignore = target / ".gitignore"
    if gitignore.exists():
        text = gitignore.read_text(encoding="utf-8")
        if "# Web Harness" not in text:
            gitignore.write_text(text.rstrip() + "\n\n" + GITIGNORE, encoding="utf-8")
    else:
        gitignore.write_text(GITIGNORE, encoding="utf-8")

    # The one failure that makes the harness decorative: an existing .claude/settings.json is
    # kept, so no hooks are wired and nothing is ever enforced — silently.
    settings = target / ".claude" / "settings.json"
    hooks_wired = False
    if settings.is_file():
        try:
            hooks_wired = "hooks/pre_tool_guard.py" in settings.read_text(encoding="utf-8")
        except OSError:
            hooks_wired = False

    state_file = target / ".webharness" / "state.json"
    if not state_file.exists() or args.force:
        state_file.write_text(
            json.dumps(
                {
                    "project": name,
                    "gate": "G0",
                    "gate_status": "open",
                    "approvals": {},
                    "locked": {"family": None, "variant": None, "hero": None},
                    "phase": None,
                    "history": [{"at": date.today().isoformat(), "event": "harness installed"}],
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        print("  .webharness/state.json  created at G0")

    print(f"\nWeb Harness installed into {target}")
    print(f"  {total_copied} files copied, {total_skipped} existing files kept")

    if not hooks_wired:
        print("\n" + "!" * 72)
        print("  HOOKS ARE NOT WIRED — the harness will not enforce anything.")
        print(f"  {settings.as_posix()} already existed, so it was kept and the")
        print("  harness's hook configuration was NOT merged into it.")
        print("")
        print("  Without the hooks this is just markdown: the agent can write product code")
        print("  in G0, ship a banned gradient, skip the refinement loop and deploy.")
        print("")
        print("  Fix it one of these ways:")
        print("    - merge the \"hooks\" block from the harness's .claude/settings.json by hand")
        print("    - or re-run with --force to overwrite it (you lose your own settings)")
        print("    - then verify:  echo {} | python .claude/hooks/session_start.py")
        print("!" * 72)

    print("\nNext:")
    print(f"  cd {target}")
    print("  python scripts/selftest.py          # prove enforcement actually works")
    print("  python scripts/setup-tools.py       # check tooling (see SETUP.md)")
    print("  claude")
    print("  /setup                              # then, if anything is missing")
    print("  /intake <client name or old site URL>")
    print("\nIf hooks do not fire, check that `python` is on PATH; otherwise change the")
    print("hook commands in .claude/settings.json to `py -3` or an absolute interpreter path.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
