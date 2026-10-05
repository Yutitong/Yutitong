// 地形: 丘と平地・尾根の鋭い山（高さ 40〜60m）・山から流れ下る川・大小の岩
//
// 地面は高さマップで決まる。列 (x, z) の y < height のセルがすべて地面。
// 水面の高さは場所ごとに違う:
// - 低い所（WATER_LEVEL より低い地面）は池や、平地をゆったり蛇行する川になる
// - 山の川は山頂の近くから谷を下り、平地の池へ流れ込む。上流は狭く急で、段ごとに小さな滝になる。
//   下るにつれて幅が広く、流れがゆるやかになる
// 同じ座標からは常に同じ結果になる（世界のどこから作り始めても同じ地形）。

import { noise2, noise3, hash3, mulberry32, shade } from './rng.js';
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
      if (cut === raw.pts.length) river.pond = { x: last.x, z: last.z, S: last.S, w: 14 + rng() * 8, depth: 4, k: 0.4, f: 1, pond: true };
      placeBoulders(river, rng);
      c.rivers.push(river);
      this.register(river);
    });
  }

  // 峰 p の近くから、谷を下る川をたどる。
  // 先に道すじを決め、それを淵（同じ水面が続く所）に区切る。淵の水面はその淵の中でいちばん低い地面より少し下にするので、
  // 水が地面より高くなることはない。淵と淵の間は段（滝）になる。淵の下流の端は浅い瀬（敷居）で、水はそこからあふれて次の淵へ落ちる
  trace(p, ang, rng) {
    const s = this.seed;
    let x = p.x + Math.cos(ang) * p.R * 0.14, z = p.z + Math.sin(ang) * p.R * 0.14;
    let dx = Math.cos(ang), dz = Math.sin(ang);
    const h0 = this.baseHeight(x, z);
    if (h0 < WATER_LEVEL + 40) return null;
    const pts = [];
    let f = 0;
    for (let n = 0; n < 220; n++) {
      const h = this.baseHeight(x, z);
      f = Math.max(f, clamp(1 - (h - WATER_LEVEL) / (h0 - WATER_LEVEL), 0, 1)); // 0 = 源流 … 1 = 河口
      pts.push({ x, z, h, f });
      if (h < WATER_LEVEL + 2) break;
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
    // 淵に区切る。上流〜中流は短い淵と大きな段（岩の間を落ちる滝）、下流は長い淵と小さな段（早瀬）
    let S = Infinity;
    let end = pts.length;
    for (let i = 0; i < pts.length;) {
      const f0 = pts[i].f;
      // 淵の長さ: 段の高さが 0.6〜1.5m ほどになるように、急な所ほど短く（下流は長い淵と小さな段）
      const ahead = pts[Math.min(pts.length - 1, i + 3)];
      const slope = Math.max(0.05, (pts[i].h - ahead.h) / (3 * RIVER_STEP));
      const len = f0 < 0.8 ? clamp(Math.round((4 + rng() * 6) / (slope * RIVER_STEP)), 2, 6) : 6 + Math.floor(rng() * 7);
      const stop = Math.min(pts.length, i + len);
      let low = Infinity;
      for (let k = i; k < stop; k++) low = Math.min(low, pts[k].h - (2 + 3 * (1 - pts[k].f)));
      let level = Math.floor(Math.min(S, low));
      if (level <= WATER_LEVEL || pts[stop - 1].h < WATER_LEVEL + 2) level = WATER_LEVEL;
      const drop = S === Infinity ? 0 : S - level;
      for (let k = i; k < stop; k++) {
        const q = pts[k];
        const at = k - i;
        q.S = level;
        // 川幅の半分。源流は 1m ほど、中流で 3m、下流で 4m ほど。滝つぼは少し広い
        q.w = (2.5 + 11 * q.f ** 0.8) * (at === 0 && drop >= 2 ? 1.25 : 1);
        // 川底の深さ: 滝つぼは深く、淵の下流の端（敷居）は水面の 1 段下
        q.depth = at === stop - i - 1 ? 1
          : at === 0 ? Math.min(7, 2 + drop * 0.45)
          : at === 1 ? Math.min(5, 1.5 + drop * 0.3)
          : 2 + 1.5 * q.f;
        q.k = 1.1 - 0.75 * q.f; // 岸の斜面の急さ（上流は深い V 字の谷）
        q.step = at === 0 ? drop : 0;
      }
      S = level;
      if (level === WATER_LEVEL) {
        end = stop;
        for (let k = i; k < stop; k++) Object.assign(pts[k], { w: 12, depth: 4, k: 0.35 });
        break;
      }
      i = stop;
    }
    pts.length = end;
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
    let bank = false, f = 1;
    let levee = -Infinity, nearest = Infinity; // いちばん近い川岸の水面 + 1
    let ch = null, chOver = Infinity, chS = Infinity, chBed = 0; // この列を受け持つ川の区間
    let edge = Infinity, ex0 = 0, ez0 = 0, fEdge = 1; // 川の縁までの距離と、いちばん近い川の中心の点・上流度
    const px = x + 0.5, pz = z + 0.5;
    const list = this.riverBuckets.get(bucketKey(floorDiv(x, BUCKET), floorDiv(z, BUCKET)));
    if (list) {
      for (const seg of list) {
        const { a, b } = seg;
        // 区間 a–b への距離と、いちばん近い点の位置 u（0..1）。over: 区間の端より先にはみ出した長さ
        const ex = b.x - a.x, ez = b.z - a.z;
        const len2 = ex * ex + ez * ez;
        const t = len2 ? ((px - a.x) * ex + (pz - a.z) * ez) / len2 : 0;
        const u = clamp(t, 0, 1);
        const cx = a.x + ex * u, cz = a.z + ez * u;
        const d = Math.hypot(px - cx, pz - cz);
        const w = a.w + (b.w - a.w) * u;
        if (d > w + MAX_REACH) continue;
        const over = len2 ? Math.abs(t - u) * Math.sqrt(len2) : 0;
        // 区間の水面は下流側の点の高さ。点ごとに段になり、上の点で落ちる（滝）。
        // 下流側の点は区間でいちばん低いので、淵の水が地面より高くなることはない
        const S = b.S;
        if (d - w < edge) {
          edge = d - w;
          ex0 = cx - px;
          ez0 = cz - pz;
          fEdge = a.f + (b.f - a.f) * u;
        }
        if (d < w) {
          // 川の中: はみ出しのいちばん少ない区間（同じなら水面の低い区間）が受け持つ。
          // こうすると段（滝）は点を通る川の横断線の上にでき、上の淵の敷居が下の淵に削られない
          if (over < chOver - 1e-6 || (Math.abs(over - chOver) <= 1e-6 && S < chS)) {
            const depth = a.depth + (b.depth - a.depth) * u;
            ch = seg;
            chOver = over;
            chS = S;
            chBed = S - 1 - (depth - 1) * (1 - (d / w) ** 2); // 川底
            f = a.f + (b.f - a.f) * u;
          }
        } else if (over <= 1.5) {
          // 谷の斜面は、区間の真横だけを削る（区間の先まで削ると、急な上流で下流の谷が淵のまわりをえぐってしまう）
          const e = d - w;
          const k = a.k + (b.k - a.k) * u;
          const v = S + 1 + e * k + 0.1 * Math.max(0, e - 12) ** 2; // 岸から谷の斜面
          if (v < h) h = v;
          if (e < 2.5) {
            if (e < nearest) {
              nearest = e;
              levee = S + 1; // 岸は水面より 1 段高く（水があふれないように）
            }
            if (!ch) f = Math.min(f, a.f + (b.f - a.f) * u);
            bank = true;
          }
        }
      }
    }
    let water = 0;
    if (ch) {
      h = Math.min(h, chBed);
      water = chS;
    } else if (h < levee) {
      // 岸を盛るのは少しだけ（それより低い所では、水があふれて流れ落ちる）
      h = Math.min(levee, h0 + 3);
    }
    h = Math.max(2, Math.round(h));
    if (ch && h >= water) water = 0;
    if (h < WATER_LEVEL) water = Math.max(water, WATER_LEVEL);
    out.h = h;
    out.water = water;
    out.channel = Boolean(ch) && water > 0;
    out.bank = bank && !out.channel;
    out.pond = out.channel && ch.a === ch.b;
    out.f = ch || bank ? f : fEdge; // 川のそばの地面は、いちばん近い川の上流度
    // 川の縁までの距離（川の中は負）と、川の中心への向き
    out.edge = edge;
    const el = Math.hypot(ex0, ez0) || 1;
    out.toX = ex0 / el;
    out.toZ = ez0 / el;
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
      // 川底や岸に、少し埋まって座る
      const s = this.sample(Math.floor(r.x), Math.floor(r.z), {});
      r.y = s.h - 1 + r.r * r.sy * r.sink;
      r.wet = s.water; // この高さより下は濡れて暗い
    }
    return out;
  }
}

