// 木: 骨格（幹・大枝・小枝）から組み立て、枝先に不規則な葉の塊をつける
//
// - 種類: 広葉樹（丸い樹冠 / 箒状）、針葉樹（スギ・モミのような円錐）、シラカバ。若木もある
// - 大きな木は 8〜13m（50〜85 ボクセル）。チャンクをまたいで広がる
// - 風: 葉の塊ごとに、突風が通るたび風下へ1ボクセルずれる。幹と枝は動かない
//   木が占有するセルは「葉がずれうる範囲」を含めて固定なので、風で何かとぶつかることはない

import { mulberry32, hash3, noise3, noise2, shade } from './rng.js';
import { CHUNK, HEIGHT, floorDiv, chunkKey, chunkKeyAt, cellIndex } from './grid.js';
import { BASE } from './terrain.js';

export const REGION = 24; // この区画ごとに最大1本の木を置く（ボクセル）
export const MAX_REACH = 30; // 幹の中心から葉先までの最大の水平距離（ボクセル）

const NAMES = { broad: 'ケヤキ', round: 'カシ', conifer: 'スギ', birch: 'シラカバ' };

const PALETTES = {
  broad: { bark: 0x6b4e37, leaves: [0x3f7f34, 0x4a8c3a, 0x356f2e, 0x58963f] },
  round: { bark: 0x5a4636, leaves: [0x2f6a2c, 0x3a7a33, 0x2a5e29, 0x47853a] },
  conifer: { bark: 0x4e3326, leaves: [0x2b553a, 0x24493a, 0x33623f, 0x2e5a34] },
  birch: { bark: 0xe6e2d6, mark: 0x2f2b28, leaves: [0x8fb84f, 0x7aa845, 0x9cc35a, 0x86ad48] },
};

// 木の中のセルの番号（負の座標もそのまま扱える数値）
const OFF = 2 ** 20;
const SPAN = 2 ** 21;
const cellKey = (x, y, z) => ((x + OFF) * SPAN + (z + OFF)) * 128 + y;

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function distToSegment(px, py, pz, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (a[0] + abx * t), dy = py - (a[1] + aby * t), dz = pz - (a[2] + abz * t);
  return [Math.sqrt(dx * dx + dy * dy + dz * dz), t];
}

// ---- 形を組み立てる（座標は幹の根元のセルが原点） --------------------------------

