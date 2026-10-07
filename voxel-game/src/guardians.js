// ピラミッドの門を守る巨アヌビス像と、頂上に浮かぶ紫の水晶
//
// 巨アヌビス像:
// - 門の外側の台座の上に、2 体の巨アヌビス像（高さ 15m ほど）が参道を向いて立つ。黒い石の体に金の首飾りと腰布、
//   山犬の頭と高い耳。外側の手に生命の印（アンク）、内側の手に長い杖（ウアス杖）
// - プレイヤーが近づくと、杖を振り下ろして参道を叩く:
//   ゆっくり大きく杖を後ろへ振りかぶり（予備動作）、震えながら一瞬ためて、一気に前の地面へ叩きつける。
//   叩いた所の近くにいると体力が減る。叩きつけたあとはゆっくり元の構えに戻る
// - ショットガンで撃つと、当たった所の石が欠ける。頭・両腕・杖は、撃ち続けると割れて下へ落ちる。
//   杖か杖を持つ腕が落ちると、もう攻撃できない
//
// 水晶: ピラミッドの頂上の上に浮かぶ、全体が紫に怪しく光る正八面体。ゆっくり回りながら上下にただよう

import { redrawBody } from './body.js';
import { HEIGHT, chunkKeyAt } from './grid.js';
import { hash3, shade } from './rng.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

const BASALT = 0x1e1d22, BASALT2 = 0x2a2830, GOLD = 0xe6b84a, GOLD2 = 0xc99a34, LAPIS = 0x24407a, WHITE = 0xece4d0, RED = 0x9e2a20;

