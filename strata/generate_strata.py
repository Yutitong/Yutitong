#!/usr/bin/env python3
"""地層断面画像ジェネレータ（横 860 cm × 縦 192 cm）

使い方:  python3 generate_strata.py [px_per_cm=20] [出力名=strata]
  px_per_cm=20 で地層部分は 17200 × 3840 px（1 mm = 2 px）。
"""
import sys
import math
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont

S = int(sys.argv[1]) if len(sys.argv) > 1 else 20          # px / cm
OUT = sys.argv[2] if len(sys.argv) > 2 else "strata"
W, H = 860 * S, 192 * S
F32 = np.float32
rng = np.random.default_rng(20261113)
T0 = time.time()
FONT = "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf"


def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


# ---------------------------------------------------------------- noise utils
def _up(a, w, h):
    return np.asarray(Image.fromarray(a.astype(F32), "F").resize((w, h), Image.BICUBIC))


def fbm(w, h, cx, cy, octaves=4, pers=0.5):
    """フラクタルノイズ（おおよそ -1..1）。cx, cy は最大オクターブのセルサイズ(px)。"""
    tot = np.zeros((h, w), F32)
    amp, norm = 1.0, 0.0
    for _ in range(octaves):
        gx = min(w, max(2, int(w / max(cx, 1.0)) + 2))
        gy = min(h, max(2, int(h / max(cy, 1.0)) + 2)) if h > 1 else 1
        tot += amp * (_up(rng.random((gy, gx)), w, h) - 0.5) * 2
        norm += amp
        amp *= pers
        cx /= 2
        cy /= 2
    return tot / norm


def n1(cell_cm, octaves=4):
    """横方向 1 次元ノイズ（-1..1 に正規化）"""
    f = fbm(W, 1, cell_cm * S, 1, octaves)[0]
    return f / (np.abs(f).max() + 1e-6)


def grain(h, amp):
    return (rng.standard_normal((h, W)) * amp).astype(F32)


def mix(c1, c2, m):
    c1 = np.asarray(c1, F32)
    c2 = np.asarray(c2, F32)
    if np.ndim(m) == 0:
        return c1 + (c2 - c1) * m
    return c1 + (c2 - c1) * m[..., None]


def box_blur(a, r, axis):
    """cumsum による高速ボックスブラー"""
    if r < 1:
        return a
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode="edge")
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    n = a.shape[axis]
    if axis == 0:
        out = (c[2 * r + 1:2 * r + 1 + n] - c[:n]) / (2 * r + 1)
    else:
        out = (c[:, 2 * r + 1:2 * r + 1 + n] - c[:, :n]) / (2 * r + 1)
    return out.astype(F32)


xs = np.arange(W, dtype=F32)
xn = xs / W

# ---------------------------------------------------------------- layer plan
#           名前,               厚さ(cm)
LAYERS = [("表土", 15),
          ("ローム層", 25),
          ("礫層", 22),
          ("砂岩（斜交層理）", 28),
          ("凝灰岩（火山灰層）", 8),
          ("泥岩", 30),
          ("砂岩泥岩互層", 25),
          ("炭質泥岩", 5),
          ("細粒砂岩", 34)]
DESC = ["黒褐色の腐植土。植物の根を含む",
        "赤褐色。火山灰が風化した粘土質の土",
        "径1〜8cmの円礫。下面は浸食面（不整合）",
        "黄褐色の中〜粗粒砂。斜交葉理が発達",
        "白色の細粒火山灰。広域に追跡できる鍵層",
        "青灰色。細かい平行葉理と、はく離性",
        "砂岩と泥岩が数cmごとに繰り返す",
        "黒色。炭化した植物片を多く含む",
        "灰色。生痕・貝化石片・ノジュールを含む"]
THK = [t for _, t in LAYERS]
assert sum(THK) == 192
base = np.cumsum(THK)[:-1].astype(F32)          # 層境界の基準深度(cm)

log(f"canvas {W}x{H}px  ({S}px/cm)")

# 下位の地層（砂岩以下）は右上がりに傾き、ゆるく波打つ → 礫層が不整合で覆う
tilt = 12.0 * (0.5 - xn) + 3.0 * np.sin(2 * np.pi * xn * 0.9 + 0.7)
bnd = []
bnd.append(base[0] + 2.5 * n1(25) + 1.0 * n1(5))                 # 表土/ローム
bnd.append(base[1] + 3.0 * n1(60) + 0.8 * n1(8))                 # ローム/礫
scour = np.zeros(W, F32)                                          # 浸食によるえぐれ
for c in (0.10, 0.34, 0.57, 0.82):
    c += rng.uniform(-0.05, 0.05)
    dep = rng.uniform(5, 9)
    sig = rng.uniform(25, 45) / 860
    z = (xn - c) / sig
    scour += dep * np.exp(-z * z) * (1 + 0.3 * np.tanh(z))
