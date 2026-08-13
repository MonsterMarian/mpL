#!/usr/bin/env python3
"""taste-library — scaffold and serve the G1 inspiration library.

    python scripts/taste-library.py              # scan taste/, scaffold library.json
    python scripts/taste-library.py --serve       # scaffold, then serve on :8080
    python scripts/taste-library.py --add https://example.com  # a URL reference

Scans taste/ for screenshots, writes taste/library.json with one entry per image, and copies
the viewer in next to it. It deliberately leaves `family`, `vocabulary`, `works`, `avoid`,
`image_prompt` and `brief` empty — naming what a reference is doing is the agent's job in
`/taste`, and a scaffold that guesses would put words in the human's mouth.

Existing entries are never overwritten. Re-run it whenever screenshots are added.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

TASTE_DIR = Path("taste")
LIBRARY = TASTE_DIR / "library.json"
VIEWER = TASTE_DIR / "index.html"
VIEWER_TEMPLATE = Path("templates/taste-library.html")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"}

BLANK = {
    "family": "",
    "vocabulary": [],
    "works": "",
    "avoid": "",
    "image_prompt": "",
    "brief": "",
    "url": "",
}


def load_library() -> dict:
    if LIBRARY.is_file():
        try:
            data = json.loads(LIBRARY.read_text(encoding="utf-8"))
            data.setdefault("families", {})
            data.setdefault("refs", [])
            return data
        except json.JSONDecodeError:
            print(f"  {LIBRARY} is not valid JSON — fix it by hand, refusing to overwrite")
            sys.exit(1)
    return {"project": Path.cwd().name, "families": {}, "refs": []}


def next_id(refs: list[dict]) -> str:
    used = set()
    for r in refs:
        rid = str(r.get("id", ""))
        if rid.startswith("t-") and rid[2:].isdigit():
            used.add(int(rid[2:]))
    n = 1
    while n in used:
        n += 1
    return f"t-{n:02d}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Scaffold the G1 taste library")
    ap.add_argument("--serve", action="store_true", help="serve taste/ on :8080 afterwards")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--add", metavar="URL", action="append", default=[],
                    help="add a URL-only reference (repeatable)")
    args = ap.parse_args()

    if not TASTE_DIR.is_dir():
        TASTE_DIR.mkdir(parents=True)
        print(f"created {TASTE_DIR}/ — drop screenshots in it and run this again")

    data = load_library()
    known_files = {r.get("file") for r in data["refs"]}
    known_urls = {r.get("url") for r in data["refs"] if r.get("url")}
    added = 0

    for img in sorted(TASTE_DIR.iterdir()):
        if img.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        rel = img.name
        if rel in known_files:
            continue
        entry = {"id": next_id(data["refs"]), "file": rel, **BLANK}
        data["refs"].append(entry)
        added += 1
        print(f"  + {entry['id']}  {rel}")

    for url in args.add:
        if url in known_urls:
            continue
        entry = {"id": next_id(data["refs"]), "file": "", **BLANK}
        entry["url"] = url
        data["refs"].append(entry)
        added += 1
        print(f"  + {entry['id']}  {url}")

    LIBRARY.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Refresh when the template is newer, so a fixed viewer actually reaches the project.
    if VIEWER_TEMPLATE.is_file():
        if not VIEWER.is_file():
            shutil.copy2(VIEWER_TEMPLATE, VIEWER)
            print(f"  viewer -> {VIEWER.as_posix()}")
        elif VIEWER_TEMPLATE.stat().st_mtime > VIEWER.stat().st_mtime:
            shutil.copy2(VIEWER_TEMPLATE, VIEWER)
            print(f"  viewer refreshed -> {VIEWER.as_posix()}")

    total = len(data["refs"])
    unnamed = [r["id"] for r in data["refs"] if not r.get("family")]

    print(f"\n{LIBRARY.as_posix()}: {total} reference(s), {added} new")
    if unnamed:
        print(f"  {len(unnamed)} still unnamed: {', '.join(unnamed[:12])}"
              f"{' …' if len(unnamed) > 12 else ''}")
        print("  Run /taste — the agent fills in family, vocabulary, works, avoid,")
        print("  image_prompt and brief for each one.")
    if total < 8:
        print(f"\n  Only {total} references. Under 8 is not a library — the families you")
        print("  derive from it will be guesses. Collect more before /brief.")

    if args.serve:
        import http.server
        import socketserver

        handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
            *a, directory=str(TASTE_DIR), **kw
        )
        print(f"\n  http://localhost:{args.port}/  (ctrl-c to stop)")
        with socketserver.TCPServer(("", args.port), handler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\n  stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