// 体の部位（像の座標: s = 内側（参道の方）へ、y = 上、f = 前）。break: 割れて落ちる部位
function capsule(a, b, ra, rb) {
  return (s, y, f) => {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const L2 = abx * abx + aby * aby + abz * abz || 1e-9;
    let t = ((s - a[0]) * abx + (y - a[1]) * aby + (f - a[2]) * abz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = s - a[0] - abx * t, dy = y - a[1] - aby * t, dz = f - a[2] - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
  };
}
function ellipsoid(c, r) {
  return (s, y, f) => (Math.hypot((s - c[0]) / r[0], (y - c[1]) / r[1], (f - c[2]) / r[2]) - 1) * Math.min(...r);
}
function box(lo, hi) {
  return (s, y, f) => Math.max(lo[0] - s, s - hi[0], lo[1] - y, y - hi[1], lo[2] - f, f - hi[2]);
}

const STATIC_PARTS = [
  { name: 'feet', d: (s, y, f) => Math.min(box([-9, 0, -3], [-2, 3, 8])(s, y, f), box([2, 0, -1], [9, 3, 10])(s, y, f)), color: () => BASALT },
  { name: 'legs', d: (s, y, f) => Math.min(capsule([-5.5, 3, 1], [-5.5, 44, 0], 3.8, 5)(s, y, f), capsule([5.5, 3, 4], [5.5, 44, 0], 3.8, 5)(s, y, f)), color: () => BASALT },
  {
    name: 'kilt', d: (s, y, f) => (y < 34 || y > 50 ? 1 : Math.max(Math.abs(s) - (11 - (y - 34) * 0.12), Math.abs(f - 0.5) - 6.5)),
    color: (s, y) => (y > 47 ? GOLD : Math.floor(s + 20) % 3 === 0 ? GOLD2 : WHITE),
  },
  {
    name: 'torso', d: (s, y, f) => Math.min(ellipsoid([0, 60, 0], [10.5, 13, 6.5])(s, y, f), ellipsoid([0, 71, 0], [14, 4.5, 6])(s, y, f)),
    color: (s, y, f) => (y > 64 && y < 76 && f > -2 ? ((Math.floor(y) % 3 === 0) ? LAPIS : (Math.floor(y) % 3 === 1 ? GOLD : RED)) : (hash3(Math.floor(s), Math.floor(y), Math.floor(f)) % 9 === 0 ? BASALT2 : BASALT)),
  },
  { name: 'neck', d: capsule([0, 74, 0], [0, 81, 1.5], 4.2, 3.8), color: () => BASALT },
  {
    name: 'head', break: true, hp: 10,
    d: (s, y, f) => Math.min(
      ellipsoid([0, 85, 1], [6, 6, 7])(s, y, f),
      capsule([0, 83.5, 5], [0, 81.5, 16], 3.8, 2)(s, y, f),
      capsule([-3.5, 89, -1], [-4.5, 102, -2.5], 2.4, 0.6)(s, y, f),
      capsule([3.5, 89, -1], [4.5, 102, -2.5], 2.4, 0.6)(s, y, f),
    ),
    color: (s, y, f) => {
      if (f > 15) return 0x0a0a0c; // 鼻先
      if (y > 85 && y < 88 && f > 5 && f < 7.5 && Math.abs(s) > 1.8 && Math.abs(s) < 4.2) return GOLD; // 目
      if (y > 90 && f > -1.2 && Math.abs(s) > 2.5 && Math.abs(s) < 5) return y > 99 ? GOLD : RED; // 耳の内側
      if (y < 81 && f < 6) return GOLD; // 首の金の帯
      return BASALT;
    },
  },
  {
    name: 'armL', break: true, hp: 10,
    d: (s, y, f) => Math.min(capsule([-13, 72, 0], [-14.5, 56, 2], 3.8, 3.2)(s, y, f), capsule([-14.5, 56, 2], [-14.5, 45, 7], 3.2, 2.8)(s, y, f),
      // 生命の印（アンク）
      capsule([-14.5, 34, 8], [-14.5, 44, 8], 1.2, 1.2)(s, y, f), capsule([-17.5, 44, 8], [-11.5, 44, 8], 1.2, 1.2)(s, y, f),
      Math.abs(Math.hypot(0, y - 48, f - 8) - 3) - 1.1 + Math.max(0, Math.abs(s + 14.5) - 1.2)),
    color: (s, y, f) => (f > 6.5 && y < 52 ? GOLD : y > 50 && y < 53 ? GOLD : BASALT),
  },
];

// 杖を持つ腕の姿勢（α: 腕の振り、β: 杖の傾き、γ: 内側へのひねり）から、肩・手・杖の両端（像の座標）
function armPose(alpha, beta, gamma) {
  const sh = [13, 72, 0];
  const rot = (v) => [v[0] * Math.cos(gamma) + v[2] * Math.sin(gamma), v[1], -v[0] * Math.sin(gamma) + v[2] * Math.cos(gamma)];
  const arm = rot([0, -Math.cos(alpha) * 28, Math.sin(alpha) * 28]);
  const hand = [sh[0] + arm[0], sh[1] + arm[1], sh[2] + arm[2]];
  const sd = rot([0, Math.cos(beta), Math.sin(beta)]);
  const butt = [hand[0] - sd[0] * 40, hand[1] - sd[1] * 40, hand[2] - sd[2] * 40];
  const tip = [hand[0] + sd[0] * 80, hand[1] + sd[1] * 80, hand[2] + sd[2] * 80];
  return { sh, hand, butt, tip, sd };
}

const REST = [0.25, 0, 0];
const WINDUP = [-2.5, -0.65, 0];
const STRIKE = [1.0, 2.55, 0.55];
// 攻撃の段取り（秒）
const T_WIND = 1.5, T_HOLD = 0.35, T_STRIKE = 0.22, T_RECOVER = 1.4, T_REST = 1.3;
const STATUE_DAMAGE = 35;

let STATIC_LOCAL = null;
function buildStaticLocal() {
  const cells = [];
  for (let y = 0; y < 106; y++) {
    for (let s = -22; s <= 22; s++) {
      for (let f = -12; f <= 20; f++) {
        const ps = s + 0.5, py = y + 0.5, pf = f + 0.5;
        for (let k = 0; k < STATIC_PARTS.length; k++) {
          const part = STATIC_PARTS[k];
          const d = part.d(ps, py, pf);
          if (d > 0) continue;
          if (d < -3) break; // 中まで詰めない（殻だけ）
          cells.push([s, y, f, part.color(ps, py, pf), k]);
          break;
        }
      }
    }
  }
  return cells;
}

// 線分 a–b のまわり（半径 r）のセルを、球を並べて塗る（同じセルは 1 回だけ）
function stampCapsule(a, b, r, emitLocal, seen) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(L / Math.max(0.6, r * 0.5)));
  const R = Math.ceil(r);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let dy = -R; dy <= R; dy++) for (let ds = -R; ds <= R; ds++) for (let df = -R; df <= R; df++) {
      const s = Math.floor(c[0]) + ds, y = Math.floor(c[1]) + dy, f = Math.floor(c[2]) + df;
      const qx = s + 0.5 - c[0], qy = y + 0.5 - c[1], qz = f + 0.5 - c[2];
      if (qx * qx + qy * qy + qz * qz > r * r) continue;
      const key = ((s + 512) * 1024 + (y + 512)) * 1024 + (f + 512);
      if (seen.has(key)) continue;
      seen.add(key);
      emitLocal(s, y, f, t);
    }
  }
}

