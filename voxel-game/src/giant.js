// 巨大樹: セコイアのような、樹高およそ 100m（600〜710 ボクセル）・根元の直径およそ 10m の木。巨大樹の森に林立する
//
// - 幹: 赤褐色で、縦に深い溝が走る。根元は板のように張り出して広がる（根張り）。上へ行くほど細い。根元の北側には苔
// - 枝と葉: 高さ 4 割より上にだけ、短めの枝を四方へ張り、枝先に暗い緑の葉の塊がつく。樹冠は不規則な丸みのある塔の形
// - 巨大樹の森: 出発地点のそばの平地に 1 つと、世界のあちこちの平地に。20〜40m おきに立つ。林床は落ち葉と苔とシダで、ふつうの木は生えない
//
// 1 本で数十万ボクセルあるので、セルの一覧は持たない。形を数式で持ち、チャンクを作るときに、そのチャンクにかかる所だけを塗る。
// 斧の切り込み・光線の穴・焦げ跡は「変えたセル」として木ごとに覚えておき、チャンクを作り直しても残る。
// 斧で切り倒せる。倒れていく間は、見えているセルをまとめて回して描き、地面に着いたら倒木として形から塗り直す

import { CHUNK, HEIGHT, LAYER, floorDiv, chunkKey, chunkKeyAt } from './grid.js';
import { mulberry32, hash3, noise2, noise3, shade } from './rng.js';
import { BASE } from './terrain.js';
import { redrawBody } from './body.js';
import { EMPTY, GROUND_ID } from './ids.js';

export const GIANT_CELL = 210; // この区画ごとに最大 1 本（≈ 30m おき）
const MARGIN = 50; // 区画の端からの距離（となりの木と幹がくっつかないように）
export const GIANT_REACH = 150; // 幹の中心から枝葉の先までの最大の水平距離
const INTERIOR = -1; // 中のセル（占有するが見えない）
const NOTCH_H = 4; // 斧の切り込みの高さ
const NOTCH_STEP = 1.6; // 1 回で切り込む深さ
const FELL_AT = 0.62; // 幹の太さのこの割合まで切り込むと倒れる
const GRAVITY = 65;

const BARK = [0x8c4a2c, 0x9a5532, 0x7f4228, 0x93502e];
const MOSS = 0x56693a;
const WOOD = 0x6b3a24;
const HEART = 0xa8482c;
const SAP = 0xd8ac7a;
const LEAVES = [0x3a6232, 0x46703a, 0x335a2d, 0x507d40, 0x3f6835];
const LITTER = [0x5a4430, 0x4d3a28, 0x63503a, 0x4a3a2a];
const FOREST_MOSS = [0x4f6236, 0x5b6e3c];
const CHAR = [0x2a221d, 0x332820, 0x1f1a17];

const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- 巨大樹の森の場所 ---------------------------------------------------------------

// 出発地点のそばの、平らで水の少ない所（巨大樹の森の中心）。地形だけで決まる
function grove(world) {
  if (world.giantGrove !== undefined) return world.giantGrove;
  let best = null, bestScore = Infinity;
  for (let k = 0; k < 64; k++) {
    const a = ((k % 16) / 16) * Math.PI * 2;
    const dist = 560 + 120 * Math.floor(k / 16);
    const cx = Math.round(Math.cos(a) * dist), cz = Math.round(Math.sin(a) * dist);
    const hs = [];
    let wet = 0;
    for (let dz = -300; dz <= 300; dz += 60) {
      for (let dx = -300; dx <= 300; dx += 60) {
        if (dx * dx + dz * dz > 300 * 300) continue;
        const s = world.sample(cx + dx, cz + dz, {});
        hs.push(s.h);
        // 水辺（池・川・水面すれすれの低地）は巨大樹が立てないので避ける
        if (s.water || s.channel || s.bank || s.edge < 60 || s.h < world.waterLevel + 4) wet++;
      }
    }
    const mean = hs.reduce((p, q) => p + q, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((p, q) => p + (q - mean) ** 2, 0) / hs.length);
    const score = wet * 6 + sd + Math.max(0, mean - BASE - 40) + (dist - 560) / 60;
    if (score < bestScore) {
      bestScore = score;
      best = [cx, cz];
    }
  }
  world.giantGrove = best;
  return best;
}

// (x, z) が巨大樹の森である度合い 0..1（h: 地面の高さ）。山の上にはない
export function giantZone(world, x, z, h = world.heightAt(x, z)) {
  if (!world.terrain) return 0;
  const g = grove(world);
  const near = g ? smoothstep(520, 340, Math.hypot(x - g[0], z - g[1])) : 0;
  const far = smoothstep(0.64, 0.72, noise2(x / 1500, z / 1500, world.seed + 0x77));
  // 出発地点のまわり（45m ほど）はふつうの森のまま
  return Math.max(near, far) * smoothstep(95, 40, h - BASE) * smoothstep(240, 300, Math.hypot(x, z));
}

// 区画 (gx, gz) に立つ巨大樹の設計図（なければ null）
export function giantSpec(world, gx, gz) {
  world.giantSpecs ??= new Map();
  const key = chunkKey(gx, gz);
  if (world.giantSpecs.has(key)) return world.giantSpecs.get(key);
  let spec = null;
  if (world.terrain) {
    const rng = mulberry32(hash3(gx, gz, world.seed ^ 0x6a17));
    const roll = rng();
    const H = 600 + Math.floor(rng() * 110), R = 27 + rng() * 5;
    const lean = [(rng() - 0.5) * 0.04, (rng() - 0.5) * 0.04];
    // 区画の中で、立てられる所を何か所か試す（低地には小さな池が多いので）
    for (let k = 0; k < 8 && !spec; k++) {
      const x = gx * GIANT_CELL + MARGIN + Math.floor(rng() * (GIANT_CELL - 2 * MARGIN));
      const z = gz * GIANT_CELL + MARGIN + Math.floor(rng() * (GIANT_CELL - 2 * MARGIN));
      const col = world.sample(x, z, {});
      const zone = giantZone(world, x, z, col.h);
      if (roll >= zone * 1.15 || col.water || col.channel || col.bank || col.pond || col.edge <= 70 || col.h <= world.waterLevel + 1) continue;
      // 根元のまわりの地面の一番低い所と高い所。傾きすぎた所や水辺には立たない
      let lo = col.h, hi = col.h, wet = false;
      for (let j = 0; j < 8 && !wet; j++) {
        const a = (j / 8) * Math.PI * 2;
        const s = world.sample(Math.round(x + Math.cos(a) * 34), Math.round(z + Math.sin(a) * 34), {});
        lo = Math.min(lo, s.h);
        hi = Math.max(hi, s.h);
        if (s.water || s.channel) wet = true;
      }
      if (hi - lo >= 30 || wet) continue;
      spec = { key, gx, gz, x, z, y: lo - 2, H, R, lean, seed: hash3(gx, gz, world.seed + 0x9a) };
    }
  }
  world.giantSpecs.set(key, spec);
  return spec;
}