// ---- 川の岩 ----------------------------------------------------------------------

// 川の岩を置く。上流〜中流は大きな丸い花崗岩が転がる渓流、下流は小石が中心
// - 段（滝）の落ち口: 岩が川を横切って並び、間の 1 か所（落ち口）を水が抜けて落ちる
// - 岸: 半分川に入った大岩。ところどころに 4〜6m の巨岩
// - 川底: 水をかぶる丸い石
function placeBoulders(river, rng) {
  const { pts } = river;
  const put = (a, b, along, side, r, opts = {}) => {
    const ax = b.x - a.x, az = b.z - a.z;
    const al = Math.hypot(ax, az) || 1;
    const ca = rng() * Math.PI * 2;
    river.rocks.push({
      x: a.x + ax * along - (az / al) * side,
      z: a.z + az * along + (ax / al) * side,
      r, sy: opts.sy ?? 0.58 + rng() * 0.22, sz: opts.sz ?? 0.8 + rng() * 0.35, rot: rng() * Math.PI,
      seed: Math.floor(rng() * 2 ** 31), sink: opts.sink ?? 0.32, y: null, wet: 0,
      // 割れ目: 岩を縦に通る面（ない岩もある）
      crack: r > 3.5 && rng() < 0.5 ? [Math.cos(ca), (rng() - 0.5) * 0.5, Math.sin(ca), (rng() - 0.5) * r * 0.6] : null,
    });
  };
  const extent = (r, sz) => r * Math.max(1, sz);
  for (let n = 1; n < pts.length; n++) {
    const q = pts[n], prev = pts[n - 1];
    const up = 1 - q.f;
    const gorge = q.f > 0.03 && q.f < 0.9; // 上流〜中流
    if (gorge && q.step >= 2) {
      // 落ち口の岩の列。落ち口（幅 3〜6）は空けておく
      const g = (rng() * 2 - 1) * prev.w * 0.4;
      const half = 1.5 + rng() * 1.5;
      for (const side of [-1, 1]) {
        let off = g + side * half;
        for (let m = 0; m < 4 && Math.abs(off) < prev.w + 2; m++) {
          const r = 3 + rng() * (4 + 7 * up);
          const sz = 0.8 + rng() * 0.3;
          const R = extent(r, sz);
          const lat = off + side * R * 1.02;
          put(prev, q, 0.1 + rng() * 0.2, lat, r, { sz });
          off = lat + side * R * 0.75;
        }
      }
    }
    if (gorge && rng() < 0.08 + 0.25 * up) {
      // 岸の大岩（川には幅の半分より奥へは入らない）
      const r = 3 + rng() ** 2 * (4 + 7 * up);
      const sz = 0.8 + rng() * 0.35;
      const side = rng() < 0.5 ? -1 : 1;
      put(prev, q, rng(), side * (q.w * 0.5 + extent(r, sz) * 0.95 + rng() * 2), r, { sz });
    }
    if (gorge && q.f > 0.15 && rng() < 0.02) {
      // 巨岩（直径 4〜6m）。淵の脇にどっしり座る
      const r = 13 + rng() * 7;
      const sz = 0.85 + rng() * 0.25;
      const side = rng() < 0.5 ? -1 : 1;
      put(prev, q, rng(), side * (q.w * 0.55 + extent(r, sz) * 0.9), r, { sz, sy: 0.55 + rng() * 0.15, sink: 0.25 });
    }
    // 川底の丸い石（水をかぶる）。下流ほど少なく小さい
    const cobbles = rng() < 0.3 + 0.5 * up ? 1 + (rng() < up ? 1 : 0) : 0;
    for (let m = 0; m < cobbles; m++) {
      put(prev, q, rng(), (rng() * 2 - 1) * q.w * 0.85, 1.2 + rng() * (0.8 + 1.5 * up), { sy: 0.5 + rng() * 0.15, sink: 0.3 });
    }
  }
}