export class Anubis {
  // o: 足もとの世界の位置、fwd: 前の向き（世界 [x, z]）、inner: 内側（参道の方）の向き（世界 [x, z]）
  constructor(world, o, fwd, inner, name = 'アヌビス像') {
    this.world = world;
    this.o = o.map(Math.round);
    this.F = fwd;
    this.S = inner;
    this.id = world.nextId++;
    this.entity = { id: this.id, kind: 'statue', name, priority: 9, pos: [...this.o], offsets: new Int16Array(0), colors: new Uint32Array(0), body: this };
    world.entities.set(this.id, this.entity);
    this.parts = STATIC_PARTS.map((p) => ({ ...p, hp: p.hp ?? Infinity, broken: false }));
    this.armHp = 12;
    this.staffHp = 8;
    this.armBroken = false;
    this.staffBroken = false;
    this.chips = []; // 欠けた所 [x, y, z, r]（世界の座標）
    this.angles = [...REST];
    this.phase = 'rest';
    this.t = 0;
    this.delay = 0; // 攻撃を始めるまでの遅れ（2 体が同時に叩かないように）
    this.cells = [];
    this.events = [];
    this.version = 0;
    this.dirty = true;
    this.acc = 0;
    this.buildStatic();
  }

  // 世界 ↔ 像の座標
  toWorld(s, y, f) {
    return [this.o[0] + this.S[0] * s + this.F[0] * f, this.o[1] + y, this.o[2] + this.S[1] * s + this.F[1] * f];
  }

  toLocal(x, y, z) {
    const dx = x - this.o[0], dz = z - this.o[2];
    return [dx * this.S[0] + dz * this.S[1], y - this.o[1], dx * this.F[0] + dz * this.F[1]];
  }

  // 動かない部位のセル（表面から 3 ボクセルの殻）。像の座標の形は 2 体で共通なので一度だけ作る
  buildStatic() {
    STATIC_LOCAL ??= buildStaticLocal();
    this.static = STATIC_LOCAL.map(([s, y, f, color, k]) => {
      const [x, wy, z] = this.toWorld(s, y, f);
      return [x, wy, z, color, k];
    });
    this.removed = new Set(); // 欠けて消えたセル
  }

  get label() {
    if (this.armBroken || this.staffBroken) return '杖を失った';
    return { rest: '台座で構えている', windup: '杖を振りかぶる', hold: '杖を振りかぶる', strike: '杖を振り下ろす', recover: '構えに戻る', cool: '台座で構えている' }[this.phase];
  }

  canAttack() {
    return !this.armBroken && !this.staffBroken;
  }