// 範囲 [x0, x1] × [z0, z1] に枝葉が届きうる巨大樹の設計図
export function giantSpecsNear(world, x0, z0, x1, z1) {
  const out = [];
  if (!world.terrain) return out;
  for (let gz = floorDiv(z0 - GIANT_REACH, GIANT_CELL); gz <= floorDiv(z1 + GIANT_REACH, GIANT_CELL); gz++) {
    for (let gx = floorDiv(x0 - GIANT_REACH, GIANT_CELL); gx <= floorDiv(x1 + GIANT_REACH, GIANT_CELL); gx++) {
      const s = giantSpec(world, gx, gz);
      if (s && s.x + GIANT_REACH >= x0 && s.x - GIANT_REACH <= x1 && s.z + GIANT_REACH >= z0 && s.z - GIANT_REACH <= z1) out.push(s);
    }
  }
  return out;
}

// 巨大樹（1 本につき 1 つ）。切ったり焦げたりした木は、チャンクを片付けても覚えておく
export function getGiant(world, spec) {
  world.giants ??= new Map();
  let g = world.giants.get(spec.key);
  if (g) return g;
  g = { spec, id: world.nextId++, edits: new Map(), shape: null, cut: null, falling: null, fallen: null };
  world.entities.set(g.id, {
    id: g.id, kind: 'terrain', name: 'セコイア', priority: Infinity, giant: g,
    pos: [spec.x, spec.y, spec.z], offsets: new Int16Array(0), colors: new Uint32Array(0),
  });
  world.giants.set(spec.key, g);
  return g;
}

// ---- 形 ----------------------------------------------------------------------

const GRID = 16; // 枝と葉の塊を引くための格子（ボクセル）
const GH = Math.ceil((2 * GIANT_REACH) / GRID);

function distToSegment(px, py, pz, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (a[0] + abx * t), dy = py - (a[1] + aby * t), dz = pz - (a[2] + abz * t);
  return [Math.sqrt(dx * dx + dy * dy + dz * dz), t];
}

// 形を作る（座標は幹の根元の中心が原点。y は根元からの高さ）。遠景でも使うので、設計図ごとに覚えておく
function shapeOf(g) {
  if (g.shape) return g.shape;
  g.shape = shapeOfSpec(g.spec);
  return g.shape;
}
const shapes = new Map(); // 設計図 → 形（最近使ったもの）
function shapeOfSpec(spec) {
  const cached = shapes.get(spec);
  if (cached) return cached;
  if (shapes.size > 400) shapes.delete(shapes.keys().next().value);
  const rng = mulberry32(spec.seed);
  const H = spec.H, R = spec.R;
  const n = H + 32;
  const axX = new Float32Array(n), axZ = new Float32Array(n), rad = new Float32Array(n), flare = new Float32Array(n);
  const bendA = rng() * Math.PI * 2, bend = 4 + rng() * 6;
  let trunkReach = 0, axMax = 0;
  for (let h = 0; h < n; h++) {
    const t = Math.min(1, h / H);
    axX[h] = spec.lean[0] * h + Math.cos(bendA) * bend * Math.sin(Math.PI * t);
    axZ[h] = spec.lean[1] * h + Math.sin(bendA) * bend * Math.sin(Math.PI * t);
    rad[h] = Math.max(2.5, R * (1 - 0.86 * t ** 1.05));
    flare[h] = R * 0.62 * Math.exp(-h / 20);
    trunkReach = Math.max(trunkReach, Math.hypot(axX[h], axZ[h]) + rad[h] + flare[h] + 3);
    axMax = Math.max(axMax, Math.hypot(axX[h], axZ[h]));
  }
  const S = {
    H, n, axX, axZ, rad, flare, trunkReach, axMax: axMax + 0.5,
    furrows: 22 + Math.floor(rng() * 8), lobes: 5 + Math.floor(rng() * 3), lobePh: rng() * Math.PI * 2,
    parts: [], grid: null, gny: Math.ceil((n + 60) / GRID),
    reachAt: new Float32Array(n + 60), crownLo: Infinity, top: n,
  };
  // 樹冠の広がり（高さの割合 t → 半径）。下と上は細く、なかほどが太い
  const crownR = (t) => 92 * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.36) / 0.68)))) ** 0.7 + 8;
  const branch = (a, b, ra, rb) => S.parts.push({ b: true, a, e: b, ra, rb });
  const clump = (c, r) => S.parts.push({ b: false, c, r, inv: r.map((v) => 1 / v), invMin: 1 / Math.min(...r), seed: rng() * 100 });
  const crownBase = 0.4 * H;
  const NB = 62 + Math.floor(rng() * 18);
  for (let k = 0; k < NB; k++) {
    const u = (k + rng() * 0.8) / NB;
    const h = crownBase + (H - 24 - crownBase) * u;
    const t = h / H;
    const hi = Math.round(h);
    const az = k * 2.39996 + rng() * 0.7; // 黄金角でばらす
    const reach = crownR(t) * (0.65 + rng() * 0.35);
    const ca = Math.cos(az), sa = Math.sin(az);
    const start = [axX[hi] + ca * rad[hi] * 0.6, h, axZ[hi] + sa * rad[hi] * 0.6];
    const elev = t < 0.62 ? -0.15 + rng() * 0.25 : 0.05 + rng() * 0.35; // 下の枝は少し垂れ、上の枝は上を向く
    const end = [axX[hi] + ca * reach, h + Math.sin(elev) * reach, axZ[hi] + sa * reach];
    branch(start, end, 2.2 + 2.4 * (1 - u), 1.2);
    for (const f of [0.38, 0.6, 0.82, 1]) {
      if (f < 0.5 && rng() < 0.5) continue;
      const p = [start[0] + (end[0] - start[0]) * f + (rng() - 0.5) * 8, start[1] + (end[1] - start[1]) * f + 2 + rng() * 4, start[2] + (end[2] - start[2]) * f + (rng() - 0.5) * 8];
      const s = (10 + rng() * 8) * (0.75 + (0.45 * crownR(t)) / 100);
      clump(p, [s * (0.9 + rng() * 0.3), s * 0.55 * (0.8 + rng() * 0.4), s * (0.9 + rng() * 0.3)]);
    }
  }
  // 幹のまわりの葉（樹冠の中が透けて見えないように）と、てっぺん
  for (let k = 0; k < 22; k++) {
    const h = crownBase + 30 + rng() * (H - crownBase - 60);
    const hi = Math.round(h), az = rng() * Math.PI * 2;
    const d = rad[hi] + 8 + rng() * 14;
    const s = 13 + rng() * 6;
    clump([axX[hi] + Math.cos(az) * d, h, axZ[hi] + Math.sin(az) * d], [s, s * 0.6, s]);
  }
  for (let k = 0; k < 5; k++) {
    const h = H - 26 + k * 7;
    const hi = Math.min(n - 1, Math.round(h));
    const s = 15 - k * 2.2;
    clump([axX[hi] + (rng() - 0.5) * 4, h, axZ[hi] + (rng() - 0.5) * 4], [s, s * 0.75, s]);
  }
  // 格子に登録し、高さごとの水平の届く距離を求める
  for (let h = 0; h < S.reachAt.length; h++) S.reachAt[h] = h < n ? Math.hypot(axX[h], axZ[h]) + rad[h] + flare[h] + 3 : 0;
  for (const p of S.parts) {
    let lo, hi;
    if (p.b) {
      const r = Math.max(p.ra, p.rb);
      lo = [Math.min(p.a[0], p.e[0]) - r, Math.min(p.a[1], p.e[1]) - r, Math.min(p.a[2], p.e[2]) - r];
      hi = [Math.max(p.a[0], p.e[0]) + r, Math.max(p.a[1], p.e[1]) + r, Math.max(p.a[2], p.e[2]) + r];
    } else {
      lo = p.c.map((v, i) => v - p.r[i] * 1.25);
      hi = p.c.map((v, i) => v + p.r[i] * 1.25);
    }
    p.lo = lo;
    p.hi = hi;
    S.crownLo = Math.min(S.crownLo, Math.floor(lo[1]));
    S.top = Math.max(S.top, Math.ceil(hi[1]) + 1);
    const far = Math.max(Math.abs(lo[0]), Math.abs(hi[0]), Math.abs(lo[2]), Math.abs(hi[2]));
    for (let h = Math.max(0, Math.floor(lo[1])); h <= Math.min(S.reachAt.length - 1, Math.ceil(hi[1])); h++) S.reachAt[h] = Math.max(S.reachAt[h], far + 2);
  }
  S.top = Math.min(S.top, S.reachAt.length - 1);
  shapes.set(spec, S);
  return S;
}

