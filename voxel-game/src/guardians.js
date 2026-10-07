// ピラミッドの門を守る巨アヌビス像と、頂上に浮かぶ紫の水晶
//
// 巨アヌビス像:
// - 門の外側の台座の上に、2 体の巨アヌビス像（高さ 15m ほど）が参道を向いて立つ。黒い石の体に金の首飾りと腰布、
//   山犬の頭と高い耳。外側の手に生命の印（アンク）、内側の手に長い杖（ウアス杖）
// - 体全体で動く。腰・膝・背骨・首・肩・肘の骨組みを持ち、脚と腕は関節を逆算して（IK）足を台座に、手を杖に着けたまま動く
// - プレイヤーが近くにいると、体ごとそちらへ向き直る（足を片方ずつ持ち上げて踏み替え、下ろすとどすんと沈む）
// - 前に来ると、両手で杖を握って膝を曲げて沈み、背中を大きく反らせて杖を頭の後ろへ振りかぶり（予備動作）、震えながらためて、
//   一歩踏み込みながら上体を前へ折って全身で叩きつける（頭も杖を追う）。反動で体が震え、少し止まってからゆっくり構えに戻る。
//   杖の下にいると体力が減る
// - ショットガンで撃つと、当たった所の石が欠ける。頭・両腕・杖は、撃ち続けると割れて下へ落ちる。
//   杖か杖を持つ腕が落ちると、もう攻撃できない。欠けた所は部位の座標で覚えるので、動いても欠けたまま
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