  update(dt, player) {
    this.events = [];
    this.acc += dt;
    if (this.acc < 0.079) return;
    const step = this.acc;
    this.acc = 0;
    const P = player ? [player.pos[0] + 4.5, player.pos[1], player.pos[2] + 4.5] : null;
    const L = P ? this.toLocal(P[0], P[1], P[2]) : null;
    const before = this.angles.join();
    this.t += step;
    switch (this.phase) {
      case 'rest':
      case 'cool':
        if (this.phase === 'cool' && this.t < T_REST + this.delay) break;
        if (this.phase === 'rest' && this.t < this.delay) break;
        this.phase = 'rest';
        // 前の方（像の前 120 ボクセル以内）にプレイヤーが来たら、振りかぶる
        if (this.canAttack() && L && L[2] > -10 && L[2] < 120 && Math.abs(L[0]) < 90 && Math.abs(L[1]) < 40) {
          this.phase = 'windup';
          this.t = 0;
          // 叩く所をプレイヤーの横の位置へ合わせる（内側へのひねり）
          this.aimGamma = clamp(Math.atan2(L[0] - 13, Math.max(20, L[2])) * 1.05, -0.25, 0.95);
          this.events.push({ type: 'statueWindup', actor: this.entity });
        }
        break;
      case 'windup': {
        // ゆっくり、大きく振りかぶる（はじめはゆっくり、だんだん速く）
        const u = Math.min(1, this.t / T_WIND);
        const e = u * u * (3 - 2 * u);
        this.angles = [lerp(REST[0], WINDUP[0], e), lerp(REST[1], WINDUP[1], e), lerp(REST[2], this.aimGamma * 0.3, e)];
        if (u >= 1) {
          this.phase = 'hold';
          this.t = 0;
        }
        break;
      }
      case 'hold':
        // 一瞬ためる（小刻みに震える）
        this.angles = [WINDUP[0] + Math.sin(this.t * 60) * 0.025, WINDUP[1], this.aimGamma * 0.3];
        if (this.t >= T_HOLD) {
          this.phase = 'strike';
          this.t = 0;
        }
        break;
      case 'strike': {
        const u = Math.min(1, this.t / T_STRIKE);
        const e = u * u; // 加速しながら叩きつける
        this.angles = [lerp(WINDUP[0], STRIKE[0], e), lerp(WINDUP[1], STRIKE[1], e), lerp(this.aimGamma * 0.3, this.aimGamma, e)];
        if (u >= 1) {
          this.impact(P);
          this.phase = 'recover';
          this.t = 0;
        }
        break;
      }
      case 'recover': {
        const u = Math.min(1, this.t / T_RECOVER);
        const e = ease(u);
        this.angles = [lerp(STRIKE[0], REST[0], e), lerp(STRIKE[1], REST[1], e), lerp(this.aimGamma, REST[2], e)];
        if (u >= 1) {
          this.phase = 'cool';
          this.t = 0;
        }
        break;
      }
    }
    if (this.angles.join() !== before) this.dirty = true;
    // チャンクが作り直されたら描き直す
    if (!this.dirty && this.world.tickCount % 12 === 0) this.dirty = this.cellsMissing();
    if (this.dirty) this.draw();
  }

  // 像のかかるチャンクが新しく作られた（作り直された）か
  cellsMissing() {
    const w = this.world;
    if (!this.spanKeys) {
      const keys = new Set();
      for (const [x, , z] of this.static) keys.add(chunkKeyAt(x, z));
      this.spanKeys = [...keys];
      this.seen = new Map();
    }
    let changed = false;
    for (const key of this.spanKeys) {
      const ch = w.chunks.get(key);
      if (ch !== this.seen.get(key)) {
        this.seen.set(key, ch);
        if (ch) changed = true;
      }
    }
    return changed;
  }

  // 杖が地面を叩いた: 近くのプレイヤーは体力が減る
  impact(P) {
    if (!this.canAttack()) return;
    const { tip, hand } = armPose(...this.angles);
    this.events.push({ type: 'statueSlam', actor: this.entity });
    if (!P) return;
    const L = this.toLocal(P[0], P[1] + 6, P[2]);
    // 杖の先の 35 ボクセルのまわり
    const a = [hand[0] + (tip[0] - hand[0]) * 0.55, hand[1] + (tip[1] - hand[1]) * 0.55, hand[2] + (tip[2] - hand[2]) * 0.55];
    const d = capsule(a, tip, 0, 0)(L[0], L[1], L[2]);
    if (d < 12) {
      const r = this.world.hurt?.(STATUE_DAMAGE);
      this.events.push({ type: 'statueHit', actor: this.entity, target: this.world.player, damage: STATUE_DAMAGE });
      if (r) this.events.push(r);
    }
    this.world.splashes?.dust?.(...this.toWorld(tip[0], Math.max(tip[1], -13), tip[2]));
  }

  // 杖を持つ腕と杖（動く部位）のセル
  dynamicCells(emit, staffOnly = false) {
    if (this.armBroken) return;
    const { sh, hand, butt, tip } = armPose(...this.angles);
    const seen = new Set();
    const out = (color) => (s, y, f) => {
      const [x, wy, z] = this.toWorld(s, y, f);
      if (wy >= 1 && wy < HEIGHT) emit(x, wy, z, typeof color === 'function' ? color(s, y, f) : color);
    };
    if (!this.staffBroken) {
      // 杖（金の帯）と、頭の飾り・二股の石突き
      stampCapsule(butt, tip, 1.7, out((s, y, f) => ((Math.floor(y + f) % 14 < 2) ? GOLD : GOLD2)), seen);
      const sd = [(tip[0] - hand[0]) / 80, (tip[1] - hand[1]) / 80, (tip[2] - hand[2]) / 80];
      stampCapsule(tip, [tip[0] + sd[2] * 3, tip[1] + 2, tip[2] + 4], 2.4, out(GOLD), seen);
      stampCapsule(butt, [butt[0] - sd[0] * 5 + 1.5, butt[1] - sd[1] * 5, butt[2] - sd[2] * 5], 1.2, out(GOLD2), seen);
    }
    if (staffOnly) return;
    stampCapsule(sh, hand, 3.6, out((s, y) => (Math.abs(y - hand[1]) < 2.5 ? GOLD : BASALT)), seen);
  }

