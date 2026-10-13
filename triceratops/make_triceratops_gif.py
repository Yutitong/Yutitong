"""Generate a pixel-art GIF of a running triceratops.

Each body part is drawn on a tiny canvas, given its own 1px outline, and
layered back to front. Frames are then scaled up with nearest-neighbour
sampling so the pixels stay crisp, and saved as a looping transparent GIF.

Usage: python make_triceratops_gif.py [output.gif]
"""

import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

W, H = 70, 40          # native sprite canvas, in "pixels"
SCALE = 6              # upscale factor for the final GIF
FRAMES = 8
FRAME_MS = 80

OUTLINE = (27, 58, 32)
BODY = (76, 175, 80)
BODY_SHADE = (56, 142, 60)
BODY_LIGHT = (129, 199, 132)
BELLY = (200, 230, 190)
FRILL = (56, 142, 60)
FRILL_EDGE = (233, 211, 160)
HORN = (245, 235, 210)
HORN_SHADE = (205, 188, 150)
EYE = (255, 255, 255)
PUPIL = (20, 20, 20)
SPOT = (46, 120, 50)


def new_layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def outlined(layer, color=OUTLINE):
    """Return the layer with a 1px 4-neighbour outline around its silhouette."""
    a = np.array(layer)
    filled = a[:, :, 3] > 0
    grown = filled.copy()
    grown[1:, :] |= filled[:-1, :]
    grown[:-1, :] |= filled[1:, :]
    grown[:, 1:] |= filled[:, :-1]
    grown[:, :-1] |= filled[:, 1:]
    edge = grown & ~filled
    a[edge] = (*color, 255)
    return Image.fromarray(a)


def leg(hip_x, top_y, foot_x, lift, color):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    bottom = 36 - lift
    d.polygon([(hip_x - 3, top_y), (hip_x + 3, top_y),
               (foot_x + 3, bottom), (foot_x - 3, bottom)], fill=(*color, 255))
    d.rectangle([foot_x - 3, bottom, foot_x + 4, bottom + 1], fill=(*color, 255))
    # toenails
    for tx in (foot_x + 1, foot_x + 3):
        d.point((tx, bottom + 1), fill=(*HORN, 255))
    return outlined(layer)


def body(bob, tail_wag):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    y = bob
    # tail, pointing back and tapering
    d.polygon([(17, 13 + y), (17, 24 + y), (4, 21 + y + tail_wag),
               (1, 19 + y + tail_wag)], fill=(*BODY, 255))
    d.ellipse([12, 10 + y, 46, 31 + y], fill=(*BODY, 255))

    a = np.array(layer)
    mask = a[:, :, 3] > 0
    ys = np.arange(H)[:, None] * np.ones((1, W), dtype=int)
    # light rim along the top of the back
    shifted = np.zeros_like(mask)
    shifted[2:, :] = mask[:-2, :]
    a[mask & ~shifted] = (*BODY_LIGHT, 255)
    # pale belly on the underside
    a[mask & (ys >= 26 + y)] = (*BELLY, 255)
    layer = Image.fromarray(a)

    d = ImageDraw.Draw(layer)
    # a few darker scale spots on the back
    for sx, sy in [(20, 14), (26, 12), (32, 13), (24, 18), (30, 17), (36, 16)]:
        d.rectangle([sx, sy + y, sx + 1, sy + y + 1], fill=(*SPOT, 255))
    return outlined(layer)


def frill(bob):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    y = bob
    d.ellipse([35, 1 + y, 54, 27 + y], fill=(*FRILL_EDGE, 255))
    d.ellipse([37, 3 + y, 52, 25 + y], fill=(*FRILL, 255))
    for sx, sy in [(40, 8), (43, 5), (41, 14), (45, 10)]:
        d.rectangle([sx, sy + y, sx + 1, sy + y + 1], fill=(*SPOT, 255))
    return outlined(layer)


def horn(base, tip, color, bob):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    pts = [(x, yy + bob) for x, yy in base] + [(tip[0], tip[1] + bob)]
    d.polygon(pts, fill=(*color, 255))
    return outlined(layer)


