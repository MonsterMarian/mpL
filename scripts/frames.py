#!/usr/bin/env python3
"""frames — turn a folder of extracted video frames into a web-ready sequence.

    python scripts/frames.py raw_frames/ public/sequence --width 1600 --quality 80
    python scripts/frames.py raw_frames/ public/sequence --crop 0,80,1920,1000
    python scripts/frames.py raw_frames/ public/sequence --every 2   # halve the frame count

Outputs frame_000.webp … frame_NNN.webp plus a manifest with the real byte total,
so the sequence can be checked against the budget in harness/guardrails.md.

Requires Pillow:  pip install pillow
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("frames: Pillow is required.  pip install pillow")

SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def natural_key(path: Path):
    """Sort frame_2 before frame_10."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", path.name)]


def parse_crop(value: str | None):
    if not value:
        return None
    parts = [int(p) for p in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--crop needs left,top,right,bottom")
    return tuple(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description="Video frames -> web sequence")
    ap.add_argument("src", help="folder of extracted frames")
    ap.add_argument("dst", help="output folder (e.g. public/sequence)")
    ap.add_argument("--width", type=int, default=1600, help="output width in px (default 1600)")
    ap.add_argument("--quality", type=int, default=80, help="WebP quality (default 80)")
    ap.add_argument("--crop", type=str, default=None, help="left,top,right,bottom applied before resize")
    ap.add_argument("--every", type=int, default=1, help="keep every Nth frame (default 1)")
    ap.add_argument("--budget", type=int, default=4_000_000, help="total byte budget (default 4MB)")
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)
    if not src.is_dir():
        sys.exit(f"frames: {src} is not a directory")
    dst.mkdir(parents=True, exist_ok=True)

    files = sorted((f for f in src.iterdir() if f.suffix.lower() in SUFFIXES), key=natural_key)
    files = files[:: max(1, args.every)]
    if not files:
        sys.exit(f"frames: no images found in {src}")

    crop = parse_crop(args.crop)
    total = 0
    written = []

    for i, f in enumerate(files):
        with Image.open(f) as im:
            im = im.convert("RGB")
            if crop:
                im = im.crop(crop)
            if im.width != args.width:
                height = round(im.height * args.width / im.width)
                im = im.resize((args.width, height), Image.LANCZOS)
            out = dst / f"frame_{i:03d}.webp"
            im.save(out, "WEBP", quality=args.quality, method=6)
        size = out.stat().st_size
        total += size
        written.append({"index": i, "file": out.as_posix(), "bytes": size})
        print(f"  {out.name}  {size / 1024:6.1f} KB", end="\r")

    dims = Image.open(written[0]["file"]).size if written else (0, 0)
    manifest = {
        "count": len(written),
        "width": dims[0],
        "height": dims[1],
        "quality": args.quality,
        "total_bytes": total,
        "budget_bytes": args.budget,
        "within_budget": total <= args.budget,
        "pattern": f"{dst.as_posix()}/frame_{{:03d}}.webp",
        "frames": written,
    }
    (dst / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    avg = total / len(written) / 1024
    print(f"\n{len(written)} frames -> {dst}")
    print(f"  {dims[0]}x{dims[1]}  avg {avg:.1f} KB  total {total / 1_000_000:.2f} MB")

    if total > args.budget:
        over = (total - args.budget) / 1_000_000
        print(f"\n  OVER BUDGET by {over:.2f} MB.")
        print("  Fix by, in order of preference: --every 2 (fewer frames),")
        print("  --width 1280 (smaller), --quality 72 (more compression).")
        print("  A sequence over budget is a defect, not a trade-off.")
        return 1

    print(f"\n  Within the {args.budget / 1_000_000:.1f} MB budget.")
    print("  Remember: preload every frame before revealing the section,")
    print("  and make the page background match the frame background exactly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