// 枝と葉の塊を引くための格子（倒木を塗るときなど、セルごとに形を調べるときだけ作る）
function gridOf(S) {
  if (S.grid) return S.grid;
  S.grid = new Array(GH * GH * S.gny);
  for (const p of S.parts) {
    const { lo, hi } = p;
    for (let gy = Math.max(0, Math.floor(lo[1] / GRID)); gy <= Math.min(S.gny - 1, Math.floor(hi[1] / GRID)); gy++) {
      for (let gz = Math.max(0, Math.floor((lo[2] + GIANT_REACH) / GRID)); gz <= Math.min(GH - 1, Math.floor((hi[2] + GIANT_REACH) / GRID)); gz++) {
        for (let gx = Math.max(0, Math.floor((lo[0] + GIANT_REACH) / GRID)); gx <= Math.min(GH - 1, Math.floor((hi[0] + GIANT_REACH) / GRID)); gx++) {
          const i = gx + GH * (gz + GH * gy);
          (S.grid[i] ??= []).push(p);
        }
      }
    }
  }
  return S.grid;
}

// 幹の、高さ h（整数）・向き th の半径（根張り・縦の溝つき）と、溝の深さ -1..1（1 が山）
function trunkRadius(S, h, th) {
  const fl = S.flare[h] * (0.55 + 0.45 * Math.cos(S.lobes * th + S.lobePh));
  const ridge = 1 - 2 * Math.abs(Math.sin(th * S.furrows * 0.5 + 0.6 * Math.sin(h / 37 + th * 3)));
  return [S.rad[h] + fl + ridge * Math.min(1.2, S.rad[h] * 0.05), ridge];
}

// 位置 (lx, ly, lz)（根元の中心からの相対位置。セルの中心）が木のどこか。
// 戻り値: 0 = 木ではない、INTERIOR = 中（占有するが見えない）、それ以外 = 見える面の色
function classify(S, seed, lx, ly, lz) {
  const hI = Math.floor(ly);
  if (hI >= -6 && hI <= S.H) {
    const h = Math.max(0, hI);
    const dx = lx - S.axX[h], dz = lz - S.axZ[h];
    const d2 = dx * dx + dz * dz;
    const rm = S.rad[h] * 1.06 + S.flare[h] + 1.3;
    if (d2 < rm * rm) {
      const d = Math.sqrt(d2), th = Math.atan2(dz, dx);
      const [rEff, ridge] = trunkRadius(S, h, th);
      if (d <= rEff) {
        if (d <= rEff - 1.7) return INTERIOR;
        return barkColor(seed, h, th, ridge, Math.round(lx), hI, Math.round(lz));
      }
    }
  }
  if (lx < -GIANT_REACH || lx >= GIANT_REACH || lz < -GIANT_REACH || lz >= GIANT_REACH || ly < 0) return 0;
  const gy = Math.floor(ly / GRID);
  if (gy >= S.gny) return 0;
  const list = gridOf(S)[Math.floor((lx + GIANT_REACH) / GRID) + GH * (Math.floor((lz + GIANT_REACH) / GRID) + GH * gy)];
  if (!list) return 0;
  let leaf = 0, inner = false;
  for (const p of list) {
    if (lx < p.lo[0] || lx > p.hi[0] || ly < p.lo[1] || ly > p.hi[1] || lz < p.lo[2] || lz > p.hi[2]) continue;
    if (p.b) {
      const [d, t] = distToSegment(lx, ly, lz, p.a, p.e);
      if (d <= p.ra + (p.rb - p.ra) * t) return shade(WOOD, 0.85 + (hash3(Math.round(lx), Math.round(ly), Math.round(lz)) % 25) / 100);
      continue;
    }
    const qx = (lx - p.c[0]) * p.inv[0], qy = (ly - p.c[1]) * p.inv[1], qz = (lz - p.c[2]) * p.inv[2];
    let q = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (q > 1.2) continue;
    q += (noise3(lx * 0.21 + p.seed, ly * 0.21, lz * 0.21) - 0.5) * 0.32;
    if (q > 1) continue;
    if (q > 1 - 1.35 * p.invMin - 0.08) {
      if (!leaf) leaf = leafColor(qy, Math.round(lx), Math.round(ly), Math.round(lz));
    } else {
      inner = true;
    }
  }
  if (inner) return INTERIOR;
  return leaf;
}

