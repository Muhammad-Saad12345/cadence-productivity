"""Generates the PWA icons in public/icons (run: python3 scripts/make_icons.py)."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)
SS = 4  # supersampling for anti-aliasing

def mark(size, bg=True, pad=0.0, mono=False):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        # vertical indigo gradient in a rounded square (full-bleed for maskable)
        grad = Image.new("RGBA", (S, S))
        gd = ImageDraw.Draw(grad)
        top, bot = (99, 102, 241), (67, 56, 202)
        for y in range(S):
            t = y / S
            gd.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
        mask = Image.new("L", (S, S), 0)
        r = 0 if pad > 0 else int(S * 0.22)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
        img.paste(grad, (0, 0), mask)
    col = (255, 255, 255, 255)
    inset = S * (0.2 + pad)
    w = int(S * 0.075)
    box = [inset, inset, S - inset, S - inset]
    # open ring (a "cycle") with a gap at the top-right, plus a check mark
    d.arc(box, start=-50, end=250, fill=col, width=w)
    cx, cy = S / 2, S / 2
    k = (S - 2 * inset) / 2
    pts = [(cx - k * 0.42, cy + k * 0.02), (cx - k * 0.1, cy + k * 0.34), (cx + k * 0.62, cy - k * 0.5)]
    d.line(pts, fill=col, width=w, joint="curve")
    for p in (pts[0], pts[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=col)
    return img.resize((size, size), Image.LANCZOS)

mark(192).save(f"{OUT}/icon-192.png")
mark(512).save(f"{OUT}/icon-512.png")
mark(512, pad=0.1).save(f"{OUT}/maskable-512.png")
mark(180).save(f"{OUT}/apple-touch-icon.png")
mark(96, bg=False).save(f"{OUT}/badge-96.png")  # monochrome status-bar badge (Android)
mark(32).save(f"{OUT}/favicon-32.png")
print("icons written")
