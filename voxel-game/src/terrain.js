// 地形: 丘と平地・尾根の鋭い山（高さ 40〜60m）・山から流れ下る川・大小の岩
//
// 地面は高さマップで決まる。列 (x, z) の y < height のセルがすべて地面。
// 水面の高さは場所ごとに違う:
// - 低い所（WATER_LEVEL より低い地面）は池や、平地をゆったり蛇行する川になる
// - 山の川は山頂の近くから谷を下り、平地の池へ流れ込む。上流は狭く急で、段ごとに小さな滝になる。
//   下るにつれて幅が広く、流れがゆるやかになる
// 同じ座標からは常に同じ結果になる（世界のどこから作り始めても同じ地形）。

import { noise2, hash3, mulberry32, shade } from './rng.js';
import { floorDiv } from './grid.js';

export const WATER_LEVEL = 16; // 平地の池・川の水面
export const BASE = 18; // 平均的な地面の高さ
export const MOUNTAIN_CELL = 1536; // 山を置く区画の一辺（ボクセル ≈ 230m）。1区画に山は1つまで
const BUCKET = 32; // 川・岩を探すための格子
const RIVER_STEP = 4; // 川の折れ線の点の間隔
const MAX_REACH = 60; // 川が谷を削る範囲（川の中心からの距離）

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const ridge = (x, z, seed) => {
  const r = 1 - Math.abs(2 * noise2(x, z, seed) - 1);
  return r * r;
};
const bucketKey = (bx, bz) => (bx + 32768) * 65536 + (bz + 32768);

// ---- 丘と平地 --------------------------------------------------------------------

// 山と川を除いた起伏。lowland: 平地の川の谷の重み（0..1）を返すための入れ物
function hills(seed, x, z, mountain, out) {
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
  h += mountain;
  // 平地の川: ノイズの等高線に沿って蛇行する広い谷。谷底は水面より低い。山の中には入らない
  const river = Math.abs(noise2(x / 230, z / 230, seed + 6) - 0.5);
  const valley = smoothstep(0.13, 0.012, river) ** 1.4 * (1 - smoothstep(10, 60, mountain));
  if (out) out.lowland = valley;
  return h + (WATER_LEVEL - 4 - h) * valley;
}