def head(bob):
    layer = new_layer()
    d = ImageDraw.Draw(layer)
    y = bob
    d.ellipse([44, 12 + y, 57, 25 + y], fill=(*BODY, 255))
    d.polygon([(52, 15 + y), (63, 18 + y), (62, 23 + y), (52, 25 + y)],
              fill=(*BODY, 255))
    # beak
    d.polygon([(60, 19 + y), (65, 21 + y), (60, 24 + y)], fill=(*HORN_SHADE, 255))
    # cheek / jaw
    d.rectangle([47, 22 + y, 58, 24 + y], fill=(*BELLY, 255))
    layer = outlined(layer)

    d = ImageDraw.Draw(layer)
    # mouth line
    d.line([(54, 22 + y), (60, 22 + y)], fill=(*OUTLINE, 255))
    # eye
    d.rectangle([49, 16 + y, 50, 17 + y], fill=(*EYE, 255))
    d.point((50, 17 + y), fill=(*PUPIL, 255))
    d.point((49, 15 + y), fill=(*OUTLINE, 255))
    d.point((50, 15 + y), fill=(*OUTLINE, 255))
    # nostril
    d.point((61, 19 + y), fill=(*OUTLINE, 255))
    return layer


def gait(phase, amp=4, lift_amp=3):
    """Foot x offset and lift for a leg at the given phase of the cycle."""
    dx = -amp * math.cos(phase)
    lift = lift_amp * max(0.0, math.sin(phase))
    return round(dx), round(lift)


def frame(k):
    t = 2 * math.pi * k / FRAMES
    bob = round(0.5 - 0.5 * math.cos(2 * t))
    tail_wag = round(1.5 * math.sin(t))
    top = 25 + bob

    canvas = new_layer()

    # far legs (darker, behind the body); diagonal pairs move together
    for hip, ph in ((16, t + math.pi), (36, t)):
        dx, lift = gait(ph)
        canvas.alpha_composite(leg(hip, top, hip + dx, lift, BODY_SHADE))

    canvas.alpha_composite(body(bob, tail_wag))
    canvas.alpha_composite(frill(bob))
    # far brow horn, slightly offset and shaded
    canvas.alpha_composite(horn([(45, 15), (50, 11)], (62, 4), HORN_SHADE, bob))
    canvas.alpha_composite(head(bob))
    # near brow horn and nose horn
    canvas.alpha_composite(horn([(48, 16), (54, 12)], (67, 6), HORN, bob))
    canvas.alpha_composite(horn([(56, 17), (59, 17)], (59, 12), HORN, bob))

    # near legs (in front of the body)
    for hip, ph in ((20, t), (40, t + math.pi)):
        dx, lift = gait(ph)
        canvas.alpha_composite(leg(hip, top, hip + dx, lift, BODY))

    return canvas


def to_paletted(frames):
    """Convert RGBA frames to P mode sharing one palette; index 0 is transparent."""
    colors = []
    for f in frames:
        a = np.array(f)
        opaque = a[a[:, :, 3] > 0][:, :3]
        colors.extend(map(tuple, opaque))
    palette = [(0, 0, 0)] + sorted(set(colors))
    assert len(palette) <= 256
    index = {c: i for i, c in enumerate(palette)}
    flat = [v for c in palette for v in c]

    out = []
    for f in frames:
        a = np.array(f)
        idx = np.zeros(a.shape[:2], dtype=np.uint8)
        ys, xs = np.nonzero(a[:, :, 3] > 0)
        for yy, xx in zip(ys, xs):
            idx[yy, xx] = index[tuple(a[yy, xx, :3])]
        p = Image.fromarray(idx, mode="P")
        p.putpalette(flat)
        out.append(p.resize((W * SCALE, H * SCALE), Image.NEAREST))
    return out


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else \
        Path(__file__).with_name("triceratops_run.gif")
    frames = to_paletted([frame(k) for k in range(FRAMES)])
    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0, transparency=0, disposal=2,
                   optimize=False)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
