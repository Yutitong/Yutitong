// 水の流れ: プレイヤーのまわりの水を、列ごとの水位で動かす
//
// - 列ごとに「床」（地面と、その上に積み重なった岩・倒木・龍の体など）と「水位」（小数）を持つ
// - となりの列との間では、高い水面から低い水面へ水が移る。量は、間の高い方の床から上にある水の厚さで決まる
//   （せきを越える水と同じ。下流の水面が低ければ勢いよく落ち、同じくらいなら少しずつ移る）
// - だから水は高い所から低い所へ流れ、淵の敷居や岩の間を抜けて段を落ちていく。
//   倒木などで流れをせき止めると、上流の水位が上がって、あふれた所から別の所へ流れる
// - 計算するのはプレイヤーのまわり 9×9 チャンクだけ。いちばん外側の列と、平地の水（池・川の行き着く先）は
//   水位が変わらない（そこから水が入ってきて、そこへ水が出ていく）
// - 表示はボクセル単位: 水位を四捨五入した高さまで水のセルを置く。水面には流れに乗って動く泡やさざ波を描き、
//   段では上の淵からあふれた水が白く落ちていく（滝）

import { CHUNK, floorDiv, chunkKey } from './grid.js';
import { EMPTY, WATER_ID, FALL_ID, GROUND_ID, ROCK_ID, PLANT_ID } from './ids.js';
import { waterColor, fallColor, withAlpha, ALPHA_SHIFT } from './terrain.js';
import { mulberry32, shade } from './rng.js';
import { MOVABLE } from './body.js';

const WATER_FLAG = 0x1000000;
export const WATER_RADIUS = 4; // 計算するチャンクの半径
const SPAN = 2 * WATER_RADIUS + 1;
const N = SPAN * CHUNK; // 一辺の列の数
const SHOW = 0.15; // これより薄い水は描かない
const ACTIVE = 0, FIXED = 1, ABSENT = 2;
const MAX_PARTS = 1200;

const FOAM = withAlpha(0xeef6f5, 0.85) | WATER_FLAG;
const SPLASH = withAlpha(0xd8edee, 0.8) | WATER_FLAG;

export class WaterSim {
  constructor(world) {
    this.world = world;
    const n = N * N;
    this.F = new Int16Array(n); // 床の高さ（水が乗る所）
    this.H = new Int16Array(n); // 地面の高さ
    this.L = new Float32Array(n); // 水位（水面の高さ。水がなければ床と同じ）
    this.W = new Int16Array(n); // 描いている水面（この高さの 1 つ下のセルまでが水。0 = 水なし）
    this.kind = new Uint8Array(n).fill(ABSENT);
    this.dv = new Float32Array(n);
    this.qx = new Float32Array(n); // 1 回の計算で +x 側のとなりへ移った水（負なら向こうから来た）
    this.qz = new Float32Array(n);
    this.ux = new Float32Array(n); // +x 側の境目の水の速さ（ボクセル/秒）
    this.uz = new Float32Array(n);
    this.Qx = new Float32Array(n);
    this.Qz = new Float32Array(n);
    this.out = new Float32Array(n);
    this.vx = new Float32Array(n); // 流れの速さ（ボクセル/秒）
    this.vz = new Float32Array(n);
    this.base = new Uint32Array(n); // 水面のふだんの色
    this.splash = new Uint8Array(n); // 上から水が落ちてくる列
    this.chunks = new Array(SPAN * SPAN).fill(null);
    this.cx = null;
    this.cz = null;
    this.ox = 0;
    this.oz = 0;
    this.falls = new Map(); // 滝のセル: 番号 → [チャンク, セル番号]
    this.parts = []; // 流れに乗って動く泡とさざ波
    this.rng = mulberry32(world.seed ^ 0x77a7e);
    this.time = 0;
    this.count = 0;
  }

  // 列 (x, z) の流れの速さ（範囲の外は 0）
  velocity(x, z) {
    const i = x - this.ox, j = z - this.oz;
    if (this.cx === null || i < 0 || j < 0 || i >= N || j >= N) return [0, 0];
    return [this.vx[i + N * j], this.vz[i + N * j]];
  }