function barkColor(seed, h, th, ridge, x, y, z) {
  const k = hash3(Math.round(th * 40), Math.floor(h / 3), seed);
  let c = shade(BARK[k % BARK.length], ridge > 0.3 ? 1.1 : ridge < -0.45 ? 0.62 : 0.9);
  // 根元の北側（-z の側）には苔
  if (h < 70 && Math.sin(th) < -0.25 && noise3(x * 0.15, y * 0.15, z * 0.15) > 0.5 - (70 - h) / 200) c = shade(MOSS, 0.85 + (k % 20) / 100);
  return c || 1;
}

function leafColor(qy, x, y, z) {
  const k = hash3(x, y, z);
  return shade(LEAVES[k % LEAVES.length], (qy > 0.25 ? 1.12 : qy < -0.3 ? 0.72 : 0.92) + ((k >>> 8) % 12) / 100);
}

// 切り口・穴の壁に見える木の中の色（中心は赤い心材、外側は白っぽい辺材、年輪）
function heartColor(S, lx, ly, lz) {
  const h = Math.max(0, Math.min(S.H, Math.floor(ly)));
  const d = Math.hypot(lx - S.axX[h], lz - S.axZ[h]);
  const r = S.rad[h] + S.flare[h] * 0.55;
  if (d > r * 1.05) return shade(LEAVES[2], 0.7); // 葉の塊の中
  const ring = Math.floor(d * 0.8) % 2 ? 0.92 : 1;
  return shade(d > r * 0.8 ? SAP : HEART, ring);
}

// ---- チャンクに塗る -----------------------------------------------------------------

const editKey = (sp, x, y, z) => ((x - sp.x + 1024) * 2048 + (z - sp.z + 1024)) * 1024 + y;
function editPos(sp, k) {
  const y = k % 1024;
  const r = (k - y) / 1024;
  const z = (r % 2048) - 1024 + sp.z;
  const x = Math.floor(r / 2048) - 1024 + sp.x;
  return [x, y, z];
}

function put(c, x, y, z, id, color, changed) {
  if (y < c.base || y >= HEIGHT) return;
  c.ensure(y);
  const i = c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK);
  if (c.owner[i] !== EMPTY) return;
  c.owner[i] = id;
  c.color[i] = color;
  if (y >= c.top) c.top = y + 1;
  if (changed) c.changed.push(i);
}