// 動かない形の部位（休んだ姿勢の像の座標）。rig: どの骨に付いて動くか。break: 割れて落ちる部位
const RIGID_PARTS = [
  { name: 'footL', rig: 'footL', d: box([-9, 0, -3], [-2, 3, 8]), color: () => BASALT },
  { name: 'footR', rig: 'footR', d: box([2, 0, -1], [9, 3, 10]), color: () => BASALT },
  {
    name: 'kilt', rig: 'kilt', d: (s, y, f) => (y < 34 || y > 50 ? 1 : Math.max(Math.abs(s) - (11 - (y - 34) * 0.12), Math.abs(f - 0.5) - 6.5)),
    color: (s, y) => (y > 47 ? GOLD : Math.floor(s + 20) % 3 === 0 ? GOLD2 : WHITE),
  },
  {
    name: 'torso', rig: 'torso', d: (s, y, f) => Math.min(ellipsoid([0, 60, 0], [10.5, 13, 6.5])(s, y, f), ellipsoid([0, 71, 0], [14, 4.5, 6])(s, y, f), capsule([0, 74, 0], [0, 79, 1.2], 4.2, 3.9)(s, y, f)),
    color: (s, y, f) => (y > 64 && y < 76 && f > -2 ? ((Math.floor(y) % 3 === 0) ? LAPIS : (Math.floor(y) % 3 === 1 ? GOLD : RED)) : (hash3(Math.floor(s), Math.floor(y), Math.floor(f)) % 9 === 0 ? BASALT2 : BASALT)),
  },
  {
    name: 'head', rig: 'head', break: true, hp: 10,
    d: (s, y, f) => Math.min(
      capsule([0, 78, 1], [0, 81, 1.5], 3.9, 3.8)(s, y, f),
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
];
// 動く部位（骨の位置から毎回描く）: 割れて落ちる腕と杖
const LIMB_HP = { armL: 10, arm: 12, staff: 8 };

// 骨組みの寸法
const HIP = 44, THIGH = 21, SHIN = 21, UPPER = 16, FORE = 13;
const PELVIS = [0, 46, 0], NECK = [0, 79, 1];
const ANKLE = [[-5.5, 3, 1], [5.5, 3, 4]]; // 左（外側）・右（内側、杖の側）の足首
const STAFF = 120; // 杖の長さ

// 3×4 の行列（像の座標の変換）
const mul = (A, B) => {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + (c === 3 ? A[r * 4 + 3] : 0);
    }
  }
  return o;
};
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
// 縦の軸まわり（s → f の向きへ）。正なら内側（+s）へ向く
const RY = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
};
// 横の軸まわり。正なら前へ倒れる（上が前へ）
const RX = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
};
const about = (p, R) => mul(T(p[0], p[1], p[2]), mul(R, T(-p[0], -p[1], -p[2])));
const apply = (M, p) => [
  M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3],
  M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7],
  M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11],
];
// 回転と平行移動だけの行列の逆
const invRigid = (M) => {
  const R = [M[0], M[4], M[8], M[1], M[5], M[9], M[2], M[6], M[10]];
  const t = [M[3], M[7], M[11]];
  return [
    R[0], R[1], R[2], -(R[0] * t[0] + R[1] * t[1] + R[2] * t[2]),
    R[3], R[4], R[5], -(R[3] * t[0] + R[4] * t[1] + R[5] * t[2]),
    R[6], R[7], R[8], -(R[6] * t[0] + R[7] * t[1] + R[8] * t[2]),
  ];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addS = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// 2 本の骨（l1, l2）で a から target へ届かせる。pole の向きへ関節を曲げる。戻り値は [関節, 先]
function ik(a, target, l1, l2, pole) {
  const v = sub(target, a);
  const L = Math.hypot(v[0], v[1], v[2]) || 1e-6;
  const d = clamp(L, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const dir = [v[0] / L, v[1] / L, v[2] / L];
  const end = addS(a, dir, d);
  const ca = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const pd = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2];
  const perp = norm([pole[0] - dir[0] * pd, pole[1] - dir[1] * pd, pole[2] - dir[2] * pd]);
  const joint = [a[0] + (dir[0] * ca + perp[0] * sa) * l1, a[1] + (dir[1] * ca + perp[1] * sa) * l1, a[2] + (dir[2] * ca + perp[2] * sa) * l1];
  return [joint, end];
}

// 姿勢のかなめ（像の向きは別）。G: 杖を持つ手（内側の手）の所、beta: 杖の傾き（0 = 上向き、正 = 前へ倒れる）、
// grip: 杖の石突きから手までの長さ、w: 外側の手が杖を握る度合い、stepF / liftR: 内側の足の踏み込み・持ち上げ
const REST = { lean: 0, twist: 0, dip: 0, shiftF: 0, nod: 0, G: [15, 45, 7], beta: 0, grip: 40, w: 0, stepF: 0, liftR: 0 };
// 振りかぶり: 背中を大きく反らせ、膝を曲げて沈み、両手で杖を頭の後ろへ。体重は後ろ足へ乗り、前の足が浮く
const WINDUP = { lean: -0.42, twist: -0.18, dip: 7, shiftF: -4, nod: -0.45, G: [8, 92, -15], beta: -0.8, grip: 16, w: 1, stepF: -1, liftR: 4 };
const POSE_KEYS = ['lean', 'twist', 'dip', 'shiftF', 'nod', 'beta', 'grip', 'w', 'stepF', 'liftR'];
function blend(a, b, t) {
  const o = { G: lerp3(a.G, b.G, t) };
  for (const k of POSE_KEYS) o[k] = lerp(a[k], b[k], t);
  return o;
}
const part01 = (u, a, b) => ease((u - a) / (b - a)); // u のうち a〜b の間で 0 → 1

// 叩きつけた姿勢: 上体を前へ深く折り、一歩踏み込んで沈み、頭も杖を追って下を向く。杖は狙った所（像の座標 [前, 高さ]）へ向ける
function strikePose(reach, ground) {
  const k = clamp((reach - 50) / 70, 0, 1);
  const G = lerp3([6, 44, 24], [6, 34, 40], k);
  const beta = clamp(Math.atan2(reach - G[2], ground + 4 - G[1]), 1.15, 2.9);
  return { lean: lerp(0.55, 0.78, k), twist: 0.16, dip: 11, shiftF: 8, nod: 0.55, G, beta, grip: 16, w: 1, stepF: 8, liftR: 0 };
}

const T_WIND = 1.7, T_HOLD = 0.45, T_STRIKE = 0.24, T_RECOVER = 1.6, T_REST = 1.3, T_STEP = 0.42;
const STATUE_DAMAGE = 35;
const TURN_LIMIT = 1.05;

let SHELLS = null;
// 部位ごとの殻（表面から 3 ボクセル）のセル。2 体で共通なので一度だけ作る
function buildShells() {
  const shells = RIGID_PARTS.map(() => []);
  for (let y = 0; y < 106; y++) {
    for (let s = -22; s <= 22; s++) {
      for (let f = -12; f <= 20; f++) {
        const ps = s + 0.5, py = y + 0.5, pf = f + 0.5;
        for (let k = 0; k < RIGID_PARTS.length; k++) {
          const part = RIGID_PARTS[k];
          const d = part.d(ps, py, pf);
          if (d > 0) continue;
          if (d < -3) break; // 中まで詰めない（殻だけ）
          shells[k].push(s, y, f, part.color(ps, py, pf));
          break;
        }
      }
    }
  }
  return shells.map((a) => Float64Array.from(a));
}

const cellKey = (s, y, f) => ((s + 512) * 1024 + (y + 512)) * 1024 + (f + 512);

// 線分 a–b のまわり（半径 r）の殻（表面から 2.5 ボクセル）のセルを塗る。toW: 像の座標 → 世界。
// 長い線分は短く区切って、区切りごとの箱の中だけを調べる（同じセルが 2 回来てもよい。redrawBody は最初の色にする）
function stampCapsule(a, b, r, emit, toW, color) {
  const A = toW(a), B = toW(b);
  const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-9;
  const L = Math.sqrt(L2);
  const n = Math.max(1, Math.ceil(L / Math.max(6, r * 2)));
  const inner = Math.max(0, r - 2.5);
  for (let k = 0; k < n; k++) {
    const t0 = k / n, t1 = (k + 1) / n;
    const lo = [0, 1, 2].map((i) => Math.floor(Math.min(A[i] + ab[i] * t0, A[i] + ab[i] * t1) - r));
    const hi = [0, 1, 2].map((i) => Math.floor(Math.max(A[i] + ab[i] * t0, A[i] + ab[i] * t1) + r));
    for (let y = Math.max(1, lo[1]); y <= Math.min(HEIGHT - 1, hi[1]); y++) {
      const py = y + 0.5 - A[1];
      for (let z = lo[2]; z <= hi[2]; z++) {
        const pz = z + 0.5 - A[2];
        for (let x = lo[0]; x <= hi[0]; x++) {
          const px = x + 0.5 - A[0];
          let t = (px * ab[0] + py * ab[1] + pz * ab[2]) / L2;
          // この区切りの分だけ（端の区切りは、丸い端も）
          if ((t < t0 && k > 0) || (t >= t1 && k < n - 1)) continue;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - ab[0] * t, dy = py - ab[1] * t, dz = pz - ab[2] * t;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r * r || d2 < inner * inner) continue;
          emit(x, y, z, typeof color === 'function' ? color(t, y) : color);
        }
      }
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
    // 像の座標 → 世界
    this.W = [this.S[0], 0, this.F[0], this.o[0], 0, 1, 0, this.o[1], this.S[1], 0, this.F[1], this.o[2]];
    this.id = world.nextId++;
    this.entity = { id: this.id, kind: 'statue', name, priority: 9, pos: [...this.o], offsets: new Int16Array(0), colors: new Uint32Array(0), body: this };
    world.entities.set(this.id, this.entity);
    SHELLS ??= buildShells();
    this.parts = RIGID_PARTS.map((p) => ({ ...p, hp: p.hp ?? Infinity, broken: false }));
    this.limbHp = { ...LIMB_HP };
    this.armBroken = false; // 杖を持つ腕
    this.armLBroken = false; // アンクを持つ腕
    this.staffBroken = false;
    this.removed = new Set(); // 欠けて消えたセル（部位の番号 * 2^31 + 部位の座標のセル）
    this.yaw = 0; // 体ごとの向き
    this.yawV = 0;
    this.feet = [0, 1].map(() => ({ yaw: 0, lift: 0, from: 0, to: 0, t: -1 }));
    this.thud = 0; // 足を下ろした・叩きつけた揺れ
    this.pose = { ...REST, G: [...REST.G] };
    this.phase = 'rest';
    this.t = 0;
    this.time = 0;
    this.since = Infinity; // 叩きつけてからの時間（反動の揺れ）
    this.delay = 0; // 攻撃を始めるまでの遅れ（2 体が同時に叩かないように）
    this.cells = [];
    this.events = [];
    this.version = 0;
    this.dirty = true;
    this.acc = 0;
    this.rig = this.buildRig();
  }

  // 世界 ↔ 像の座標
  toWorld(s, y, f) {
    return [this.o[0] + this.S[0] * s + this.F[0] * f, this.o[1] + y, this.o[2] + this.S[1] * s + this.F[1] * f];
  }

  toLocal(x, y, z) {
    const dx = x - this.o[0], dz = z - this.o[2];
    return [dx * this.S[0] + dz * this.S[1], y - this.o[1], dx * this.F[0] + dz * this.F[1]];
  }

  get label() {
    if (!this.canAttack()) return '杖を失った';
    return { rest: '台座で構えている', windup: '杖を両手で振りかぶる', hold: '杖を振りかぶってためる', strike: '全身で杖を叩きつける', recover: '構えに戻る', cool: '台座で構えている' }[this.phase];
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
    this.t += step;
    this.time += step;
    this.since += step;
    const near = L && L[2] > -10 && L[2] < 120 && Math.abs(L[0]) < 90 && Math.abs(L[1]) < 40;
    switch (this.phase) {
      case 'rest':
      case 'cool':
        if (this.phase === 'cool' && this.t < T_REST + this.delay) break;
        if (this.phase === 'rest' && this.t < this.delay) break;
        this.phase = 'rest';
        // 前の方（像の前 120 ボクセル以内）にプレイヤーが来たら、振りかぶる
        if (this.canAttack() && near) {
          this.phase = 'windup';
          this.t = 0;
          this.events.push({ type: 'statueWindup', actor: this.entity });
        }
        break;
      case 'windup':
        if (this.t >= T_WIND) {
          this.phase = 'hold';
          this.t = 0;
          // 狙いを決める（ここからは向きも変えない。ためている間に逃げれば当たらない）
          this.aim = this.aimAt(L);
        }
        break;
      case 'hold':
        if (this.t >= T_HOLD) {
          this.phase = 'strike';
          this.t = 0;
        }
        break;
      case 'strike':
        if (this.t >= T_STRIKE) {
          this.phase = 'recover';
          this.t = 0;
          this.since = 0;
          this.pose = this.poseNow(); // 叩きつけた形で
          this.rig = this.buildRig();
          this.impact(P);
        }
        break;
      case 'recover':
        if (this.t >= T_RECOVER) {
          this.phase = 'cool';
          this.t = 0;
        }
        break;
    }
    this.turn(step, L);
    this.pose = this.poseNow();
    const sig = this.signature();
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.rig = this.buildRig();
      this.dirty = true;
    }
    // チャンクが作り直されたら描き直す
    if (!this.dirty && this.world.tickCount % 12 === 0) this.dirty = this.cellsMissing();
    if (this.dirty) this.draw();
  }

  // 狙う所（体の向きに合わせた像の座標で [前への距離, 地面の高さ]）
  aimAt(L) {
    if (!L) return { reach: 90, ground: -14 };
    const reach = Math.hypot(L[0], L[2]);
    return { reach: clamp(reach, 30, 130), ground: clamp(L[1], -16, 4) };
  }

  // 体ごとプレイヤーの方へ向きを変える。重いので、ゆっくり動き出し、足を交互に踏み替えながら回る
  turn(step, L) {
    const locked = this.phase === 'hold' || this.phase === 'strike';
    const engaged = L && L[2] > -30 && Math.hypot(L[0], L[2]) < 170 && Math.abs(L[1]) < 50 && this.canAttack();
    const want = engaged ? clamp(Math.atan2(L[0], Math.max(L[2], 1)), -TURN_LIMIT, TURN_LIMIT) : 0;
    if (!locked) {
      const acc = (want - this.yaw) * 7 - this.yawV * 5;
      this.yawV = clamp(this.yawV + acc * step, -0.9, 0.9);
      this.yaw += this.yawV * step;
    } else {
      this.yawV = 0;
    }
    // 足の踏み替え: 体の向きから遅れた足を、片方ずつ持ち上げて向け直す
    const stepping = this.feet.some((ft) => ft.t >= 0);
    let worst = -1, wd = 0.16;
    this.feet.forEach((ft, i) => {
      const d = Math.abs(this.yaw - ft.yaw);
      if (ft.t < 0 && d > wd) {
        wd = d;
        worst = i;
      }
    });
    if (!stepping && worst >= 0 && !locked) {
      const ft = this.feet[worst];
      ft.t = 0;
      ft.from = ft.yaw;
      ft.to = this.yaw + Math.sign(this.yaw - ft.yaw) * 0.08 + this.yawV * 0.25;
      ft.side = worst === 0 ? -1 : 1;
    }
    for (const ft of this.feet) {
      if (ft.t < 0) continue;
      ft.t += step;
      const u = Math.min(1, ft.t / T_STEP);
      ft.yaw = lerp(ft.from, ft.to, ease(u));
      ft.lift = Math.sin(Math.PI * u) * 4;
      if (u >= 1) {
        ft.t = -1;
        ft.lift = 0;
        this.thud = 1; // どすん
        this.events.push({ type: 'statueStep', actor: this.entity });
      }
    }
    this.thud = Math.max(0, this.thud - step * 4);
  }

  // いまの段取りから、姿勢を決める（大げさな予備動作・ため・反動）
  poseNow() {
    const u = (T_) => Math.min(1, this.t / T_);
    let p;
    switch (this.phase) {
      case 'windup': {
        // 動きを少しずつずらす: まず外側の手が杖をつかみ、膝が沈み、背中が反って、最後に杖が頭の後ろへ上がる
        const v = u(T_WIND);
        p = blend(REST, WINDUP, ease(v));
        p.w = part01(v, 0, 0.3);
        p.dip = WINDUP.dip * part01(v, 0, 0.55);
        p.lean = WINDUP.lean * part01(v, 0.12, 0.9);
        p.G = lerp3(REST.G, WINDUP.G, part01(v, 0.2, 1));
        p.beta = lerp(REST.beta, WINDUP.beta, part01(v, 0.25, 1));
        p.grip = lerp(REST.grip, WINDUP.grip, part01(v, 0.05, 0.45)); // 手を杖の下の方へ持ち替える
        p.nod = WINDUP.nod * part01(v, 0.3, 1); // 頭が杖を追って上を向く
        p.liftR = WINDUP.liftR * part01(v, 0.5, 1);
        break;
      }
      case 'hold': {
        // さらに少しだけ反って、震えながらためる
        const v = u(T_HOLD);
        p = blend(WINDUP, WINDUP, 0);
        const tr = Math.sin(this.time * 55);
        p.lean = WINDUP.lean - 0.06 * ease(v) + tr * 0.012;
        p.G = [WINDUP.G[0], WINDUP.G[1] + tr * 0.7 + ease(v) * 1.5, WINDUP.G[2] - ease(v) * 2];
        p.dip = WINDUP.dip + ease(v) * 1.5;
        break;
      }
      case 'strike': {
        // 一気に（加速しながら）叩きつける。足が先に踏み込み、上体と杖がついてくる
        const v = u(T_STRIKE);
        const S = strikePose(this.aim.reach, this.aim.ground);
        const e = v * v;
        p = blend(WINDUP, S, e);
        p.stepF = lerp(WINDUP.stepF, S.stepF, part01(v, 0, 0.6));
        p.liftR = Math.sin(Math.PI * Math.min(1, v / 0.6)) * 3;
        p.dip = lerp(WINDUP.dip, S.dip, ease(v));
        p.nod = lerp(WINDUP.nod, S.nod, Math.min(1, v * v * 1.2)); // 頭も杖を追って振り下ろされる
        break;
      }
      case 'recover': {
        // 叩いた形のまま少し止まってから（重さ）、ゆっくり元の構えへ
        const v = u(T_RECOVER);
        const S = strikePose(this.aim.reach, this.aim.ground);
        p = blend(S, REST, part01(v, 0.22, 1));
        p.w = 1 - part01(v, 0.55, 0.95);
        p.grip = lerp(S.grip, REST.grip, part01(v, 0.5, 0.95));
        p.stepF = S.stepF * (1 - part01(v, 0.6, 1));
        p.liftR = Math.sin(Math.PI * part01(v, 0.6, 1)) * 3;
        break;
      }
      default:
        p = blend(REST, REST, 0);
        // 構えている間も、ゆっくり息をする
        p.lean += Math.sin(this.time * 1.3) * 0.015;
        p.G = addS(p.G, [0, 1, 0], Math.sin(this.time * 1.3) * 0.4);
    }
    // 叩きつけた反動: 体が跳ね返って震える
    if (this.since < 1.4) {
      const r = Math.exp(-this.since * 4.5) * Math.sin(this.since * 26);
      p.lean += r * 0.07;
      p.dip += Math.abs(r) * 2;
      p.G = addS(p.G, [0, 1, 0], r * 3);
      p.nod += r * 0.12;
    }
    // 足を踏み替えている間は、体重が反対の足へ移り、下ろすとどすんと沈む
    for (const ft of this.feet) if (ft.t >= 0) p.shiftS = (p.shiftS ?? 0) - ft.side * 2.4 * Math.sin(Math.PI * Math.min(1, ft.t / T_STEP));
    p.dip += this.thud * 1.6;
    return p;
  }

  signature() {
    const p = this.pose;
    const r = (v) => Math.round(v * 40);
    return [this.yaw, p.lean, p.twist, p.dip, p.shiftF, p.shiftS ?? 0, p.nod, ...p.G, p.beta, p.grip, p.w, p.stepF, p.liftR, ...this.feet.flatMap((ft) => [ft.yaw, ft.lift])].map(r).join();
  }

  // 姿勢から、部位ごとの変換（体の向きを除いた像の座標）と、手足・杖の骨の位置を求める
  buildRig() {
    const p = this.pose;
    const Y = mul(this.W, RY(this.yaw)); // 体の向きの座標 → 世界
    const pel = T(p.shiftS ?? 0, -p.dip, p.shiftF);
    const torso = mul(pel, about(PELVIS, mul(RY(p.twist), RX(p.lean))));
    const head = mul(torso, about(NECK, RX(p.nod)));
    const kilt = mul(pel, about(PELVIS, RX(p.lean * 0.3)));
    const feet = this.feet.map((ft, i) => mul(RY(ft.yaw - this.yaw), T(0, ft.lift + (i === 1 ? p.liftR : 0), i === 1 ? p.stepF : 0)));
    const mats = { footL: feet[0], footR: feet[1], kilt, torso, head };
    // 脚: 腰から足首へ（膝は前へ曲がる）
    const legs = [0, 1].map((i) => {
      const side = i ? 1 : -1;
      const hip = apply(kilt, [side * 5.5, HIP, 0.5]);
      const ankle = apply(feet[i], ANKLE[i]);
      const [knee, foot] = ik(hip, ankle, THIGH, SHIN, [side * 0.15, 0, 1]);
      return { hip, knee, foot };
    });
    // 杖と、それを握る両手
    const sd = [0, Math.cos(p.beta), Math.sin(p.beta)];
    const G = p.G;
    const butt = addS(G, sd, -p.grip), tip = addS(G, sd, STAFF - p.grip);
    const ankhHand = apply(torso, [-14.5, 45, 7]);
    const targets = [lerp3(ankhHand, addS(G, sd, -11), p.w), G];
    const arms = [0, 1].map((i) => {
      const side = i ? 1 : -1;
      const sh = apply(torso, [side * 13, 72, 0]);
      const [elbow, hand] = ik(sh, targets[i], UPPER, FORE, [side * 0.8, -0.4, -0.5]);
      return { sh, elbow, hand };
    });
    return { Y, mats, legs, arms, staff: { butt, tip, G, sd } };
  }

  // 世界の位置: 部位（rig の名前）の、休んだ姿勢の像の座標 p にあたる所
  pointOf(rig, p) {
    return apply(mul(this.rig.Y, this.rig.mats[rig]), p);
  }

  // 世界の位置: 杖を持つ手から、杖に沿って k ボクセル先
  staffPoint(k) {
    const { Y, staff } = this.rig;
    return apply(Y, addS(staff.G, staff.sd, k));
  }

  // 像のかかるチャンクが新しく作られた（作り直された）か
  cellsMissing() {
    const w = this.world;
    if (!this.spanKeys) {
      const keys = new Set();
      for (let a = -40; a <= 40; a += 8) for (let b = -40; b <= 40; b += 8) keys.add(chunkKeyAt(this.o[0] + a, this.o[2] + b));
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

  // 杖が地面を叩いた: 杖の下にいるプレイヤーは体力が減る
  impact(P) {
    if (!this.canAttack()) return;
    const { Y, staff } = this.rig;
    this.events.push({ type: 'statueSlam', actor: this.entity });
    // 杖が地面に届いた所に土ぼこり
    const g = this.aim?.ground ?? -14;
    const k = staff.sd[1] < -0.05 ? clamp((g - staff.G[1]) / staff.sd[1], 0, STAFF) : STAFF - 16;
    this.world.splashes?.dust?.(...apply(Y, addS(staff.G, staff.sd, k)));
    if (!P) return;
    const q = apply(invRigid(Y), [P[0], P[1] + 6, P[2]]);
    const mid = addS(staff.G, staff.sd, (STAFF - 16) * 0.35);
    const end = addS(staff.G, staff.sd, Math.min(k, STAFF - 16));
    if (capsule(mid, end, 0, 0)(q[0], q[1], q[2]) < 12) {
      const r = this.world.hurt?.(STATUE_DAMAGE);
      this.events.push({ type: 'statueHit', actor: this.entity, target: this.world.player, damage: STATUE_DAMAGE });
      if (r) this.events.push(r);
    }
  }

  // 割れていない部位の数（動く部位: 脚・腕・杖）を描く。only: その部位だけ
  limbCells(emit, only = null) {
    const { Y, legs, arms, staff } = this.rig;
    const toW = (p) => apply(Y, p);
    const cap = (a, b, r, color) => stampCapsule(a, b, r, emit, toW, color);
    const want = (name) => !only || only === name;
    if (!only) {
      for (const leg of legs) {
        cap(leg.hip, leg.knee, 5, BASALT);
        cap(leg.knee, leg.foot, 4.2, BASALT);
      }
    }
    if (!this.staffBroken && !this.armBroken && want('staff')) {
      // 杖（金の帯）と、頭の飾り・二股の石突き
      const { butt, tip, sd } = staff;
      cap(butt, tip, 1.7, (t) => (Math.floor(t * STAFF) % 14 < 2 ? GOLD : GOLD2));
      cap(tip, addS(addS(tip, sd, 2), [0, 0, 1], 0), 2.4, GOLD);
      cap(tip, addS(tip, [sd[0], sd[2], -sd[1]], 4), 2, GOLD);
      cap(butt, addS(addS(butt, sd, -5), [1.5, 0, 0], 1), 1.2, GOLD2);
    }
    for (const [i, name] of [[0, 'armL'], [1, 'arm']]) {
      if ((i === 0 ? this.armLBroken : this.armBroken) || !want(name)) continue;
      const { sh, elbow, hand } = arms[i];
      cap(sh, elbow, 3.7, BASALT);
      cap(elbow, hand, 3.1, (t) => (t > 0.8 ? GOLD : BASALT)); // 金の腕輪
      if (i === 0) {
        // 生命の印（アンク）を握っている
        const a = addS(hand, [0, -1, 1.5], 1);
        cap(a, addS(a, [0, -11, 0], 1), 1.2, GOLD);
        cap(addS(a, [-3, 0, 0], 1), addS(a, [3, 0, 0], 1), 1.2, GOLD);
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2;
          const ring = (q) => addS(a, [Math.sin(q) * 2.6, 3.4 - Math.cos(q) * 3, 0], 1);
          cap(ring(a0), ring(a1), 1, GOLD);
        }
      }
    }
  }

  // 動かない形の部位のセル。only: その部位（番号）だけ
  rigidCells(emit, only = -1) {
    const { Y, mats } = this.rig;
    const removed = this.removed;
    for (let k = 0; k < RIGID_PARTS.length; k++) {
      if (this.parts[k].broken || (only >= 0 && k !== only)) continue;
      const M = mul(Y, mats[RIGID_PARTS[k].rig]);
      const cells = SHELLS[k];
      const base = k * 2147483648;
      for (let n = 0; n < cells.length; n += 4) {
        const s = cells[n], y = cells[n + 1], f = cells[n + 2];
        if (removed.size && removed.has(base + cellKey(s, y, f))) continue;
        const ps = s + 0.5, py = y + 0.5, pf = f + 0.5;
        const wy = Math.floor(M[4] * ps + M[5] * py + M[6] * pf + M[7]);
        if (wy < 1 || wy >= HEIGHT) continue;
        emit(Math.floor(M[0] * ps + M[1] * py + M[2] * pf + M[3]), wy, Math.floor(M[8] * ps + M[9] * py + M[10] * pf + M[11]), cells[n + 3]);
      }
    }
  }

  shape(emit) {
    this.rigidCells(emit);
    this.limbCells(emit);
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

  // 撃たれた: 当たった所が欠け、部位が弱っていく。頭・両腕・杖は割れて落ちる
  shot(p, power) {
    const dmg = 1 + power * 1.5;
    const { Y, mats, legs, arms, staff } = this.rig;
    const q = apply(invRigid(Y), p); // 体の向きの座標
    // どの部位か（いちばん近い部位）
    let best = null, bd = Infinity;
    const consider = (d, what) => {
      if (d < bd) {
        bd = d;
        best = what;
      }
    };
    this.parts.forEach((part, k) => {
      if (part.broken) return;
      const lq = apply(invRigid(mats[part.rig]), q);
      consider(part.d(lq[0], lq[1], lq[2]), { k, lq });
    });
    for (const leg of legs) consider(Math.min(capsule(leg.hip, leg.knee, 5, 5)(...q), capsule(leg.knee, leg.foot, 4.2, 4.2)(...q)), { limb: 'leg' });
    if (!this.armLBroken) consider(Math.min(capsule(arms[0].sh, arms[0].elbow, 3.7, 3.7)(...q), capsule(arms[0].elbow, arms[0].hand, 3.1, 3.1)(...q)), { limb: 'armL' });
    if (!this.armBroken) consider(Math.min(capsule(arms[1].sh, arms[1].elbow, 3.7, 3.7)(...q), capsule(arms[1].elbow, arms[1].hand, 3.1, 3.1)(...q)), { limb: 'arm' });
    if (!this.armBroken && !this.staffBroken) consider(capsule(staff.butt, staff.tip, 1.7, 1.7)(...q) - 0.5, { limb: 'staff' });
    if (!best) return 'chip';
    if (best.limb) {
      if (best.limb === 'leg') return 'chip';
      this.limbHp[best.limb] -= dmg;
      if (this.limbHp[best.limb] <= 0) return this.breakLimb(best.limb);
      return 'chip';
    }
    // 動かない形の部位: 当たった所のまわりの石が欠ける（部位の座標で覚えるので、動いても欠けたまま）
    const part = this.parts[best.k];
    const r = 1.3 + power * 0.8, R = Math.ceil(r);
    const [cs, cy, cf] = best.lq.map(Math.floor);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) {
      if (a * a + b * b + c * c > r * r) continue;
      this.removed.add(best.k * 2147483648 + cellKey(cs + a, cy + b, cf + c));
    }
    this.dirty = true;
    if (part.break) {
      part.hp -= dmg;
      if (part.hp <= 0) return this.breakPart(part);
    }
    return 'chip';
  }

  // 動かない形の部位（頭）が割れて落ちる
  breakPart(part) {
    const cells = [];
    this.rigidCells((x, y, z, c) => cells.push([x, y, z, c]), this.parts.indexOf(part));
    part.broken = true;
    this.draw();
    this.drop(cells, part.name === 'head' ? 'アヌビス像の頭' : 'アヌビス像のかけら');
    this.events.push({ type: 'statueBreak', actor: this.entity, part: part.name });
    return 'break';
  }

  // 腕（アンクの腕・杖の腕）や杖が割れて落ちる。杖の腕なら杖も一緒に落ちる
  breakLimb(which) {
    const cells = [];
    this.limbCells((x, y, z, c) => cells.push([x, y, z, c]), which);
    if (which === 'arm') this.limbCells((x, y, z, c) => cells.push([x, y, z, c]), 'staff');
    if (which === 'armL') this.armLBroken = true;
    else if (which === 'arm') this.armBroken = true;
    else this.staffBroken = true;
    if (!this.canAttack() && this.phase !== 'rest') {
      this.phase = 'rest';
      this.t = 0;
    }
    this.draw();
    this.drop(cells, { armL: 'アヌビス像の腕とアンク', arm: 'アヌビス像の腕と杖', staff: 'アヌビス像の杖' }[which]);
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