bnd.append(base[2] + 2.0 * n1(40) + 0.6 * n1(4) + scour)         # 礫/砂岩（不整合面）
amps = [1.0, 0.6, 1.0, 0.8, 1.0]
for i, a in zip(range(3, 8), amps):
    bnd.append(base[i] + tilt + a * n1(70) + 0.3 * a * n1(10))
bnd = [b.astype(F32) * S for b in bnd]
for i in range(1, len(bnd)):
    if i == 2:
        continue
    bnd[i] = np.maximum(bnd[i], bnd[i - 1] + 1.5 * S)
bnd[2] = np.minimum(bnd[2], bnd[3] - 6 * S)                      # 砂岩を削り切らない
bnd[2] = np.maximum(bnd[2], bnd[1] + 10 * S)
TOPS = [np.zeros(W, F32)] + bnd
BOTS = bnd + [np.full(W, H, F32)]

# 層番号マップ
lay = np.zeros((H, W), np.uint8)
Y = np.arange(H, dtype=F32)[:, None]
for b in bnd:
    lay += (Y >= b[None, :])
del Y
log("layer map done")


def local(top, bot, r0, r1):
    yy = np.arange(r0, r1, dtype=F32)[:, None]
    d = yy - top[None, :]
    t = np.maximum(bot - top, 1)[None, :]
    return yy, d, t, np.clip(d / t, 0, 1)


# ---------------------------------------------------------------- clasts
PEBBLE_COLORS = [((122, 120, 116), 0.25, "plain"),      # 安山岩
                 ((78, 75, 72), 0.12, "plain"),         # 玄武岩・黒色頁岩
                 ((150, 88, 66), 0.08, "plain"),        # 赤色チャート
                 ((214, 208, 196), 0.08, "quartz"),     # 石英
                 ((112, 122, 102), 0.10, "plain"),      # 緑色岩
                 ((176, 156, 120), 0.17, "plain"),      # 砂岩
                 ((196, 186, 174), 0.12, "granite"),    # 花こう岩
                 ((160, 132, 98), 0.08, "plain")]       # 風化礫
_pc_w = np.array([p[1] for p in PEBBLE_COLORS])
_pc_w /= _pc_w.sum()


def draw_clast(rgb, hgt, occ, cx, cy, rx, ry, ang, col, kind, max_occ=0.25):
    hb = rgb.shape[0]
    R = int(max(rx, ry) * 1.25) + 3
    x0, x1 = max(0, int(cx) - R), min(W, int(cx) + R + 1)
    y0, y1 = max(0, int(cy) - R), min(hb, int(cy) + R + 1)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return False
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(F32)
    dx, dy = gx - cx, gy - cy
    ca, sa = math.cos(ang), math.sin(ang)
    u = dx * ca + dy * sa
    v = -dx * sa + dy * ca
    r = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
    inside = r < 0.9
    if not inside.any():
        return False
    o = occ[y0:y1, x0:x1]
    if o[inside].mean() > max_occ:
        return False
    a = np.clip((1 - r) * min(rx, ry) * 0.9 + 0.5, 0, 1)
    z = np.sqrt(np.clip(1 - r * r, 0, 1))
    nx = np.clip(dx / rx, -1, 1)
    ny = np.clip(dy / ry, -1, 1)
    lam = np.clip(-0.45 * nx - 0.7 * ny + 0.55 * z, 0, None) / 0.95
    shade = 0.50 + 0.62 * lam
    h, w = r.shape
    g = max(2, int(max(rx, ry) / 3))
    tex = 1 + 0.16 * (_up(rng.random((g, g)), w, h) - 0.5) * 2
    tex *= 1 + rng.standard_normal((h, w)).astype(F32) * (0.05 if kind != "quartz" else 0.02)
    if kind == "granite":
        sp = rng.random((h, w))
        tex *= np.where(sp < 0.12, 0.45, np.where(sp < 0.2, 1.15, 1.0))
    if kind == "quartz":
        tex *= 1 + 0.08 * (_up(rng.random((3, 3)), w, h) - 0.5)
    col = np.asarray(col, F32) * rng.uniform(0.88, 1.1)
    c = col[None, None, :] * (shade * tex)[..., None]
    # 影（右下）
    rs = np.sqrt(((u - 0.12 * rx) / (rx * 1.1)) ** 2 + ((v - 0.2 * ry) / (ry * 1.12)) ** 2)
    shd = np.clip((1.12 - rs) * 4, 0, 1) * 0.5
    reg = rgb[y0:y1, x0:x1]
    reg *= (1 - shd)[..., None]
    reg[:] = reg * (1 - a)[..., None] + c * a[..., None]
    hgt[y0:y1, x0:x1] = np.maximum(hgt[y0:y1, x0:x1], z * min(rx, ry) * 0.6)
    occ[y0:y1, x0:x1] |= r < 1.0
    return True