class TreeShape {
  constructor(seed, palette) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.pal = palette;
    this.wood = new Map(); // key → [x, y, z, color]
    this.clumps = []; // { base: Map(key → [x, y, z, color]), center }
  }

  // 先細りの枝（a → b、太さ ra → rb）
  branch(a, b, ra, rb, colorAt) {
    const r = Math.max(ra, rb, 0.6);
    const x0 = Math.floor(Math.min(a[0], b[0]) - r), x1 = Math.ceil(Math.max(a[0], b[0]) + r);
    const y0 = Math.max(1, Math.floor(Math.min(a[1], b[1]) - r)), y1 = Math.ceil(Math.max(a[1], b[1]) + r);
    const z0 = Math.floor(Math.min(a[2], b[2]) - r), z1 = Math.ceil(Math.max(a[2], b[2]) + r);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const [d, t] = distToSegment(x + 0.5, y + 0.5, z + 0.5, a, b);
          if (d > Math.max(0.6, ra + (rb - ra) * t)) continue;
          const key = cellKey(x, y, z);
          if (!this.wood.has(key)) this.wood.set(key, [x, y, z, colorAt(x, y, z)]);
        }
      }
    }
  }

  // 葉の塊: いくつかの扁平な塊を重ね、ノイズで縁を崩し、ところどころ隙間をあける。
  // 中は外から見えないので空洞にする。上は明るく、下は暗い。
  clump(center, size, { flat = 0.6, gaps = 0.1, stretch = null } = {}) {
    const rng = this.rng;
    const blobs = [];
    const k = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < k; i++) {
      const c = i === 0 ? center : [
        center[0] + (rng() - 0.5) * size * 1.1,
        center[1] + (rng() - 0.5) * size * 0.5 * flat,
        center[2] + (rng() - 0.5) * size * 1.1,
      ];
      const r = size * (0.5 + rng() * 0.45);
      blobs.push({ c, r: [r * (stretch ? stretch[0] : 1), r * flat * (0.8 + rng() * 0.4), r * (stretch ? stretch[1] : 1)] });
    }
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const { c, r } of blobs) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], c[a] - r[a] * 1.2);
        hi[a] = Math.max(hi[a], c[a] + r[a] * 1.2);
      }
    }
    const base = new Map();
    const leaves = this.pal.leaves;
    const span = Math.max(1, hi[1] - lo[1]);
    for (let y = Math.max(1, Math.floor(lo[1])); y <= Math.ceil(hi[1]); y++) {
      for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
        for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++) {
          const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
          let d = Infinity;
          for (const { c, r } of blobs) {
            const v = ((px - c[0]) / r[0]) ** 2 + ((py - c[1]) / r[1]) ** 2 + ((pz - c[2]) / r[2]) ** 2;
            d = Math.min(d, v);
          }
          d = Math.sqrt(d);
          const n = noise3(px * 0.35, py * 0.35, pz * 0.35, this.seed);
          if (d > 0.78 + 0.4 * n) continue; // 縁をノイズで崩す
          if (d < 1 - 1.8 / size) continue; // 中は外から見えないので空洞（厚さ 2 ボクセルほどの殻）
          const h = hash3(x, y, z ^ this.seed);
          if ((h % 1000) / 1000 < gaps) continue; // 葉の隙間
          const key = cellKey(x, y, z);
          if (this.wood.has(key)) continue;
          const up = (py - lo[1]) / span; // 0 = 塊の下、1 = 上
          const f = 0.68 + 0.42 * up + (n - 0.5) * 0.25;
          base.set(key, [x, y, z, shade(leaves[(h >>> 10) % leaves.length], f)]);
        }
      }
    }
    if (base.size) this.clumps.push({ base, center });
  }

  bark() {
    const { bark, mark } = this.pal;
    const seed = this.seed;
    if (mark) {
      // シラカバ: 白い樹皮に黒い横じま
      return (x, y, z) => (noise3(x * 0.8, y * 1.1, z * 0.8, seed) > 0.72 ? mark : shade(bark, 0.9 + 0.12 * noise3(x, y * 0.3, z, seed + 1)));
    }
    // 縦に伸びたノイズで、樹皮のすじを出す
    return (x, y, z) => shade(bark, 0.75 + 0.4 * noise3(x * 0.7, y * 0.12, z * 0.7, seed));
  }
}