// ---- 地形 ------------------------------------------------------------------------

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.cells = new Map(); // 山の区画 → { peaks, near: まわり 3×3 の峰, rivers }
    this.ready = new Set(); // まわり 3×3 の区画の川がそろった区画
    this.riverBuckets = new Map(); // 格子 → 川の区間（と池）
    this.rockBuckets = new Map(); // 格子 → 岩
    this.tmp = {};
  }

  // 区画 (i, j) の峰（なければ空）。主峰と、尾根続きの低い峰
  cell(i, j) {
    const key = bucketKey(i, j);
    let c = this.cells.get(key);
    if (c) return c;
    const rng = mulberry32(hash3(i, j, this.seed ^ 0x6a09e667));
    const peaks = [];
    const home = i === 0 && j === -1; // 出発地点から見える所に必ず山を置く
    if (home || rng() < 0.55) {
      const x = home ? 640 : (i + 0.25 + rng() * 0.5) * MOUNTAIN_CELL;
      const z = home ? -520 : (j + 0.25 + rng() * 0.5) * MOUNTAIN_CELL;
      if (home) rng();
      const H = 280 + rng() * 110;
      const R = 560 + rng() * 200;
      peaks.push({ x, z, H, R, main: true });
      const subs = 1 + Math.floor(rng() * 2.5);
      const a0 = rng() * Math.PI * 2;
      for (let k = 0; k < subs; k++) {
        const a = a0 + (k * Math.PI * 2) / subs + (rng() - 0.5) * 1.2;
        const d = R * (0.3 + rng() * 0.25);
        peaks.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, H: H * (0.55 + rng() * 0.3), R: R * (0.45 + rng() * 0.2), main: false });
      }
    }
    for (const p of peaks) p.R2 = p.R * p.R;
    c = { i, j, home, peaks, near: null, raw: null, rivers: null };
    this.cells.set(key, c);
    return c;
  }

  // 区画 (i, j) とまわりの峰
  near(i, j) {
    const c = this.cell(i, j);
    if (!c.near) {
      c.near = [];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c.near.push(...this.cell(i + di, j + dj).peaks);
    }
    return c.near;
  }

  // 山の大まかな形: 峰ごとの円錐（頂上ほど急で、裾はなだらか）の重なり
  cone(x, z) {
    const peaks = this.near(floorDiv(x, MOUNTAIN_CELL), floorDiv(z, MOUNTAIN_CELL));
    if (!peaks.length) return 0;
    // 座標を大きくゆがめて、山の形と、峰と峰の間の谷を曲がりくねらせる
    const s = this.seed;
    const wx = x + 180 * (noise2(x / 520, z / 520, s + 51) - 0.5);
    const wz = z + 180 * (noise2(x / 520, z / 520, s + 52) - 0.5);
    let m = 0;
    for (const p of peaks) {
      const dx = wx - p.x, dz = wz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= p.R2) continue;
      const v = p.H * (1 - Math.sqrt(d2) / p.R) ** 1.7;
      if (v > m) m = v;
    }
    return m;
  }

  // 川が下っていく向きを決める、なめらかな地形（尾根や小さな起伏は無視する）
  macro(x, z) {
    const s = this.seed;
    return 30 * noise2(x / 256, z / 256, s + 1) + 16 * smoothstep(0.55, 0.85, noise2(x / 300, z / 300, s + 4)) + this.cone(x, z);
  }

  // 山の高さ（丘の上に足す分）。大まかな形に、尾根と谷のしわを刻む
  mountain(x, z) {
    const m = this.cone(x, z);
    if (m <= 0) return 0;
    const s = this.seed;
    // 尾根: ゆがめた座標の、ノイズの等高線に沿った鋭い稜線。高い所ほどはっきり
    const wx = x + 70 * (noise2(x / 260, z / 260, s + 21) - 0.5);
    const wz = z + 70 * (noise2(x / 260, z / 260, s + 22) - 0.5);
    const k = Math.min(1, m / 140);
    const r1 = ridge(wx / 190, wz / 190, s + 23);
    const r2 = ridge(wx / 75, wz / 75, s + 24);
    const r3 = noise2(x / 23, z / 23, s + 25);
    return Math.max(0, m * (0.74 + 0.36 * r1 * k) + k * (30 * (r2 - 0.45) + 7 * (r3 - 0.5)) - 6 * (1 - k));
  }

  // 川に削られる前の地面の高さ
  baseHeight(x, z, out) {
    return hills(this.seed, x, z, this.mountain(x, z), out);
  }

  // ---- 川 ----
  //
  // 川はまず、ほかの川と関係なく峰から谷を下ってたどる（区画ごとに決まる）。
  // 次に、より大きな川（源の高い川）に近づいた所で終わらせる（支流が本流に合流する）。
  // 同じ谷を 2 本の川が並んで流れないように。どの順で区画を作っても同じ結果になる

  // 区画 (i, j) のまわり 3×3 の区画の川を用意する（川は隣の区画までしか流れない）
  prepare(i, j) {
    const key = bucketKey(i, j);
    if (this.ready.has(key)) return;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) this.finishCell(i + di, j + dj);
    this.ready.add(key);
  }

  // 区画の川を、ほかの川と関係なくたどる
  rawRivers(i, j) {
    const c = this.cell(i, j);
    if (c.raw) return c.raw;
    c.raw = [];
    const rng = mulberry32(hash3(i, j, this.seed ^ 0x3c6ef372));
    const key = bucketKey(i, j);
    for (const p of c.peaks) {
      const n = p.main ? 3 : 1 + (rng() < 0.4 ? 1 : 0);
      let a = rng() * Math.PI * 2;
      // 出発地点の山の 1 本目は、出発地点の方へ流れ出す
      if (p.main && c.home) a = Math.atan2(-p.z, -p.x);
      for (let k = 0; k < n; k++) {
        const ang = a + (k * Math.PI * 2) / n + (k ? (rng() - 0.5) * 0.8 : 0);
        const r = this.trace(p, ang, rng);
        if (r) {
          r.rank = [r.pts[0].S, key, c.raw.length];
          c.raw.push(r);
        }
      }
    }
    return c.raw;
  }

  // 区画の川を、より大きな川との合流で切りそろえ、岩を置いて、格子に登録する
  finishCell(i, j) {
    const c = this.cell(i, j);
    if (c.rivers) return;
    c.rivers = [];
    // まわりの区画の川の点を、16 ボクセルの格子に入れておく
    const grid = new Map();
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        for (const o of this.rawRivers(i + di, j + dj)) {
          for (const v of o.pts) {
            const k = bucketKey(floorDiv(v.x, 16), floorDiv(v.z, 16));
            let list = grid.get(k);
            if (!list) grid.set(k, (list = []));
            list.push(o, v);
          }
        }
      }
    }
    const outranks = (a, b) => a.rank[0] !== b.rank[0] ? a.rank[0] > b.rank[0] : a.rank[1] !== b.rank[1] ? a.rank[1] < b.rank[1] : a.rank[2] < b.rank[2];
    c.raw.forEach((raw, index) => {
      let cut = raw.pts.length;
      find: for (let n = 3; n < raw.pts.length; n++) {
        const q = raw.pts[n];
        const bx = floorDiv(q.x, 16), bz = floorDiv(q.z, 16);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const list = grid.get(bucketKey(bx + dx, bz + dz));
            if (!list) continue;
            for (let m = 0; m < list.length; m += 2) {
              const o = list[m], v = list[m + 1];
              if (o === raw || !outranks(o, raw)) continue;
              if ((v.x - q.x) ** 2 + (v.z - q.z) ** 2 < (v.w + q.w + 2) ** 2) {
                cut = n + 1;
                break find;
              }
            }
          }
        }
      }
      const pts = raw.pts.slice(0, cut);
      if (pts.length < 6) return;
      const rng = mulberry32(hash3(i * 977 + index, j, this.seed ^ 0x2545f491));
      const last = pts[pts.length - 1];
      const river = { pts, pond: null, rocks: [] };
      // 行き着いた所は池になる（平地なら平地の水面、山の中なら山の池）。合流した川は池を作らない
      if (cut === raw.pts.length) river.pond = { x: last.x, z: last.z, S: last.S, w: 12 + rng() * 8, depth: 4, k: 0.4, f: 1 };
      // 岩: 上流ほど多く大きい。大きさはまちまち
      for (let n = 1; n < pts.length; n++) {
        const q = pts[n];
        const up = 1 - q.f;
        const chance = (0.08 + 0.85 * up ** 1.5) * (RIVER_STEP / 6); // 6 ボクセルあたりの割合
        let count = 0;
        while (count < 3 && rng() < chance * (count ? 0.45 : 1)) count++;
        for (let m = 0; m < count; m++) {
          const prev = pts[n - 1];
          const ax = q.x - prev.x, az = q.z - prev.z;
          const al = Math.hypot(ax, az) || 1;
          const r = 1.2 + rng() ** 2.2 * (1.5 + 10.5 * up);
          const side = (rng() * 2 - 1) * (q.w + 1.5 + r * 0.6);
          const along = rng();
          river.rocks.push({
            x: prev.x + ax * along - (az / al) * side,
            z: prev.z + az * along + (ax / al) * side,
            r, sy: 0.6 + rng() * 0.3, sz: 0.75 + rng() * 0.4, rot: rng() * Math.PI, seed: Math.floor(rng() * 2 ** 31), y: null,
          });
        }
      }
      c.rivers.push(river);
      this.register(river);
    });
  }

  // 峰 p の近くから、谷を下る川をたどる。点ごとに水面の高さ S（下流へ向かって下がるだけ）・幅・深さを持つ
  trace(p, ang, rng) {
    const s = this.seed;
    let x = p.x + Math.cos(ang) * p.R * 0.14, z = p.z + Math.sin(ang) * p.R * 0.14;
    let dx = Math.cos(ang), dz = Math.sin(ang);
    const h0 = this.baseHeight(x, z);
    if (h0 < WATER_LEVEL + 40) return null;
    let S = Math.floor(h0 - 3);
    const S0 = S;
    const pts = [];
    for (let n = 0; n < 220; n++) {
      const h = this.baseHeight(x, z);
      const f = clamp(1 - (S - WATER_LEVEL) / (S0 - WATER_LEVEL), 0, 1); // 0 = 源流 … 1 = 河口
      // 水面: 地面より少し下。上流は段ごとに大きく落ちて（小さな滝）、下流はなだらか
      const target = h - (2 + 3 * (1 - f));
      if (target < S) {
        const drop = f < 0.55 ? (rng() < 0.15 ? 3 + rng() * 5 : rng() * 2.5) : 0;
        S = Math.floor(target - drop);
      }
      if (S <= WATER_LEVEL || h < WATER_LEVEL + 2) {
        S = WATER_LEVEL;
        pts.push({ x, z, S, f: 1, w: 9, depth: 4, k: 0.35 });
        break;
      }
      pts.push({
        x, z, S, f,
        w: 1.4 + 7.5 * f ** 1.2, // 川幅の半分
        depth: 1 + 2.5 * f,
        k: 1.7 - 1.35 * f, // 岸の斜面の急さ（上流は深い V 字の谷）
      });
      // 大まかな下り坂の向きへ曲がる（勢いがあるので急には曲がらない）。少し蛇行させる。
      // 尾根にぶつかっても向きは変えず、谷を刻んで（峡谷になって）通り抜ける
      const e = 10;
      const m0 = this.macro(x, z);
      const gx = this.macro(x + e, z) - m0, gz = this.macro(x, z + e) - m0;
      const gl = Math.hypot(gx, gz) || 1;
      dx = dx * 0.7 - (gx / gl) * 0.55;
      dz = dz * 0.7 - (gz / gl) * 0.55;
      const wig = (noise2(x / 80, z / 80, s + 31) - 0.5) * 1.1 * (0.4 + f);
      const c = Math.cos(wig), sn = Math.sin(wig);
      [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      x += dx * RIVER_STEP;
      z += dz * RIVER_STEP;
    }
    return pts.length < 6 ? null : { pts };
  }

  // 川の区間と岩を格子に登録する（届く範囲の格子すべてに）
  register(river) {
    const add = (map, x0, z0, x1, z1, item) => {
      for (let bz = floorDiv(Math.floor(z0), BUCKET); bz <= floorDiv(Math.ceil(z1), BUCKET); bz++) {
        for (let bx = floorDiv(Math.floor(x0), BUCKET); bx <= floorDiv(Math.ceil(x1), BUCKET); bx++) {
          const key = bucketKey(bx, bz);
          let list = map.get(key);
          if (!list) map.set(key, (list = []));
          list.push(item);
        }
      }
    };
    const { pts } = river;
    for (let n = 0; n + 1 < pts.length; n++) {
      const a = pts[n], b = pts[n + 1];
      const R = Math.max(a.w, b.w) + MAX_REACH;
      add(this.riverBuckets, Math.min(a.x, b.x) - R, Math.min(a.z, b.z) - R, Math.max(a.x, b.x) + R, Math.max(a.z, b.z) + R, { a, b });
    }
    if (river.pond) {
      const p = river.pond;
      const R = p.w + MAX_REACH;
      add(this.riverBuckets, p.x - R, p.z - R, p.x + R, p.z + R, { a: p, b: p });
    }
    for (const r of river.rocks) {
      const R = r.r * 1.3 + 1;
      add(this.rockBuckets, r.x - R, r.z - R, r.x + R, r.z + R, r);
    }
  }

  // 列 (x, z) の地形。out に { h: 地面の高さ, water: 水面（0 = なし）, channel: 川の中か,
  // bank: 川岸か, f: 川の上流(0)〜下流(1), lowland: 平地の川の谷か } を書く
  sample(x, z, out = {}) {
    this.prepare(floorDiv(x, MOUNTAIN_CELL), floorDiv(z, MOUNTAIN_CELL));
    let h = this.baseHeight(x, z, out);
    const h0 = h;
    let water = 0, channel = false, bank = false, f = 1, best = Infinity;
    let levee = -Infinity, nearest = Infinity; // いちばん近い川岸の水面 + 1
    const list = this.riverBuckets.get(bucketKey(floorDiv(x, BUCKET), floorDiv(z, BUCKET)));
    if (list) {
      for (const { a, b } of list) {
        // 区間 a–b への距離と、いちばん近い点の位置 u（0..1）
        const ex = b.x - a.x, ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        const t = len2 ? ((x + 0.5 - a.x) * ex + (z + 0.5 - a.z) * ez) / len2 : 0;
        const u = clamp(t, 0, 1);
        const d = Math.hypot(x + 0.5 - a.x - ex * u, z + 0.5 - a.z - ez * u);
        const w = a.w + (b.w - a.w) * u;
        if (d > w + MAX_REACH) continue;
        // 谷の斜面は、区間の真横だけを削る（区間の先まで削ると、急な上流で下流の谷が淵のまわりをえぐってしまう）
        if (d >= w && len2 && Math.abs(t - u) * Math.sqrt(len2) > 1.5) continue;
        // 区間の水面は下流側の点の高さ。点ごとに段になり、上の点で落ちる（滝）。
        // 下流側の点は区間でいちばん低いので、淵の水が地面より高くなることはない
        const S = b.S;
        const k = a.k + (b.k - a.k) * u;
        let v;
        if (d < w) {
          const depth = a.depth + (b.depth - a.depth) * u;
          v = S - 1 - (depth - 1) * (1 - (d / w) ** 2); // 川底
          if (S < best) {
            best = S;
            water = S;
            channel = true;
            f = a.f + (b.f - a.f) * u;
          }
        } else {
          const e = d - w;
          v = S + 1 + e * k + 0.1 * Math.max(0, e - 12) ** 2; // 岸から谷の斜面
          if (e < 2.5) {
            if (e < nearest) {
              nearest = e;
              levee = S + 1; // 岸は水面より 1 段高く（水があふれないように）
            }
            if (!channel) f = Math.min(f, a.f + (b.f - a.f) * u);
            bank = true;
          }
        }
        if (v < h) h = v;
      }
    }
    // 岸を盛るのは少しだけ（それより低い所では、水があふれて白く流れ落ちる）
    if (!channel && h < levee) h = Math.min(levee, Math.max(h, h0) + 3);
    h = Math.max(2, Math.round(h));
    if (channel && h >= water) water = 0;
    if (h < WATER_LEVEL) water = Math.max(water, WATER_LEVEL);
    out.h = h;
    out.water = water;
    out.channel = channel && water > 0;
    out.bank = bank && !out.channel;
    out.f = f;
    return out;
  }

  height(x, z) {
    return this.sample(x, z, this.tmp).h;
  }

  // 範囲 [x0, x1] × [z0, z1] にかかる岩。高さ（y）は地面に合わせて決める
  rocksNear(x0, z0, x1, z1) {
    this.prepare(floorDiv(x0, MOUNTAIN_CELL), floorDiv(z0, MOUNTAIN_CELL));
    this.prepare(floorDiv(x1, MOUNTAIN_CELL), floorDiv(z1, MOUNTAIN_CELL));
    const out = new Set();
    for (let bz = floorDiv(z0, BUCKET); bz <= floorDiv(z1, BUCKET); bz++) {
      for (let bx = floorDiv(x0, BUCKET); bx <= floorDiv(x1, BUCKET); bx++) {
        for (const r of this.rockBuckets.get(bucketKey(bx, bz)) ?? []) out.add(r);
      }
    }
    for (const r of out) {
      if (r.y !== null) continue;
      // 半分ほど埋まる。水の中の岩は頭を水面から出す
      const s = this.sample(Math.floor(r.x), Math.floor(r.z), {});
      r.y = s.h - 1 + r.r * r.sy * (s.water ? 0.25 : 0.05);
      if (s.water) r.y = Math.max(r.y, s.water - r.r * r.sy * 0.55);
    }
    return out;
  }
}