// 立っている木（切り倒されたら切り株だけ）を、チャンク c に塗る。
// まわり 1 列も含めた箱の中で、セルごとに「なし / 葉 / 枝 / 樹皮 / 中」を決め（幹は列ごとに、枝と葉は部品ごとに塗る）、
// 外（なし）に面しているセルにだけ色をつける。中や、ほかのセルに囲まれたセルは占有するが消灯
const LEAF = 1, BRANCH = 2, BARKED = 3, INNER = 4;
function paintUpright(c, g, changed) {
  const S = shapeOf(g), sp = g.spec;
  const cx0 = c.cx * CHUNK, cz0 = c.cz * CHUNK;
  if (Math.max(Math.abs(cx0 + CHUNK / 2 - sp.x), Math.abs(cz0 + CHUNK / 2 - sp.z)) > GIANT_REACH + CHUNK) return;
  const stump = g.cut && (g.falling || g.fallen);
  const yTop = stump ? sp.y + g.cut.h0 - 1 : sp.y + S.top;
  const x0 = cx0 - 1, z0 = cz0 - 1, W = CHUNK + 2;
  const ya = Math.max(c.base - 1, sp.y - 6), yb = Math.min(HEIGHT - 1, yTop + 1);
  if (yb < ya) return;
  const ny = yb - ya + 1;
  const st = new Uint8Array(W * W * ny);
  const at = (x, y, z) => (x - x0) + W * ((z - z0) + W * (y - ya));
  // 幹
  const trunkTop = Math.min(yTop, sp.y + S.H);
  for (let z = z0; z < z0 + W; z++) {
    for (let x = x0; x < x0 + W; x++) {
      const ax = x - sp.x, az = z - sp.z;
      const r0 = Math.hypot(ax, az);
      if (r0 > S.trunkReach) continue;
      for (let y = ya; y <= trunkTop; y++) {
        const h = Math.max(0, y - sp.y);
        const rm = S.rad[h] * 1.06 + S.flare[h] + 1.3;
        if (r0 - S.axMax > rm) break; // 幹は上へ行くほど細いので、ここより上はもう届かない
        const dx = ax - S.axX[h], dz = az - S.axZ[h];
        const d2 = dx * dx + dz * dz;
        if (d2 >= rm * rm) continue;
        const d = Math.sqrt(d2);
        const [rEff] = trunkRadius(S, h, Math.atan2(dz, dx));
        if (d <= rEff) st[at(x, y, z)] = d > rEff - 2.5 ? BARKED : INNER;
      }
    }
  }
  // 枝と葉の塊
  const bx0 = x0 - sp.x, bz0 = z0 - sp.z, by0 = ya - sp.y, by1 = Math.min(yb, yTop) - sp.y;
  for (const p of S.parts) {
    if (p.hi[0] < bx0 || p.lo[0] > bx0 + W || p.hi[2] < bz0 || p.lo[2] > bz0 + W || p.hi[1] < by0 || p.lo[1] > by1 + 1) continue;
    const lx0 = Math.max(bx0, Math.floor(p.lo[0])), lx1 = Math.min(bx0 + W - 1, Math.ceil(p.hi[0]));
    const lz0 = Math.max(bz0, Math.floor(p.lo[2])), lz1 = Math.min(bz0 + W - 1, Math.ceil(p.hi[2]));
    const ly0 = Math.max(by0, Math.floor(p.lo[1])), ly1 = Math.min(by1, Math.ceil(p.hi[1]));
    for (let ly = ly0; ly <= ly1; ly++) {
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          const i = at(lx + sp.x, ly + sp.y, lz + sp.z);
          if (st[i] === INNER) continue;
          let v;
          if (p.b) {
            const [d, t] = distToSegment(lx, ly + 0.5, lz, p.a, p.e);
            if (d > p.ra + (p.rb - p.ra) * t) continue;
            v = BRANCH;
          } else {
            const qx = (lx - p.c[0]) * p.inv[0], qy = (ly + 0.5 - p.c[1]) * p.inv[1], qz = (lz - p.c[2]) * p.inv[2];
            const q = Math.sqrt(qx * qx + qy * qy + qz * qz);
            if (q > 1.2) continue;
            // 縁はノイズで崩す（ノイズは縁の近くだけ計算する）
            if (q > 0.82 && q + (noise3(lx * 0.21 + p.seed, (ly + 0.5) * 0.21, lz * 0.21) - 0.5) * 0.32 > 1) continue;
            v = q > 1 - 2.2 * p.invMin - 0.16 ? LEAF : INNER;
          }
          if (v > st[i]) st[i] = v;
        }
      }
    }
  }
  // 外に面したセルにだけ色をつけて、チャンクに書く
  const seed = sp.seed;
  const empty = (x, y, z) => y < ya || y > yb || st[at(x, y, z)] === 0;
  let yMax = -1;
  for (let i = st.length - 1; i >= 0; i--) {
    if (st[i]) {
      yMax = ya + Math.floor(i / (W * W));
      break;
    }
  }
  if (yMax < 0) return;
  c.ensure(Math.min(yMax, yTop, HEIGHT - 1)); // 配列は一度に広げる（少しずつ広げると何度も写し直して遅い）
  for (let y = Math.max(ya, c.base); y <= Math.min(yb, yTop, yMax); y++) {
    for (let z = cz0; z < cz0 + CHUNK; z++) {
      for (let x = cx0; x < cx0 + CHUNK; x++) {
        const v = st[at(x, y, z)];
        if (!v) continue;
        let color = 0;
        const seen = empty(x + 1, y, z) || empty(x - 1, y, z) || empty(x, y, z + 1) || empty(x, y, z - 1) || empty(x, y + 1, z) || empty(x, y - 1, z);
        if (seen && v !== INNER) {
          if (v === LEAF) color = leafColor(empty(x, y + 1, z) ? 0.5 : empty(x, y - 1, z) ? -0.5 : 0, x, y, z);
          else if (v === BRANCH) color = shade(WOOD, 0.85 + (hash3(x, y, z) % 25) / 100);
          else {
            const h = Math.max(0, y - sp.y);
            const th = Math.atan2(z - sp.z - S.axZ[h], x - sp.x - S.axX[h]);
            color = barkColor(seed, h, th, trunkRadius(S, h, th)[1], x, y, z);
          }
        } else if (stump && y === yTop) {
          color = heartColor(S, x - sp.x, y + 0.5 - sp.y, z - sp.z); // 切り株の切り口
        }
        put(c, x, y, z, g.id, color, changed);
      }
    }
  }
}

// 倒れた木（倒木）を、チャンク c に塗る。セルを木が立っていたときの位置へ戻して、形を調べる
function paintFallen(c, g, changed) {
  const S = shapeOf(g), sp = g.spec, F = g.fallen;
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  if (x0 + CHUNK <= F.box[0] || x0 > F.box[3] || z0 + CHUNK <= F.box[2] || z0 > F.box[5]) return;
  const bx = sp.x + 0.5, bz = sp.z + 0.5;
  const d = F.dirUp; // 倒れたあとの幹の向き（根元から梢へ）
  const hl = Math.hypot(d[0], d[2]);
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, z = z0 + lz;
      // この列に近い幹の位置（切り口からの距離 s）と、幹からの横の距離
      const vx = x + 0.5 - F.pivot[0], vz = z + 0.5 - F.pivot[2];
      const sh = (vx * d[0] + vz * d[2]) / hl;
      const s = sh / hl;
      if (s < -GIANT_REACH || s > S.top - F.h1 + GIANT_REACH) continue;
      const side = Math.abs(vx * d[2] - vz * d[0]) / hl;
      const hAt = Math.max(0, Math.min(S.reachAt.length - 1, Math.round(F.h1 + s)));
      const rho = Math.max(S.reachAt[hAt], S.reachAt[Math.max(0, hAt - 20)], S.reachAt[Math.min(S.reachAt.length - 1, hAt + 20)]) + 4;
      if (side > rho) continue;
      const yAxis = F.pivot[1] + d[1] * s;
      const ya = Math.max(c.base, Math.floor(yAxis - rho)), yb = Math.min(HEIGHT - 1, Math.ceil(yAxis + rho));
      for (let y = ya; y <= yb; y++) {
        const p = F.unrotate(x + 0.5, y + 0.5, z + 0.5);
        const ly = p[1] - sp.y;
        if (ly < F.h1) continue;
        let v = classify(S, sp.seed, p[0] - bx, ly, p[2] - bz);
        if (!v) continue;
        if (v === INTERIOR) v = ly < F.h1 + 1.2 ? heartColor(S, p[0] - bx, ly, p[2] - bz) : 0; // 倒木の切り口
        put(c, x, y, z, g.id, v, changed);
      }
    }
  }
}

// 覚えておいた変更（切り込み・穴・焦げ跡）をチャンク c に反映する
function applyEdits(c, g, changed) {
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  for (const [k, color] of g.edits) {
    const [x, y, z] = editPos(g.spec, k);
    if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK || y < c.base || (y - c.base + 1) * LAYER > c.owner.length) continue;
    const i = c.index(x - x0, y, z - z0);
    if (c.owner[i] !== g.id) continue;
    if (color === 0) c.owner[i] = EMPTY;
    c.color[i] = color;
    if (changed) c.changed.push(i);
  }
}