  shape(emit) {
    const removed = this.removed;
    const key = (x, y, z) => ((x - this.o[0] + 512) * 1024 + (y - this.o[1] + 512)) * 1024 + (z - this.o[2] + 512);
    for (const [x, y, z, color, k] of this.static) {
      if (this.parts[k].broken) continue;
      if (removed.size && removed.has(key(x, y, z))) continue;
      emit(x, y, z, color);
    }
    // 動く腕と杖の欠けは、腕・杖の座標で覚えておくと動きに合わせられないので、欠けは付けない
    this.dynamicCells(emit);
  }

  shapeAll(emit, skip) {
    if (skip && skip(this.o, 60)) return;
    this.shape(emit);
  }

  draw() {
    const { cells } = redrawBody(this.world, this.id, this.cells, (emit) => this.shape(emit), (m) => {
      const dx = m[0] - this.o[0], dz = m[2] - this.o[2];
      return Math.hypot(dx, dz) < 0.5 ? this.F : [dx, dz];
    });
    this.cells = cells;
    this.dirty = false;
    this.version++;
  }

  // 撃たれた: 当たった所が欠け、部位が弱っていく。頭・腕・杖は割れて落ちる
  shot(p, power) {
    const L = this.toLocal(p[0], p[1], p[2]);
    const dmg = 1 + power * 1.5;
    // 当たった所のまわりの石が欠ける
    const r = 1.3 + power * 0.8, R = Math.ceil(r);
    const cx = Math.floor(p[0]), cy = Math.floor(p[1]), cz = Math.floor(p[2]);
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      this.removed.add(((cx + dx - this.o[0] + 512) * 1024 + (cy + dy - this.o[1] + 512)) * 1024 + (cz + dz - this.o[2] + 512));
    }
    this.dirty = true;
    // どの部位か（いちばん近い部位）
    let best = null, bd = Infinity;
    this.parts.forEach((part) => {
      if (part.broken) return;
      const d = part.d(L[0], L[1], L[2]);
      if (d < bd) {
        bd = d;
        best = part;
      }
    });
    if (!this.armBroken) {
      const { sh, hand, butt, tip } = armPose(...this.angles);
      const dArm = capsule(sh, hand, 3.8, 3)(L[0], L[1], L[2]);
      const dStaff = this.staffBroken ? Infinity : capsule(butt, tip, 1.7, 1.7)(L[0], L[1], L[2]);
      if (dStaff < bd && dStaff < dArm) {
        this.staffHp -= dmg;
        if (this.staffHp <= 0) return this.breakDynamic('staff');
        return 'chip';
      }
      if (dArm < bd) {
        this.armHp -= dmg;
        if (this.armHp <= 0) return this.breakDynamic('arm');
        return 'chip';
      }
    }
    if (best && best.break) {
      best.hp -= dmg;
      if (best.hp <= 0) return this.breakPart(best);
    }
    return 'chip';
  }

  // 動かない部位が割れて落ちる
  breakPart(part) {
    const k = this.parts.indexOf(part);
    const cells = this.static.filter((c) => c[4] === k).map(([x, y, z, color]) => [x, y, z, color]);
    part.broken = true;
    this.draw();
    this.drop(cells, part.name === 'head' ? 'アヌビス像の頭' : 'アヌビス像の腕');
    this.events.push({ type: 'statueBreak', actor: this.entity, part: part.name });
    return 'break';
  }

  // 杖（または杖を持つ腕ごと）が割れて落ちる
  breakDynamic(which) {
    const cells = [];
    if (which === 'arm') {
      this.dynamicCells((x, y, z, c) => cells.push([x, y, z, c]));
      this.armBroken = true;
    } else {
      this.dynamicCells((x, y, z, c) => cells.push([x, y, z, c]), true);
      this.staffBroken = true;
    }
    this.phase = 'rest';
    this.draw();
    this.drop(cells, which === 'arm' ? 'アヌビス像の腕と杖' : 'アヌビス像の杖');
    this.events.push({ type: 'statueBreak', actor: this.entity, part: which });
    return 'break';
  }

  drop(cells, name) {
    const w = this.world;
    const map = new Map();
    for (const c of cells) if (w.ownerAt(c[0], c[1], c[2]) === 0) map.set(`${c[0]},${c[1]},${c[2]}`, c);
    const list = [...map.values()];
    if (!list.length) return;
    const lo = [0, 1, 2].map((a) => Math.min(...list.map((c) => c[a])));
    w.spawn({ kind: 'carcass', name, priority: 8, falling: true, vy: 0, fall: 0, pos: lo, voxels: list.map(([x, y, z, c]) => [x - lo[0], y - lo[1], z - lo[2], c]) });
  }
}

