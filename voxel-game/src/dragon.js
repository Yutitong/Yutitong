// 龍（東洋の龍）: 全長およそ 60m（400 ボクセル）。森の上の空をうねりながら飛び回る
//
// - 頭が飛んだ道すじ（軌跡）を胴がなぞる。そこに後ろへ流れる波を重ねてうねらせ、曲がるときは体を傾ける
// - 胴は太さの変わる管で、厚さ 2 ボクセルほどの殻だけを点灯・占有する（中は空）
// - 頭（角・鬣・髭・目・口）、短い四肢と爪、背びれ、腹板、尾の先の炎のような房
// - 1つのボクセルには1つの物だけ: 龍は空いているセルにしか入らず、他の物を押し出さない

import { mulberry32, hash3, shade } from './rng.js';
import { CHUNK, HEIGHT, floorDiv, chunkKey, chunkKeyAt, cellIndex } from './grid.js';

export const DRAGON_LENGTH = 400; // ボクセル（≈ 60m）
const SPEED = 38; // ボクセル/秒（≈ 5.7 m/s）
const TURN = 0.55; // 左右に曲がる速さ（ラジアン/秒）
const CLIMB = 0.45; // 上下に向きを変える速さ
const MAX_PITCH = 0.38;
const SAFE = 13; // 頭の中心と、下の木や地面との最小のすき間
const SPINE_STEP = 0.8; // 胴を描く間隔（ボクセル）

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