// チャンクを作るときに、そこにかかる巨大樹を塗り、巨大樹の森の林床を落ち葉と苔の色にする
export function paintGiantsInto(world, c) {
  if (!world.terrain) return;
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  const touched = new Set();
  for (const spec of giantSpecsNear(world, x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
    const g = getGiant(world, spec);
    paintUpright(c, g, false);
    touched.add(g);
  }
  for (const g of world.giants?.values() ?? []) {
    if (!g.fallen) continue;
    paintFallen(c, g, false);
    touched.add(g);
  }
  for (const g of touched) if (g.edits.size) applyEdits(c, g, false);
  // 林床
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, z = z0 + lz;
      const h = c.height[lx + CHUNK * lz];
      const zone = giantZone(world, x, z, h);
      if (zone < 0.3 || h - 1 < c.base) continue;
      const i = c.index(lx, h - 1, lz);
      if (!c.color[i] || c.owner[i] !== GROUND_ID) continue;
      const k = hash3(x, z, world.seed + 0x1f);
      if ((k % 100) / 100 > zone * 1.3) continue; // 森の端はまだらに
      const moss = noise2(x / 9, z / 9, world.seed + 0x2f) > 0.6;
      c.color[i] = shade(moss ? FOREST_MOSS[k % 2] : LITTER[k % LITTER.length], 0.88 + ((k >>> 8) % 20) / 100);
    }
  }
}

// 別のスレッドで作ったチャンクには、巨大樹は「何も手を加えていない形」で塗られている。
// この世界で切ったり穴をあけたりした巨大樹は塗り直し、倒木も塗る
export function refreshGiantsIn(world, c, giants) {
  for (const g of giants) {
    if (!(g.cut || g.edits.size || g.fallen || g.falling)) continue;
    for (let i = 0; i < c.owner.length; i++) {
      if (c.owner[i] !== g.id) continue;
      c.owner[i] = EMPTY;
      c.color[i] = 0;
    }
    paintUpright(c, g, false);
    if (g.edits.size) applyEdits(c, g, false);
  }
  for (const g of world.giants?.values() ?? []) {
    if (!g.fallen) continue;
    paintFallen(c, g, false);
    if (g.edits.size) applyEdits(c, g, false);
  }
}

// ---- 切る・焼く・消す ---------------------------------------------------------------

// セル (x, y, z) の、木が立っていたときの相対位置（倒木なら回して戻す）
function localOf(g, x, y, z) {
  const sp = g.spec;
  if (g.fallen && y >= sp.y + g.cut.h0 - 1) {
    const S = shapeOf(g);
    const direct = classify(S, sp.seed, x - sp.x, y + 0.5 - sp.y, z - sp.z);
    if (!(direct && y < sp.y + g.cut.h0)) {
      const p = g.fallen.unrotate(x + 0.5, y + 0.5, z + 0.5);
      return [p[0] - sp.x - 0.5, p[1] - sp.y, p[2] - sp.z - 0.5];
    }
  }
  return [x - sp.x, y + 0.5 - sp.y, z - sp.z];
}

// 巨大樹のセルを消す。あいた穴の壁になった中のセル（見えていなかった所）に、木の中の色をつける
export function eraseGiantCell(world, g, x, y, z) {
  if (world.ownerAt(x, y, z) !== g.id) return false;
  world.setCell(x, y, z, EMPTY, 0);
  g.edits.set(editKey(g.spec, x, y, z), 0);
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (world.ownerAt(nx, ny, nz) !== g.id || world.colorAt(nx, ny, nz)) continue;
    const color = heartColor(shapeOf(g), ...localOf(g, nx, ny, nz));
    world.setCell(nx, ny, nz, g.id, color);
    g.edits.set(editKey(g.spec, nx, ny, nz), color);
  }
  return true;
}

// 龍の炎で焦がす。葉は焦げ茶、幹や枝は黒く（巨大樹は燃え落ちない）。戻り値は焦げたあとの色（焦げない所は null）
export function burnGiantCell(world, g, x, y, z) {
  if (world.ownerAt(x, y, z) !== g.id) return null;
  const c = world.colorAt(x, y, z);
  if (!c || CHAR.includes(c)) return null;
  const color = CHAR[hash3(x, y, z) % CHAR.length];
  g.edits.set(editKey(g.spec, x, y, z), color);
  return color;
}

// 斧で切る。腰の高さの幹に、手前から切り込みを入れていく。幹の太さの 6 割まで切り込むと、向こう側へ倒れる。
// f: 前の向き、m: 体の中心。ev に結果を書く
export function chopGiant(world, e, g, f, m, ev) {
  ev.target = world.entities.get(g.id);
  if (g.falling || g.fallen) return ev;
  const sp = g.spec, S = shapeOf(g);
  if (!g.cut) {
    const y = Math.max(sp.y + 2, e.pos[1] + 4);
    g.cut = { y, h0: y - sp.y, depth: 0 };
  }
  const cut = g.cut;
  const h = Math.min(S.H, cut.h0);
  const cx = sp.x + 0.5 + S.axX[h], cz = sp.z + 0.5 + S.axZ[h];
  const r = S.rad[h] + S.flare[h] * 0.75;
  cut.depth += NOTCH_STEP;
  // 幹の手前の面から depth まで（V 字に: 上の段ほど浅い）
  const front = (cx - m[0]) * f[0] + (cz - m[1]) * f[1] - r - 1.5;
  const R = Math.ceil(r + S.flare[h] * 0.3 + 3);
  for (let dy = 0; dy < NOTCH_H; dy++) {
    const y = cut.y + dy;
    const reach = front + cut.depth * (1 - dy * 0.12);
    for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        if ((x + 0.5 - m[0]) * f[0] + (z + 0.5 - m[1]) * f[1] > reach) continue;
        if (world.ownerAt(x, y, z) === g.id) eraseGiantCell(world, g, x, y, z);
      }
    }
  }
  ev.progress = Math.min(1, cut.depth / (2 * r * FELL_AT));
  ev.result = 'notch';
  if (cut.depth >= 2 * r * FELL_AT) {
    let dx = cx - m[0], dz = cz - m[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    world.felling.push(new FallingGiant(world, g, [dx, dz], [cx, cz], r));
    ev.result = 'felled';
  }
  return ev;
}

