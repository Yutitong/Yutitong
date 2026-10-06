// 龍（東洋の龍）: 全長およそ 60m（400 ボクセル）
//
// - 頭が進んだ道すじ（軌跡）を胴がなぞる。そこに後ろへ流れる波を重ねてうねらせ、曲がるときは体を傾ける
// - 胴は太さの変わる管で、厚さ 2 ボクセルほどの殻だけを点灯・占有する（中は空）
// - 頭（角・鬣・髭・目・口）、短い四肢と爪、背びれ、腹板、尾の先の炎のような房
// - 1日の流れ: 飛ぶ → 開けた所へ降りる → 地面を這うように歩く（ときどき立ち止まって火を吹く）→ 飛び立つ
// - 1つのボクセルには1つの物だけ: 龍は地形・木・岩には入らない。人・NPC にぶつかったら押しのける

import { mulberry32, hash3, shade } from './rng.js';
import { CHUNK, HEIGHT, floorDiv, chunkKey, chunkKeyAt } from './grid.js';
import { Fire } from './fire.js';
import { redrawBody, MOVABLE } from './body.js';

export const DRAGON_LENGTH = 400; // ボクセル（≈ 60m）
const SPEED = 38; // ボクセル/秒（≈ 5.7 m/s）
const TURN = 0.55; // 左右に曲がる速さ（ラジアン/秒）
const CLIMB = 0.45; // 上下に向きを変える速さ
const MAX_PITCH = 0.38;
const SAFE = 13; // 頭の中心と、下の木や地面との最小のすき間
const SPINE_STEP = 0.8; // 胴を描く間隔（ボクセル）
const SLAB_MIN = SPINE_STEP * 0.625; // 背骨の1点が受け持つ厚みの半分（となりと少し重ねる）
const SHELL = 1.9; // 胴の皮の厚さ（ボクセル）。√3 より厚いと、どの向きから見ても中が透けない
const WALK_SPEED = 12; // 地面を歩く速さ（ボクセル/秒 ≈ 1.8 m/s）
const WALK_TURN = 0.75;
const HEAD_FLOOR = 12.5; // 歩くとき、頭の中心は地面からこの高さ
const BELLY = 2.5; // 歩くとき、腹と地面のすき間
const BREATH_TIME = 3.6; // 1回に火を吹く時間（秒）
const SEVER_MIN = 60; // これより頭に近い所（首）は切り落とせない
// 切り口の色: 皮の下の脂、肉、骨
const FLESH = [0xa3262e, 0xbc3438, 0xcf4f4c, 0xb02c33];
const FAT = 0xe9b9a0;
const BONE = 0xeee3c8;
const GROUNDED = new Set(['walk', 'aim', 'breathe']);
const NO_HOLES = [];
const WINDUP = 1.2; // 火を吹く前のため（首を引いて胸に息を吸い込む）秒
const CROUCH = 0.9; // 飛び立つ前に身をかがめる秒
// 動きのばね（ゆれ・余韻）。x を target へ近づける。freq: 1 秒に揺れる回数、zeta: 減衰（小さいほど長く揺れる）
function spring(st, key, target, freq, zeta, dt) {
  const w = freq * Math.PI * 2;
  const n = Math.max(1, Math.ceil(dt * w * 2));
  const h = dt / n;
  let x = st[key], v = st[key + 'V'] ?? 0;
  for (let i = 0; i < n; i++) {
    v += (-w * w * (x - target) - 2 * zeta * w * v) * h;
    x += v * h;
  }
  st[key] = x;
  st[key + 'V'] = v;
}
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const ANGER_TIME = 25; // 撃たれてから怒っている時間（秒）
const MAX_POCKS = 160;

export const DRAGON_MODES = {
  fly: '飛んでいる', descend: '降りてくる', walk: '歩いている', aim: '火を吹く相手を見ている',
  breathe: '火を吹いている', takeoff: '飛び立つ',
};

// 速い atan2（誤差 0.005 ラジアンほど。鱗の模様に使うだけなので十分）
function fastAtan2(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y);
  const a = Math.min(ax, ay) / (Math.max(ax, ay) || 1);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  return y < 0 ? -r : r;
}
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

const C = {
  scaleA: 0x2e8b6e, scaleB: 0x3aa07f, scaleC: 0x237059, ridge: 0x1d5c4a,
  belly: 0xe9cf7f, bellyLine: 0xc9a752,
  fin: 0xd2452c, finTip: 0xf08a3c, mane: 0xb8382a, maneTip: 0xe86a38,
  horn: 0xf0e2c0, hornBase: 0xcdb48a, eye: 0xffd23a, pupil: 0x1c1010,
  mouth: 0x5a1a1a, tooth: 0xfaf5e8, whisker: 0xf2e2b0, claw: 0xf2ead8,
  nose: 0x257a60,
};

// ---- 小さなベクトル計算 ------------------------------------------------------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const rotateAround = (v, axis, ang) => {
  // ロドリゲスの回転公式
  const c = Math.cos(ang), s = Math.sin(ang);
  return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)));
};

// 胴の太さ（頭からの距離 s → 半径）
function radiusAt(s) {
  const t = s / DRAGON_LENGTH;
  if (t < 0.12) return 4.6 + 1.6 * (t / 0.12); // 首
  if (t < 0.4) return 6.2 + 0.8 * Math.sin(((t - 0.12) / 0.28) * Math.PI); // 胴の太い所
  return Math.max(1.2, 6.2 * (1 - (t - 0.4) / 0.6) ** 0.9); // 尾へ細くなる
}

// 頭からの距離 s の輪にかかる切り傷。V 字の切り口: 真ん中が一番深い（deep の所まで削れる）
function cutsNear(wounds, s, r, margin) {
  const cuts = [];
  for (const w of wounds) {
    const half = 2.5 + 2 * w.f; // 深くなるほど切り口も広がる
    if (Math.abs(s - w.s) > half + margin) continue;
    const deep = r - 2 * r * w.f;
    // 斜面の傾き。面からの距離は、面に直角に測る（斜面でも肉の層が薄くならないように）
    const slope = (r - deep) / half;
    cuts.push({ cu0: Math.cos(w.th), su0: Math.sin(w.th), ws: w.s, half, deep, norm: Math.sqrt(1 + slope * slope) });
  }
  return cuts;
}

// 胴の位置 s のまわりにある弾痕。弾痕は、皮の上の点から胴の芯の向きへ掘った、太さ a の穴（両端の丸いカプセル）
// w0 / w1: 穴の芯が通る範囲（弾痕の向きに測った、背骨からの距離）
function pocksNear(pocks, s, r, margin) {
  const out = [];
  for (const q of pocks) {
    if (Math.abs(s - q.s) > q.a + margin) continue;
    out.push({ ws: q.s, cu0: Math.cos(q.th), su0: Math.sin(q.th), a: q.a, a2: q.a * q.a, w0: r - q.d + q.a, w1: r + 1.5 });
  }
  return out;
}

// 点 (背骨に沿った ds, 胴の断面の u, v) と弾痕の穴の面との距離（負なら穴の中）
function pockDist(h, ds, u, v) {
  const w = u * h.cu0 + v * h.su0, pp = v * h.cu0 - u * h.su0;
  const wc = w < h.w0 ? h.w0 : w > h.w1 ? h.w1 : w;
  return Math.sqrt(ds * ds + pp * pp + (w - wc) * (w - wc)) - h.a;
}

// 円周を n 等分した点の cos / sin（何度も使うので覚えておく）
const rings = new Map();
function ringTable(n) {
  let t = rings.get(n);
  if (!t) {
    t = { cos: new Float64Array(n), sin: new Float64Array(n) };
    for (let k = 0; k < n; k++) {
      t.cos[k] = Math.cos((k / n) * Math.PI * 2);
      t.sin[k] = Math.sin((k / n) * Math.PI * 2);
    }
    rings.set(n, t);
  }
  return t;
}

// うねりの大きさ（頭と尾の先では小さい）
const waveAt = (s) => Math.sin(Math.min(1, s / DRAGON_LENGTH) * Math.PI) * 10 + 1;

// ---- 頭の形（頭の座標: f = 前, u = 上, l = 横。一度だけ作る） ------------------

const ell = (c, r) => Object.assign((p) => Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]), { rmin: Math.min(...r) });

