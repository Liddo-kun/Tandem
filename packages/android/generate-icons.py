#!/usr/bin/env python3
"""Generate WhisperCode Android launcher icons."""

from PIL import Image, ImageDraw
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RES_DIR = os.path.join(SCRIPT_DIR, "src-tauri", "gen", "android", "app", "src", "main", "res")
SCALE = 2

W_RECTS = [
    (128, 96, 160, 320),
    (352, 96, 384, 320),
    (224, 224, 288, 288),
    (192, 256, 224, 288),
    (288, 256, 320, 288),
    (160, 288, 192, 352),
    (320, 288, 352, 352),
    (192, 320, 224, 416),
    (288, 320, 320, 416),
]
SHADOW_RECT = (224, 288, 288, 352)

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
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>"""

IC_LAUNCHER_BACKGROUND_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#131010</color>
</resources>"""


def scaled(rect):
    return tuple(v * SCALE for v in rect)


def draw_icon(bg_color, letter_color, shadow_color=None, transparent_bg=False):
    size = 512 * SCALE
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent_bg else bg_color)
    draw = ImageDraw.Draw(img)

    if shadow_color:
        x1, y1, x2, y2 = scaled(SHADOW_RECT)
        draw.rectangle([x1, y1, x2 - 1, y2 - 1], fill=shadow_color)

    for rect in W_RECTS:
        x1, y1, x2, y2 = scaled(rect)
        draw.rectangle([x1, y1, x2 - 1, y2 - 1], fill=letter_color)

    return img


def make_foreground(src_img, size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    visible = int(size * 72 / 108)
    resized = src_img.resize((visible, visible), Image.LANCZOS)
    offset = (size - visible) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def main():
    if not os.path.isdir(RES_DIR):
        print(f"Android resource directory missing; skipping launcher icon generation: {RES_DIR}")
        return

    dark = draw_icon(bg_color="#131010", letter_color="#FFFFFF", shadow_color="#5A5858")
    tinted = draw_icon(bg_color=None, letter_color="#FFFFFF", transparent_bg=True)

    for density, size in FOREGROUND_SIZES.items():
        out_dir = os.path.join(RES_DIR, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        make_foreground(tinted, size).save(os.path.join(out_dir, "ic_launcher_foreground.png"))

    for density, size in ICON_SIZES.items():
        out_dir = os.path.join(RES_DIR, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)
        icon = dark.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(out_dir, "ic_launcher.png"))
        icon.save(os.path.join(out_dir, "ic_launcher_round.png"))

    anydpi_dir = os.path.join(RES_DIR, "mipmap-anydpi-v26")
    os.makedirs(anydpi_dir, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(anydpi_dir, name), "w") as f:
            f.write(ADAPTIVE_ICON_XML)

    values_dir = os.path.join(RES_DIR, "values")
    os.makedirs(values_dir, exist_ok=True)
    with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(IC_LAUNCHER_BACKGROUND_XML)

    print(f"Generated WhisperCode Android launcher icons in {RES_DIR}")


if __name__ == "__main__":
    main()