// 軸 axis（長さ 1）のまわりに ang 回す行列
function rotation(axis, ang) {
  const [x, y, z] = axis;
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

// 切り口より上が、切り口の向こう側の縁を支点に倒れていく（100m の木なので、ゆっくり倒れ始め、だんだん速くなる）
export class FallingGiant {
  constructor(world, g, dir, center, r) {
    this.world = world;
    this.g = g;
    const sp = g.spec, cut = g.cut;
    g.falling = this;
    this.id = world.nextId++;
    this.entity = {
      id: this.id, kind: 'falling', name: 'セコイア（倒れていく）', priority: 8, pos: [Math.round(center[0]), cut.y, Math.round(center[1])],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    };
    world.entities.set(this.id, this.entity);
    this.dir = [dir[0], 0, dir[1]];
    this.axis = [dir[1], 0, -dir[0]]; // 上向き → dir の向きへ回す軸
    this.pivot = [center[0] + dir[0] * r, cut.y + NOTCH_H / 2, center[1] + dir[1] * r];
    this.h1 = cut.h0 + NOTCH_H; // 倒れる部分のいちばん下（根元からの高さ）
    this.length = shapeOf(g).H - cut.h0;
    // 切り口より上の、見えているセルを取り外して、倒れる物にする。切り込みの段に残った所（つる）は消える
    const pts = [];
    const S = shapeOf(g);
    for (const c of world.chunks.values()) {
      const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
      if (x0 + CHUNK < sp.x - GIANT_REACH || x0 > sp.x + GIANT_REACH || z0 + CHUNK < sp.z - GIANT_REACH || z0 > sp.z + GIANT_REACH) continue;
      const from = Math.max(0, cut.y - c.base) * LAYER;
      const to = Math.min(c.owner.length, (Math.min(c.top, sp.y + S.top + 1) - c.base) * LAYER);
      for (let i = from; i < to; i++) {
        if (c.owner[i] !== g.id) continue;
        const y = c.yOf(i);
        if (c.color[i] && y >= cut.y + NOTCH_H) {
          // 倒れていく間は、幹は全部、枝葉は 3 つに 1 つだけ描く（数十万のセルを毎回描き直すと重いので。速く動くので目立たない）
          const x = x0 + (i % CHUNK), z = z0 + (Math.floor(i / CHUNK) % CHUNK);
          const h = Math.min(S.n - 1, y - sp.y);
          const trunk = Math.hypot(x - sp.x - S.axX[h], z - sp.z - S.axZ[h]) <= S.rad[h] + S.flare[h] + 2;
          if (trunk || hash3(x, y, z) % 3 === 0) pts.push(x + 0.5, y + 0.5, z + 0.5, c.color[i]);
        }
        c.owner[i] = EMPTY;
        c.color[i] = 0;
        c.changed.push(i);
        world.dirty.add(c.key);
      }
    }
    this.pts = Float64Array.from(pts);
    // 切り口より上の変更はもう使わない。切り株の切り口に色をつける
    for (const k of [...g.edits.keys()]) if (editPos(sp, k)[1] >= cut.y) g.edits.delete(k);
    const top = cut.y - 1;
    const R = Math.ceil(r + 6);
    for (let z = Math.floor(center[1] - R); z <= Math.ceil(center[1] + R); z++) {
      for (let x = Math.floor(center[0] - R); x <= Math.ceil(center[0] + R); x++) {
        if (world.ownerAt(x, top, z) !== g.id || world.colorAt(x, top, z)) continue;
        const color = heartColor(S, x - sp.x, top + 0.5 - sp.y, z - sp.z);
        world.setCell(x, top, z, g.id, color);
        g.edits.set(editKey(sp, x, top, z), color);
      }
    }
    this.angle = 0.02;
    this.omega = 0;
    this.cells = [];
    this.done = false;
    this.landed = false;
    this.repaint = null;
    this.tick = 0;
    this.draw();
  }

  // 点 p を支点のまわりに ang だけ回す
  rotate(p, M) {
    const v0 = p[0] - this.pivot[0], v1 = p[1] - this.pivot[1], v2 = p[2] - this.pivot[2];
    return [
      this.pivot[0] + M[0] * v0 + M[1] * v1 + M[2] * v2,
      this.pivot[1] + M[3] * v0 + M[4] * v1 + M[5] * v2,
      this.pivot[2] + M[6] * v0 + M[7] * v1 + M[8] * v2,
    ];
  }

  // 角度 ang のとき、幹が地面に当たっているか
  touches(ang) {
    const w = this.world;
    const M = rotation(this.axis, ang);
    const S = shapeOf(this.g);
    for (let h = 20; h <= this.length; h += 10) {
      const p = this.rotate([this.pivot[0], this.pivot[1] + h, this.pivot[2]], M);
      const x = Math.round(p[0]), z = Math.round(p[2]);
      const r = S.rad[Math.min(S.H, this.g.cut.h0 + h)] * 0.8;
      const ground = w.chunks.has(chunkKeyAt(x, z)) ? Math.max(w.groundAt(x, z), w.waterAt(x, z)) : w.heightAt(x, z);
      if (p[1] - r < ground) return true;
    }
    return false;
  }

  update(dt) {
    if (this.done) return;
    if (this.landed) {
      // 地面に着いたあと: 倒木を、作ってあるチャンクに少しずつ塗る
      for (let k = 0; k < 3 && this.repaint.length; k++) {
        const c = this.repaint.pop();
        if (!this.world.chunks.has(c.key)) continue;
        paintFallen(c, this.g, true);
        this.world.dirty.add(c.key);
      }
      if (!this.repaint.length) this.done = true;
      return;
    }
    this.omega += ((3 * GRAVITY) / (2 * this.length)) * Math.sin(this.angle) * dt;
    let next = Math.min(Math.PI / 2, this.angle + this.omega * dt);
    let land = false;
    if (this.touches(next)) {
      let lo = this.angle, hi = next;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (this.touches(mid)) hi = mid;
        else lo = mid;
      }
      next = lo;
      land = true;
    } else if (next >= Math.PI / 2) {
      land = true;
    }
    this.angle = next;
    // 体が大きいので、描き直すのは梢が 2 ボクセル以上動いたときだけ（多くても 2 回に 1 回。地面に着くときは必ず）
    this.tick++;
    if (land) this.finish();
    else if (this.tick - this.drawnTick >= 2 && (this.angle - this.drawnAngle) * this.length >= 2) this.draw();
  }

  draw() {
    this.drawnTick = this.tick;
    this.drawnAngle = this.angle;
    const M = rotation(this.axis, this.angle);
    const pts = this.pts;
    const P = this.pivot;
    const { cells, pushed } = redrawBody(this.world, this.id, this.cells, (emit) => {
      for (let n = 0; n < pts.length; n += 4) {
        const v0 = pts[n] - P[0], v1 = pts[n + 1] - P[1], v2 = pts[n + 2] - P[2];
        const y = Math.floor(P[1] + M[3] * v0 + M[4] * v1 + M[5] * v2);
        if (y < 1 || y >= HEIGHT) continue;
        emit(Math.floor(P[0] + M[0] * v0 + M[1] * v1 + M[2] * v2), y, Math.floor(P[2] + M[6] * v0 + M[7] * v1 + M[8] * v2), pts[n + 3]);
      }
    }, (m) => {
      // 倒れてくる木の下から、横へ押し出す
      const side = (m[0] - P[0]) * this.axis[0] + (m[2] - P[2]) * this.axis[2];
      return side >= 0 ? [this.axis[0], this.axis[2]] : [-this.axis[0], -this.axis[2]];
    });
    this.cells = cells;
    this.pushed = pushed;
  }

  // 地面に着いた: 倒れる物を消して、倒木として形から塗り直す
  finish() {
    const w = this.world, g = this.g, S = shapeOf(g);
    redrawBody(w, this.id, this.cells, () => {}, () => null);
    this.cells = [];
    this.pushed = [];
    w.entities.delete(this.id);
    const M = rotation(this.axis, this.angle);
    const Minv = rotation(this.axis, -this.angle);
    const P = this.pivot;
    const up = [M[1], M[4], M[7]];
    const F = {
      pivot: P, dirUp: up, h1: this.h1, angle: this.angle,
      unrotate: (x, y, z) => {
        const v0 = x - P[0], v1 = y - P[1], v2 = z - P[2];
        return [P[0] + Minv[0] * v0 + Minv[1] * v1 + Minv[2] * v2, P[1] + Minv[3] * v0 + Minv[4] * v1 + Minv[5] * v2, P[2] + Minv[6] * v0 + Minv[7] * v1 + Minv[8] * v2];
      },
    };
    // 倒木の範囲（水平）: 支点から梢まで、横は枝葉の届く距離
    const L = S.top - this.h1 + 8;
    const ends = [P, [P[0] + up[0] * L, 0, P[2] + up[2] * L]];
    F.box = [
      Math.min(ends[0][0], ends[1][0]) - GIANT_REACH, 0, Math.min(ends[0][2], ends[1][2]) - GIANT_REACH,
      Math.max(ends[0][0], ends[1][0]) + GIANT_REACH, HEIGHT, Math.max(ends[0][2], ends[1][2]) + GIANT_REACH,
    ];
    g.fallen = F;
    g.falling = null;
    this.landed = true;
    this.repaint = [...w.chunks.values()].filter((c) => {
      const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
      return !(x0 + CHUNK <= F.box[0] || x0 > F.box[3] || z0 + CHUNK <= F.box[2] || z0 > F.box[5]);
    });
    // 近いチャンクから塗る（pop で後ろから取るので、遠い順に並べる）
    const px = this.entity.pos[0], pz = this.entity.pos[2];
    this.repaint.sort((a, b) => Math.hypot(b.cx * CHUNK - px, b.cz * CHUNK - pz) - Math.hypot(a.cx * CHUNK - px, a.cz * CHUNK - pz));
  }
}