// 広葉樹: 太い幹が途中で数本の大枝に分かれ、さらに枝分かれした先に葉の塊がつく
function buildBroadleaf(t, scale, vase) {
  const rng = t.rng;
  const H = (52 + rng() * 22) * scale;
  const tr = Math.max(0.7, (1.8 + rng() * 0.8) * scale);
  const hb = H * (0.24 + rng() * 0.12); // 枝分かれする高さ
  const bark = t.bark();
  const base = [0.5, 0.6, 0.5];
  const top = [0.5 + (rng() - 0.5) * 4 * scale, hb, 0.5 + (rng() - 0.5) * 4 * scale];
  const mid = lerp3(base, top, 0.5);
  mid[0] += (rng() - 0.5) * 1.5 * scale;
  mid[2] += (rng() - 0.5) * 1.5 * scale;
  t.branch(base, mid, tr * 1.2, tr * 0.95, bark);
  t.branch(mid, top, tr * 0.95, tr * 0.75, bark);
  // 根張り
  const roots = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng() * 0.6;
    const R = tr * (2.2 + rng() * 1.2);
    t.branch([0.5, 1.5 + tr * 1.5, 0.5], [0.5 + Math.cos(a) * R, 1.1, 0.5 + Math.sin(a) * R], tr * 0.7, 0.45, bark);
  }
  // 葉の塊は枝の先だけでなく途中にもつけ、樹冠全体がこんもりした塊になるようにする
  const clumpSize = (vase ? 5.5 : 6.5) * Math.max(0.6, scale);
  const grow = (p, az, elev, len, r, depth) => {
    const dir = [Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)];
    const end = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len];
    const bend = lerp3(p, end, 0.5);
    bend[1] += len * 0.08; // 枝は少し上に反る
    t.branch(p, bend, r, r * 0.85, bark);
    t.branch(bend, end, r * 0.85, r * 0.7, bark);
    if (depth >= 3 || r < 0.4) {
      t.clump(end, clumpSize * (0.85 + rng() * 0.45));
      return;
    }
    if (depth >= 1) t.clump(rng() < 0.5 ? bend : end, clumpSize * (0.7 + rng() * 0.3));
    const kids = 2 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const az2 = az + (k - (kids - 1) / 2) * 0.85 + (rng() - 0.5) * 0.6;
      const elev2 = Math.min(1.35, Math.max(0.15, elev + (rng() - 0.55) * 0.7));
      grow(end, az2, elev2, len * (0.6 + rng() * 0.15), r * 0.64, depth + 1);
    }
  };
  const limbs = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < limbs; i++) {
    const az = (i / limbs) * Math.PI * 2 + rng() * 0.9;
    const elev = vase ? 0.95 + rng() * 0.35 : 0.45 + rng() * 0.4;
    const start = [top[0], top[1] - rng() * hb * 0.15, top[2]];
    grow(start, az, elev, (H - hb) * (0.32 + rng() * 0.12), tr * 0.7, 0);
  }
  // 樹冠の芯を埋める大きな塊
  const fills = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < fills; i++) {
    const a = rng() * Math.PI * 2;
    const rr = (H - hb) * 0.15 * rng();
    t.clump([top[0] + Math.cos(a) * rr, top[1] + (H - hb) * (0.35 + rng() * 0.3), top[2] + Math.sin(a) * rr], clumpSize * 1.5, { gaps: 0.05 });
  }
}

// 針葉樹: まっすぐな幹のまわりに、段ごとに垂れた枝と平たい葉の層がつく。上ほど短い。
function buildConifer(t, scale) {
  const rng = t.rng;
  const H = Math.min(HEIGHT - 4, (56 + rng() * 24) * scale);
  const tr = Math.max(0.6, (1.3 + rng() * 0.5) * scale);
  const bark = t.bark();
  t.branch([0.5, 0.6, 0.5], [0.5, H, 0.5], tr * 1.15, 0.4, bark);
  const y0 = H * (0.14 + rng() * 0.1);
  const Rmax = (11 + rng() * 5) * Math.max(0.55, scale);
  let tier = 0;
  for (let y = y0; y < H - 3; y += (2.8 + rng() * 2) * Math.max(0.6, scale)) {
    const f = (H - y) / (H - y0);
    const R = 1.5 + Rmax * f ** 0.9 * (0.8 + rng() * 0.35);
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + rng() * 0.8 + tier * 0.6;
      const droop = R * (0.2 + rng() * 0.25);
      const tip = [0.5 + Math.cos(az) * R, y - droop, 0.5 + Math.sin(az) * R];
      t.branch([0.5, y, 0.5], tip, 0.6, 0.5, bark);
      const pads = Math.max(1, Math.round(R / 3.5));
      for (let p = 0; p < pads; p++) {
        const s = 0.25 + (0.75 * (p + 1)) / pads;
        const pos = lerp3([0.5, y, 0.5], tip, s);
        t.clump(pos, (2 + 1.6 * f + rng()) * Math.max(0.6, scale), {
          flat: 0.42, gaps: 0.06, stretch: [1 + Math.abs(Math.cos(az)) * 0.5, 1 + Math.abs(Math.sin(az)) * 0.5],
        });
      }
    }
    tier++;
  }
  t.clump([0.5, H - 1, 0.5], 2.2 * Math.max(0.6, scale), { flat: 1.6, gaps: 0 });
}