// 岩の形: 少しゆがんだ楕円体。(x, y, z) が岩の中なら色、外なら 0
const ROCK_TONES = [0x8f8d86, 0x85837d, 0x9a968c, 0x7b7a76, 0xa29d91, 0x88857a];
const MOSS = [0x6f8445, 0x7b8f4c];
export function rockCell(rock, x, y, z) {
  const px = x + 0.5 - rock.x, py = y + 0.5 - rock.y, pz = z + 0.5 - rock.z;
  const c = Math.cos(rock.rot), s = Math.sin(rock.rot);
  const lx = px * c + pz * s, lz = -px * s + pz * c;
  const r = rock.r;
  const ry = r * rock.sy, rz = r * rock.sz;
  let d = (lx / r) ** 2 + (py / ry) ** 2 * (py < 0 ? 0.7 : 1) + (lz / rz) ** 2;
  d += (noise2((x + rock.seed % 997) / 3.1, (z + y * 1.7) / 3.1, rock.seed) - 0.5) * (r > 3 ? 0.45 : 0.25); // ごつごつ
  if (d > 1) return 0;
  const n = hash3(x, y, z);
  const tone = ROCK_TONES[(rock.seed + floorDiv(y, 2) + (n % 3 === 0 ? 1 : 0)) % ROCK_TONES.length];
  const up = clamp(py / ry, -1, 1);
  if (up > 0.55 && r > 2.5 && noise2(x / 2.3, z / 2.3, rock.seed + 1) > 0.6) return MOSS[n % 2]; // 上に苔
  return shade(tone, 0.82 + 0.18 * up + (n % 13) / 100);
}

