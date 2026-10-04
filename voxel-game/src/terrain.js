// 地形: なだらかな丘・小さな崖・川・池と、土の層・岩肌の色分け
//
// 地面は高さマップで決まる。列 (x, z) の y < height のセルがすべて地面。
// 水は全体で同じ高さ（WATER_LEVEL）。地面がそれより低い所は池や川になる。

import { noise2, hash3, shade } from './rng.js';
import { floorDiv } from './grid.js';

export const WATER_LEVEL = 16; // この高さより下で地面が低い所は水
export const BASE = 18; // 平均的な地面の高さ

const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 地形の高さ（地面のセルの数）。同じ座標からは常に同じ値
export function terrainHeight(seed, x, z) {
  // 丘: 大きなうねりに中くらい・小さな起伏を重ねる
  let h = BASE
    + 30 * (noise2(x / 256, z / 256, seed + 1) - 0.28)
    + 9 * (noise2(x / 70, z / 70, seed + 2) - 0.5)
    + 2.5 * (noise2(x / 18, z / 18, seed + 3) - 0.5);
  h += 16 * smoothstep(0.55, 0.85, noise2(x / 300, z / 300, seed + 4)); // ところどころ高台
  // 小さな崖: 一部の地域では高さを 7 段ごとの段丘にする
  const terrace = smoothstep(0.58, 0.66, noise2(x / 120, z / 120, seed + 5));
  if (terrace > 0) {
    const stepped = Math.floor(h / 7) * 7 + smoothstep(0.75, 1, (h % 7) / 7) * 7;
    h = h + (stepped - h) * terrace;
  }
  // 川: ノイズの等高線に沿って蛇行する谷。谷底は水面より低くなる
  // 谷は広く、岸に向かってゆるやかに下がる。川のまわりの丘も低めにする
  const river = Math.abs(noise2(x / 230, z / 230, seed + 6) - 0.5);
  const valley = smoothstep(0.13, 0.012, river) ** 1.4;
  h = h + (WATER_LEVEL - 4 - h) * valley;
  return Math.max(2, Math.round(h));
}

// 地面の各セルの色（見えないセルは 0）
const GRASS = [0x5f9a46, 0x67a34c, 0x588f41, 0x6eab52];
const DRY_GRASS = [0x86a34e, 0x7c9a48];
const FLOWERS = [0xf3e37c, 0xf4f1f7, 0xe58fb2];
const SAND = 0xd8c48e;
const MUD = 0x75694c;
const DIRT = 0x7a5a3c;
const ROCK = [0x8a8f98, 0x7d828b, 0x959aa2, 0x868078]; // 地層ごとに少しずつ違う

function surfaceColor(seed, x, z, h, slope) {
  const n = hash3(x, z, seed);
  if (h <= WATER_LEVEL - 1) return shade(h < WATER_LEVEL - 3 ? MUD : SAND, 0.92 + (n % 16) / 100);
  if (h <= WATER_LEVEL + 1) return shade(SAND, 0.94 + (n % 12) / 100); // 岸辺の砂
  if (slope >= 3) return rockColor(seed, x, h - 1, z); // 急な所は岩肌
  if (n % 97 === 0) return FLOWERS[(n >>> 8) % FLOWERS.length];
  const patch = hash3(floorDiv(x, 4), floorDiv(z, 4), seed + 7) % 2;
  if (h > BASE + 22) return DRY_GRASS[(n >>> 4) % 2]; // 高い所は乾いた草
  return GRASS[((n >>> 4) % 2) + patch * 2];
}

function rockColor(seed, x, y, z) {
  const band = hash3(floorDiv(y, 3), 0, seed + 8) % ROCK.length; // 3 段ごとの地層
  return shade(ROCK[band], 0.9 + (hash3(x, y, z) % 20) / 100);
}

// 列の中の高さ y のセルの色。depth は地表からの深さ（0 = 地表）
export function groundColor(seed, x, y, z, h, slope) {
  const depth = h - 1 - y;
  if (depth === 0) return surfaceColor(seed, x, z, h, slope);
  if (h <= WATER_LEVEL + 1) return shade(depth < 3 ? SAND : MUD, 0.9 + (hash3(x, y, z) % 12) / 100);
  if (depth <= 3 && slope < 3) return shade(DIRT, 0.88 + (hash3(x, y, z) % 20) / 100); // 土の層
  return rockColor(seed, x, y, z);
}

// 水面の色: 浅い所は明るく、深い所は暗い
export function waterColor(x, z, depth) {
  const base = depth <= 1 ? 0x86c9c6 : depth <= 3 ? 0x5aaec4 : depth <= 6 ? 0x3d8db5 : 0x2f6d9c;
  return shade(base, 0.95 + (hash3(x, z, 17) % 10) / 100);
}