// ---- 水晶 ----------------------------------------------------------------------

const CRYSTAL_R = 24;
const VIOLET = [0x3a0a66, 0x5a1a9a, 0x7a2ad0, 0xa64dff, 0xc58cff, 0xdcb0ff];

export class Crystal {
  constructor(world, c) {
    this.world = world;
    this.c0 = [...c];
    this.c = [...c];
    this.id = world.nextId++;
    this.entity = { id: this.id, kind: 'crystal', name: '紫の水晶', priority: 9, pos: c.map(Math.round), offsets: new Int16Array(0), colors: new Uint32Array(0), body: this };
    world.entities.set(this.id, this.entity);
    this.spin = 0;
    this.time = 0;
    this.cells = [];
    this.events = [];
    this.version = 0;
    this.acc = 0;
  }

  update(dt) {
    this.events = [];
    this.acc += dt;
    if (this.acc < 0.16) return; // 1 秒に 6 回ほど（ゆっくり回るので十分）
    const step = this.acc;
    this.acc = 0;
    this.time += step;
    this.spin += step * 0.55;
    this.c[1] = this.c0[1] + Math.sin(this.time * 0.7) * 4;
    this.draw();
  }

  // 回っている正八面体の殻。面ごとに明るさを変え、全体がゆっくり明滅する
  shape(emit) {
    const R = CRYSTAL_R;
    const cs = Math.cos(this.spin), sn = Math.sin(this.spin);
    const tilt = 0.18 * Math.sin(this.time * 0.5);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const pulse = 0.85 + 0.25 * Math.sin(this.time * 2.1);
    const [X, Y, Z] = this.c;
    for (let y = Math.floor(Y - R - 1); y <= Y + R + 1; y++) {
      if (y < 1 || y >= HEIGHT) continue;
      for (let z = Math.floor(Z - R - 1); z <= Z + R + 1; z++) {
        for (let x = Math.floor(X - R - 1); x <= X + R + 1; x++) {
          const px = x + 0.5 - X, py = y + 0.5 - Y, pz = z + 0.5 - Z;
          // 体の座標へ（縦の軸まわりに回し、少し傾ける）
          const ax = px * cs - pz * sn, az = px * sn + pz * cs;
          const by = py * ct - ax * st, bx = py * st + ax * ct;
          const d = Math.abs(bx) + Math.abs(by) + Math.abs(az);
          if (d > R || d < R - 2.6) continue;
          // 面の向きで明るさを変える（上の面ほど明るい）。辺はいちばん明るく光る
          const face = (by > 0 ? 3 : 1) + (bx > 0 ? 1 : 0) + (az > 0 ? 0 : -1);
          const edge = Math.min(Math.abs(bx), Math.abs(by), Math.abs(az)) < 1.3;
          let k = edge ? 5 : clamp(face, 0, 4);
          const color = shade(VIOLET[k], pulse * (edge ? 1 : 0.9 + (hash3(x, y, z) % 10) / 50));
          emit(x, y, z, color);
          void k;
        }
      }
    }
  }

  shapeAll(emit, skip) {
    if (skip && skip(this.c, 40)) return;
    this.shape(emit);
  }

  draw() {
    const { cells } = redrawBody(this.world, this.id, this.cells, (emit) => this.shape(emit), () => null);
    this.cells = cells;
    this.version++;
  }
}