// シラカバ: 細く少し曲がった白い幹。上の方に小さめの葉の塊がまばらにつく。
function buildBirch(t, scale) {
  const rng = t.rng;
  const H = (40 + rng() * 18) * scale;
  const tr = Math.max(0.55, (0.95 + rng() * 0.35) * scale);
  const bark = t.bark();
  let p = [0.5, 0.6, 0.5];
  let lean = [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25];
  const segs = 4;
  const trunk = [p];
  for (let i = 1; i <= segs; i++) {
    lean = [lean[0] + (rng() - 0.5) * 0.15, lean[1] + (rng() - 0.5) * 0.15];
    const q = [p[0] + lean[0] * (H / segs), (H * i) / segs, p[2] + lean[1] * (H / segs)];
    t.branch(p, q, tr * (1 - (i - 1) / (segs + 1)), tr * (1 - i / (segs + 1)), bark);
    trunk.push(q);
    p = q;
  }
  const along = (h) => {
    const i = Math.min(segs - 1, Math.floor((h / H) * segs));
    return lerp3(trunk[i], trunk[i + 1], (h / H) * segs - i);
  };
  for (let h = H * 0.38; h < H - 2; h += (1.8 + rng() * 2) * Math.max(0.6, scale)) {
    const s = along(h);
    const az = rng() * Math.PI * 2;
    const elev = 0.6 + rng() * 0.6;
    const len = (4 + rng() * 6) * scale;
    const end = [s[0] + Math.cos(elev) * Math.cos(az) * len, s[1] + Math.sin(elev) * len, s[2] + Math.cos(elev) * Math.sin(az) * len];
    t.branch(s, end, 0.6, 0.5, bark);
    t.clump(end, (3.2 + rng() * 1.8) * Math.max(0.6, scale), { flat: 0.75, gaps: 0.18 });
  }
  t.clump(along(H - 1), 3 * Math.max(0.6, scale), { flat: 0.9, gaps: 0.15 });
}

// ---- 木の配置 -------------------------------------------------------------------

const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 区画 (rx, rz) に生える木の設計図（なければ null）。森と野原は低い周波数のノイズで分かれる。
function regionSpec(world, rx, rz) {
  const key = chunkKey(rx, rz);
  if (world.treeSpecs.has(key)) return world.treeSpecs.get(key);
  const rng = mulberry32(hash3(rx, rz, world.seed ^ 0x51ed));
  const forest = noise2(rx * 0.17, rz * 0.17, world.seed);
  const p = 0.06 + 0.86 * smoothstep(0.4, 0.68, forest);
  let spec = null;
  if (rng() < p) {
    const x = rx * REGION + 3 + Math.floor(rng() * (REGION - 6));
    const z = rz * REGION + 3 + Math.floor(rng() * (REGION - 6));
    const nearSpawn = Math.abs(x - 8) < 18 && Math.abs(z - 8) < 18;
    const y = world.heightAt(x, z); // 幹の根元の高さ
    if (!nearSpawn && y > world.waterLevel + 1) {
      // 水辺は広葉樹とシラカバ、高い所はスギが多い
      const elev = (y - BASE) / 30;
      const kind = noise2(rx * 0.12 + 50, rz * 0.12, world.seed + 3) - elev * 0.18;
      const species = kind < 0.4 ? 'conifer' : kind > 0.64 ? 'birch' : rng() < 0.5 ? 'broad' : 'round';
      const young = rng() < 0.22;
      spec = {
        key, x, y, z, species,
        scale: young ? 0.38 + rng() * 0.2 : 0.8 + rng() * 0.32,
        seed: hash3(rx, rz, world.seed + 99),
      };
    }
  }
  world.treeSpecs.set(key, spec);
  return spec;
}