function buildHead() {
  const parts = [
    { f: ell([0, 3, 0], [12, 8, 9]), color: 'skull' }, // 頭蓋
    { f: ell([16, 0.5, 0], [13, 5.5, 6.5]), color: 'snout' }, // 鼻づら
    { f: ell([28, 1.5, 0], [4.5, 4.5, 5.5]), color: 'nose' }, // 鼻先のふくらみ
    { f: ell([15, -8.6, 0], [12.5, 2.4, 5.5]), color: 'jaw' }, // 下あご（口を開けている）
    { f: ell([10, -4.5, 0], [10, 2.2, 4.6]), color: 'mouth' }, // 口の中
    { f: ell([7, 7.2, 5], [6, 2.4, 3]), color: 'brow' }, // 眉
    { f: ell([7, 7.2, -5], [6, 2.4, 3]), color: 'brow' },
    { f: ell([-2, 0, 9.5], [5, 4, 2.5]), color: 'cheek' }, // ほおのひれ
    { f: ell([-2, 0, -9.5], [5, 4, 2.5]), color: 'cheek' },
  ];
  const points = [];
  // 頭の殻（表面から厚さ 2 ボクセル）は、頭の座標の 0.5 ボクセルごとの格子に色を入れておく。
  // 描くときは、頭のまわりのボクセルの中心を頭の座標へ戻して格子を引く（殻は 2 ボクセル以上の厚さなので、
  // 頭がどの向きに回っても隙間はできない）。点を回して並べるより、ずっと少ない計算ですむ
  const G = { f0: -14, u0: -11, l0: -13, nf: 97, nu: 49, nl: 53, step: 0.5 };
  const grid = new Uint8Array(G.nf * G.nu * G.nl); // 色の番号（palette の何番目か。0 = なし）。小さい配列の方が速く引ける
  const palette = [0];
  const paletteIndex = new Map();
  for (let i = 0; i < G.nf; i++) {
    const f = G.f0 + i * G.step;
    for (let j = 0; j < G.nu; j++) {
      const u = G.u0 + j * G.step;
      for (let k = 0; k < G.nl; k++) {
        const l = G.l0 + k * G.step;
        const p = [f, u, l];
        let best = null;
        let bestD = Infinity;
        for (const part of parts) {
          const d = part.f(p);
          if (d < bestD) {
            bestD = d;
            best = part;
          }
        }
        if (bestD > 1 || bestD < 1 - 2.0 / best.f.rmin) continue; // 表面の殻だけ（中は空）
        let color;
        const h = hash3(Math.round(f), Math.round(u), Math.round(l));
        if (best.color === 'jaw') color = u > -7.2 && f > 5 ? (h % 2 === 0 ? C.tooth : C.mouth) : (u < -9.3 ? C.belly : C.scaleA);
        else if (best.color === 'mouth') color = C.mouth;
        else if (best.color === 'brow') color = C.ridge;
        else if (best.color === 'cheek') color = h % 2 ? C.fin : C.finTip;
        else if (best.color === 'nose') color = u > 3 && Math.abs(l) < 2.5 && f > 29 ? 0x14261f : C.nose;
        else color = u < -3.5 ? (best.color === 'snout' && f > 6 ? C.mouth : C.belly) : (h % 4 === 0 ? C.scaleB : C.scaleA);
        if (!paletteIndex.has(color)) {
          paletteIndex.set(color, palette.length);
          palette.push(color);
        }
        grid[i + G.nf * (j + G.nu * k)] = paletteIndex.get(color);
      }
    }
  }
  // 上あごの牙
  for (let f = 6; f <= 27; f += 1.5) {
    for (const side of [-1, 1]) {
      const l = side * (5.2 - (f - 6) * 0.08);
      for (let d = 0; d < 1.6; d += 0.5) points.push([f, -4.6 - d, l, C.tooth]);
    }
  }
  // 目: 黄色い球に黒いひとみ
  for (const side of [-1, 1]) {
    for (let a = 0; a < 60; a++) {
      const th = (a / 60) * Math.PI * 2;
      for (let r = 0; r <= 2.2; r += 0.5) {
        const p = [9.5 + Math.cos(th) * r * 0.6, 4.6 + Math.sin(th) * r, side * 7.9];
        points.push([...p, r < 0.9 ? C.pupil : C.eye]);
      }
    }
  }
  // 角: 後ろへ伸びて枝分かれする（鹿の角のように）
  const horn = (a, b, r0, r1, color) => {
    const n = Math.ceil(Math.hypot(...sub(b, a)) / 0.4);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = add(a, mul(sub(b, a), t));
      const r = r0 + (r1 - r0) * t;
      for (let k = 0; k < 10; k++) {
        const th = (k / 10) * Math.PI * 2;
        points.push([c[0], c[1] + Math.cos(th) * r, c[2] + Math.sin(th) * r, t < 0.3 ? C.hornBase : color]);
      }
    }
  };
  for (const s of [-1, 1]) {
    horn([-4, 9, s * 4], [-14, 15, s * 6], 1.6, 1.2, C.horn);
    horn([-14, 15, s * 6], [-26, 20, s * 8], 1.2, 0.6, C.horn);
    horn([-11, 14, s * 5.5], [-13, 22, s * 7], 0.9, 0.5, C.horn);
    horn([-21, 18, s * 7], [-22, 25, s * 9.5], 0.8, 0.4, C.horn);
  }
  return { points, grid, palette, G };
}

// ---- 龍 -----------------------------------------------------------------------

export class Dragon {
  constructor(world, start, rng = mulberry32(7)) {
    this.world = world;
    this.rng = rng;
    this.id = world.nextId++;
    this.entity = {
      id: this.id, kind: 'dragon', name: '龍', priority: 9, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    };
    world.entities.set(this.id, this.entity);
    // 炎は別の持ち主。いつでも場所をゆずる（yields）
    this.fireId = world.nextId++;
    world.entities.set(this.fireId, {
      id: this.fireId, kind: 'fire', name: '炎', priority: 0, yields: true, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    });
    this.fire = new Fire(world, this.fireId, new Set([this.id, this.fireId]));
    this.mode = 'fly';
    this.modeTime = 0;
    this.nextLanding = 18 + rng() * 10; // 飛び始めてから降りるまで（秒）
    this.groundW = 0; // 地面に沿う度合い 0..1（軌跡の点ごとに記録する）
    this.rear = 0; // 火を吹くときに首をもたげる度合い 0..1
    this.speed = SPEED;
    this.walked = 0; // 歩いた距離（足の運びに使う）
    this.walkClock = 0;
    this.events = [];
    this.pts = null;
    this.length = DRAGON_LENGTH; // 尾を切り落とされると短くなる
    this.wounds = []; // 切り傷: { s: 頭からの距離, th: 胴のまわりの向き, f: 深さ（直径に対する割合） }
    this.pocks = []; // 弾痕: { s, th, a: 穴の太さ（半径）, d: 皮からの深さ }（ボクセル）
    this.anger = 0; // 撃たれて怒っている残りの時間（秒）。怒っている間はプレイヤーに向かってきて火を吹く
    // 動きの表情（アニメーション）: どれもばねで動き、勢いの余韻が残る
    this.anim = {
      pull: 0, // 頭を引く量（+ で後ろへ、- で前へ突き出す。ボクセル）
      lift: 0, // 頭を持ち上げる量
      squat: 0, // 身をかがめる量（+ でかがむ、- で伸び上がる）
      inhale: 0, // 胸に吸い込んだ息 0..1
      lagB: 0, lagN: 0, lagF: 0, // 髭・鬣が遅れてなびく量（横・上下・前後）
      tail: 0, // 尾の房が遅れて振れる量
    };
    this.flinches = []; // ひるみ: { s, d: 押される向き, a: 大きさ, t: 経過 }
    this.blinkAt = 2 + rng() * 3; // 次にまばたきする時刻
    this.launched = false;
    this.head = [...start];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.time = 0;
    this.waypoint = null;
    this.waypointLeft = 0;
    // 軌跡: 頭が通った点（新しい順）。最初はまっすぐ後ろに伸ばしておく
    this.trail = [];
    for (let s = 0; s <= DRAGON_LENGTH + 20; s += 3) this.trail.push({ p: [start[0], start[1], start[2] - s], roll: 0, w: 0 });
    this.headModel = buildHead();
    this.cells = []; // いま占有しているセル: [チャンクの番号, セル番号, ...]
  }

