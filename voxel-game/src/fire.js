// 龍の吐く炎: 炎の粒・焦げ跡・燃えさし
//
// - 炎の粒は口から勢いよく飛び出し、広がりながら遅くなり、少し浮き上がって煙になって消える
// - 粒は空いているセルにだけ点灯する（ほかの物を押さない・上書きしない）
// - 粒が何かに当たると消える。木の葉は燃え落ち（一部は焦げ茶で残る）、幹と枝は黒く焦げる。地面の草も焦げる
// - 焦げる前に、しばらくオレンジ色に光ってちらつく（燃えさし）

import { GROUND_ID } from './ids.js';
import { burnTreeCell } from './trees.js';
import { burnGiantCell } from './giant.js';
import { CHUNK, floorDiv, chunkKey } from './grid.js';

export const FIRE_SPEED = 80; // ボクセル/秒（≈ 12 m/s）

const CHAR_GROUND = [0x2e2620, 0x3a2f25, 0x45372a, 0x262019];
const EMBER = [0xff9a32, 0xff6a1c, 0xe8431a, 0xffc04a];

// 炎の色: 生まれたては白っぽい黄色 → 橙 → 赤 → 煙
function flameColor(t, h) {
  if (t < 0.12) return 0xfff2b8;
  if (t < 0.3) return h & 1 ? 0xffd04a : 0xffbd38;
  if (t < 0.55) return h & 1 ? 0xff8a24 : 0xff7418;
  if (t < 0.78) return h & 1 ? 0xe2481a : 0xc93614;
  return h & 1 ? 0x5e5550 : 0x4c4542;
}

export class Fire {
  constructor(world, id, ignore) {
    this.world = world;
    this.id = id; // 炎のセルの持ち主
    this.ignore = ignore; // 当たっても無視する持ち主（龍自身・炎）
    this.particles = [];
    this.embers = [];
    this.cells = []; // 点灯しているセル: [チャンク, セル番号, ...]
    this.burned = 0; // 焦がしたセルの数
    this.seed = 1;
  }

  rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 2 ** 32;
  }

  // 口 mouth から dir の方向へ n 粒吹く
  breathe(mouth, dir, n) {
    for (let k = 0; k < n; k++) {
      const spread = 0.13;
      const v = [
        dir[0] + (this.rand() - 0.5) * spread * 2,
        dir[1] + (this.rand() - 0.5) * spread * 2,
        dir[2] + (this.rand() - 0.5) * spread * 2,
      ];
      const len = Math.hypot(...v);
      const speed = FIRE_SPEED * (0.75 + this.rand() * 0.35);
      this.particles.push({
        p: [mouth[0] + (this.rand() - 0.5) * 2, mouth[1] + (this.rand() - 0.5) * 2, mouth[2] + (this.rand() - 0.5) * 2],
        v: v.map((c) => (c / len) * speed),
        age: this.rand() * 0.05,
        life: 0.75 + this.rand() * 0.55,
        h: (this.rand() * 1024) | 0,
      });
    }
  }

  // 粒を動かし、当たった物を焦がす
  update(dt) {
    const w = this.world;
    const alive = [];
    for (const q of this.particles) {
      q.age += dt;
      if (q.age > q.life) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(...q.v) * dt));
      let hit = false;
      for (let k = 0; k < steps && !hit; k++) {
        q.p[0] += (q.v[0] * dt) / steps;
        q.p[1] += (q.v[1] * dt) / steps;
        q.p[2] += (q.v[2] * dt) / steps;
        const x = Math.floor(q.p[0]), y = Math.floor(q.p[1]), z = Math.floor(q.p[2]);
        const owner = w.ownerAt(x, y, z);
        if (owner === 0 || this.ignore.has(owner)) continue;
        hit = true;
        // 煙になるころの粒は焦がさない
        if (q.age / q.life < 0.75) this.scorch(owner, x, y, z);
      }
      if (hit) continue;
      // 空気の抵抗で遅くなり、熱で少し浮く
      const drag = Math.max(0, 1 - 1.4 * dt);
      q.v[0] *= drag;
      q.v[1] = q.v[1] * drag + 14 * dt;
      q.v[2] *= drag;
      alive.push(q);
    }
    this.particles = alive;
    this.updateEmbers(dt);
  }

  // 当たった場所のまわりを焦がす
  scorch(owner, x, y, z) {
    const w = this.world;
    const e = w.entities.get(owner);
    if (owner === GROUND_ID) {
      // 地面: 当たった所のまわりの地表を焦がす
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dz * dz > 5 || this.rand() < 0.25) continue;
          const gx = x + dx, gz = z + dz;
          const gy = w.groundAt(gx, gz) - 1;
          if (Math.abs(gy - y) > 3 || w.ownerAt(gx, gy, gz) !== GROUND_ID) continue;
          const c = w.colorAt(gx, gy, gz);
          if (!c || CHAR_GROUND.includes(c)) continue;
          this.ignite(gx, gy, gz, owner, CHAR_GROUND[(gx * 7 + gz * 13) & 3]);
        }
      }
    } else if (e?.giant) {
      // 巨大樹: まわりの葉や幹が焦げる（燃え落ちはしない）
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx * dx + dy * dy + dz * dz > 5) continue;
            const final = burnGiantCell(w, e.giant, x + dx, y + dy, z + dz);
            if (final !== null) this.ignite(x + dx, y + dy, z + dz, owner, final);
          }
        }
      }
    } else if (e?.tree) {
      // 木: まわり半径 2 ほどの葉と枝が燃える
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx * dx + dy * dy + dz * dz > 5) continue;
            const bx = x + dx, by = y + dy, bz = z + dz;
            if (w.ownerAt(bx, by, bz) !== owner) continue;
            const final = burnTreeCell(e.tree, bx, by, bz);
            if (final !== null) this.ignite(bx, by, bz, owner, final);
          }
        }
      }
    }
    // 人・岩・水には何もしない（炎が消えるだけ）
  }

  // セルをしばらく燃えさしの色で光らせ、そのあと final の色にする
  ignite(x, y, z, owner, final) {
    const c = this.world.chunks.get(chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK)));
    if (!c || y < c.base) return;
    const i = c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK);
    const glow = EMBER[(this.rand() * EMBER.length) | 0];
    c.color[i] = glow;
    c.changed.push(i);
    this.world.dirty.add(c.key);
    this.embers.push({ c, i, owner, final, glow, left: 0.8 + this.rand() * 1.8 });
    this.burned++;
  }

  updateEmbers(dt) {
    const keep = [];
    for (const em of this.embers) {
      em.left -= dt;
      const { c, i } = em;
      // ほかの物が来た / 風で葉がずれたなどで色が変わっていたら、もう触らない
      if (c.owner[i] !== em.owner || c.color[i] !== em.glow) continue;
      const next = em.left <= 0 ? em.final : EMBER[(this.rand() * EMBER.length) | 0];
      c.color[i] = next;
      c.changed.push(i);
      this.world.dirty.add(c.key);
      if (em.left > 0) {
        em.glow = next;
        keep.push(em);
      }
    }
    this.embers = keep;
  }

  // 炎の粒をセルとして書く（空いている所だけ）。前回のセルは先に消しておくこと
  draw() {
    const w = this.world;
    const cells = [];
    for (const q of this.particles) {
      const t = q.age / q.life;
      const r = 0.6 + t * 2.4;
      const R = Math.ceil(r);
      const color = flameColor(t, q.h);
      const px = q.p[0], py = q.p[1], pz = q.p[2];
      for (let dy = -R; dy <= R; dy++) {
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy + dz * dz > r * r) continue;
            const x = Math.floor(px + dx), y = Math.floor(py + dy), z = Math.floor(pz + dz);
            if (y < 1) continue;
            const c = w.chunks.get(chunkKey(floorDiv(x, CHUNK), floorDiv(z, CHUNK)));
            if (!c || y < c.base) continue;
            c.ensure(y);
            const i = c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK);
            if (c.owner[i] !== 0) continue; // 空いている所だけ（ほかの粒が先に取った所も含む）
            c.owner[i] = this.id;
            c.color[i] = color;
            if (y >= c.top) c.top = y + 1;
            c.changed.push(i);
            w.dirty.add(c.key);
            cells.push(c, i);
          }
        }
      }
    }
    this.cells = cells;
  }

  // 前回書いたセルを消す
  clear() {
    for (let n = 0; n < this.cells.length; n += 2) {
      const c = this.cells[n], i = this.cells[n + 1];
      if (c.owner[i] !== this.id) continue;
      c.owner[i] = 0;
      c.color[i] = 0;
      c.changed.push(i);
      this.world.dirty.add(c.key);
    }
    this.cells = [];
  }
}