# ---------------------------------------------------------------- layers
def L_topsoil(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    m = np.clip(0.5 + fbm(W, hb, 8 * S, 4 * S), 0, 1)
    rgb = mix((64, 49, 38), (96, 70, 50), m)
    v = 1 + 0.20 * fbm(W, hb, 1.2 * S, 1.2 * S) + grain(hb, 0.07)
    v *= 0.80 + 0.20 * fr
    tr = np.clip((fr - 0.7) / 0.3, 0, 1) ** 2
    rgb = mix(rgb, np.broadcast_to(np.array((128, 82, 52), F32), rgb.shape), tr * 0.5)
    rgb *= v[..., None]
    # 植物の根
    mask = Image.new("L", (W, hb), 0)
    dr = ImageDraw.Draw(mask)
    for _ in range(int(860 * 0.4)):
        x = rng.uniform(0, W)
        y = rng.uniform(0, 4 * S)
        ang = math.pi / 2 + rng.normal(0, 0.25)
        L = rng.uniform(5, 30) * S
        w0 = rng.uniform(0.08, 0.35) * S
        step = 0.4 * S
        n = int(L / step)
        for k in range(n):
            ang += rng.normal(0, 0.18)
            ang = 0.85 * ang + 0.15 * (math.pi / 2)
            nx_, ny_ = x + math.cos(ang) * step, y + math.sin(ang) * step
            wd = max(1, int(w0 * (1 - k / n)))
            dr.line([(x, y), (nx_, ny_)], fill=int(rng.uniform(170, 230)), width=wd)
            if rng.random() < 0.06:            # 細根
                bx, by, ba = x, y, ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.2)
                for _k in range(int(rng.uniform(3, 12))):
                    ba += rng.normal(0, 0.25)
                    ex, ey = bx + math.cos(ba) * step * 0.6, by + math.sin(ba) * step * 0.6
                    dr.line([(bx, by), (ex, ey)], fill=150, width=1)
                    bx, by = ex, ey
            x, y = nx_, ny_
    rm = np.asarray(mask, F32) / 255 * 0.85
    rc = np.array((146, 116, 82), F32) * (1 + grain(hb, 0.05))[..., None]
    rgb = rgb * (1 - rm[..., None]) + rc * rm[..., None]
    hgt = 0.35 * S * fbm(W, hb, 1.5 * S, 1.5 * S) + rm * 0.15 * S
    return rgb, hgt


