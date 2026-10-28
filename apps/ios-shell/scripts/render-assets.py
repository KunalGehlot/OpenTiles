#!/usr/bin/env python3
"""Renders the iPad app's icon and launch image from the web app's icon (apps/web/public/icon.svg).

The shapes below mirror icon.svg (a 64-unit square). The App Store icon is a full square without
transparency, because iOS applies its own rounded mask; the launch image shows the rounded icon
on the web app's background colour.

Needs Pillow (MIT-CMU licence), only to regenerate the images:
    python3 -m pip install pillow
    python3 apps/ios-shell/scripts/render-assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "ios" / "App" / "App" / "Assets.xcassets"
GREEN = "#1f6f5c"  # icon background, --accent in apps/web/src/styles.css
DARK = "#123b31"  # black keys
WHITE = "#ffffff"
MINT = "#9be7cd"  # the falling tile and the key it lands on
PAGE = "#fbfaf7"  # --bg in apps/web/src/styles.css

# (x, y, width, height, corner radius) in icon.svg units.
TILE = [(22, 9, 10, 17, 2.5)]
WHITE_KEYS = [(10, 31, 10, 23, 2), (34, 31, 10, 23, 2), (46, 31, 8, 23, 2)]
LIT_KEY = [(22, 31, 10, 23, 2)]
BLACK_KEYS = [(17, 31, 7, 13, 1.5), (29, 31, 7, 13, 1.5), (43, 31, 7, 13, 1.5)]
SUPERSAMPLE = 4


def icon(size: int, rounded: bool) -> Image.Image:
    """The icon at `size` pixels, drawn large and scaled down for smooth edges."""
    big = size * SUPERSAMPLE
    unit = big / 64
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if rounded:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=14 * unit, fill=GREEN)
    else:
        draw.rectangle((0, 0, big - 1, big - 1), fill=GREEN)
    for keys, colour in ((TILE, MINT), (WHITE_KEYS, WHITE), (LIT_KEY, MINT), (BLACK_KEYS, DARK)):
        for x, y, w, h, r in keys:
            box = (x * unit, y * unit, (x + w) * unit - 1, (y + h) * unit - 1)
            draw.rounded_rectangle(box, radius=r * unit, fill=colour)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    app_icon = icon(1024, rounded=False).convert("RGB")
    app_icon.save(ASSETS / "AppIcon.appiconset" / "AppIcon-512@2x.png", optimize=True)

    splash = Image.new("RGB", (2732, 2732), PAGE)
    mark = icon(384, rounded=True)
    offset = (2732 - 384) // 2
    splash.paste(mark, (offset, offset), mark)
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        splash.save(ASSETS / "Splash.imageset" / name, optimize=True)


if __name__ == "__main__":
    main()