  // 列 (x, z) の水位（範囲の外や計算していない所は null）
  level(x, z) {
    const i = x - this.ox, j = z - this.oz;
    if (this.cx === null || i < 0 || j < 0 || i >= N || j >= N || this.kind[i + N * j] === ABSENT) return null;
    return this.L[i + N * j];
  }

  update(dt, pos) {
    const pcx = floorDiv(Math.floor(pos[0]) + 4, CHUNK), pcz = floorDiv(Math.floor(pos[2]) + 4, CHUNK);
    if (this.cx === null || Math.abs(pcx - this.cx) > 1 || Math.abs(pcz - this.cz) > 1 || this.changed()) this.rebuild(pcx, pcz);
    this.time += dt;
    this.count++;
    if (this.count % 4 === 0) this.refreshFloors();
    this.flow(dt);
    this.show();
    this.drawFalls();
    this.moveParts(dt);
    this.paintSurface();
  }

  // 範囲のチャンクが作られた / 片付けられた
  changed() {
    for (let k = 0; k < this.chunks.length; k++) {
      const cx = this.cx - WATER_RADIUS + (k % SPAN), cz = this.cz - WATER_RADIUS + Math.floor(k / SPAN);
      if ((this.world.chunks.get(chunkKey(cx, cz)) ?? null) !== this.chunks[k]) return true;
    }
    return false;
  }

  // 列の床: 地面の上に積み重なった、動かない物（岩・倒木・木の幹・龍の体など）のてっぺん
  floorOf(c, lx, lz, h) {
    const ents = this.world.entities;
    let y = Math.max(h, c.base);
    for (;;) {
      if ((y - c.base + 1) * CHUNK * CHUNK > c.owner.length) return y;
      const o = c.owner[c.index(lx, y, lz)];
      if (o === EMPTY || o === WATER_ID || o === FALL_ID) return y;
      if (o !== GROUND_ID && o !== ROCK_ID && o !== PLANT_ID) {
        const e = ents.get(o);
        if (!e || e.yields || MOVABLE.has(e.kind)) return y;
      }
      y++;
    }
  }