// ---- 色 ------------------------------------------------------------------------

const GRASS = [0x5f9a46, 0x67a34c, 0x588f41, 0x6eab52];
const DRY_GRASS = [0x86a34e, 0x7c9a48];
const ALPINE = [0x7e9150, 0x8a9a5a, 0x748a4a];
const FLOWERS = [0xf3e37c, 0xf4f1f7, 0xe58fb2];
const SAND = 0xd8c48e;
const MUD = 0x75694c;
const DIRT = 0x7a5a3c;
const ROCK = [0x8a8f98, 0x7d828b, 0x959aa2, 0x868078]; // 地層ごとに少しずつ違う
const PEBBLES = [0x9a948a, 0x8a8478, 0xb3aa98, 0x7b746a, 0xc4bba7, 0x6f6a63, 0xa49a88, 0x8e8a83];
const STONES = [0x77756f, 0x6a6964, 0x83817a, 0x5f5e5a];

// 列の情報 col: { h, water, channel, bank, f, lowland }
function surfaceColor(seed, x, z, col, slope) {
  const { h, water } = col;
  const n = hash3(x, z, seed);
  if (col.channel) {
    // 川底: 上流はごつごつした石、下流は丸い小石
    if (col.f < 0.45) return shade(STONES[(hash3(floorDiv(x, 2), floorDiv(z, 2), seed + 9) + (n & 1)) % STONES.length], 0.9 + (n % 18) / 100);
    return shade(PEBBLES[n % PEBBLES.length], 0.9 + ((n >>> 8) % 16) / 100);
  }
  if (water) {
    if (col.lowland > 0.5 && h >= WATER_LEVEL - 4) return shade(PEBBLES[n % PEBBLES.length], 0.88 + ((n >>> 8) % 14) / 100); // 平地の川の小石
    return shade(h < WATER_LEVEL - 3 ? MUD : SAND, 0.92 + (n % 16) / 100);
  }
  if (col.bank) return shade((n >>> 4) % 3 ? PEBBLES[n % PEBBLES.length] : GRASS[n % 4], 0.92 + (n % 12) / 100); // 川岸の砂利
  if (h <= WATER_LEVEL + 1) return shade(SAND, 0.94 + (n % 12) / 100); // 岸辺の砂
  // 山: 高くなるほど岩が出て、草は背の低い高山の草になる
  const alt = h - BASE;
  const rocky = alt > 130 ? smoothstep(130, 330, alt) + (noise2(x / 16, z / 16, seed + 12) - 0.5) * 1.1 : 0;
  if (slope >= 3 || rocky > 0.45) return rockColor(seed, x, h - 1, z);
  if (n % 97 === 0 && alt < 200) return FLOWERS[(n >>> 8) % FLOWERS.length];
  if (alt > 110) return shade(ALPINE[(n >>> 4) % 3], 0.92 + (n % 14) / 100);
  const patch = hash3(floorDiv(x, 4), floorDiv(z, 4), seed + 7) % 2;
  if (alt > 22) return DRY_GRASS[(n >>> 4) % 2]; // 高い所は乾いた草
  return GRASS[((n >>> 4) % 2) + patch * 2];
}