// 範囲 [x0, x1] × [z0, z1] に枝葉が届きうる木の設計図（区画の順に並ぶ）
function specsNear(world, x0, z0, x1, z1) {
  const out = [];
  for (let rz = floorDiv(z0 - MAX_REACH, REGION); rz <= floorDiv(z1 + MAX_REACH, REGION); rz++) {
    for (let rx = floorDiv(x0 - MAX_REACH, REGION); rx <= floorDiv(x1 + MAX_REACH, REGION); rx++) {
      const s = regionSpec(world, rx, rz);
      if (s) out.push(s);
    }
  }
  return out;
}

// 設計図から木を作り、世界に登録する（1本につき1回だけ）
function getTree(world, spec) {
  let tree = world.trees.get(spec.key);
  if (tree) return tree;
  const shape = new TreeShape(spec.seed, PALETTES[spec.species]);
  if (spec.species === 'conifer') buildConifer(shape, spec.scale);
  else if (spec.species === 'birch') buildBirch(shape, spec.scale);
  else buildBroadleaf(shape, spec.scale, spec.species === 'broad');
  tree = finalize(shape, spec);
  const e = {
    id: world.nextId++, kind: 'terrain', name: NAMES[spec.species], priority: Infinity,
    pos: [spec.x, 1, spec.z], tree, offsets: new Int16Array(0), colors: new Uint32Array(0),
  };
  tree.id = e.id;
  world.entities.set(e.id, e);
  world.trees.set(spec.key, tree);
  return tree;
}

// 形をセルの配列にまとめる。葉の塊ごとに「風でずれうる範囲」まで占有する。
function finalize(shape, spec) {
  const xs = [], ys = [], zs = [], color = [], clumpOf = [];
  const claimed = new Set();
  // 形は根元が y = 1 の座標で作ってあるので、地面の高さ spec.y に合わせて持ち上げる
  const lift = spec.y - 1;
  const push = (x, y, z, c, clump) => {
    const wx = x + spec.x, wz = z + spec.z, wy = y + lift;
    if (Math.abs(x) > MAX_REACH - 1 || Math.abs(z) > MAX_REACH - 1 || y < 1 || wy >= HEIGHT) return -1;
    xs.push(wx); ys.push(wy); zs.push(wz); color.push(c); clumpOf.push(clump);
    return xs.length - 1;
  };
  for (const [key, [x, y, z, c]] of shape.wood) {
    claimed.add(key);
    push(x, y, z, c, -1);
  }
  const clumps = shape.clumps.map((cl, ci) => {
    const cells = [];
    // 1. 静止しているときの葉
    for (const [key, [x, y, z, c]] of cl.base) {
      if (claimed.has(key)) continue;
      claimed.add(key);
      const i = push(x, y, z, c, ci);
      if (i >= 0) cells.push(i);
    }
    // 2. 風でずれたときに葉が入りうる、風下側の1ボクセル（ふだんは消灯）。風は +x / +z の間から吹く
    for (const [, [x, y, z]] of cl.base) {
      for (let dz = 0; dz <= 1; dz++) {
        for (let dx = 0; dx <= 1; dx++) {
          const key = cellKey(x + dx, y, z + dz);
          if (claimed.has(key)) continue;
          claimed.add(key);
          const i = push(x + dx, y, z + dz, 0, ci);
          if (i >= 0) cells.push(i);
        }
      }
    }
    // 葉の色は世界座標で引けるようにしておく
    const base = new Map();
    for (const [, [x, y, z, c]] of cl.base) base.set(cellKey(x + spec.x, y + lift, z + spec.z), c);
    const heightRatio = cl.center[1] / 80;
    return {
      cells: Int32Array.from(cells), base, ox: 0, oz: 0, level: 0,
      wx: cl.center[0] + spec.x, wz: cl.center[2] + spec.z,
      amp: 0.55 + 1.1 * Math.min(1, heightRatio), // 高い所ほどよく揺れる
    };
  });
  const tree = {
    spec, clumps,
    xs: Int32Array.from(xs), ys: Int16Array.from(ys), zs: Int32Array.from(zs),
    color: Uint32Array.from(color), clumpOf: Int16Array.from(clumpOf),
    buckets: new Map(), height: ys.reduce((m, y) => Math.max(m, y - lift), 0),
  };
  const lists = new Map();
  for (let i = 0; i < xs.length; i++) {
    const k = chunkKeyAt(xs[i], zs[i]);
    if (!lists.has(k)) lists.set(k, []);
    lists.get(k).push(i);
  }
  for (const [k, list] of lists) tree.buckets.set(k, Int32Array.from(list));
  return tree;
}