// 片付けたチャンクにしかかかっていない、手を加えていない巨大樹を忘れる
export function forgetGiants(world) {
  if (!world.giants) return;
  for (const [key, g] of world.giants) {
    if (g.cut || g.edits.size || g.fallen || g.falling) continue;
    const sp = g.spec;
    let loaded = false;
    for (let cz = floorDiv(sp.z - GIANT_REACH, CHUNK); cz <= floorDiv(sp.z + GIANT_REACH, CHUNK) && !loaded; cz++) {
      for (let cx = floorDiv(sp.x - GIANT_REACH, CHUNK); cx <= floorDiv(sp.x + GIANT_REACH, CHUNK); cx++) {
        if (world.chunks.has(chunkKey(cx, cz))) {
          loaded = true;
          break;
        }
      }
    }
    if (loaded) continue;
    world.giants.delete(key);
    world.entities.delete(g.id);
  }
}

// 遠景用: 巨大樹を箱で表す（幹は太さの変わる段の積み重ね、樹冠は葉の塊ごとの箱）。
// out に [中心 x, 下, 中心 z, 幅, 高さ, 色, 回転] を足す。幹は箱を 45° ずらして 2 つ重ね、断面を八角形にする。箱ごとに、その位置がチャンクで描かれていれば遠景側で隠される
export function giantBoxes(world, spec, out) {
  const g = world.giants?.get(spec.key);
  const bx = spec.x + 0.5, bz = spec.z + 0.5, y = spec.y;
  const S = shapeOfSpec(spec);
  const top = g && (g.fallen || g.falling) ? g.cut.h0 : S.H;
  const oct = (x, y0, z, d, h, c) => out.push(x, y0, z, d * 0.92, h, c, 0, x, y0, z, d * 0.92, h, shade(c, 0.9), Math.PI / 4);
  oct(bx, y, bz, (S.rad[0] + S.flare[0] * 0.7) * 1.8, 14, BARK[2]); // 根張り
  for (let h = 0; h < top; h += 24) {
    const hh = Math.min(top, h + 24);
    const m = Math.min(S.n - 1, h + 12);
    oct(bx + S.axX[m], y + h, bz + S.axZ[m], (S.rad[m] + S.flare[m] * 0.7) * 2, hh - h, BARK[(h / 24) % BARK.length]);
  }
  if (top < S.H) return; // 切り株
  for (const p of S.parts) {
    if (p.b) continue;
    const k = hash3(Math.round(p.c[0]), Math.round(p.c[1]), spec.seed);
    const t = p.c[1] / S.H;
    out.push(bx + p.c[0], y + p.c[1] - p.r[1] * 0.8, bz + p.c[2], (p.r[0] + p.r[2]) * 0.85, p.r[1] * 1.6, shade(LEAVES[k % LEAVES.length], 0.72 + t * 0.3), (k % 8) * 0.2);
  }
}