function rockColor(seed, x, y, z) {
  const band = hash3(floorDiv(y, 3), 0, seed + 8) % ROCK.length; // 3 段ごとの地層
  return shade(ROCK[band], 0.9 + (hash3(x, y, z) % 20) / 100);
}

// 列の中の高さ y のセルの色
export function groundColor(seed, x, y, z, col, slope) {
  const depth = col.h - 1 - y;
  if (depth === 0) return surfaceColor(seed, x, z, col, slope);
  if (col.channel || col.bank) return shade(STONES[hash3(x, y, z) % STONES.length], 0.9 + (hash3(x, y, z) % 14) / 100);
  if (col.h <= WATER_LEVEL + 1) return shade(depth < 3 ? SAND : MUD, 0.9 + (hash3(x, y, z) % 12) / 100);
  if (depth <= 3 && slope < 3 && col.h - BASE < 160) return shade(DIRT, 0.88 + (hash3(x, y, z) % 20) / 100); // 土の層
  return rockColor(seed, x, y, z);
}

// 水面の色: 浅い所は明るく、深い所は暗い。山の川は少し緑がかって澄んでいる
export function waterColor(x, z, depth, river = false) {
  const base = depth <= 1 ? 0x86c9c6 : depth <= 3 ? 0x5aaec4 : depth <= 6 ? 0x3d8db5 : 0x2f6d9c;
  return shade(river ? ((base & 0xfefefe) >> 1) + ((0x7cc4bc & 0xfefefe) >> 1) : base, 0.95 + (hash3(x, z, 17) % 10) / 100);
}

// 滝・早瀬の白いしぶき
const FOAM = [0xeef6f8, 0xdcecf0, 0xc8e2ea, 0xf7fbfc];
export function foamColor(x, y, z) {
  return FOAM[hash3(x, y * 31 + z, 5) % FOAM.length];
}

// テストや他のモジュール用: 地形の高さだけ
const shared = new Map();
export function terrainHeight(seed, x, z) {
  let t = shared.get(seed);
  if (!t) shared.set(seed, (t = new Terrain(seed)));
  return t.height(x, z);
}
