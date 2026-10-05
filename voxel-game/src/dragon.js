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

export const DRAGON_MODES = {
  fly: '飛んでいる', descend: '降りてくる', walk: '歩いている', aim: '火を吹く相手を見ている',
  breathe: '火を吹いている', takeoff: '飛び立つ',
};

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
  // 点の間隔 0.55（1/√3 より細かい）・殻の厚さ 2 ボクセル以上: 頭がどの向きに回っても、
  // どのボクセルにも点が入るので、点の間に隙間ができない
  const step = 0.55;
  for (let f = -14; f <= 34; f += step) {
    for (let u = -11; u <= 13; u += step) {
      for (let l = -13; l <= 13; l += step) {
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
        points.push([f, u, l, color]);
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
  return points;
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
    this.nextBreath = 5 + this.rng() * 4;
    this.walkTarget = null;
    this.speed = Math.min(this.speed, WALK_SPEED);
  }

  // 1回分の行動（状態ごとに頭を動かす）
  advance(dt, around) {
    const rng = this.rng;
    this.time += dt;
    this.modeTime += dt;
    switch (this.mode) {
      case 'fly':
        if (this.modeTime > this.nextLanding) {
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
        if (dist < 30 && this.head[1] < L.y + HEAD_FLOOR + 12) this.startWalking();
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
        this.flyStep(dt, around);
        if (this.modeTime > 3.5) {
          this.setMode('fly');
          this.nextLanding = 26 + rng() * 14;
        }
        break;
    }
    this.groundW = approach(this.groundW, GROUNDED.has(this.mode) ? 1 : 0, dt / 1.4);
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
    if (this.mode === 'walk') {
      if (this.walkClock > this.walkTime) {
        this.setMode('takeoff');
        return this.flyStep(dt, around);
      }
      if (this.walkClock > this.nextBreath) {
        this.fireTarget = this.findFireTarget();
        this.setMode('aim');
      }
      this.walkTargetLeft = (this.walkTargetLeft ?? 0) - dt;
      if (!this.walkTarget || this.walkTargetLeft <= 0 || Math.hypot(this.walkTarget[0] - this.head[0], this.walkTarget[2] - this.head[2]) < 20) {
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
    const target = this.mode === 'walk' ? this.walkTarget : this.fireTarget;
    const to = [target[0] - this.head[0], 0, target[2] - this.head[2]];
    let wantYaw = Math.atan2(to[0], to[2]);
    let wantSpeed = this.mode === 'walk' ? WALK_SPEED : this.mode === 'aim' ? WALK_SPEED * 0.6 : 0;
    if (this.mode === 'aim') {
      const facing = Math.abs(wrap(wantYaw - this.yaw)) < 0.3;
      if ((facing && Math.hypot(to[0], to[2]) < 85) || this.modeTime > 5) this.setMode('breathe');
    } else if (this.mode === 'breathe' && this.modeTime > BREATH_TIME + 0.6) {
      this.mode = 'walk';
      this.modeTime = 0;
      this.nextBreath = this.walkClock + 9 + rng() * 6;
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
        const want = this.floorAt(center[0], center[2]) + off + lift;
        center[1] += (want - center[1]) * w;
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
  shape(emit, from = 0, to = this.length) {
    const put = (p, color) => {
      const y = Math.floor(p[1]);
      if (y < 1 || y >= HEIGHT) return;
      emit(Math.floor(p[0]), y, Math.floor(p[2]), color);
    };
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
      if (s < 3 || !keep(s)) continue;
      const r = radiusAt(s);
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
      const r2 = r * r;
      const inner = Math.max(0, r - SHELL);
      const inner2 = cuts.length || cap ? -1 : inner * inner; // 切り傷も切り口もなければ、中の空洞はすぐに飛ばせる
      // 背骨の向きに一番近い軸を内側のループにし、その軸では「受け持つ厚み」に入る範囲だけを調べる
      const ax = Math.abs(T[0]) >= Math.abs(T[1]) && Math.abs(T[0]) >= Math.abs(T[2]) ? 0 : Math.abs(T[1]) >= Math.abs(T[2]) ? 1 : 2;
      const [a1, a2] = [0, 1, 2].filter((a) => a !== ax);
      const ext = (a) => Math.abs(T[a]) * SLAB + Math.sqrt(Math.max(0, 1 - T[a] * T[a])) * r + 0.5;
      const cell = [0, 0, 0];
      for (let i1 = Math.floor(c[a1] - ext(a1)); i1 <= Math.floor(c[a1] + ext(a1)); i1++) {
        const d1 = i1 + 0.5 - c[a1];
        for (let i2 = Math.floor(c[a2] - ext(a2)); i2 <= Math.floor(c[a2] + ext(a2)); i2++) {
          const d2 = i2 + 0.5 - c[a2];
          // t = d1*T[a1] + d2*T[a2] + d3*T[ax] が ±SLAB に入る d3 の範囲
          const t0 = d1 * T[a1] + d2 * T[a2];
          const u0 = d1 * N[a1] + d2 * N[a2];
          const v0 = d1 * B[a1] + d2 * B[a2];
          const ta = (-SLAB - t0) / T[ax], tb = (SLAB - t0) / T[ax];
          const lo3 = Math.ceil(Math.min(ta, tb) + c[ax] - 0.5), hi3 = Math.floor(Math.max(ta, tb) + c[ax] - 0.5);
          for (let i3 = lo3; i3 <= hi3; i3++) {
            const d3 = i3 + 0.5 - c[ax];
            const u = u0 + d3 * N[ax];
            const v = v0 + d3 * B[ax];
            const rho2 = u * u + v * v;
            if (rho2 > r2 || rho2 < inner2) continue;
            const t = t0 + d3 * T[ax];
            cell[a1] = i1;
            cell[a2] = i2;
            cell[ax] = i3;
            const x = cell[0], y = cell[1], z = cell[2];
            if (y < 1 || y >= HEIGHT) continue;
            // 切り傷で削れた所は描かない。削れた面のすぐ下は肉の断面
            let face = Infinity;
            let removed = false;
            for (const q of cuts) {
              const ds = Math.abs(s + t - q.ws);
              if (ds > q.half) continue;
              const e = u * q.cu0 + v * q.su0 - (q.deep + (r - q.deep) * (ds / q.half));
              if (e > 0) {
                removed = true;
                break;
              }
              face = Math.min(face, -e / q.norm);
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
                const th = Math.atan2(v, u) + Math.PI;
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
        for (let h = 0.5; h <= hgt; h += 0.5) put(add(c, mul(N, r + h)), h > hgt - 1 ? C.finTip : C.fin);
      }
      // 尾の先の炎のような房
      if (s > DRAGON_LENGTH - 30) {
        const k = (s - (DRAGON_LENGTH - 30)) / 30;
        const len = 2 + 9 * Math.sin(k * Math.PI) ** 0.7;
        for (const [dn, db] of [[1, 0], [-1, 0], [0.7, 0.7], [0.7, -0.7], [-0.6, 0.8], [-0.6, -0.8]]) {
          const flick = Math.sin(t * 6 + s * 0.5 + dn * 3) * 1.2;
          for (let h = 0; h <= len; h += 0.5) {
            put(add(c, add(mul(N, dn * (r + h)), mul(B, db * (r + h) + flick * (h / len)))), h > len * 0.6 ? C.finTip : C.fin);
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
        tube(put, hip, knee, 2.4, 1.8, C.scaleA);
        tube(put, knee, ankle, 1.8, 1.3, C.scaleB);
        for (const claw of claws) tube(put, ankle, add(ankle, mul(claw, 3.5)), 0.6, 0.4, C.claw);
      }
    }

    if (from > 0) return; // 頭・髭・鬣は頭の側だけ
    // 頭: 首の向きに合わせて頭の形を置く
    const { c: hc, T: hT, N: hN, B: hB } = pts[0];
    for (const [f, u, l, color] of this.headModel) {
      const y = Math.floor(hc[1] + hT[1] * f + hN[1] * u + hB[1] * l);
      if (y < 1 || y >= HEIGHT) continue;
      const x = Math.floor(hc[0] + hT[0] * f + hN[0] * u + hB[0] * l);
      const z = Math.floor(hc[2] + hT[2] * f + hN[2] * u + hB[2] * l);
      emit(x, y, z, color);
    }
    const h0 = pts[0];
    // 髭: 鼻先から後ろへ長くなびく
    for (const side of [-1, 1]) {
      let p = add(h0.c, add(add(mul(h0.T, 26), mul(h0.N, -1)), mul(h0.B, side * 5)));
      for (let i = 0; i < 90; i++) {
        const bend = Math.sin(t * 3 + i * 0.12) * 0.35;
        const d = norm(add(add(mul(h0.T, -1), mul(h0.B, side * (0.35 + bend))), mul(h0.N, -0.25 + Math.cos(t * 2 + i * 0.1) * 0.2)));
        p = add(p, mul(d, 0.5));
        put(p, C.whisker);
      }
    }
    // 鬣: 頭の後ろから首にかけて、炎のように後ろへなびく房
    for (let s = 6; s < Math.min(70, to); s += 3) {
      const { c, T, N, B } = pts[Math.round(s / SPINE_STEP)];
      const r = radiusAt(s);
      for (const side of [-1, 0, 1]) {
        let p = add(c, add(mul(N, r * 0.8), mul(B, side * r * 0.6)));
        const len = 9 * (1 - s / 90);
        for (let h = 0; h < len; h += 0.5) {
          const sway = Math.sin(t * 4 + s * 0.3 + h * 0.4) * 0.5;
          const d = norm(add(add(mul(N, 0.8), mul(T, -1)), mul(B, side * 0.6 + sway)));
          p = add(p, mul(d, 0.5));
          put(p, h > len * 0.6 ? C.maneTip : C.mane);
        }
      }
    }
  }

  // 1回分動いて、体と炎を描き直す
  update(dt, around) {
    this.events = [];
    this.advance(dt, around);
    this.fire.update(dt); // 炎の粒を動かし、当たった物を焦がす
    this.fire.clear();
    this.draw();
    // 火を吹く: 口から相手へ向けて、少し首を振りながら
    if (this.mode === 'breathe' && this.rear > 0.55 && this.modeTime < BREATH_TIME) {
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

  // 斧が点 p に当たった: 胴なら、当たった側から depth ボクセル削る。
  // 戻り値: null（胴に当たっていない）/ { s, f, severed }
  wound(p, depth = 2.2) {
    if (!this.pts) return null;
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
    w.f = Math.min(1, w.f + depth / (2 * r));
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

  // s0 のまわりで、切り傷のせいで胴の断面がすべて削れている所の s（なければ null）
  cutThrough(s0) {
    for (let s = s0 - 6; s <= s0 + 6; s += 0.4) {
      if (s < 3 || s > this.length) continue;
      const r = radiusAt(s);
      const cuts = cutsNear(this.wounds, s, r, 0);
      if (!cuts.length) continue;
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
    const tail = new Map();
    this.shape((x, y, z, color) => tail.set(`${x},${y},${z}`, [x, y, z, color]), sCut + SPINE_STEP, this.length);
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
    const sweep = Math.sin(this.modeTime * 2.4) * 0.14;
    const dir = [aim[0] * Math.cos(sweep) + aim[2] * Math.sin(sweep), aim[1], -aim[0] * Math.sin(sweep) + aim[2] * Math.cos(sweep)];
    return { mouth, dir };
  }

  // いま占有しているセルの数
  get size() {
    return this.cells.length / 2;
  }
}

// 太さの変わる管（短い部位用）
function tube(put, a, b, r0, r1, color) {
  const d = sub(b, a);
  const len = Math.hypot(...d);
  const T = norm(d);
  const B = norm(Math.abs(T[1]) > 0.9 ? cross(T, [1, 0, 0]) : cross(T, [0, 1, 0]));
  const N = cross(B, T);
  // 中まで詰まった管（細いので、殻にせず全部埋める。点の間隔 0.45 なら斜めでも隙間ができない）
  for (let s = 0; s <= len; s += 0.45) {
    const c = add(a, mul(T, s));
    const r = r0 + (r1 - r0) * (s / len);
    for (let u = -r; u <= r; u += 0.45) {
      const L = Math.sqrt(Math.max(0, r * r - u * u));
      for (let v = -L; v <= L; v += 0.45) put(add(c, add(mul(N, u), mul(B, v))), color);
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