const ell = (c, r) => (p) => Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);

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
  const step = 0.6;
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
        if (bestD > 1 || bestD < 0.86) continue; // 表面の薄い殻だけ
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
    this.head = [...start];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.time = 0;
    this.waypoint = null;
    this.waypointLeft = 0;
    // 軌跡: 頭が通った点（新しい順）。最初はまっすぐ後ろに伸ばしておく
    this.trail = [];
    for (let s = 0; s <= DRAGON_LENGTH + 20; s += 3) this.trail.push({ p: [start[0], start[1], start[2] - s], roll: 0 });
    this.headModel = buildHead();
    this.cells = []; // いま占有しているセル: [チャンクの番号, セル番号, ...]
  }

  // (x, z) のまわりで、龍以外の物がある一番高い所。まだ作られていない場所は地形 + 大木の高さとみなす
  clearance(x, z, radius = 20) {
    let top = 0;
    for (let dz = -radius; dz <= radius; dz += 4) {
      for (let dx = -radius; dx <= radius; dx += 4) {
        top = Math.max(top, this.columnTop(Math.round(x + dx), Math.round(z + dz)));
      }
    }
    return top;
  }

  columnTop(x, z) {
    const w = this.world;
    const c = w.chunks.get(chunkKeyAt(x, z));
    if (!c) return w.heightAt(x, z) + 95;
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
    for (let y = c.top - 1; y > 0; y--) {
      const o = c.owner[cellIndex(lx, y, lz)];
      if (o && o !== this.id) return y + 1;
    }
    return c.height[lx + CHUNK * lz];
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

  fly(dt, around) {
    this.time += dt;
    this.waypointLeft -= dt;
    if (!this.waypoint || this.waypointLeft <= 0 || Math.hypot(...sub(this.waypoint, this.head)) < 25) this.pickWaypoint(around);
    const to = sub(this.waypoint, this.head);
    const wantYaw = Math.atan2(to[0], to[2]);
    let dy = ((wantYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const turn = Math.max(-TURN * dt, Math.min(TURN * dt, dy));
    this.yaw += turn;
    this.roll += (Math.max(-0.6, Math.min(0.6, (turn / dt) * 1.4)) - this.roll) * Math.min(1, dt * 2);
    let wantPitch = Math.atan2(to[1], Math.hypot(to[0], to[2]));
    // 先の方に木や丘があれば上がる
    const fwd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const ahead = add(this.head, mul(fwd, 30));
    const minY = Math.max(this.clearance(this.head[0], this.head[2]), this.clearance(ahead[0], ahead[2])) + SAFE;
    if (this.head[1] < minY + 4) wantPitch = MAX_PITCH;
    wantPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, wantPitch));
    this.pitch += Math.max(-CLIMB * dt, Math.min(CLIMB * dt, wantPitch - this.pitch));
    const dir = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
    this.head = add(this.head, mul(dir, SPEED * dt));
    this.head[1] = Math.min(HEIGHT - 16, Math.max(this.head[1], this.clearance(this.head[0], this.head[2]) + SAFE - 3));
    this.trail.unshift({ p: [...this.head], roll: this.roll });
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
      // 後ろへ流れる波でうねる（横に大きく、縦に小さく）
      const ph = (s / 120) * Math.PI * 2 - this.time * 2.2;
      const center = add(p, add(mul(B, Math.sin(ph) * waveAt(s)), mul(N, Math.cos(ph * 0.5) * waveAt(s) * 0.35)));
      pts.push({ s, c: center, T, N, B });
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
    return pts;
  }

  // いまの姿のセルを作る
  // emit(x, y, z, color) を、龍の体の各セルについて呼ぶ（同じセルが何度か来ることもある）
  shape(emit) {
    const put = (p, color) => {
      const y = Math.floor(p[1]);
      if (y < 1 || y >= HEIGHT) return;
      emit(Math.floor(p[0]), y, Math.floor(p[2]), color);
    };
    const pts = this.spine();
    const t = this.time;

    // 胴: 太さの変わる管の殻。上は鱗、下は腹板（たくさん呼ばれるので配列を作らずに計算する）
    for (const { s, c, N, B } of pts) {
      if (s < 3) continue;
      const r = radiusAt(s);
      const band = Math.floor(s / 2.2);
      for (const rho of [r, r - 0.9]) {
        if (rho <= 0.4) continue;
        const n = Math.max(8, Math.ceil((Math.PI * 2 * rho) / 0.8));
        const ring = ringTable(n);
        for (let k = 0; k < n; k++) {
          const th = (k / n) * Math.PI * 2;
          const cu = ring.cos[k], su = ring.sin[k];
          const y = Math.floor(c[1] + (N[1] * cu + B[1] * su) * rho);
          if (y < 1 || y >= HEIGHT) continue;
          const x = Math.floor(c[0] + (N[0] * cu + B[0] * su) * rho);
          const z = Math.floor(c[2] + (N[2] * cu + B[2] * su) * rho);
          let color;
          if (cu < -0.55) color = band % 3 === 0 ? C.bellyLine : C.belly;
          else if (cu > 0.93) color = C.ridge;
          else {
            const cell = (band + Math.floor((th * rho) / 2.2)) % 2;
            color = cell ? C.scaleA : (hash3(band, k, 3) % 5 === 0 ? C.scaleC : C.scaleB);
          }
          emit(x, y, z, color);
        }
      }
      // 背びれ: のこぎり状
      if (s > 40 && s < DRAGON_LENGTH - 28) {
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

    // 四肢: 前足と後ろ足。泳ぐように前後に掻く
    for (const [sLeg, phase] of [[78, 0], [232, Math.PI * 0.6]]) {
      const k = Math.round(sLeg / SPINE_STEP);
      const { c, T, N, B } = pts[k];
      const r = radiusAt(sLeg);
      for (const side of [-1, 1]) {
        const swing = Math.sin(t * 2.4 + phase + (side > 0 ? Math.PI : 0)) * 0.7;
        const hip = add(c, add(mul(B, side * r * 0.8), mul(N, -r * 0.45)));
        const down = norm(add(add(mul(N, -1), mul(B, side * 0.55)), mul(T, -0.4 + swing)));
        const knee = add(hip, mul(down, 9));
        const shin = norm(add(add(mul(N, -0.6), mul(T, 0.7 + swing * 0.5)), mul(B, side * 0.2)));
        const ankle = add(knee, mul(shin, 7));
        tube(put, hip, knee, 2.4, 1.8, C.scaleA);
        tube(put, knee, ankle, 1.8, 1.3, C.scaleB);
        for (const spread of [-0.6, -0.2, 0.2, 0.6]) {
          const claw = norm(add(add(shin, mul(B, spread)), mul(N, -0.5)));
          tube(put, ankle, add(ankle, mul(claw, 3.5)), 0.6, 0.4, C.claw);
        }
      }
    }

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
    for (let s = 6; s < 70; s += 3) {
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

  // 1回分飛んで、体を描き直す。前の体を消してから新しい体を書く。
  // 龍は空いているセルにしか入らない（ほかの物を押し出したり上書きしたりしない）
  update(dt, around) {
    this.fly(dt, around);
    const w = this.world;
    const id = this.id;
    // 同じチャンクのセルが続くので、直前のチャンクを使い回す
    let chunk = null;
    let ck = -1;
    const use = (key) => {
      if (key !== ck) {
        ck = key;
        chunk = w.chunks.get(key) ?? w.chunkAt(Math.floor(key / 65536) - 32768, (key % 65536) - 32768);
        w.dirty.add(key);
      }
    };
    for (let n = 0; n < this.cells.length; n += 2) {
      use(this.cells[n]);
      const i = this.cells[n + 1];
      if (chunk.owner[i] !== id) continue;
      chunk.owner[i] = 0;
      chunk.color[i] = 0;
      chunk.changed.push(i);
    }
    const cells = [];
    this.shape((x, y, z, color) => {
      const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      use(chunkKey(cx, cz));
      chunk.ensure(y);
      const i = cellIndex(x - cx * CHUNK, y, z - cz * CHUNK);
      const owner = chunk.owner[i];
      if (owner !== 0 && owner !== id) return; // ほかの物がいる
      if (owner === 0) {
        chunk.owner[i] = id;
        cells.push(ck, i);
        if (y >= chunk.top) chunk.top = y + 1;
      }
      chunk.color[i] = color;
      chunk.changed.push(i);
    });
    this.cells = cells; // [チャンクの番号, セル番号, ...]
    this.entity.pos = this.head.map(Math.round);
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
  for (let s = 0; s <= len; s += 0.5) {
    const c = add(a, mul(T, s));
    const r = r0 + (r1 - r0) * (s / len);
    const n = Math.max(6, Math.ceil((Math.PI * 2 * r) / 0.7));
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      put(add(c, add(mul(N, Math.cos(th) * r), mul(B, Math.sin(th) * r))), color);
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