def L_loam(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    m = np.clip(0.5 + 1.3 * fbm(W, hb, 3 * S, 3 * S), 0, 1)
    rgb = mix((150, 86, 50), (176, 116, 62), m)
    v = 1 + 0.08 * fbm(W, hb, 12 * S, 6 * S) + grain(hb, 0.045)
    sp = fbm(W, hb, 0.4 * S, 0.4 * S, 2)                  # マンガン斑
    v *= np.where(sp > 0.55, 0.55, 1.0)
    v *= 0.92 + 0.08 * fr
    rgb *= v[..., None]
    # 鉛直の乾燥割れ目
    mask = Image.new("L", (W, hb), 0)
    dr = ImageDraw.Draw(mask)
    x = rng.uniform(10, 40) * S
    while x < W:
        pts = []
        cx = x
        y = top[int(min(W - 1, x))] - r0 + rng.uniform(0, 6) * S
        yend = bot[int(min(W - 1, x))] - r0 - rng.uniform(0, 8) * S
        while y < yend:
            pts.append((cx, y))
            cx += rng.normal(0, 0.12 * S)
            y += 0.5 * S
        if len(pts) > 1:
            dr.line(pts, fill=255, width=max(1, int(rng.uniform(0.08, 0.2) * S)))
        x += rng.uniform(25, 70) * S
    cm = np.asarray(mask, F32) / 255
    rgb *= (1 - 0.55 * cm)[..., None]
    hgt = 0.3 * S * fbm(W, hb, 2 * S, 2 * S) + 0.4 * S - cm * 0.3 * S
    return rgb, hgt


def L_gravel(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    m = np.clip(0.5 + fbm(W, hb, 10 * S, 5 * S), 0, 1)
    rgb = mix((150, 130, 100), (178, 158, 122), m)
    v = 1 + grain(hb, 0.11) + 0.06 * fbm(W, hb, 1 * S, 1 * S)
    rgb = (rgb * v[..., None]).astype(F32)
    hgt = 0.2 * S * fbm(W, hb, 1 * S, 1 * S) + 0.6 * S
    occ = np.zeros((hb, W), bool)
    topl, botl = top - r0, bot - r0
    tries = [(1.6, 4.0, 1300 * S // 20 * 0 + 1500), (0.6, 1.6, 9000), (0.2, 0.6, 26000)]
    for rmin, rmax, n in tries:
        n = int(n * 1.0)
        rr = np.exp(rng.uniform(math.log(rmin), math.log(rmax), n)) * S
        for rx in np.sort(rr)[::-1]:
            cx = rng.uniform(0, W)
            xi = int(cx)
            ry = rx * rng.uniform(0.45, 0.9)
            lo, hi = topl[xi] + 0.5 * ry, botl[xi] - 0.6 * ry
            if hi <= lo:
                continue
            # 下部ほど粗い礫（級化）
            fpos = rng.beta(2.2, 1.4) if rmin > 1 else rng.random()
            cy = lo + (hi - lo) * fpos
            ang = rng.normal(-0.3, 0.2)
            k = rng.choice(len(PEBBLE_COLORS), p=_pc_w)
            col, _, kind = PEBBLE_COLORS[k]
            draw_clast(rgb, hgt, occ, cx, cy, rx, ry, ang, col, kind,
                       max_occ=0.15 if rmin > 1 else 0.3)
    log("  pebbles placed")
    return rgb, hgt


def L_xsand(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    s1 = 0.33 + 0.07 * n1(80)
    s2 = 0.68 + 0.07 * n1(80)
    setidx = (fr >= s1[None]).astype(np.uint8) + (fr >= s2[None])
    phase = np.zeros((hb, W), F32)
    for k in range(3):
        edges = [0.0]
        while edges[-1] < W:
            edges.append(edges[-1] + rng.uniform(50, 160) * S)
        edges = np.array(edges, F32)
        seg = np.clip(np.searchsorted(edges, xs, side="right") - 1, 0, len(edges) - 1)
        ang = np.radians(rng.uniform(12, 26, len(edges)))
        dirn = rng.choice([1, 1, 1, -1], len(edges))
        sl = (np.tan(ang) * dirn).astype(F32)[seg]
        ph = yy - (xs - edges[seg])[None, :] * sl[None, :] + k * 1000
        sel = setidx == k
        phase[sel] = ph[sel]
    period = 0.55 * S
    warp = 0.8 * fbm(W, hb, 12 * S, 3 * S)
    lam = np.sin(2 * np.pi * (phase / period + warp))
    lam = np.sign(lam) * np.abs(lam) ** 0.5
    contrast = 0.05 + 0.05 * np.clip(fbm(W, hb, 20 * S, 4 * S) + 0.3, 0, 1)
    m = np.clip(0.5 + fbm(W, hb, 15 * S, 6 * S), 0, 1)
    rgb = mix((186, 156, 110), (206, 182, 136), m)
    v = 1 + contrast * lam + grain(hb, 0.09)
    sp = rng.random((hb, W), dtype=F32)
    v *= np.where(sp < 0.012, 0.55, np.where(sp > 0.992, 1.25, 1.0))
    # セット境界
    for s in (s1, s2):
        q = (fr - s[None]) * t / (0.12 * S)
        v *= 1 - 0.18 * np.exp(-q * q)
    rgb *= v[..., None]
    hgt = 0.25 * S * fbm(W, hb, 1.5 * S, 1.5 * S) + 1.0 * S + 0.04 * S * lam
    return rgb, hgt


def L_tuff(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    frw = fr + 0.03 * fbm(W, hb, 30 * S, 4 * S)
    lam = np.sin(2 * np.pi * frw * rng.uniform(9, 12))
    rgb = mix((196, 190, 178), (234, 230, 218), np.clip(1 - frw, 0, 1) ** 0.7)  # 下部が粗くやや灰色
    rgb = mix(rgb, np.broadcast_to(np.array((232, 214, 206), F32), rgb.shape),
              np.clip(fbm(W, hb, 40 * S, 8 * S) + 0.2, 0, 1) * 0.5)          # 淡いピンク
    v = 1 + 0.03 * lam + grain(hb, 0.035 + 0.05 * 0) * (1.6 - frw)
    rgb *= v[..., None]
    hgt = 0.15 * S * fbm(W, hb, 2 * S, 1 * S) + 1.3 * S
    return rgb, hgt


def L_mud(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    m = np.clip(0.5 + fbm(W, hb, 20 * S, 6 * S), 0, 1)
    rgb = mix((100, 107, 110), (126, 130, 128), m)
    lam = np.sin(2 * np.pi * (d / (0.45 * S) + 0.6 * fbm(W, hb, 30 * S, 3 * S)))
    fis = fbm(W, hb, 12 * S, 0.12 * S, 3)
    v = 1 + 0.035 * lam + grain(hb, 0.035)
    v *= np.where(fis > 0.42, 0.72, 1.0)
    rgb *= v[..., None]
    # 鉄さび色のしみ
    rust = np.clip((fbm(W, hb, 6 * S, 3 * S) - 0.2) * 3, 0, 1) * 0.55
    rgb = rgb * (1 - rust[..., None]) + np.array((150, 108, 68), F32) * v[..., None] * rust[..., None]
    hgt = 0.12 * S * fbm(W, hb, 3 * S, 1 * S) - 0.2 * S * (fis > 0.42)
    return rgb, hgt


def L_alt(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    seq, tot, sand = [], 0.0, True
    while tot < 25:
        th = rng.uniform(2, 5) if sand else rng.uniform(1, 3.5)
        seq.append((sand, th))
        tot += th
        sand = not sand
    cum = np.cumsum([s[1] for s in seq]) / tot
    lo_ = np.concatenate([[0], cum[:-1]])
    types = np.array([s[0] for s in seq])
    frw = fr + 0.012 * fbm(W, hb, 25 * S, 5 * S)
    idx = np.clip(np.searchsorted(cum, frw), 0, len(seq) - 1)
    issand = types[idx]
    bf = np.clip((frw - lo_[idx]) / (cum[idx] - lo_[idx]), 0, 1)
    sand_rgb = mix((178, 158, 120), (196, 176, 136), np.clip(0.5 + fbm(W, hb, 10 * S, 4 * S), 0, 1))
    sand_rgb = mix(sand_rgb, np.broadcast_to(np.array((140, 136, 124), F32), sand_rgb.shape),
                   np.clip((bf - 0.65) / 0.35, 0, 1) * 0.6)                 # 上方細粒化
    mud_rgb = mix((92, 97, 100), (112, 116, 116), np.clip(0.5 + fbm(W, hb, 10 * S, 4 * S), 0, 1))
    lam = np.sin(2 * np.pi * (d / (0.4 * S) + 0.5 * fbm(W, hb, 15 * S, 2 * S)))
    rgb = np.where(issand[..., None], sand_rgb, mud_rgb)
    v = 1 + np.where(issand, grain(hb, 0.085) + 0.04 * lam, grain(hb, 0.03) + 0.02 * lam)
    rgb *= v[..., None]
    hgt = 0.15 * S * fbm(W, hb, 2 * S, 1 * S) + np.where(issand, 0.9 * S, 0.2 * S)
    return rgb, hgt.astype(F32)


def L_coal(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    rgb = mix((36, 33, 30), (56, 50, 44), np.clip(0.5 + fbm(W, hb, 8 * S, 2 * S), 0, 1))
    lam = np.sin(2 * np.pi * (d / (0.2 * S) + 0.4 * fbm(W, hb, 10 * S, 1 * S)))
    sp = rng.random((hb, W), dtype=F32)
    v = 1 + 0.12 * lam + grain(hb, 0.05)
    v *= np.where(sp > 0.993, 2.2, 1.0)
    frag = fbm(W, hb, 3 * S, 0.1 * S, 2)
    v *= np.where(frag > 0.5, 1.5, 1.0)
    rgb *= v[..., None]
    hgt = 0.1 * S * fbm(W, hb, 2 * S, 1 * S) - 0.3 * S
    return rgb, hgt


def L_fsand(top, bot, r0, r1):
    hb = r1 - r0
    yy, d, t, fr = local(top, bot, r0, r1)
    m = np.clip(0.5 + fbm(W, hb, 15 * S, 6 * S), 0, 1)
    rgb = mix((150, 148, 134), (170, 167, 150), m)
    bio = fbm(W, hb, 2.2 * S, 2.2 * S, 3)
    rgb = mix(rgb, np.broadcast_to(np.array((128, 128, 112), F32), rgb.shape), np.clip((bio - 0.15) * 4, 0, 1) * 0.6)
    v = 1 + grain(hb, 0.075)
    rgb *= v[..., None]
    hgt = 0.2 * S * fbm(W, hb, 2 * S, 2 * S) + 0.8 * S
    topl, botl = top - r0, bot - r0
    # ノジュール（石灰質団塊）
    for cxn in rng.uniform([0.15, 0.6], [0.3, 0.8]):
        cx = cxn * W
        xi = int(cx)
        cy = topl[xi] + (botl[xi] - topl[xi]) * rng.uniform(0.45, 0.6)
        rx, ry = rng.uniform(22, 35) * S, rng.uniform(6, 8.5) * S
        x0, x1 = int(cx - rx - 4), int(cx + rx + 4)
        y0, y1 = max(0, int(cy - ry - 4)), min(hb, int(cy + ry + 4))
        gy, gx = np.mgrid[y0:y1, x0:x1].astype(F32)
        wob = 1 + 0.06 * fbm(x1 - x0, y1 - y0, 6 * S, 6 * S)
        r = np.sqrt(((gx - cx) / rx) ** 2 + ((gy - cy) / ry) ** 2) * wob
        a = np.clip((1 - r) * 12, 0, 1)
        ring = 1 + 0.018 * np.sin(r * 2 * np.pi * 5 + 3 * wob)
        c = np.array((184, 176, 154), F32)[None, None] * (ring * (1 + 0.05 * fbm(x1 - x0, y1 - y0, 1 * S, 1 * S)))[..., None]
        z = np.sqrt(np.clip(1 - r * r, 0, 1))
        reg = rgb[y0:y1, x0:x1]
        reg[:] = reg * (1 - a[..., None]) + c * a[..., None]
        hgt[y0:y1, x0:x1] += z * 1.2 * S
    # 生痕（巣穴）と貝化石片
    mask = Image.new("L", (W, hb), 0)
    dr = ImageDraw.Draw(mask)
    shells = Image.new("L", (W, hb), 0)
    ds = ImageDraw.Draw(shells)
    for _ in range(int(860 * 0.25)):
        x = rng.uniform(0, W)
        xi = int(x)
        y = topl[xi] + (botl[xi] - topl[xi]) * rng.uniform(0.05, 0.95)
        ang = math.pi / 2 + rng.normal(0, 0.5)
        L = rng.uniform(3, 10) * S
        dr.line([(x, y), (x + math.cos(ang) * L, y + math.sin(ang) * L)], fill=200,
                width=max(1, int(rng.uniform(0.4, 0.8) * S)))
    for _ in range(int(860 * 0.6)):
        x = rng.uniform(0, W)
        xi = int(x)
        f = rng.normal(0.28, 0.04) if rng.random() < 0.6 else rng.uniform(0.05, 0.95)  # 貝殻密集層
        y = topl[xi] + (botl[xi] - topl[xi]) * f
        r = rng.uniform(0.4, 1.8) * S
        st = rng.uniform(180, 220) if rng.random() < 0.7 else rng.uniform(0, 360)
        ds.arc([x - r, y - r * 0.6, x + r, y + r * 0.6], st, st + rng.uniform(70, 160), fill=255,
               width=max(1, int(rng.uniform(0.12, 0.25) * S)))
    bm = np.asarray(mask, F32) / 255 * 0.5
    rgb = rgb * (1 - bm[..., None]) + np.array((176, 170, 150), F32) * bm[..., None]
    sm = np.asarray(shells, F32) / 255
    rgb = rgb * (1 - sm[..., None]) + np.array((236, 232, 220), F32) * (1 + grain(hb, 0.04))[..., None] * sm[..., None]
    hgt += sm * 0.15 * S
    return rgb, hgt


RENDER = [L_topsoil, L_loam, L_gravel, L_xsand, L_tuff, L_mud, L_alt, L_coal, L_fsand]

img = np.zeros((H, W, 3), F32)
hgt = np.zeros((H, W), F32)
for i, fn in enumerate(RENDER):
    top, bot = TOPS[i], BOTS[i]
    r0 = max(0, int(math.floor(top.min())) - 2)
    r1 = min(H, int(math.ceil(bot.max())) + 2)
    rgb, hh = fn(top, bot, r0, r1)
    sel = lay[r0:r1] == i
    img[r0:r1][sel] = rgb[sel]
    hgt[r0:r1][sel] = hh[sel]
    del rgb, hh, sel
    log(f"layer {i + 1} {LAYERS[i][0]} done")

# ---------------------------------------------------------------- relief shading
hs = box_blur(box_blur(hgt, int(0.35 * S), 0), int(0.35 * S), 0)
hs = box_blur(hs, int(0.2 * S), 1)
hx = np.zeros_like(hs)
hy = np.zeros_like(hs)
hx[:, 1:-1] = (hs[:, 2:] - hs[:, :-2]) * 0.5
hy[1:-1] = (hs[2:] - hs[:-2]) * 0.5
shade = np.clip(1 + 0.30 * (0.45 * hx + 0.75 * hy), 0.55, 1.35)
del hs, hx, hy, hgt
img *= shade[..., None]
del shade
log("relief shading done")

# 雨だれ状の風化すじ
img *= (1 + 0.05 * fbm(W, H, 0.7 * S, 40 * S, 3))[..., None]
img *= (1 + 0.04 * fbm(W, H, 60 * S, 60 * S, 2))[..., None]

# 泥岩の上面からしみ出す地下水（湿って黒ずむ）
b_wet = bnd[4]
dl = (8 + 22 * np.clip(0.5 + n1(60), 0, 1)) * S
drip = 0.55 + 0.45 * np.clip(0.5 + 1.5 * fbm(W, H, 1.2 * S, 25 * S, 3), 0, 1)
Yf = np.arange(H, dtype=F32)[:, None]
q = (Yf - b_wet[None]) / dl[None]
wet = np.where(q > -0.06, np.exp(-np.clip(q, 0, None) * 2.2), 0) * drip
img *= (1 - 0.3 * wet)[..., None]
del drip, q, wet
log("weathering done")

# 基盤岩（砂岩以下）の節理 — 不整合面で止まる
jm = Image.new("L", (W, H), 0)
dj = ImageDraw.Draw(jm)
for _ in range(16):
    x = rng.uniform(0.02, 0.98) * W
    y = bnd[2][int(x)] if rng.random() < 0.7 else bnd[2][int(x)] + rng.uniform(10, 60) * S
    yend = H if rng.random() < 0.6 else y + rng.uniform(30, 100) * S
    pts = []
    dxs = rng.normal(0, 0.08)
    while y < yend:
        pts.append((x, y))
        x += dxs * 0.5 * S + rng.normal(0, 0.1 * S)
        y += 0.5 * S
    if len(pts) > 1:
        dj.line(pts, fill=255, width=max(1, int(rng.uniform(0.1, 0.25) * S)))
jmask = np.asarray(jm, F32) / 255
halo = box_blur(box_blur(jmask, int(1.2 * S), 1), int(0.3 * S), 0)
rock = (lay >= 3)
jmask = box_blur(box_blur(jmask, max(1, S // 12), 1), max(1, S // 12), 0) * rock
halo = np.clip(halo * 3, 0, 1) * rock * 0.18
img = img * (1 - halo[..., None]) + np.array((150, 102, 62), F32) * (img.mean(2, keepdims=True) / 150) * halo[..., None]
img *= (1 - 0.5 * np.clip(jmask * 1.3, 0, 1))[..., None]
del jmask, halo, rock, jm
log("joints done")

strata = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
del img
strata.save(f"{OUT}_plain.png", optimize=False)
log("plain saved")

# ---------------------------------------------------------------- annotation
fs_name = int(3.4 * S)
fs_desc = int(2.3 * S)
f_name = ImageFont.truetype(FONT, fs_name)
f_desc = ImageFont.truetype(FONT, fs_desc)
f_title = ImageFont.truetype(FONT, int(4.4 * S))
f_num = ImageFont.truetype(FONT, int(2.0 * S))
CIRC = "①②③④⑤⑥⑦⑧⑨"
INK = (34, 34, 38)
SUB = (96, 98, 104)

tmp = ImageDraw.Draw(Image.new("RGB", (10, 10)))


def tw(text, font):
    b = tmp.textbbox((0, 0), text, font=font)
    return b[2] - b[0]


name_txt = [f"{CIRC[i]} {n}" for i, (n, _) in enumerate(LAYERS)]
thk_txt = [f"厚さ 約{t}cm" for t in THK]
pad = 3 * S
lead = 12 * S
col_w = max(max(tw(n, f_name) + S + tw(t, f_desc) for n, t in zip(name_txt, thk_txt)),
            max(tw(d, f_desc) for d in DESC))
RM = lead + col_w + 2 * pad

# 凡例レイアウト
sw_w, sw_h = 28 * S, 13 * S
leg_cols = 5
leg_cell_w = (W + RM - 2 * pad) // leg_cols
leg_row_h = sw_h + 5 * S
LG = int(9 * S + 2 * leg_row_h + 3 * S)
TM = pad
canvas = Image.new("RGB", (W + RM + pad, TM + H + LG), (255, 255, 255))
ox, oy = pad, TM
canvas.paste(strata, (ox, oy))
dr = ImageDraw.Draw(canvas)
dr.rectangle([ox - 2, oy - 2, ox + W + 1, oy + H + 1], outline=INK, width=max(2, S // 8))

# 左端：層番号
xi_l = int(3 * S)
for i in range(len(LAYERS)):
    cy = (TOPS[i][xi_l] + BOTS[i][xi_l]) / 2 + oy
    rr = min(1.6 * S, (BOTS[i][xi_l] - TOPS[i][xi_l]) / 2 - 2)
    cx = ox + xi_l
    dr.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 255, 255), outline=INK, width=max(1, S // 10))
    f = ImageFont.truetype(FONT, int(rr * 1.25))
    dr.text((cx, cy), str(i + 1), font=f, fill=INK, anchor="mm")

# 右側：層名ラベル（引き出し線つき）
xe = W - 1
want = [(TOPS[i][xe] + BOTS[i][xe]) / 2 for i in range(len(LAYERS))]
gap = fs_name + fs_desc + 2.2 * S
ys = list(want)
for _ in range(200):
    for i in range(1, len(ys)):
        if ys[i] - ys[i - 1] < gap:
            mid = (ys[i] + ys[i - 1]) / 2
            ys[i - 1], ys[i] = mid - gap / 2, mid + gap / 2
    lo, hi = gap / 2, H - gap / 2
    sh = max(0, lo - ys[0]) - max(0, ys[-1] - hi)
    ys = [y + sh for y in ys]
lx0 = ox + W
lx1 = ox + W + lead - 2 * S
tx = ox + W + lead
for i in range(len(LAYERS)):
    y0 = oy + want[i]
    y1 = oy + ys[i]
    dr.ellipse([lx0 - 0.4 * S, y0 - 0.4 * S, lx0 + 0.4 * S, y0 + 0.4 * S], fill=INK)
    dr.line([(lx0, y0), (lx0 + 4 * S, y0), (lx1 - 2 * S, y1), (lx1, y1)], fill=INK, width=max(2, S // 8))
    ny = y1 - (fs_name + fs_desc + 0.8 * S) / 2
    dr.text((tx, ny), name_txt[i], font=f_name, fill=INK)
    dr.text((tx + tw(name_txt[i], f_name) + S, ny + fs_name - fs_desc), thk_txt[i], font=f_desc, fill=SUB)
    dr.text((tx, ny + fs_name + 0.8 * S), DESC[i], font=f_desc, fill=SUB)

# 凡例（下）
ly = oy + H + 3 * S
dr.text((ox, ly), "凡例", font=f_title, fill=INK)
dr.text((ox + tw("凡例", f_title) + 3 * S, ly + int(4.4 * S) - fs_desc),
        "地層断面　横 860 cm × 縦 192 cm（1 cm = %d px）。左端・右側の番号は層の番号（上から順）。" % S,
        font=f_desc, fill=SUB)
ly += 7 * S


def swatch(i):
    th = BOTS[i] - TOPS[i]
    # 最も厚い付近（左右端を避ける）から切り出す
    cand = np.convolve(th, np.ones(sw_w) / sw_w, mode="valid")
    lo_, hi_ = int(20 * S), len(cand) - int(20 * S)
    x0 = lo_ + int(np.argmax(cand[lo_:hi_]))
    xc = x0 + sw_w // 2
    avail = int(th[x0:x0 + sw_w].min()) - int(0.6 * S)
    mid = int((TOPS[i][xc] + BOTS[i][xc]) / 2)
    hh = max(4, min(sw_h, avail))
    piece = strata.crop((x0, mid - hh // 2, x0 + sw_w, mid - hh // 2 + hh))
    if hh >= sw_h:
        return piece
    out = Image.new("RGB", (sw_w, sw_h))
    y, flip = 0, False
    while y < sw_h:
        out.paste(piece.transpose(Image.FLIP_TOP_BOTTOM) if flip else piece, (0, y))
        y += hh
        flip = not flip
    return out


for i in range(len(LAYERS)):
    r, c = divmod(i, leg_cols)
    x = ox + c * leg_cell_w
    y = ly + r * leg_row_h
    canvas.paste(swatch(i), (x, y))
    dr.rectangle([x - 1, y - 1, x + sw_w, y + sw_h], outline=INK, width=max(1, S // 10))
    tx2 = x + sw_w + 2 * S
    dr.text((tx2, y + 0.5 * S), name_txt[i], font=f_name, fill=INK)
    dr.text((tx2, y + 0.5 * S + fs_name + 1.2 * S), thk_txt[i], font=f_desc, fill=SUB)
    # 説明文は折り返し
    maxw = leg_cell_w - sw_w - 4 * S
    line, lines = "", []
    for ch in DESC[i]:
        if tw(line + ch, f_desc) > maxw:
            lines.append(line)
            line = ""
        line += ch
    lines.append(line)
    for k, ln in enumerate(lines):
        dr.text((tx2, y + 0.5 * S + fs_name + 1.2 * S + (fs_desc + 0.8 * S) * (k + 1)), ln, font=f_desc, fill=SUB)

canvas.save(f"{OUT}.png", optimize=False)
log(f"annotated saved {canvas.size}")
canvas.save(f"{OUT}.jpg", quality=92, subsampling=0)
pw = 4000
canvas.resize((pw, int(canvas.size[1] * pw / canvas.size[0])), Image.LANCZOS).save(f"{OUT}_preview.jpg", quality=90)
log("done")
