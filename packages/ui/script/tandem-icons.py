#!/usr/bin/env python3
# Tandem-owned (not in upstream): Generate web/desktop icons from canonical Tandem artwork.
"""Reuse the Android/v1 Tandem artwork for web and desktop. Requires Pillow."""
import importlib.util
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("tandem_icons", root / "packages/android/generate-icons.py")
art = importlib.util.module_from_spec(spec)
spec.loader.exec_module(art)
out = root / "packages/ui/src/assets/brand"
out.mkdir(parents=True, exist_ok=True)

# Use the existing canonical renderer, including its offset shadow and gradient.
pixels = art.draw_icon(1024)
image = Image.frombytes("RGBA", (1024, 1024), bytes(channel for row in pixels for pixel in row for channel in pixel))
for name, size in [("icon", 512), ("dock", 512), ("apple-touch-icon", 180), ("manifest-192", 192), ("notification", 96)]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(out / f"{name}.png")
image.save(out / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(out / "icon.icns")