// 岩の形: 角の丸い塊（大きな岩ほど角ばって丸い）に、ゆるいうねりと割れ目。(x, y, z) が岩の中か
export function rockInside(rock, x, y, z) {
  const px = x + 0.5 - rock.x, py = y + 0.5 - rock.y, pz = z + 0.5 - rock.z;
  const c = Math.cos(rock.rot), s = Math.sin(rock.rot);
  const lx = px * c + pz * s, lz = -px * s + pz * c;
  const r = rock.r, ry = r * rock.sy, rz = r * rock.sz;
  if (py < -ry * 0.6) return false; // 底は平ら
  const big = r > 4;
  const pw = big ? 2.6 : 2;
  let d = (Math.abs(lx / r) ** pw + Math.abs(py / ry) ** pw + Math.abs(lz / rz) ** pw) ** (2 / pw);
  const sc = big ? r * 0.45 : 2.6;
  d += (noise3(px / sc, py / sc, pz / sc, rock.seed % 9973) - 0.5) * (big ? 0.22 : 0.35);
  if (d > 1) return false;
  if (rock.crack && d > 0.4) {
    const [nx, ny, nz, off] = rock.crack;
    if (Math.abs(px * nx + py * ny + pz * nz - off) < 0.6) return false; // 割れ目の溝
  }
  return true;
}

