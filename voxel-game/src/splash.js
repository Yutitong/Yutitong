// しぶき: 物が勢いよく水に落ちると、水しぶきが上がり、水面に外へ広がる波が立つ
//
// - しぶきの粒は、水面から上と外へ飛び、重力で落ちて水に戻ると消える（いつでも場所をゆずる。空いたセルにだけ見える）
// - 波は、水の流れ（water.js）の、落ちた所のまわりの水を外向きに押し出して起こす（真ん中がへこみ、まわりが盛り上がって広がる）
// - 物が底に沈んで積もると、そのぶん川底が上がり、水位が上がってあふれることもある（water.js が床の変化を拾う）

import { redrawBody } from './body.js';
import { mulberry32 } from './rng.js';

const GRAVITY = 65;
const MAX = 900; // 粒の数の上限
const COLORS = [0xf4fbff, 0xdcefff, 0xc4e2f4, 0xe8f6ff];

export class Splashes {
  constructor(world) {
    this.world = world;
    this.id = world.nextId++;
    world.entities.set(this.id, {
      id: this.id, kind: 'splash', name: '水しぶき', priority: 0, yields: true, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    });
    this.parts = [];
    this.cells = [];
    this.rng = mulberry32(77);
    this.count = 0; // 上がったしぶきの数（数えるだけ）
  }

  // (x, y, z)（y は水面の高さ）に、大きさ size（1 = 小石 〜 10 = 倒木や岩の塊）のしぶきを上げる
  splash(x, y, z, size) {
    this.count++;
    const rng = this.rng;
    const n = Math.min(MAX - this.parts.length, Math.round(4 + size * 14));
    const speed = 10 + size * 3;
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const out = (0.3 + rng() * 0.7) * speed * 0.55;
      const r = rng() * Math.min(6, 1 + size * 0.6);
      this.parts.push({
        p: [x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r],
        v: [Math.cos(a) * out, speed * (0.6 + rng() * 0.8), Math.sin(a) * out],
        c: COLORS[k % COLORS.length], age: 0,
      });
    }
    // 水面に、外へ広がる波を起こす
    this.world.water?.impulse(Math.floor(x), Math.floor(z), 3 + size * 1.2, Math.min(8, 3 + size * 0.5));
  }

  update(dt) {
    if (!this.parts.length && !this.cells.length) return;
    const w = this.world;
    const alive = [];
    for (const q of this.parts) {
      q.age += dt;
      q.v[1] -= GRAVITY * dt;
      q.p[0] += q.v[0] * dt;
      q.p[1] += q.v[1] * dt;
      q.p[2] += q.v[2] * dt;
      // 水面より下に戻ったら消える
      const x = Math.floor(q.p[0]), z = Math.floor(q.p[2]);
      if (q.age > 2.5 || (q.v[1] < 0 && q.p[1] < Math.max(w.loadedWaterAt(x, z), w.loadedGroundAt(x, z)))) continue;
      alive.push(q);
    }
    this.parts = alive;
    const { cells } = redrawBody(w, this.id, this.cells, (emit) => {
      for (const q of this.parts) emit(Math.floor(q.p[0]), Math.floor(q.p[1]), Math.floor(q.p[2]), q.c);
    }, () => null);
    this.cells = cells;
  }
}