  // (x, z) のまわりで、龍以外の物がある一番高い所。まだ作られていない場所は地形 + 大木の高さとみなす
  // ignoreMovable: 人・NPC は数えない（歩くときは押しのけるので）
  clearance(x, z, radius = 20, ignoreMovable = false) {
    let top = 0;
    const step = radius > 10 ? 4 : 3;
    for (let dz = -radius; dz <= radius; dz += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        top = Math.max(top, this.columnTop(Math.round(x + dx), Math.round(z + dz), ignoreMovable));
      }
    }
    return top;
  }

  columnTop(x, z, ignoreMovable = false) {
    const w = this.world;
    const c = w.chunks.get(chunkKeyAt(x, z));
    if (!c) return w.heightAt(x, z) + 95;
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
    for (let y = c.top - 1; y > Math.max(0, c.base - 1); y--) {
      const o = c.owner[c.index(lx, y, lz)];
      if (!o || o === this.id || o === this.fireId) continue;
      if (ignoreMovable && MOVABLE.has(w.entities.get(o)?.kind)) continue;
      return y + 1;
    }
    return c.height[lx + CHUNK * lz];
  }

  // 歩くときの足場の高さ（水の上は水面）
  floorAt(x, z) {
    const w = this.world;
    x = Math.round(x);
    z = Math.round(z);
    // まだ作られていない所は、地形の計算だけで求める（チャンクを作り始めると重い）
    if (!w.chunks.has(chunkKeyAt(x, z))) {
      const s = w.sample(x, z, {});
      return Math.max(s.h, s.water);
    }
    return Math.max(w.groundAt(x, z), w.waterAt(x, z));
  }

  setMode(mode) {
    this.mode = mode;
    this.modeTime = 0;
  }

  // 降りる場所: プレイヤーの近くの、木がなく平らな所か水面（もう作られている場所だけ）
  findLanding(around) {
    const rng = this.rng;
    const w = this.world;
    for (let k = 0; k < 30; k++) {
      const a = rng() * Math.PI * 2;
      const r = 45 + rng() * 70;
      const x = Math.round(around[0] + Math.cos(a) * r), z = Math.round(around[2] + Math.sin(a) * r);
      if (!w.chunks.has(chunkKeyAt(x, z))) continue;
      const g = this.floorAt(x, z); // 川や池なら水面に降りる
      if (this.clearance(x, z, 14, true) > g + 7) continue; // 小さな岩くらいは気にしない
      let flat = true;
      for (const [dx, dz] of [[-20, 0], [20, 0], [0, -20], [0, 20]]) {
        if (Math.abs(this.floorAt(x + dx, z + dz) - g) > 6) flat = false;
      }
      if (flat) return { x, y: g, z };
    }
    return null;
  }

  // 火を吹く相手: 近くの木（なければ前の地面）
  findFireTarget() {
    let best = null;
    let bd = 95;
    for (const tree of this.world.trees.values()) {
      const { x, y, z } = tree.spec;
      const d = Math.hypot(x - this.head[0], z - this.head[2]);
      if (d < bd && d > 30) {
        bd = d;
        best = [x + 0.5, y + tree.height * 0.6, z + 0.5];
      }
    }
    if (best) return best;
    const fx = this.head[0] + Math.sin(this.yaw) * 45, fz = this.head[2] + Math.cos(this.yaw) * 45;
    return [fx, this.floorAt(fx, fz), fz];
  }

  // 降りて歩き始める（テストや、降りてきたとき）。trail は今の向きのまま地面に沿わせる
  land(x, z, yaw = this.yaw) {
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.head = [x, this.floorAt(x, z) + HEAD_FLOOR, z];
    this.trail = [];
    for (let s = 0; s <= DRAGON_LENGTH + 20; s += 3) {
      const px = x - Math.sin(yaw) * s, pz = z - Math.cos(yaw) * s;
      this.trail.push({ p: [px, this.floorAt(px, pz) + HEAD_FLOOR, pz], roll: 0, w: 1 });
    }
    this.groundW = 1;
    this.startWalking();
  }

  startWalking() {
    this.setMode('walk');
    this.walkClock = 0;
    this.walkTime = 36 + this.rng() * 16;
    this.nextBreath = this.anger > 0 ? 1 : 5 + this.rng() * 4;
    this.walkTarget = null;
    this.speed = Math.min(this.speed, WALK_SPEED);
  }

  // 1回分の行動（状態ごとに頭を動かす）
  advance(dt, around) {
    const rng = this.rng;
    this.time += dt;
    this.modeTime += dt;
    this.anger = Math.max(0, this.anger - dt);
    switch (this.mode) {
      case 'fly':
        // 怒っているときは、すぐにプレイヤーの近くへ降りる場所を探す
        if (this.anger > 0 && this.time >= (this.angerLanding ?? 0)) {
          const spot = this.findLanding(around);
          if (spot) {
            this.landing = spot;
            this.setMode('descend');
          } else {
            this.angerLanding = this.time + 1;
          }
        } else if (this.modeTime > this.nextLanding) {
          const spot = this.findLanding(around);
          if (spot) {
            this.landing = spot;
            this.setMode('descend');
          } else {
            this.nextLanding = this.modeTime + 4;
          }
        }
        this.flyStep(dt, around);
        break;
      case 'descend': {
        const L = this.landing;
        const dist = Math.hypot(L.x - this.head[0], L.z - this.head[2]);
        if (dist < 30 && this.head[1] < L.y + HEAD_FLOOR + 12) {
          this.startWalking();
          // 着地: 勢いで体が沈み込み、頭は前へつんのめってから戻る
          this.animKick('squatV', 16);
          this.animKick('pullV', -40);
        }
        else if (this.modeTime > 35) {
          this.setMode('fly');
          this.nextLanding = 10;
        }
        this.flyStep(dt, around);
        break;
      }
      case 'walk':
      case 'aim':
      case 'breathe':
        this.walkClock += dt;
        this.groundStep(dt, around);
        break;
      case 'takeoff':
        // 飛び立つ前に身を低くかがめてから、勢いよく跳び上がる
        if (this.modeTime < CROUCH) {
          this.speed = approach(this.speed, 0, 30 * dt);
          this.head[0] += Math.sin(this.yaw) * this.speed * dt;
          this.head[2] += Math.cos(this.yaw) * this.speed * dt;
          this.launched = false;
          break;
        }
        if (!this.launched) {
          this.launched = true;
          this.speed = SPEED * 1.5;
          this.pitch = MAX_PITCH * 1.7;
          this.animKick('squatV', -14); // 伸び上がる
        }
        this.flyStep(dt, around);
        if (this.modeTime > 3.5 + CROUCH) {
          this.setMode('fly');
          this.nextLanding = 26 + rng() * 14;
        }
        break;
    }
    const grounded = GROUNDED.has(this.mode) || (this.mode === 'takeoff' && this.modeTime < CROUCH);
    this.groundW = approach(this.groundW, grounded ? 1 : 0, dt / 1.4);
    this.rear = approach(this.rear, this.mode === 'breathe' ? 1 : 0, dt / 0.9);
    // 降りたあと、空に残っている胴と尾も数秒かけて地面へ下ろす（頭から順に）
    if (GROUNDED.has(this.mode)) {
      for (let i = 0; i < this.trail.length; i++) {
        const q = this.trail[i];
        if (q.w < 1) q.w = Math.min(1, q.w + (dt / 5) * Math.max(0.3, 1 - i / this.trail.length));
      }
    }
    const last = this.trail[0];
    if (Math.hypot(...sub(this.head, last.p)) > 0.05) this.trail.unshift({ p: [...this.head], roll: this.roll, w: this.groundW });
    else last.w = this.groundW;
    // 胴の長さ分だけ残す
    let len = 0;
    for (let i = 1; i < this.trail.length; i++) {
      len += Math.hypot(...sub(this.trail[i].p, this.trail[i - 1].p));
      if (len > DRAGON_LENGTH + 20) {
        this.trail.length = i + 1;
        break;
      }
    }
  }

  // 地面を歩く（立ち止まって火を吹くときも）
  groundStep(dt, around) {
    const rng = this.rng;
    const angry = this.anger > 0;
    // 怒っているときの相手: プレイヤーの胸
    const foe = [around[0] + 4.5, around[1] + 9, around[2] + 4.5];
    if (this.mode === 'walk') {
      if (angry) this.walkTime = Math.max(this.walkTime, this.walkClock + 5); // 怒っている間は飛び去らない
      if (this.walkClock > this.walkTime) {
        this.setMode('takeoff');
        return this.flyStep(dt, around);
      }
      if (this.walkClock > this.nextBreath) {
        this.fireTarget = angry ? foe : this.findFireTarget();
        this.setMode('aim');
      }
      this.walkTargetLeft = (this.walkTargetLeft ?? 0) - dt;
      if (angry) {
        this.walkTarget = foe; // プレイヤーへ向かって歩く
      } else if (!this.walkTarget || this.walkTargetLeft <= 0 || Math.hypot(this.walkTarget[0] - this.head[0], this.walkTarget[2] - this.head[2]) < 20) {
        // プレイヤーのまわりの開けた所を目指して歩く
        let t = null;
        for (let k = 0; k < 12 && !t; k++) {
          const a = rng() * Math.PI * 2, r = 30 + rng() * 60;
          const x = around[0] + Math.cos(a) * r, z = around[2] + Math.sin(a) * r;
          if (!this.world.chunks.has(chunkKeyAt(Math.round(x), Math.round(z)))) continue;
          if (this.clearance(x, z, 9, true) <= this.floorAt(x, z) + 4) t = [x, 0, z];
        }
        this.walkTarget = t ?? [this.head[0] + Math.sin(this.yaw + rng() - 0.5) * 60, 0, this.head[2] + Math.cos(this.yaw + rng() - 0.5) * 60];
        this.walkTargetLeft = 10 + rng() * 6;
      }
    }
    if (angry && this.mode !== 'walk') this.fireTarget = foe; // 逃げても追って向きを変える
    const target = this.mode === 'walk' ? this.walkTarget : this.fireTarget;
    const to = [target[0] - this.head[0], 0, target[2] - this.head[2]];
    let wantYaw = Math.atan2(to[0], to[2]);
    let wantSpeed = this.mode === 'walk' ? WALK_SPEED : this.mode === 'aim' ? WALK_SPEED * 0.6 : 0;
    if (this.mode === 'aim') {
      const facing = Math.abs(wrap(wantYaw - this.yaw)) < 0.3;
      if ((facing && Math.hypot(to[0], to[2]) < 85) || this.modeTime > 5) this.setMode('breathe');
    } else if (this.mode === 'breathe' && this.modeTime > WINDUP + BREATH_TIME + 0.6) {
      this.mode = 'walk';
      this.modeTime = 0;
      this.nextBreath = this.walkClock + (angry ? 2.5 + rng() * 2 : 9 + rng() * 6);
    }
    // 木や岩を避ける: 前が塞がっていたら、空いている側へ曲がる
    if (this.mode !== 'breathe') {
      const blocked = (yaw, d) => {
        const x = this.head[0] + Math.sin(yaw) * d, z = this.head[2] + Math.cos(yaw) * d;
        return this.clearance(x, z, 7, true) > this.floorAt(x, z) + 6;
      };
      if (blocked(this.yaw, 14) || blocked(this.yaw, 26)) {
        const left = blocked(this.yaw + 0.8, 22), right = blocked(this.yaw - 0.8, 22);
        wantYaw = this.yaw + (left && !right ? -1.2 : 1.2);
        wantSpeed *= 0.5;
      }
    }
    this.yaw += Math.max(-WALK_TURN * dt, Math.min(WALK_TURN * dt, wrap(wantYaw - this.yaw)));
    this.speed = approach(this.speed, wantSpeed, 18 * dt);
    this.roll = approach(this.roll, 0, dt);
    this.pitch = approach(this.pitch, 0, dt);
    this.head[0] += Math.sin(this.yaw) * this.speed * dt;
    this.head[2] += Math.cos(this.yaw) * this.speed * dt;
    const floor = this.floorAt(this.head[0], this.head[2]) + HEAD_FLOOR;
    this.head[1] = this.head[1] > floor ? Math.max(floor, this.head[1] - 25 * dt) : floor;
    this.walked += this.speed * dt;
  }

  // 次に向かう点: プレイヤーのまわりを大きく回る。ときどき低く降りてくる
  pickWaypoint(around) {
    const rng = this.rng;
    const a = rng() * Math.PI * 2;
    const r = 60 + rng() * 50;
    const x = around[0] + Math.cos(a) * r, z = around[2] + Math.sin(a) * r;
    const floor = this.clearance(x, z, 16);
    const low = rng() < 0.3;
    const y = Math.min(HEIGHT - 20, floor + (low ? SAFE + 3 : SAFE + 18 + rng() * 25));
    this.waypoint = [x, y, z];
    this.waypointLeft = 8 + rng() * 6;
  }

  // 空を飛ぶ（降りてくるとき・飛び立つときも）
  flyStep(dt, around) {
    const descending = this.mode === 'descend';
    const takeoff = this.mode === 'takeoff';
    this.waypointLeft -= dt;
    if (descending) this.waypoint = [this.landing.x, this.landing.y + HEAD_FLOOR, this.landing.z];
    else if (!this.waypoint || this.waypointLeft <= 0 || Math.hypot(...sub(this.waypoint, this.head)) < 25) this.pickWaypoint(around);
    const to = sub(this.waypoint, this.head);
    // 降りる場所の真上近くでは、ゆっくり・急角度で森の切れ目へ舞い降りる
    const final = descending && Math.hypot(to[0], to[2]) < 50;
    this.speed = approach(this.speed, final ? SPEED * 0.5 : descending ? SPEED * 0.75 : SPEED, 12 * dt);
    const wantYaw = Math.atan2(to[0], to[2]);
    let dy = ((wantYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turnRate = final ? TURN * 2.2 : TURN;
    const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, dy));
    this.yaw += turn;
    this.roll += (Math.max(-0.6, Math.min(0.6, (turn / dt) * 1.4)) - this.roll) * Math.min(1, dt * 2);
    let wantPitch = Math.atan2(to[1], Math.hypot(to[0], to[2]));
    // 先の方に木や丘があれば上がる。降りる場所の近くでは、人は気にせず地面まで降りる
    const nearLanding = descending && Math.hypot(to[0], to[2]) < 70;
    const gap = nearLanding ? HEAD_FLOOR - 2 : SAFE;
    const fwd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const ahead = add(this.head, mul(fwd, 30));
    const probe = final ? 6 : 20;
    const minY = final
      ? this.clearance(this.head[0], this.head[2], probe, true) + gap
      : Math.max(this.clearance(this.head[0], this.head[2], probe, nearLanding), this.clearance(ahead[0], ahead[2], probe, nearLanding)) + gap;
    if (this.head[1] < minY + 4) wantPitch = MAX_PITCH;
    if (takeoff) wantPitch = MAX_PITCH;
    const minPitch = final ? -1.3 : descending ? -0.6 : -MAX_PITCH;
    wantPitch = Math.max(minPitch, Math.min(MAX_PITCH, wantPitch));
    const climb = final ? CLIMB * 2.5 : CLIMB;
    this.pitch += Math.max(-climb * dt, Math.min(climb * dt, wantPitch - this.pitch));
    const dir = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
    this.head = add(this.head, mul(dir, this.speed * dt));
    const floor = this.clearance(this.head[0], this.head[2], probe, nearLanding) + (nearLanding ? HEAD_FLOOR - 2 : SAFE - 3);
    // 低すぎるときは持ち上げる。一度に跳ね上げると軌跡（胴）が折れるので、速さの分までにする
    if (this.head[1] < floor) this.head[1] = Math.min(floor, this.head[1] + this.speed * dt);
    this.head[1] = Math.min(HEIGHT - 16, this.head[1]);
  }

  get blowing() {
    return this.mode === 'breathe' && this.modeTime >= WINDUP && this.modeTime < WINDUP + BREATH_TIME;
  }

  animKick(key, v) {
    this.anim[key] = (this.anim[key] ?? 0) + v;
  }

  // 動きの表情を 1 回分進める（予備動作・余韻・ゆれ）
  animate(dt) {
    const A = this.anim;
    // 火を吹く: ため（首を引き、胸いっぱいに息を吸う）→ 一気に頭を突き出して吐く → 吐き終わると頭が反動で揺れて戻る
    let pull = 0, lift = 0, inhale = 0;
    if (this.mode === 'breathe') {
      const T = this.modeTime;
      if (T < WINDUP) {
        const u = ease(T / WINDUP);
        pull = 9 * u;
        lift = 5 * u;
        inhale = u;
      } else if (T < WINDUP + BREATH_TIME) {
        const u = (T - WINDUP) / BREATH_TIME;
        pull = -6 + 3 * u;
        inhale = 1 - u;
        this.recoiled = false;
      } else if (!this.recoiled) {
        // 吐き終わり: 反動で頭が後ろへ揺り戻される
        this.recoiled = true;
        this.animKick('pullV', 30);
      }
    }
    // 降りる直前: 頭を起こして勢いを殺す
    if (this.mode === 'descend' && this.landing) {
      const d = Math.hypot(this.landing.x - this.head[0], this.landing.z - this.head[2]);
      if (d < 60) {
        const u = 1 - d / 60;
        lift = 7 * u;
        pull = 4 * u;
      }
    }
    const takeoffCrouch = this.mode === 'takeoff' && this.modeTime < CROUCH;
    const snapping = this.blowing; // 吐く瞬間は鋭く、そのあとはゆったり揺れる
    spring(A, 'pull', pull, snapping ? 3 : 1.3, snapping ? 0.3 : 0.2, dt);
    spring(A, 'lift', lift, 1.2, 0.35, dt);
    spring(A, 'squat', takeoffCrouch ? ease(this.modeTime / (CROUCH * 0.7)) : 0, 1.4, 0.3, dt);
    A.inhale = this.mode === 'breathe' ? inhale : approach(A.inhale, 0, dt * 2);
    // 髭・鬣・尾の房: 頭の向きの変わり方や速さの変化に遅れてなびき、止まっても揺れが残る
    const yawRate = wrap(this.yaw - (this.prevYaw ?? this.yaw)) / dt;
    const pitchRate = (this.pitch - (this.prevPitch ?? this.pitch)) / dt;
    const acc = (this.speed - (this.prevSpeed ?? this.speed)) / dt;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevSpeed = this.speed;
    const clampV = (v, m) => Math.max(-m, Math.min(m, v));
    spring(A, 'lagB', clampV(-yawRate * 1.8, 1.3), 1.1, 0.22, dt);
    spring(A, 'lagN', clampV(-pitchRate * 1.5 - A.liftV * 0.04, 1), 1.0, 0.22, dt);
    spring(A, 'lagF', clampV(-acc / 35, 0.7), 0.9, 0.25, dt);
    spring(A, 'tail', clampV(-yawRate * 2.2, 1.5), 0.6, 0.2, dt);
    // ひるみ
    for (const f of this.flinches) f.t += dt;
    this.flinches = this.flinches.filter((f) => f.t < 1.4);
    // まばたき（ときどき 2 回続けて）
    if (this.time > this.blinkAt + 0.2) this.blinkAt = this.time + (this.rng() < 0.2 ? 0.25 : 2.5 + this.rng() * 4);
  }

  get blinking() {
    return this.time >= this.blinkAt && this.time < this.blinkAt + 0.2;
  }

  // 撃たれた・切られた所で、体がびくっとよじれ、頭が跳ね上がる
  flinch(p, strength = 1) {
    const q = this.nearestSpine(p);
    if (!q) return;
    const d = norm(sub(q.c, p));
    const old = this.flinches.find((f) => f.t < 0.12 && Math.abs(f.s - q.s) < 20);
    if (old) old.a = Math.min(5, old.a + strength * 0.6);
    else this.flinches.push({ s: q.s, d, a: Math.min(5, 2.5 * strength), t: 0 });
    if (this.flinches.length > 6) this.flinches.shift();
    if ((this.flinchHead ?? -1) < this.time - 0.15) {
      this.flinchHead = this.time;
      this.animKick('liftV', 22 * strength);
      this.animKick('pullV', 14 * strength);
      this.blinkAt = this.time; // 思わず目をつぶる
    }
  }

  // 胸のふくらみ（息を吸う・ふだんの呼吸）。胴の太さに掛ける
  swell(s) {
    const bell = Math.exp(-(((s - 75) / 45) ** 2));
    return 1 + bell * (this.anim.inhale * 0.3 + 0.06 * Math.sin(this.time * 1.5));
  }

  // 軌跡に沿って、頭から距離 s の位置・向き・傾きを求める
  spine() {
    const pts = [];
    let acc = 0;
    let i = 0;
    const tr = this.trail;
    for (let s = 0; s <= DRAGON_LENGTH; s += SPINE_STEP) {
      while (i < tr.length - 2) {
        const seg = Math.hypot(...sub(tr[i + 1].p, tr[i].p));
        if (acc + seg >= s) break;
        acc += seg;
        i++;
      }
      const a = tr[i], b = tr[i + 1] ?? tr[i];
      const seg = Math.hypot(...sub(b.p, a.p)) || 1;
      const t = Math.min(1, (s - acc) / seg);
      const p = add(a.p, mul(sub(b.p, a.p), t));
      const T = norm(sub(a.p, b.p)); // 頭の方向
      let B = norm(cross(T, [0, 1, 0])); // 横
      let N = cross(B, T); // 上
      const roll = a.roll + (b.roll - a.roll) * t;
      B = rotateAround(B, T, roll);
      N = rotateAround(N, T, roll);
      // 地面に沿う度合い（その点を頭が通ったときの値）
      const w = (a.w ?? 0) + ((b.w ?? 0) - (a.w ?? 0)) * t;
      // 後ろへ流れる波でうねる（横に大きく、縦に小さく）。地面では縦に揺れず、止まっているときは小さく
      const ph = (s / 120) * Math.PI * 2 - this.time * 2.2;
      const amp = waveAt(s) * (1 - w * (0.45 - 0.25 * Math.min(1, this.speed / WALK_SPEED)));
      const center = add(p, add(mul(B, Math.sin(ph) * amp), mul(N, Math.cos(ph * 0.5) * amp * 0.35 * (1 - w))));
      if (w > 0) {
        // 地面から腹までのすき間をあけて這う。頭のあたりは高く、火を吹くときは首をもたげる
        const r = radiusAt(s);
        const off = s < 40 ? HEAD_FLOOR + (r + BELLY - HEAD_FLOOR) * (s / 40) : r + BELLY;
        const lift = this.rear * 18 * Math.max(0, 1 - s / 90) ** 1.6;
        // かがむと体が沈み、頭は大きく下がる（伸び上がるときは逆）
        const squat = this.anim.squat * (s < 50 ? 2 + 6 * (1 - s / 50) : 2);
        const want = this.floorAt(center[0], center[2]) + off + lift - squat;
        center[1] += (want - center[1]) * w;
      }
      // 頭を引く・突き出す・持ち上げる（首の付け根に向かって弱まる）
      if (s < 80) {
        const k = (1 - s / 80) ** 2;
        const pl = this.anim.pull * k, lf = this.anim.lift * k;
        center[0] -= T[0] * pl;
        center[1] -= T[1] * pl - lf;
        center[2] -= T[2] * pl;
      }
      // ひるみ: 当たった所が押されるように曲がり、揺れながら戻る
      for (const f of this.flinches) {
        const g = Math.exp(-(((s - f.s) / 22) ** 2));
        if (g < 0.02) continue;
        const a = f.a * g * Math.exp(-4 * f.t) * Math.cos(11 * f.t);
        center[0] += f.d[0] * a;
        center[1] += f.d[1] * a;
        center[2] += f.d[2] * a;
      }
      pts.push({ s, c: center, T, N, B, w });
    }
    // うねりを加えたあとの向きを付け直す
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 2)], b = pts[Math.min(pts.length - 1, k + 2)];
      const T = norm(sub(a.c, b.c));
      const B = norm(cross(T, pts[k].N));
      pts[k].T = T;
      pts[k].B = B;
      pts[k].N = cross(B, T);
    }
    this.pts = pts;
    return pts;
  }

  // いまの姿のセルを作る
  // emit(x, y, z, color) を、龍の体の各セルについて呼ぶ（同じセルが何度か来ることもある）
  // from / to: 頭からの距離でこの範囲だけ描く（尾を切り落とすときに使う）
  // all: プレイヤーから遠い所も描く（world.drawRadius があるときは、ふだんはプレイヤーのまわりだけ描く）
  // skip(中心, 大きさ): 描かなくてよい部分（なければ、細かく描く範囲の外）
  shape(emit, from = 0, to = this.length, all = false, skip = null) {
    const put = (p, color) => {
      const y = Math.floor(p[1]);
      if (y < 1 || y >= HEIGHT) return;
      emit(Math.floor(p[0]), y, Math.floor(p[2]), color);
    };
    const putXYZ = (x, y, z, color) => {
      if (y < 1 || y >= HEIGHT) return;
      emit(Math.floor(x), Math.floor(y), Math.floor(z), color);
    };
    // 描かなくてよい所: 見えている範囲（チャンクを描く範囲）より遠い所。描いても誰にも見えず、重くなるだけなので
    const F = all ? null : this.drawFocus, FR = this.world.drawRadius;
    const far = skip ?? ((p, extra) => Boolean(F && FR) && Math.max(Math.abs(p[0] - F[0]), Math.abs(p[2] - F[2])) > FR + extra);
    const pts = this.spine();
    const t = this.time;
    const keep = (s) => s >= from && s <= to;
    // 切り口・切り傷の断面の色: 中心からの距離で 脂 → 肉 → 骨
    const fleshColor = (rho, r, x, y, z) =>
      rho > r - 0.7 ? FAT : rho < 1.3 && r > 2.5 ? BONE : FLESH[hash3(x, y, z) % FLESH.length];

    // 胴: 太さの変わる管。ボクセルごとに背骨からの距離を測り、表面から SHELL の厚さの所だけを点灯する
    // （点を並べるのではなく1つずつ調べるので、斜めから見ても隙間ができない）。中は空。
    // 切り傷や切り口では、削れた面から SHELL の厚さの所に肉の断面を描くので、そこからも中は見えない
    // 背骨の点の間が空いている所（軌跡が急に曲がった所など）には、間の点を足して隙間をなくす
    const rings = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      rings.push(a);
      const b = pts[k + 1];
      if (!b) break;
      const gap = Math.hypot(b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]);
      const m = Math.ceil(gap / (SLAB_MIN * 2)) - 1; // 受け持ちの厚み（2 × SLAB_MIN）で届く間は足さない
      for (let i = 1; i <= m; i++) {
        const f = i / (m + 1);
        const mix = (p, q) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f];
        const T = norm(mix(a.T, b.T));
        const B = norm(cross(T, mix(a.N, b.N)));
        rings.push({ s: a.s + (b.s - a.s) * f, c: mix(a.c, b.c), T, N: cross(B, T), B });
      }
    }
    for (let k = 0; k < rings.length; k++) {
      const { s, c, T, N, B } = rings[k];
      if (s < 3 || !keep(s) || far(c, 20)) continue;
      const r = radiusAt(s) * this.swell(s);
      const band = Math.floor(s / 2.2);
      // 急に曲がる所では、曲がりの外側がとなりの点の受け持ちから外れないよう、受け持つ厚みを広げる
      let bend = 0;
      for (const j of [k - 1, k + 1]) {
        const q = rings[j];
        if (q) bend = Math.max(bend, Math.acos(Math.min(1, q.T[0] * T[0] + q.T[1] * T[1] + q.T[2] * T[2])));
      }
      const SLAB = SLAB_MIN + r * bend;
      const cap = (from > 0 && s - from < SPINE_STEP * 1.5) || (to < DRAGON_LENGTH && to - s < SPINE_STEP * 1.5);
      // この輪にかかる切り傷: 向き th の側から V 字に削れている。真ん中が一番深い
      const cuts = cutsNear(this.wounds, s, r, SLAB);
      const holes = this.pocks.length ? pocksNear(this.pocks, s, r, SLAB + SHELL) : NO_HOLES;
      const r2 = r * r;
      const inner = Math.max(0, r - SHELL);
      const inner2 = cuts.length || holes.length || cap ? -1 : inner * inner; // 切り傷も切り口もなければ、中の空洞はすぐに飛ばせる
      // 背骨の向きに一番近い軸を内側のループにし、その軸では「受け持つ厚み」に入る範囲だけを調べる
      const ax = Math.abs(T[0]) >= Math.abs(T[1]) && Math.abs(T[0]) >= Math.abs(T[2]) ? 0 : Math.abs(T[1]) >= Math.abs(T[2]) ? 1 : 2;
      const [a1, a2] = [0, 1, 2].filter((a) => a !== ax);
      const ext = (a) => Math.abs(T[a]) * SLAB + Math.sqrt(Math.max(0, 1 - T[a] * T[a])) * r + 0.5;
      // 輪の厚みの中で、背骨からの距離がどれだけ変わりうるか（輪の端と真ん中の差）
      const pad = SLAB * Math.sqrt(Math.max(0, 1 - T[ax] * T[ax])) / Math.max(0.3, Math.abs(T[ax])) + 0.9;
      const cell = [0, 0, 0];
      const e1 = ext(a1), e2 = ext(a2);
      const i1a = Math.floor(c[a1] - e1), i1b = Math.floor(c[a1] + e1), i2a = Math.floor(c[a2] - e2), i2b = Math.floor(c[a2] + e2);
      const Ta1 = T[a1], Ta2 = T[a2], Tax = T[ax], Na1 = N[a1], Na2 = N[a2], Nax = N[ax], Ba1 = B[a1], Ba2 = B[a2], Bax = B[ax];
      const nCuts = cuts.length;
      for (let i1 = i1a; i1 <= i1b; i1++) {
        const d1 = i1 + 0.5 - c[a1];
        for (let i2 = i2a; i2 <= i2b; i2++) {
          const d2 = i2 + 0.5 - c[a2];
          // t = d1*T[a1] + d2*T[a2] + d3*T[ax] が ±SLAB に入る d3 の範囲
          const t0 = d1 * Ta1 + d2 * Ta2;
          const u0 = d1 * Na1 + d2 * Na2;
          const v0 = d1 * Ba1 + d2 * Ba2;
          // 輪の真ん中（t = 0）での背骨からの距離が、殻から大きく外れていれば飛ばす
          const dm = -t0 / Tax;
          const um = u0 + dm * Nax, vm = v0 + dm * Bax;
          const rm2 = um * um + vm * vm;
          if (rm2 > (r + pad) * (r + pad) || (inner2 > 0 && rm2 < Math.max(0, inner - pad) ** 2)) continue;
          const ta = (-SLAB - t0) / Tax, tb = (SLAB - t0) / Tax;
          const lo3 = Math.ceil(Math.min(ta, tb) + c[ax] - 0.5), hi3 = Math.floor(Math.max(ta, tb) + c[ax] - 0.5);
          for (let i3 = lo3; i3 <= hi3; i3++) {
            const d3 = i3 + 0.5 - c[ax];
            const u = u0 + d3 * Nax;
            const v = v0 + d3 * Bax;
            const rho2 = u * u + v * v;
            if (rho2 > r2 || rho2 < inner2) continue;
            const t = t0 + d3 * Tax;
            cell[a1] = i1;
            cell[a2] = i2;
            cell[ax] = i3;
            const x = cell[0], y = cell[1], z = cell[2];
            if (y < 1 || y >= HEIGHT) continue;
            // 切り傷で削れた所は描かない。削れた面のすぐ下は肉の断面
            let face = Infinity;
            let removed = false;
            if (nCuts) for (const q of cuts) {
              const ds = Math.abs(s + t - q.ws);
              if (ds > q.half) continue;
              const e = u * q.cu0 + v * q.su0 - (q.deep + (r - q.deep) * (ds / q.half));
              if (e > 0) {
                removed = true;
                break;
              }
              face = Math.min(face, -e / q.norm);
            }
            // 弾痕の穴の中は描かない。穴の面のすぐ下は肉
            if (!removed) for (const h of holes) {
              const ds = s + t - h.ws;
              if (ds > h.a + SHELL || ds < -h.a - SHELL) continue; // 穴のまわりの肉の層まで調べる
              const e = pockDist(h, ds, u, v);
              if (e < 0) {
                removed = true;
                break;
              }
              face = Math.min(face, e);
            }
            if (removed) continue;
            const rho = Math.sqrt(rho2);
            const skin = rho >= inner;
            const cutFace = face < SHELL || cap;
            if (!skin && !cutFace) continue;
            let color;
            if (cutFace && (cap || face < 1.2 || !skin)) {
              color = fleshColor(rho, r, x, y, z);
            } else {
              const cu = rho > 0 ? u / rho : 1;
              if (cu < -0.55) color = band % 3 === 0 ? C.bellyLine : C.belly;
              else if (cu > 0.93) color = C.ridge;
              else {
                const th = fastAtan2(v, u) + Math.PI;
                const cellc = (band + Math.floor((th * r) / 2.2)) % 2;
                color = cellc ? C.scaleA : (hash3(band, Math.floor(th * 6), 3) % 5 === 0 ? C.scaleC : C.scaleB);
              }
            }
            emit(x, y, z, color);
          }
        }
      }
      for (const q of cuts) q.c0 = q.deep + (r - q.deep) * Math.min(1, Math.abs(s - q.ws) / q.half);
      // 背びれ: のこぎり状
      if (s > 40 && s < DRAGON_LENGTH - 28 && !cuts.some((q) => q.c0 < r * 0.2 && q.cu0 > 0.3)) {
        const hgt = 1.5 + 2.8 * ((s % 7) / 7) * Math.min(1, r / 4);
        for (let h = 0.5; h <= hgt; h += 0.5) putXYZ(c[0] + N[0] * (r + h), c[1] + N[1] * (r + h), c[2] + N[2] * (r + h), h > hgt - 1 ? C.finTip : C.fin);
      }
      // 尾の先の炎のような房
      if (s > DRAGON_LENGTH - 30) {
        const k = (s - (DRAGON_LENGTH - 30)) / 30;
        const len = 2 + 9 * Math.sin(k * Math.PI) ** 0.7;
        for (const [dn, db] of [[1, 0], [-1, 0], [0.7, 0.7], [0.7, -0.7], [-0.6, 0.8], [-0.6, -0.8]]) {
          const flick = Math.sin(t * 6 + s * 0.5 + dn * 3) * 1.2 + this.anim.tail * 4;
          for (let h = 0; h <= len; h += 0.5) {
            const a = dn * (r + h), b = db * (r + h) + flick * (h / len);
            putXYZ(c[0] + N[0] * a + B[0] * b, c[1] + N[1] * a + B[1] * b, c[2] + N[2] * a + B[2] * b, h > len * 0.6 ? C.finTip : C.fin);
          }
        }
      }
    }


    // 四肢: 飛ぶときは泳ぐように前後に掻き、歩くときは足を地面につけて交互に運ぶ
    const lerp3 = (a, b, k) => add(a, mul(sub(b, a), k));
    const stride = Math.min(1, this.speed / WALK_SPEED);
    for (const [sLeg, phase, walkPhase] of [[78, 0, 0], [232, Math.PI * 0.6, Math.PI]]) {
      if (!keep(sLeg)) continue;
      const k = Math.round(sLeg / SPINE_STEP);
      const { c, T, N, B, w } = pts[k];
      if (far(c, 30)) continue;
      const r = radiusAt(sLeg);
      const Th = norm([T[0], 0, T[2]]);
      const Bh = norm(cross(Th, [0, 1, 0]));
      for (const side of [-1, 1]) {
        // 飛ぶとき
        const swing = Math.sin(t * 2.4 + phase + (side > 0 ? Math.PI : 0)) * 0.7;
        const hip = add(c, add(mul(B, side * r * 0.8), mul(N, -r * 0.45)));
        const down = norm(add(add(mul(N, -1), mul(B, side * 0.55)), mul(T, -0.4 + swing)));
        let knee = add(hip, mul(down, 9));
        let shin = norm(add(add(mul(N, -0.6), mul(T, 0.7 + swing * 0.5)), mul(B, side * 0.2)));
        let ankle = add(knee, mul(shin, 7));
        let claws = [-0.6, -0.2, 0.2, 0.6].map((spread) => norm(add(add(shin, mul(B, spread)), mul(N, -0.5))));
        if (w > 0) {
          // 歩くとき: 対角の足が一緒に動く。振り出す足は少し持ち上がる
          const lp = (this.walked / 26) * Math.PI * 2 + walkPhase + (side > 0 ? Math.PI : 0);
          const fx = c[0] + Bh[0] * side * (r + 4) + Th[0] * Math.sin(lp) * 5 * stride;
          const fz = c[2] + Bh[2] * side * (r + 4) + Th[2] * Math.sin(lp) * 5 * stride;
          const foot = [fx, this.floorAt(fx, fz) + 0.6 + Math.max(0, Math.cos(lp)) * 3 * stride, fz];
          const wKnee = add(lerp3(hip, foot, 0.5), add(mul(Bh, side * 3.5), [0, 2.5, 0]));
          const wClaws = [-0.6, -0.2, 0.2, 0.6].map((spread) => norm(add(add(Th, mul(Bh, side * spread)), [0, -0.2, 0])));
          knee = lerp3(knee, wKnee, w);
          ankle = lerp3(ankle, foot, w);
          claws = claws.map((cl, n) => norm(lerp3(cl, wClaws[n], w)));
        }
        tube(emit, hip, knee, 2.4, 1.8, C.scaleA);
        tube(emit, knee, ankle, 1.8, 1.3, C.scaleB);
        for (const claw of claws) tube(emit, ankle, add(ankle, mul(claw, 3.5)), 0.6, 0.4, C.claw);
      }
    }

    if (from > 0 || far(pts[0].c, 60)) return; // 頭・髭・鬣は頭の側だけ
    // 頭: 首の向きに合わせて頭の形を置く
    const { c: hc, T: hT, N: hN, B: hB } = pts[0];
    // 頭の殻: 頭のまわりの箱の中のボクセルごとに、頭の座標の格子を引く
    const { grid, palette, G } = this.headModel;
    const f1 = G.f0 + (G.nf - 1) * G.step, u1 = G.u0 + (G.nu - 1) * G.step, l1 = G.l0 + (G.nl - 1) * G.step;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const f of [G.f0, f1]) for (const u of [G.u0, u1]) for (const l of [G.l0, l1]) {
      for (let a = 0; a < 3; a++) {
        const v = hc[a] + hT[a] * f + hN[a] * u + hB[a] * l;
        lo[a] = Math.min(lo[a], v);
        hi[a] = Math.max(hi[a], v);
      }
    }
    const inv = 1 / G.step;
    const x0 = Math.floor(lo[0]), x1 = Math.floor(hi[0]);
    // 行ごとに、頭の座標の 3 つの範囲に入る x の区間だけを調べる（x に沿って f, u, l は一定の割合で変わる）
    const clip = (base, slope, a, b, range) => {
      // a <= base + slope * (x + 0.5 - hc0) <= b を満たす x の範囲を range に重ねる
      if (Math.abs(slope) < 1e-9) {
        if (base < a || base > b) range[0] = Infinity;
        return;
      }
      let p = (a - base) / slope + hc[0] - 0.5, q = (b - base) / slope + hc[0] - 0.5;
      if (p > q) [p, q] = [q, p];
      range[0] = Math.max(range[0], Math.ceil(p));
      range[1] = Math.min(range[1], Math.floor(q));
    };
    const range = [0, 0];
    for (let y = Math.max(1, Math.floor(lo[1])); y <= Math.min(HEIGHT - 1, Math.floor(hi[1])); y++) {
      const dy = y + 0.5 - hc[1];
      for (let z = Math.floor(lo[2]); z <= Math.floor(hi[2]); z++) {
        const dz = z + 0.5 - hc[2];
        const bf = dy * hT[1] + dz * hT[2], bu = dy * hN[1] + dz * hN[2], bl = dy * hB[1] + dz * hB[2];
        range[0] = x0;
        range[1] = x1;
        clip(bf, hT[0], G.f0 - 0.25, f1 + 0.25, range);
        clip(bu, hN[0], G.u0 - 0.25, u1 + 0.25, range);
        clip(bl, hB[0], G.l0 - 0.25, l1 + 0.25, range);
        for (let x = range[0]; x <= range[1]; x++) {
          const dx = x + 0.5 - hc[0];
          const i = Math.round((dx * hT[0] + bf - G.f0) * inv);
          const j = Math.round((dx * hN[0] + bu - G.u0) * inv);
          const k = Math.round((dx * hB[0] + bl - G.l0) * inv);
          if (i < 0 || i >= G.nf || j < 0 || j >= G.nu || k < 0 || k >= G.nl) continue;
          const color = grid[i + G.nf * (j + G.nu * k)];
          if (color) emit(x, y, z, palette[color]);
        }
      }
    }
    // 牙・目・角（細かいので点で置く）。まばたきの間は、目をまぶた（鱗の色）でふさぐ
    const blink = this.blinking;
    for (const [f, u, l, color0] of this.headModel.points) {
      const color = blink && (color0 === C.eye || color0 === C.pupil) ? C.ridge : color0;
      const y = Math.floor(hc[1] + hT[1] * f + hN[1] * u + hB[1] * l);
      if (y < 1 || y >= HEIGHT) continue;
      const x = Math.floor(hc[0] + hT[0] * f + hN[0] * u + hB[0] * l);
      const z = Math.floor(hc[2] + hT[2] * f + hN[2] * u + hB[2] * l);
      emit(x, y, z, color);
    }
    const h0 = pts[0];
    // 髭: 鼻先から後ろへ長くなびく
    const { T: T0, N: N0, B: B0 } = h0;
    for (const side of [-1, 1]) {
      let px = h0.c[0] + T0[0] * 26 - N0[0] + B0[0] * side * 5;
      let py = h0.c[1] + T0[1] * 26 - N0[1] + B0[1] * side * 5;
      let pz = h0.c[2] + T0[2] * 26 - N0[2] + B0[2] * side * 5;
      const A = this.anim;
      for (let i = 0; i < 90; i++) {
        // 先へいくほど、頭の動きに遅れてなびく
        const k = i / 90;
        const b = side * (0.35 + Math.sin(t * 3 + i * 0.12) * 0.35) + A.lagB * k * 1.4, n = -0.25 + Math.cos(t * 2 + i * 0.1) * 0.2 + A.lagN * k * 1.2;
        const f = 1 - A.lagF * k * 1.6;
        const dx = -T0[0] * f + B0[0] * b + N0[0] * n, dy = -T0[1] * f + B0[1] * b + N0[1] * n, dz = -T0[2] * f + B0[2] * b + N0[2] * n;
        const l = 0.5 / (Math.hypot(dx, dy, dz) || 1);
        px += dx * l;
        py += dy * l;
        pz += dz * l;
        putXYZ(px, py, pz, C.whisker);
      }
    }
    // 鬣: 頭の後ろから首にかけて、炎のように後ろへなびく房
    for (let s = 6; s < Math.min(70, to); s += 3) {
      const { c, T, N, B } = pts[Math.round(s / SPINE_STEP)];
      const r = radiusAt(s);
      for (const side of [-1, 0, 1]) {
        let px = c[0] + N[0] * r * 0.8 + B[0] * side * r * 0.6;
        let py = c[1] + N[1] * r * 0.8 + B[1] * side * r * 0.6;
        let pz = c[2] + N[2] * r * 0.8 + B[2] * side * r * 0.6;
        const len = 9 * (1 - s / 90);
        for (let h = 0; h < len; h += 0.5) {
          const b = side * 0.6 + Math.sin(t * 4 + s * 0.3 + h * 0.4) * 0.5 + this.anim.lagB * (h / len) * 1.2;
          const up = 0.8 + this.anim.lagN * (h / len) * 0.8;
          const dx = N[0] * up - T[0] + B[0] * b, dy = N[1] * up - T[1] + B[1] * b, dz = N[2] * up - T[2] + B[2] * b;
          const l = 0.5 / (Math.hypot(dx, dy, dz) || 1);
          px += dx * l;
          py += dy * l;
          pz += dz * l;
          putXYZ(px, py, pz, h > len * 0.6 ? C.maneTip : C.mane);
        }
      }
    }
  }

  // 遠くの粗いブロック用: 体全部（skip で細かく描く範囲にすっぽり入る部分を飛ばす）
  shapeAll(emit, skip) {
    this.shape(emit, 0, this.length, true, skip);
  }

  // 1回分動いて、体と炎を描き直す
  update(dt, around) {
    this.events = [];
    this.advance(dt, around);
    this.animate(dt);
    // 細かく描く範囲の中心（画面の側が決める。なければプレイヤーのまわり）
    this.drawFocus = this.world.drawCenter ?? around;
    this.version = (this.version ?? 0) + 1;
    this.fire.update(dt); // 炎の粒を動かし、当たった物を焦がす
    this.fire.clear();
    // プレイヤーから離れているときは、体を描き直すのは 2 回に 1 回（動きは毎回進める）。近くでは毎回
    const F = this.drawFocus;
    const near = !this.world.drawRadius || !this.pts || this.pts.some((q) => Math.abs(q.c[0] - F[0]) + Math.abs(q.c[2] - F[2]) < this.world.drawRadius + 20);
    this.skipped = !near && !this.skipped;
    if (!this.skipped) this.draw();
    // 火を吹く: 口から相手へ向けて、少し首を振りながら
    if (this.blowing) {
      const { mouth, dir } = this.mouth();
      this.fire.breathe(mouth, dir, 16);
    }
    this.fire.draw();
    this.entity.pos = this.head.map(Math.round);
  }

  // 体を描き直す。人・NPC がいるセルは、その物を体から離れる向きへ押しのけてから入る
  draw() {
    const { cells, pushed } = redrawBody(this.world, this.id, this.cells, (emit) => this.shape(emit), (m) => this.awayFrom(m));
    this.cells = cells;
    for (const e of pushed) this.events.push({ type: 'push', actor: this.entity, target: e });
  }

  // 位置 m から見て、龍の体から離れる向き [dx, dz]
  awayFrom(m) {
    let best = this.pts[0];
    let bd = Infinity;
    for (const p of this.pts) {
      if (p.s > this.length) break;
      const d = (p.c[0] - m[0]) ** 2 + (p.c[2] - m[2]) ** 2 + 0.25 * (p.c[1] - m[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const dx = m[0] - best.c[0], dz = m[2] - best.c[2];
    return Math.hypot(dx, dz) < 0.5 ? [best.B[0], best.B[2]] : [dx, dz];
  }

  // 斧が点 p に当たった: 胴なら、当たった側から depth ボクセル削る（frac を渡すと、胴の太さに対する割合で削る）。
  // 戻り値: null（胴に当たっていない）/ { s, f, severed }
  wound(p, depth = 2.2, frac = null) {
    if (!this.pts) return null;
    this.flinch(p, 1.2);
    let best = null;
    let bd = Infinity;
    for (const q of this.pts) {
      if (q.s < 3 || q.s > this.length) continue;
      const d = (q.c[0] - p[0]) ** 2 + (q.c[1] - p[1]) ** 2 + (q.c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (!best) return null;
    const r = radiusAt(best.s);
    const v = sub(p, best.c);
    if (Math.hypot(...v) > r + 2.5) return null; // 足・ひれ・鬣などは削らない
    const th = Math.atan2(dot(v, best.B), dot(v, best.N));
    // 近くに切り傷があれば、それを深くする（少しずれた所に当たっても、同じ傷が深くなる）
    let w = null;
    let wd = Infinity;
    for (const q of this.wounds) {
      const ds = Math.abs(q.s - best.s);
      if (ds > 2.5 + 2 * q.f + 1 || Math.abs(wrap(q.th - th)) > 1.3) continue;
      if (ds < wd) {
        wd = ds;
        w = q;
      }
    }
    if (!w) {
      w = { s: best.s, th, f: 0 };
      this.wounds.push(w);
    }
    const before = w.f;
    w.f = Math.min(1, w.f + (frac ?? depth / (2 * r)));
    // 傷がいくつも重なって胴の断面がすべて削れたら、そこで切り落とされたことにする
    // （見た目だけ切れて、体はつながったまま、ということが起きないように）
    const through = w.f >= 1 ? w.s : this.cutThrough(w.s);
    if (through !== null && through < SEVER_MIN) {
      w.f = before; // 首は切り落とせない: これ以上は深くならない
      return { s: w.s, f: w.f, severed: null };
    }
    if (through !== null) return { s: through, f: 1, severed: this.sever(through) };
    return { s: w.s, f: w.f, severed: null };
  }

  // 点 o から向き dir（長さ 1）へ飛ぶ弾が、龍の体（胴と頭）に当たる距離（当たらなければ Infinity）。
  // チャンクに描いていない遠くの体にも当たるように、セルではなく形（背骨に沿った球の列と、頭の球）で調べる。弾痕の穴は通り抜ける
  rayHit(o, dir, maxT) {
    if (!this.pts) return Infinity;
    let best = Infinity;
    const sphere = (c, r) => {
      const ox = c[0] - o[0], oy = c[1] - o[1], oz = c[2] - o[2];
      const tc = ox * dir[0] + oy * dir[1] + oz * dir[2];
      if (tc < -r || tc - r > Math.min(best, maxT)) return Infinity;
      const d2 = ox * ox + oy * oy + oz * oz - tc * tc;
      if (d2 > r * r) return Infinity;
      const t = tc - Math.sqrt(r * r - d2);
      return t >= 0 ? t : tc >= 0 ? 0 : Infinity;
    };
    for (let k = 0; k < this.pts.length; k += 2) {
      const q = this.pts[k];
      if (q.s < 3 || q.s > this.length) continue;
      const t = sphere(q.c, radiusAt(q.s));
      if (t < best && !this.inPock(add(o, mul(dir, t + 0.5)))) best = t;
    }
    // 頭（頭蓋・鼻づら・鼻先）
    const { c, T } = this.pts[0];
    for (const [f, r] of [[0, 9], [13, 6.5], [24, 5]]) best = Math.min(best, sphere(add(c, mul(T, f)), r));
    return best <= maxT ? best : Infinity;
  }

  // 点 p が弾痕の穴の中か
  inPock(p) {
    if (!this.pocks.length) return false;
    const q = this.nearestSpine(p);
    if (!q) return false;
    const r = radiusAt(q.s);
    const v = sub(p, q.c);
    const u = dot(v, q.N), w = dot(v, q.B), ds = dot(v, q.T);
    return pocksNear(this.pocks, q.s, r, 0).some((h) => pockDist(h, q.s + ds - h.ws, u, w) < 0);
  }

  // 点 p に一番近い背骨の点
  nearestSpine(p) {
    let best = null;
    let bd = Infinity;
    for (const q of this.pts ?? []) {
      if (q.s < 3 || q.s > this.length) continue;
      const d = (q.c[0] - p[0]) ** 2 + (q.c[1] - p[1]) ** 2 + (q.c[2] - p[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  // 散弾が点 p に当たった（power: 0〜1、近いほど大きい）。胴なら、丸い弾痕をあける（近くの弾痕に当たれば、それが広く深くなる）。
  // 弾痕が重なって胴の断面がすべてなくなると、そこから尾の側がちぎれて落ちる（首はちぎれない）。
  // 戻り値: null（胴に当たっていない: 頭・足・ひれなど）/ { s, depth: 胴の太さに対する深さ, severed }
  shot(p, power) {
    const q = this.nearestSpine(p);
    if (!q) return null;
    this.flinch(p, 0.5 + power);
    const r = radiusAt(q.s);
    const v = sub(p, q.c);
    if (Math.hypot(...v) > r + 2.5) return null;
    const th = Math.atan2(dot(v, q.B), dot(v, q.N));
    const ds = dot(v, q.T);
    const sHit = q.s + ds;
    let hole = null;
    for (const h of this.pocks) {
      if (Math.abs(h.s - sHit) < h.a + 2.5 && Math.abs(wrap(h.th - th)) * r < h.a + 2.5) {
        hole = h;
        break;
      }
    }
    const before = hole ? { a: hole.a, d: hole.d } : null;
    if (hole) {
      hole.a = Math.min(r * 1.15, hole.a + 0.45 * power + 0.2);
      hole.d = Math.min(2 * r + 2, hole.d + 1.5 * power + 0.5);
    } else {
      hole = { s: sHit, th, a: 1.3 + 1.1 * power, d: 1.4 + 2.8 * power };
      this.pocks.push(hole);
      if (this.pocks.length > MAX_POCKS) this.pocks.shift();
    }
    const through = this.cutThrough(hole.s);
    if (through !== null && through < SEVER_MIN) {
      // 首はちぎれない: これ以上は深くならない
      if (before) Object.assign(hole, before);
      else this.pocks.pop();
      return { s: hole.s, depth: hole.d / (2 * r), severed: null };
    }
    if (through !== null) return { s: through, depth: 1, severed: this.sever(through) };
    return { s: hole.s, depth: Math.min(1, hole.d / (2 * r)), severed: null };
  }

  // 撃たれて怒る: しばらくの間、プレイヤーの近くへ降りてきて、プレイヤーへ向けて火を吹く
  provoke() {
    const was = this.anger > 0;
    this.anger = ANGER_TIME;
    if (was) return;
    this.angerLanding = 0;
    if (this.mode === 'walk') this.nextBreath = this.walkClock; // すぐに振り向いて火を吹く
  }

  // s0 のまわりで、切り傷のせいで胴の断面がすべて削れている所の s（なければ null）
  cutThrough(s0) {
    for (let s = s0 - 6; s <= s0 + 6; s += 0.4) {
      if (s < 3 || s > this.length) continue;
      const r = radiusAt(s);
      const cuts = cutsNear(this.wounds, s, r, 0);
      const holes = pocksNear(this.pocks, s, r, 0);
      if (!cuts.length && !holes.length) continue;
      let gone = true;
      for (let u = -r + 0.3; u <= r - 0.3 && gone; u += 0.5) {
        const L = Math.sqrt(Math.max(0, r * r - u * u)) - 0.3;
        for (let v = -L; v <= L; v += 0.5) {
          let removed = false;
          for (const q of cuts) {
            const ds = Math.abs(s - q.ws);
            if (ds <= q.half && u * q.cu0 + v * q.su0 > q.deep + (r - q.deep) * (ds / q.half)) {
              removed = true;
              break;
            }
          }
          if (!removed) for (const h of holes) {
            if (pockDist(h, s - h.ws, u, v) < 0) {
              removed = true;
              break;
            }
          }
          if (!removed) {
            gone = false;
            break;
          }
        }
      }
      if (gone) return s;
    }
    return null;
  }

  // 頭から距離 sCut の所で切り落とす。尾の側は別の物（龍の尾）になって地面へ落ちる
  sever(sCut) {
    const w = this.world;
    this.wounds = this.wounds.filter((q) => Math.abs(q.s - sCut) > 5);
    this.pocks = this.pocks.filter((q) => q.s < sCut - 5);
    const tail = new Map();
    this.shape((x, y, z, color) => tail.set(`${x},${y},${z}`, [x, y, z, color]), sCut + SPINE_STEP, this.length, true);
    this.length = sCut;
    this.wounds = this.wounds.filter((q) => q.s < sCut);
    this.draw(); // 尾の側のセルが空く
    const cells = [...tail.values()].filter(([x, y, z]) => w.ownerAt(x, y, z) === 0);
    if (!cells.length) return null;
    const lo = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c[a])));
    const piece = w.spawn({
      kind: 'carcass', name: '龍の尾', priority: 8, falling: true, vy: 0, fall: 0, pos: lo,
      voxels: cells.map(([x, y, z, color]) => [x - lo[0], y - lo[1], z - lo[2], color]),
    });
    if (GROUNDED.has(this.mode)) this.setMode('takeoff'); // 痛がって飛び去る
    return piece;
  }

  // 口の位置と、炎を吹く向き
  mouth() {
    const { c, T, N } = this.pts[0];
    const mouth = add(c, add(mul(T, 22), mul(N, -5.5)));
    const target = this.fireTarget ?? add(mouth, mul(T, 40));
    let aim = norm(sub(target, mouth));
    aim = norm(add(mul(T, 0.3), mul(aim, 0.7))); // 首の向きから大きくは外れない
    const sweep = Math.sin((this.modeTime - WINDUP) * 2.4) * 0.14;
    const dir = [aim[0] * Math.cos(sweep) + aim[2] * Math.sin(sweep), aim[1], -aim[0] * Math.sin(sweep) + aim[2] * Math.cos(sweep)];
    return { mouth, dir };
  }

  // いま占有しているセルの数
  get size() {
    return this.cells.length / 2;
  }
}

// 太さの変わる管（短い部位用）
function tube(emit, a, b, r0, r1, color) {
  // 中まで詰まった管。管のまわりの箱の中のボクセルごとに、中心から管の芯までの距離を測る
  // （管が通るボクセルはすべて点灯するように、半径に半ボクセル足す）
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const R = Math.max(r0, r1) + 0.45;
  const x0 = Math.floor(Math.min(a[0], b[0]) - R), x1 = Math.floor(Math.max(a[0], b[0]) + R);
  const y0 = Math.max(1, Math.floor(Math.min(a[1], b[1]) - R)), y1 = Math.min(HEIGHT - 1, Math.floor(Math.max(a[1], b[1]) + R));
  const z0 = Math.floor(Math.min(a[2], b[2]) - R), z1 = Math.floor(Math.max(a[2], b[2]) + R);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - a[0], py = y + 0.5 - a[1], pz = z + 0.5 - a[2];
        let t = (px * abx + py * aby + pz * abz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - abx * t, dy = py - aby * t, dz = pz - abz * t;
        const r = r0 + (r1 - r0) * t + 0.45;
        if (dx * dx + dy * dy + dz * dz <= r * r) emit(x, y, z, color);
      }
    }
  }
}

// プレイヤーから少し離れた空に龍を置く
export function spawnDragon(world, near) {
  const x = near[0] - 90, z = near[2] - 60;
  const tmp = { world, columnTop: Dragon.prototype.columnTop, id: -1 };
  const floor = Dragon.prototype.clearance.call(tmp, x, z, 16);
  const dragon = new Dragon(world, [x, Math.min(HEIGHT - 30, floor + 30), z]);
  world.dragon = dragon;
  return dragon;
}

export { chunkKey, floorDiv };