// 花崗岩の色: 白っぽい灰色に黒と白の粒、縦に流れる黒い水跡、割れ目のまわりの影、
// 水に濡れた所は暗く、上の面には苔が生える
const GRANITE = [0xb8b3a8, 0xaba69c, 0xc2bdb2, 0xa29e95, 0xb0aaa0];
const MOSS = [0x5c7a37, 0x6a893e, 0x4d6b31, 0x789444, 0x587233];
export function boulderColor(rock, x, y, z) {
  const px = x + 0.5 - rock.x, py = y + 0.5 - rock.y, pz = z + 0.5 - rock.z;
  const ry = rock.r * rock.sy;
  const up = clamp(py / ry, -1, 1);
  const n = hash3(x, y, z);
  if (rock.r > 2.5 && up > 0.25) {
    const m = noise2(x / 3.2 + (rock.seed % 97), z / 3.2 + y * 0.2, rock.seed);
    if (m > 0.62 - 0.35 * (up - 0.25)) return shade(MOSS[n % MOSS.length], 0.9 + (n % 14) / 100); // 苔
  }
  if (n % 19 === 0) return 0x4b4844; // 黒い粒
  if (n % 23 === 1) return 0xe4e0d6; // 白い粒
  let f = 0.84 + 0.16 * up + ((n >>> 5) % 10) / 100 + (noise3(x / 4, y / 4, z / 4, rock.seed % 991) - 0.5) * 0.16;
  if (up < 0.6 && hash3(x, 7, z ^ rock.seed) % 7 === 0) f *= 0.62; // 縦の水跡
  if (rock.crack) {
    const [nx, ny, nz, off] = rock.crack;
    if (Math.abs(px * nx + py * ny + pz * nz - off) < 1.5) f *= 0.62;
  }
  let tone = GRANITE[(rock.seed + (n % 5 === 0 ? 1 : 0)) % GRANITE.length];
  if (rock.wet && y < rock.wet + 1) {
    f *= 0.7; // 濡れて暗く、少し緑がかる
    tone = 0x9aa088;
  }
  if (n % 47 === 0 && up > 0) return 0xc6caa2; // 地衣類
  return shade(tone, f);
}

// ---- シダ ------------------------------------------------------------------------

// 列 (x, z) を中心にシダが生えるか（川の近くの湿った所、ばらばらに）
export function fernAt(seed, x, z, col) {
  if (col.water || col.channel || col.edge > 14 || col.edge < 0.5 || col.f > 0.95) return false;
  return hash3(x, z, seed + 61) % 1000 < 70 + 60 * (1 - col.edge / 14);
}

// シダの形: 中心から 5〜7 枚の葉が弧を描いて垂れる。[dx, dy, dz, 色] のリスト（高さは 2 まで）
const FERN = [0x3f7a2c, 0x4f8d33, 0x5c9b3a, 0x6aa842, 0x356b27];
export function fernCells(seed, x, z) {
  const h = hash3(x, z, seed + 62);
  const rng = mulberry32(h);
  const cells = new Map();
  const n = 5 + Math.floor(rng() * 3);
  const a0 = rng() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const L = 2.5 + rng() * 2.5;
    for (let t = 0; t <= 1; t += 0.12) {
      const r = L * t;
      const dy = Math.round(2 * Math.sin(Math.PI * Math.min(1, t * 1.25)) * (1 - 0.25 * t));
      const dx = Math.round(Math.cos(a) * r), dz = Math.round(Math.sin(a) * r);
      cells.set(`${dx},${dy},${dz}`, [dx, Math.max(0, Math.min(2, dy)), dz, shade(FERN[Math.floor(t * 4.9) % FERN.length], 0.9 + rng() * 0.2)]);
    }
  }
  return [...cells.values()];
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
const RIVERBED = [0xa8a296, 0x9c968a, 0xb5afa2, 0x8c877d, 0xc2bcaf, 0x7f7a71, 0x968f80]; // 花崗岩の丸い石と砂利
const MOSSY = [0x4f7a35, 0x5d8a3c, 0x46703a, 0x3e6a33, 0x557f37]; // 川沿いの湿った地面の苔