// チャンクを作るときに、そこにかかる木の部分を塗る。
// 木同士が重なるセルは、区画の順で先の木のものになる（チャンクを作る順番によらず同じ結果）。
export function paintTreesInto(world, chunk) {
  const x0 = chunk.cx * CHUNK, z0 = chunk.cz * CHUNK;
  for (const spec of specsNear(world, x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1)) {
    const tree = getTree(world, spec);
    const list = tree.buckets.get(chunk.key);
    if (!list) continue;
    for (const i of list) {
      const ci = cellIndex(tree.xs[i] - x0, tree.ys[i], tree.zs[i] - z0);
      if (chunk.owner[ci] !== 0) continue;
      chunk.owner[ci] = tree.id;
      chunk.color[ci] = tree.color[i];
      chunk.top = Math.max(chunk.top, tree.ys[i] + 1);
    }
  }
}

// ---- 風 ----------------------------------------------------------------------

function shiftClump(world, tree, clump, ox, oz) {
  clump.ox = ox;
  clump.oz = oz;
  for (const i of clump.cells) {
    const x = tree.xs[i], y = tree.ys[i], z = tree.zs[i];
    const c = clump.base.get(cellKey(x - ox, y, z - oz)) ?? 0;
    if (c === tree.color[i]) continue;
    tree.color[i] = c;
    const chunk = world.chunks.get(chunkKeyAt(x, z));
    if (!chunk) continue; // まだ作られていないチャンク（作るときにこの色で塗られる）
    const ci = cellIndex(x - chunk.cx * CHUNK, y, z - chunk.cz * CHUNK);
    if (chunk.owner[ci] !== tree.id) continue; // 隣の木が先に取ったセル
    chunk.color[ci] = c;
    chunk.changed.push(ci);
    world.dirty.add(chunk.key);
  }
}

// 突風が風下へ流れていく。葉の塊は突風が強いときだけ風下へ1ボクセルずれる。
export function updateWind(world, time, px, pz, radius) {
  const angle = 0.78 + 0.6 * Math.sin(time * 0.03); // 0.18〜1.38 rad（+x と +z の間）
  const wx = Math.cos(angle), wz = Math.sin(angle);
  const strength = 0.55 + 0.45 * noise2(time * 0.12, 0, world.seed + 11);
  for (const tree of world.trees.values()) {
    const { x, z } = tree.spec;
    if (Math.max(Math.abs(x - px), Math.abs(z - pz)) > radius) continue;
    for (const cl of tree.clumps) {
      const along = cl.wx * wx + cl.wz * wz;
      const gust = 0.5 + 0.5 * Math.sin(along * 0.07 - time * 1.9 + (cl.wx - cl.wz) * 0.013);
      const s = cl.amp * gust * strength;
      // 行き来が細かくならないよう、ずれるときと戻るときで境目を変える
      if (cl.level === 0 && s > 0.72) cl.level = 1;
      else if (cl.level === 1 && s < 0.42) cl.level = 0;
      const ox = Math.round(wx * cl.level), oz = Math.round(wz * cl.level);
      if (ox !== cl.ox || oz !== cl.oz) shiftClump(world, tree, cl, ox, oz);
    }
  }
}