  // 中心チャンク (cx, cz) のまわりを計算する範囲にする
  rebuild(cx, cz) {
    const w = this.world;
    // いまの範囲の水位をチャンクに残し、水面の泡を消す
    if (this.cx !== null) {
      for (let a = 0; a < N * N; a++) {
        if (this.kind[a] === ABSENT) continue;
        const c = this.chunks[Math.floor((a % N) / CHUNK) + SPAN * Math.floor(Math.floor(a / N) / CHUNK)];
        const col = ((a % N) % CHUNK) + CHUNK * (Math.floor(a / N) % CHUNK);
        if (this.kind[a] === ACTIVE) (c.lvl ??= new Float32Array(CHUNK * CHUNK).fill(NaN))[col] = this.L[a];
        if (this.W[a]) this.paintTop(a, this.base[a]);
      }
    }
    this.cx = cx;
    this.cz = cz;
    this.ox = (cx - WATER_RADIUS) * CHUNK;
    this.oz = (cz - WATER_RADIUS) * CHUNK;
    this.falls.clear();
    this.parts.length = 0;
    for (let k = 0; k < this.chunks.length; k++) {
      this.chunks[k] = w.chunks.get(chunkKey(cx - WATER_RADIUS + (k % SPAN), cz - WATER_RADIUS + Math.floor(k / SPAN))) ?? null;
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = i + N * j;
        const c = this.chunks[Math.floor(i / CHUNK) + SPAN * Math.floor(j / CHUNK)];
        this.qx[a] = this.qz[a] = this.vx[a] = this.vz[a] = this.ux[a] = this.uz[a] = 0;
        if (!c) {
          this.kind[a] = ABSENT;
          continue;
        }
        const lx = i % CHUNK, lz = j % CHUNK, col = lx + CHUNK * lz;
        const h = c.height[col];
        const W = c.water[col];
        const F = this.floorOf(c, lx, lz, h);
        const border = i === 0 || j === 0 || i === N - 1 || j === N - 1;
        this.kind[a] = border || c.fixed?.[col] ? FIXED : ACTIVE;
        this.H[a] = h;
        this.F[a] = F;
        this.W[a] = W > F ? W : 0;
        const saved = c.lvl?.[col];
        this.L[a] = this.kind[a] === ACTIVE && Number.isFinite(saved) ? Math.max(saved, F) : W > F ? W - 0.25 : F;
        this.base[a] = this.W[a] ? this.baseColor(a) : 0;
        // すでにある滝のセルも、ここで面倒を見る
        if (W) {
          for (let y = W; y < W + 24 && (y - c.base + 1) * CHUNK * CHUNK <= c.owner.length; y++) {
            const ci = c.index(lx, y, lz);
            if (c.owner[ci] === FALL_ID) this.falls.set(c.key * 131072 + ci, [c, ci]);
          }
        }
      }
    }
  }

  refreshFloors() {
    for (let a = 0; a < N * N; a++) {
      if (this.kind[a] === ABSENT) continue;
      const i = a % N, j = Math.floor(a / N);
      const c = this.chunks[Math.floor(i / CHUNK) + SPAN * Math.floor(j / CHUNK)];
      const F = this.floorOf(c, i % CHUNK, j % CHUNK, this.H[a]);
      if (F === this.F[a]) continue;
      this.F[a] = F;
      if (this.L[a] < F) this.L[a] = F; // 物が入ってきた所の水は押しのけられる
    }
  }

  // 水を動かす。列と列の境目ごとに水の速さを持つ（勢いがつく）:
  // - 水面の高さの差で加速し、川底との摩擦で減速する
  // - 段の落ち口では、水の厚さで決まる速さ（限界の速さ）より速くはならない（せきを越える水と同じ）
  // - 1 回に出ていく水は、その列にある水の分まで
  flow(dt) {
    const steps = 3;
    this.qx.fill(0);
    this.qz.fill(0);
    for (let s = 0; s < steps; s++) this.substep(dt / steps);
    const { F, L, kind, ux, uz } = this;
    for (let a = 0; a < N * N; a++) {
      if (kind[a] === ABSENT) continue;
      const i = a % N;
      // 列の流れの速さ: 両側の境目の速さの平均（水のない所は 0）
      const wet = L[a] > F[a];
      this.vx[a] = wet ? ((i > 0 ? ux[a - 1] : 0) + ux[a]) * 0.5 : 0;
      this.vz[a] = wet ? ((a >= N ? uz[a - N] : 0) + uz[a]) * 0.5 : 0;
    }
  }

  substep(dt) {
    const { F, L, kind, dv, ux, uz, Qx, Qz, out } = this;
    const G = 65;
    dv.fill(0);
    out.fill(0);
    // 1. 境目の速さと、移る水の量（まだ、ある分に収めていない）
    const edge = (a, b, U, Q) => {
      const La = L[a], Lb = L[b];
      const crest = F[a] > F[b] ? F[a] : F[b]; // 境目の高い方の床
      if (La <= crest && Lb <= crest) {
        U[a] = 0;
        Q[a] = 0;
        return;
      }
      let u = U[a] + dt * G * (La - Lb);
      const h = (u >= 0 ? La : Lb) - crest; // 流れてくる側の、境目より上の水の厚さ
      if (h <= 0) {
        U[a] = 0;
        Q[a] = 0;
        return;
      }
      u /= 1 + dt * (0.5 + 0.35 * Math.abs(u) / Math.max(h, 0.25)); // 摩擦（浅いほど強い）
      const lim = 1.4 * Math.sqrt(G * h) + 0.3; // 限界の速さ
      if (u > lim) u = lim;
      else if (u < -lim) u = -lim;
      U[a] = u;
      const q = u * h * dt;
      Q[a] = q;
      out[q > 0 ? a : b] += Math.abs(q);
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = i + N * j;
        const ka = kind[a];
        if (ka === ABSENT) continue;
        if (i + 1 < N && kind[a + 1] !== ABSENT && (ka === ACTIVE || kind[a + 1] === ACTIVE)) edge(a, a + 1, ux, Qx);
        else Qx[a] = ux[a] = 0;
        if (j + 1 < N && kind[a + N] !== ABSENT && (ka === ACTIVE || kind[a + N] === ACTIVE)) edge(a, a + N, uz, Qz);
        else Qz[a] = uz[a] = 0;
      }
    }
    // 2. 出ていく水を、その列にある水の分までに縮める（変わらない列からはいくらでも出る）
    for (let a = 0; a < N * N; a++) {
      const o = out[a];
      out[a] = o > 0 && kind[a] === ACTIVE ? Math.min(1, (0.95 * (L[a] - F[a])) / o) : 1;
    }
    // 3. 水を移す
    const move = (a, b, U, Q, acc) => {
      let q = Q[a];
      if (q === 0) return;
      const k = out[q > 0 ? a : b];
      if (k < 1) {
        q *= k;
        U[a] *= k;
      }
      dv[a] -= q;
      dv[b] += q;
      acc[a] += q;
    };
    for (let a = 0; a < N * N; a++) {
      if (kind[a] === ABSENT) continue;
      if (a % N + 1 < N) move(a, a + 1, ux, Qx, this.qx);
      if (a + N < N * N) move(a, a + N, uz, Qz, this.qz);
    }
    for (let a = 0; a < N * N; a++) {
      if (kind[a] !== ACTIVE) continue;
      L[a] += dv[a];
      if (L[a] - F[a] < 0.01) L[a] = F[a]; // ごく薄い水は消える（しみこむ）
    }
  }

  cellOf(a) {
    const i = a % N, j = Math.floor(a / N);
    const c = this.chunks[Math.floor(i / CHUNK) + SPAN * Math.floor(j / CHUNK)];
    return { c, lx: i % CHUNK, lz: j % CHUNK, x: this.ox + i, z: this.oz + j };
  }

  baseColor(a) {
    const { x, z } = this.cellOf(a);
    return waterColor(x, z, this.W[a] - this.H[a], this.W[a] > this.world.waterLevel) | WATER_FLAG;
  }

  // 水位に合わせて、水のセルを増やしたり減らしたりする
  show() {
    const { F, L, kind, W } = this;
    for (let a = 0; a < N * N; a++) {
      if (kind[a] !== ACTIVE) continue;
      const depth = L[a] - F[a];
      const cur = W[a];
      // 水位がちょうど境目のあたりで行ったり来たりしても、水面がちらつかないように少し粘る
      if (cur && cur > F[a] && depth > SHOW * 0.5 && L[a] > cur - 0.65 && L[a] < cur + 0.65) continue;
      const top = depth > SHOW ? Math.max(F[a] + 1, Math.round(L[a])) : 0;
      if (top !== cur) this.setTop(a, top);
    }
  }

  setTop(a, top) {
    const w = this.world;
    const { c, lx, lz } = this.cellOf(a);
    const old = this.W[a];
    const set = (y, owner) => {
      c.ensure(y);
      const i = c.index(lx, y, lz);
      const o = c.owner[i];
      if (owner === WATER_ID ? o !== EMPTY && o !== FALL_ID && o !== WATER_ID : o !== WATER_ID) return;
      if (o === owner && c.color[i] === 0) return;
      c.owner[i] = owner;
      c.color[i] = 0;
      c.changed.push(i);
      if (owner && y >= c.top) c.top = y + 1;
    };
    if (top > old) {
      if (old) set(old - 1, WATER_ID); // 前の水面は水の中になる（色を消す）
      for (let y = old || this.F[a]; y < top; y++) set(y, WATER_ID);
    } else {
      for (let y = top || this.F[a]; y < old; y++) set(y, EMPTY);
    }
    c.water[lx + CHUNK * lz] = top;
    this.W[a] = top;
    this.base[a] = top ? this.baseColor(a) : 0;
    w.dirty.add(c.key);
  }

  paintTop(a, color) {
    const { c, lx, lz } = this.cellOf(a);
    const y = this.W[a] - 1;
    if (y < c.base) return;
    const i = c.index(lx, y, lz);
    if (c.owner[i] !== WATER_ID || c.color[i] === color) return;
    c.color[i] = color;
    c.changed.push(i);
    this.world.dirty.add(c.key);
  }

  // 段で、上の淵からあふれた水が下へ落ちていく（滝）。模様は毎回下へずれる
  drawFalls() {
    const { W, F, kind, qx, qz } = this;
    const next = new Map();
    this.splash.fill(0);
    const fall = (src, dst) => {
      const from = W[dst] || F[dst];
      if (!W[src] || W[src] - from < 2 || kind[dst] === ABSENT) return;
      const { c, lx, lz, x, z } = this.cellOf(dst);
      this.splash[dst] = 1;
      for (let y = from; y < W[src] - 1; y++) {
        c.ensure(y);
        const i = c.index(lx, y, lz);
        const o = c.owner[i];
        if (o !== EMPTY && o !== FALL_ID) continue;
        const color = fallColor(x, y, z, this.time);
        if (o !== FALL_ID || c.color[i] !== color) {
          c.owner[i] = FALL_ID;
          c.color[i] = color;
          c.changed.push(i);
          if (y >= c.top) c.top = y + 1;
          this.world.dirty.add(c.key);
        }
        next.set(c.key * 131072 + i, [c, i]);
      }
    };
    for (let a = 0; a < N * N; a++) {
      if (qx[a] > 0.004) fall(a, a + 1);
      else if (qx[a] < -0.004) fall(a + 1, a);
      if (qz[a] > 0.004) fall(a, a + N);
      else if (qz[a] < -0.004) fall(a + N, a);
    }
    // 流れが止まった滝は消える
    for (const [key, [c, i]] of this.falls) {
      if (next.has(key) || c.owner[i] !== FALL_ID) continue;
      c.owner[i] = EMPTY;
      c.color[i] = 0;
      c.changed.push(i);
      this.world.dirty.add(c.key);
    }
    this.falls = next;
  }

  // 泡とさざ波: 流れの速い所や滝つぼで生まれ、流れに乗って下流へ動き、しばらくすると消える
  moveParts(dt) {
    const { W, kind, vx, vz, rng } = this;
    for (let a = 0; a < N * N; a++) {
      if (kind[a] !== ACTIVE || !W[a] || this.parts.length >= MAX_PARTS) continue;
      const s = Math.hypot(vx[a], vz[a]);
      const i = a % N, j = Math.floor(a / N);
      if (this.splash[a] ? rng() < 0.5 : s > 0.4 && rng() < 0.03 * s) {
        this.parts.push({ x: i + rng(), z: j + rng(), age: 0, life: 1.5 + rng() * (this.splash[a] ? 2.5 : 4.5), foam: this.splash[a] || s > 4.5 });
      }
    }
    const alive = [];
    for (const p of this.parts) {
      const a = Math.floor(p.x) + N * Math.floor(p.z);
      if (p.x < 0 || p.z < 0 || p.x >= N || p.z >= N || !W[a] || (p.age += dt) > p.life) continue;
      p.x += (vx[a] + (rng() - 0.5) * 0.8) * dt;
      p.z += (vz[a] + (rng() - 0.5) * 0.8) * dt;
      alive.push(p);
    }
    this.parts = alive;
  }

  // 水面の色: ふだんの色に、泡とさざ波と滝つぼのしぶきを重ねる
  paintSurface() {
    const over = new Map();
    for (const p of this.parts) {
      const a = Math.floor(p.x) + N * Math.floor(p.z);
      if (!this.W[a]) continue;
      if (p.foam) over.set(a, FOAM);
      else if (!over.has(a)) {
        const b = this.base[a];
        const alpha = Math.min(15, ((b >>> ALPHA_SHIFT) & 15) + 3);
        over.set(a, (shade(b & 0xffffff, 1.2) | (alpha << ALPHA_SHIFT) | WATER_FLAG) >>> 0);
      }
    }
    for (let a = 0; a < N * N; a++) {
      if (this.kind[a] !== ACTIVE || !this.W[a]) continue;
      this.paintTop(a, over.get(a) ?? (this.splash[a] ? SPLASH : this.base[a]));
    }
  }
}