// 列の情報 col: { h, water, channel, bank, f, lowland }
function surfaceColor(seed, x, z, col, slope) {
  const { h, water } = col;
  const n = hash3(x, z, seed);
  if (col.channel) {
    // 川底: 上流〜中流は花崗岩の丸い石と砂利（深い所は苔で緑がかる）、下流は丸い小石
    const deep = col.water - h;
    if (col.f < 0.9) {
      const stone = RIVERBED[(hash3(floorDiv(x, 2), floorDiv(z, 2), seed + 9) + (n & 1)) % RIVERBED.length];
      return shade(deep >= 4 ? ((stone & 0xfefefe) >> 1) + ((0x5b6e4a & 0xfefefe) >> 1) : stone, 0.88 + (n % 16) / 100);
    }
    return shade(PEBBLES[n % PEBBLES.length], 0.9 + ((n >>> 8) % 16) / 100);
  }
  if (water) {
    if (col.lowland > 0.5 && h >= WATER_LEVEL - 4) return shade(PEBBLES[n % PEBBLES.length], 0.88 + ((n >>> 8) % 14) / 100); // 平地の川の小石
    return shade(h < WATER_LEVEL - 3 ? MUD : SAND, 0.92 + (n % 16) / 100);
  }
  if (col.bank) {
    // 川岸: 渓流は濡れた砂利と苔、下流は小石の河原
    if (col.f < 0.9) return shade((n >>> 4) % 3 ? RIVERBED[n % RIVERBED.length] : MOSSY[n % MOSSY.length], 0.8 + (n % 12) / 100);
    return shade((n >>> 4) % 3 ? PEBBLES[n % PEBBLES.length] : GRASS[n % 4], 0.92 + (n % 12) / 100);
  }
  // 渓流の谷の急な斜面は、苔と草におおわれた岩
  if (col.edge < 45 && col.f < 0.9 && slope >= 3) return gorgeWall(seed, x, h - 1, z);
  // 渓流沿いの湿った地面は苔むす（ところどころ黒い土）
  if (col.edge < 12 && col.f < 0.9) {
    if (n % 9 === 0) return shade(0x4a3a2a, 0.9 + (n % 10) / 100);
    return shade(MOSSY[(n >>> 3) % MOSSY.length], 0.88 + (n % 16) / 100);
  }
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

// 渓流の谷の岩壁: 濡れた暗い岩に、苔と草がまだらに生える
const WET_ROCK = [0x6d6c64, 0x5f5e57, 0x77756b, 0x666a5e];
function gorgeWall(seed, x, y, z) {
  const n = hash3(x, y, z);
  const m = noise3(x / 4.5, y / 3, z / 4.5, seed + 71);
  if (m > 0.5) return shade(MOSSY[n % MOSSY.length], 0.85 + (n % 18) / 100);
  if (m > 0.44) return shade(0x4a3a2a, 0.9 + (n % 10) / 100); // 土
  return shade(WET_ROCK[(n >>> 3) % WET_ROCK.length], 0.88 + (n % 16) / 100);
}

function rockColor(seed, x, y, z) {
  const band = hash3(floorDiv(y, 3), 0, seed + 8) % ROCK.length; // 3 段ごとの地層
  return shade(ROCK[band], 0.9 + (hash3(x, y, z) % 20) / 100);
}

// ---- 掘れる土 ------------------------------------------------------------------

export const SOIL_DEPTH = 5; // 土の層の厚さ（ボクセル ≈ 75cm）。その下は岩

// 地面のセル (x, y, z) が、シャベルで掘れる土・砂・砂利か（岩なら false）。
// col は掘る前の地形（world.sample の結果）、slope はまわりとの高さの差
export function isSoil(seed, x, y, z, col, slope) {
  const depth = col.h - 1 - y;
  if (depth < 0) return true; // もとの地面より上（盛った土）
  if (col.channel || col.bank) return depth <= 2; // 川底・岸の砂利
  if (col.h <= WATER_LEVEL + 1) return depth <= 6; // 水辺の砂と泥
  if (slope >= 3) return false; // 急な所は岩肌
  const alt = col.h - BASE;
  if (alt > 130 && smoothstep(130, 330, alt) + (noise2(x / 16, z / 16, seed + 12) - 0.5) * 1.1 > 0.45) return false; // 山の上の岩場
  if (col.edge < 45 && col.f < 0.9) return depth <= 2; // 渓流の谷: 苔と土の下はすぐ岩
  return depth <= SOIL_DEPTH && alt < 160;
}

// 盛った土の色（掘り返した、黒っぽい柔らかい土）
const LOOSE = [0x6b4f35, 0x5f4630, 0x76573a, 0x664a32];
export function soilColor(x, y, z) {
  const n = hash3(x, y, z);
  return shade(LOOSE[n % LOOSE.length], 0.9 + (n % 16) / 100);
}

// 列の中の高さ y のセルの色
export function groundColor(seed, x, y, z, col, slope) {
  const depth = col.h - 1 - y;
  if (depth === 0) return surfaceColor(seed, x, z, col, slope);
  if ((col.channel || col.bank) && (col.f >= 0.9 || depth <= 1)) return shade(RIVERBED[hash3(x, y, z) % RIVERBED.length], 0.78 + (hash3(x, y, z) % 14) / 100);
  if (col.edge < 45 && col.f < 0.9) return gorgeWall(seed, x, y, z); // 渓流の谷の斜面の側面
  if (col.h <= WATER_LEVEL + 1) return shade(depth < 3 ? SAND : MUD, 0.9 + (hash3(x, y, z) % 12) / 100);
  if (depth <= SOIL_DEPTH && slope < 3 && col.h - BASE < 160) return shade(DIRT, 0.88 + (hash3(x, y, z) % 20) / 100); // 土の層
  return rockColor(seed, x, y, z);
}

// 水面の色と透け具合（色の 25〜28 ビットに不透明度 0..15 を入れる。0 は既定の不透明度）。
// 山の川は澄んでいて、浅い所は川底の石がよく透け、深い淵はエメラルド色。平地の水は青く、あまり透けない
export const ALPHA_SHIFT = 25;
export const withAlpha = (rgb, a) => (rgb & 0xffffff) | (Math.round(a * 15) << ALPHA_SHIFT);
const CLEAR = [[1, 0xb4e3d6, 0.22], [2, 0x93d6c6, 0.32], [4, 0x5fb9a6, 0.45], [6, 0x349683, 0.58], [Infinity, 0x1f7465, 0.7]];
export function waterColor(x, z, depth, river = false) {
  const f = 0.96 + (hash3(x, z, 17) % 8) / 100;
  if (river) {
    const [, rgb, a] = CLEAR.find(([d]) => depth <= d);
    return withAlpha(shade(rgb, f), a);
  }
  const base = depth <= 1 ? 0x86c9c6 : depth <= 3 ? 0x5aaec4 : depth <= 6 ? 0x3d8db5 : 0x2f6d9c;
  return withAlpha(shade(base, f), depth <= 1 ? 0.45 : 0.68);
}

// 滝・早瀬の白いしぶき
const FOAM = [0xeef6f8, 0xdcecf0, 0xc8e2ea, 0xf7fbfc];
export function foamColor(x, y, z) {
  return FOAM[hash3(x, y * 31 + z, 5) % FOAM.length];
}

// 落ちていく水（滝）の色。t が進むと模様が下へずれていくので、水が落ちて見える
const FALLS = [0xf4f9f9, 0xe1eff0, 0xc9e4e6, 0xeaf5f4, 0xb1dbda, 0xffffff];
export function fallColor(x, y, z, t) {
  const k = hash3(x, z, 9);
  const v = y + Math.floor(t * 14) + (k & 15); // 1 秒に 14 ボクセル落ちる模様
  const c = FALLS[hash3(k & 255, v, 3) % FALLS.length];
  return withAlpha(c, (hash3(x + v, z, 4) & 3) === 0 ? 0.55 : 0.88) | 0x1000000; // 水（半透明）の印つき
}

// テストや他のモジュール用: 地形の高さだけ
const shared = new Map();
export function terrainHeight(seed, x, z) {
  let t = shared.get(seed);
  if (!t) shared.set(seed, (t = new Terrain(seed)));
  return t.height(x, z);
}
