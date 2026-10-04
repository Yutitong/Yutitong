// 乱数・ハッシュ・ノイズ（同じ座標からは常に同じ結果になる）

export function hash3(a, b, c) {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);
const lattice = (x, y, z, seed) => hash3(x + seed * 7919, y, z) / 2 ** 32;

// 0..1 のなめらかなノイズ（格子点の乱数を補間）
export function noise3(x, y, z, seed = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = smooth(x - x0), ty = smooth(y - y0), tz = smooth(z - z0);
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const dx = i & 1, dy = (i >> 1) & 1, dz = (i >> 2) & 1;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    v += w * lattice(x0 + dx, y0 + dy, z0 + dz, seed);
  }
  return v;
}

export const noise2 = (x, z, seed = 0) => noise3(x, 0, z, seed);

// 0xRRGGBB の明るさを f 倍する
export function shade(rgb, f) {
  const r = Math.min(255, Math.max(0, Math.round(((rgb >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((rgb >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((rgb & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
