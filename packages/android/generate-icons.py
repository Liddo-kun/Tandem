#!/usr/bin/env python3
"""Generate Tandem Android launcher icons: a bold "T" monogram on the brand
teal->sky->violet gradient, matching the CLI wordmark and the in-app logo mark."""

import struct
import zlib
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RES_DIR = os.path.join(SCRIPT_DIR, "src-tauri", "gen", "android", "app", "src", "main", "res")

# Tandem "T" monogram, designed on a 512x512 grid (top bar + centered stem).
T_RECTS = [
    (116, 128, 396, 188),  # top bar
    (226, 128, 286, 388),  # stem
]
SHADOW_OFFSET = 16
SHADOW_COLOR = (7, 10, 18, 120)
LETTER_COLOR = (255, 255, 255, 255)

# Brand gradient stops (teal -> sky -> violet); identical to the CLI logo gradient.
GRADIENT = [(45, 212, 191), (56, 189, 248), (139, 92, 246)]

FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

ICON_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

ADAPTIVE_ICON_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@drawable/ic_launcher_background"/>
</adaptive-icon>"""

# Gradient background drawable for adaptive icons (angle 315 = top-left -> bottom-right).
IC_LAUNCHER_BACKGROUND_DRAWABLE_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <gradient
      android:type="linear"
      android:angle="315"
      android:startColor="#2DD4BF"
      android:centerColor="#38BDF8"
      android:endColor="#8B5CF6"/>
</shape>"""

# Solid fallback color kept for any legacy reference; adaptive icons use the gradient drawable.
IC_LAUNCHER_BACKGROUND_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#38BDF8</color>
</resources>"""


def lerp(a, b, f):
    return tuple(round(a[index] + (b[index] - a[index]) * f) for index in range(3))


def gradient_color(t):
    clamped = max(0.0, min(1.0, t))
    scaled = clamped * (len(GRADIENT) - 1)
    index = min(len(GRADIENT) - 2, int(scaled))
    r, g, b = lerp(GRADIENT[index], GRADIENT[index + 1], scaled - index)
    return (r, g, b, 255)


def empty_image(size, fill=(0, 0, 0, 0)):
    return [[fill for _ in range(size)] for _ in range(size)]


def fill_gradient(image):
    height = len(image)
    width = len(image[0]) if height else 0
    denom = (width - 1) + (height - 1)
    for y in range(height):
        row = image[y]
        for x in range(width):
            row[x] = gradient_color((x + y) / denom if denom else 0)


def fill_rect(image, rect, fill, base_size=512, offset=0, target_size=None):
    target_size = target_size or len(image)
    x1, y1, x2, y2 = rect
    left = offset + round(x1 * target_size / base_size)
    top = offset + round(y1 * target_size / base_size)
    right = offset + round(x2 * target_size / base_size)
    bottom = offset + round(y2 * target_size / base_size)

    for y in range(max(0, top), min(len(image), bottom)):
        row = image[y]
        for x in range(max(0, left), min(len(row), right)):
            row[x] = fill


def draw_letter(image, offset=0, target_size=None):
    for x1, y1, x2, y2 in T_RECTS:
        shadow = (x1 + SHADOW_OFFSET, y1 + SHADOW_OFFSET, x2 + SHADOW_OFFSET, y2 + SHADOW_OFFSET)
        fill_rect(image, shadow, SHADOW_COLOR, offset=offset, target_size=target_size)
    for rect in T_RECTS:
        fill_rect(image, rect, LETTER_COLOR, offset=offset, target_size=target_size)


def draw_icon(size):
    image = empty_image(size)
    fill_gradient(image)
    draw_letter(image)
    return image


def draw_foreground(size):
    image = empty_image(size)
    visible = int(size * 72 / 108)
    offset = (size - visible) // 2
    draw_letter(image, offset=offset, target_size=visible)
    return image


def write_png(path, image):
    height = len(image)
    width = len(image[0]) if height else 0
    raw = b"".join(b"\x00" + b"".join(bytes(pixel) for pixel in row) for row in image)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as file:
        file.write(b"\x89PNG\r\n\x1a\n")
        file.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        file.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        file.write(chunk(b"IEND", b""))


def main():
    if not os.path.isdir(RES_DIR):
        print(f"Android resource directory missing; skipping launcher icon generation: {RES_DIR}")
        return

    for density, size in FOREGROUND_SIZES.items():
        out_dir = os.path.join(RES_DIR, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        write_png(os.path.join(out_dir, "ic_launcher_foreground.png"), draw_foreground(size))

    for density, size in ICON_SIZES.items():
        out_dir = os.path.join(RES_DIR, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        icon = draw_icon(size)
        write_png(os.path.join(out_dir, "ic_launcher.png"), icon)
        write_png(os.path.join(out_dir, "ic_launcher_round.png"), icon)

    anydpi_dir = os.path.join(RES_DIR, "mipmap-anydpi-v26")
    os.makedirs(anydpi_dir, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(anydpi_dir, name), "w") as f:
            f.write(ADAPTIVE_ICON_XML)

    drawable_dir = os.path.join(RES_DIR, "drawable")
    os.makedirs(drawable_dir, exist_ok=True)
    with open(os.path.join(drawable_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(IC_LAUNCHER_BACKGROUND_DRAWABLE_XML)

    values_dir = os.path.join(RES_DIR, "values")
    os.makedirs(values_dir, exist_ok=True)
    with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(IC_LAUNCHER_BACKGROUND_XML)

    print(f"Generated Tandem Android launcher icons in {RES_DIR}")


if __name__ == "__main__":
    main()
