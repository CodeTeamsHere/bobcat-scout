"""Generate Bobcat Scout PWA app icons (run: python tools/make_icons.py).
Requires Pillow. Produces icon-192.png, icon-512.png, icon-maskable-512.png."""
import os
from PIL import Image, ImageDraw, ImageFont

MAROON = (123, 31, 43, 255)
GOLD = (212, 165, 55, 255)
WHITE = (255, 255, 255, 255)
GEORGIA_B = r"C:\Windows\Fonts\georgiab.ttf"
ARIAL_B = r"C:\Windows\Fonts\arialbd.ttf"


def draw_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill=MAROON)          # full bleed; OS masks the shape
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.20), fill=MAROON)
    inset = int(size * (0.16 if maskable else 0.085))
    d.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=int(size * 0.12), outline=GOLD, width=max(2, int(size * 0.026)),
    )
    f1 = ImageFont.truetype(GEORGIA_B, int(size * (0.24 if maskable else 0.30)))
    f2 = ImageFont.truetype(ARIAL_B, int(size * (0.085 if maskable else 0.11)))
    d.text((size / 2, size * 0.45), "177", font=f1, fill=WHITE, anchor="mm")
    d.text((size / 2, size * 0.66), "SCOUT", font=f2, fill=GOLD, anchor="mm")
    return img


base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
draw_icon(192).save(os.path.join(base, "icon-192.png"))
draw_icon(512).save(os.path.join(base, "icon-512.png"))
draw_icon(512, maskable=True).save(os.path.join(base, "icon-maskable-512.png"))
print("icons written to", base)
