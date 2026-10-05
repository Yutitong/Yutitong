// 人型キャラのボクセル模型
//
// 骨格（腰・膝・足首・肩・肘・首・頭）の角度から体の形を組み立て、
// 太ももやすねなどの部位を「先細りのカプセル」や「楕円体」として
// ボクセルに塗りつぶす（ラスタライズする）。
// 関節は連続的に曲がるが、表示は 15cm のボクセル単位なのでドット感は残る。
//
// キャラは常に 9×15×9 の箱の中の円柱（当たり判定）を占有する。円柱なのでどちらを向いても同じで、
// 斜面でも角が地面に引っかかりにくい。
// アニメーションはこの直方体の中で「どのボクセルを何色で点灯するか」を切り替えるだけ。
// 色 0 は「占有しているが消灯」を表す。

export const HUMAN_SIZE = [9, 15, 9];
const [W, H, D] = HUMAN_SIZE;
const N = W * H * D;
const CX = W / 2; // 体の中心（ボクセル中心 4.5 に合う）
const CZ = D / 2;

// 体の寸法（ボクセル単位。1 ≈ 15cm）
export const BODY = {
  hipHalf: 1.0, // 左右の股関節の間隔の半分
  thigh: 3.3,
  shin: 3.3,
  ankle: 0.6, // 足首の高さ
  foot: 1.5, // 足首からつま先まで
  spine: 3.0, // 骨盤から首の付け根まで
  shoulderHalf: 2.0,
  upperArm: 2.4,
  forearm: 2.2,
  neck: 0.6,
  head: [1.45, 1.55, 1.5], // 頭の半径（横・縦・前後）
};

// 当たり判定の円柱に入るセル（箱の中の番号）と、その相対位置。全キャラ共通。
export const HUMAN_RADIUS = 4.6;
export const HUMAN_MASK = (() => {
  const idx = [];
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x + 0.5 - CX, z + 0.5 - CZ) <= HUMAN_RADIUS) idx.push(x + W * (z + D * y));
      }
    }
  }
  return Int32Array.from(idx);
})();
export const HUMAN_OFFSETS = (() => {
  const o = new Int16Array(HUMAN_MASK.length * 3);
  HUMAN_MASK.forEach((i, k) => {
    o[k * 3] = i % W;
    o[k * 3 + 1] = Math.floor(i / (W * D));
    o[k * 3 + 2] = Math.floor(i / W) % D;
  });
  return o;
})();

// 姿勢のパラメータ
export function createPose() {
  return {
    yaw: 0, // 体の向き（0 = +z、+x 向きが π/2）
    phase: 0, // 歩行周期の位置 0..1（1周期で左右1歩ずつ）
    walk: 0, // 歩き・走りの振れ幅 0..1（0 = 立ち姿）
    run: 0, // 歩き → 走りの混ざり具合 0..1
    sprint: 0, // 走り → 全力疾走 0..1（脚を大きく振り、前に倒れ込む）
    push: 0, // 押す姿勢 0..1
    breath: 0, // 呼吸 0..1
    sway: 0, // 立っているときの重心移動 -1..1
    headYaw: 0, // 首を振る角度
    blink: false,
    crouch: 0, // 段差を登った直後・着地したときに膝を曲げる 0..1
    air: 0, // 落ちている 0..1
    swing: 0, // 斧を振る動きの進み具合 0..1（0 = 振っていない）
  };
}

// ---- 小さなベクトル計算 ------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// x 軸まわりの回転（前に倒す向きが正）。p は [x, y, z]
const tilt = (p, ang) => [
  p[0],
  p[1] * Math.cos(ang) - p[2] * Math.sin(ang),
  p[1] * Math.sin(ang) + p[2] * Math.cos(ang),
];
// 前に ang だけ振った長さ len の下向きベクトル
const swingDown = (len, ang, side = 0) => [side * len, -len * Math.cos(ang), len * Math.sin(ang)];

// 斧を振る動きのかなめのコマ: [進み具合, 肩の角度, 肘の曲がり, 腕を内へ寄せる量, 手首の返し]
// 振りかぶる（斧が頭の後ろへ） → 前へ振り下ろす（0.55 で当たる） → 戻す
const CHOP_KEYS = [
  [0.0, 0.3, 0.4, 0.0, -1.2],
  [0.15, 2.2, 1.0, 0.0, -1.4],
  [0.38, 3.25, 1.4, -0.15, -1.5],
  [0.55, 1.0, 0.15, -0.35, -0.25],
  [0.75, 0.7, 0.3, -0.25, -0.6],
  [1.0, 0.3, 0.4, 0.0, -1.2],
];
export const CHOP_IMPACT = 0.55;

function chopKey(t) {
  let k = 0;
  while (k < CHOP_KEYS.length - 2 && CHOP_KEYS[k + 1][0] < t) k++;
  const a = CHOP_KEYS[k], b = CHOP_KEYS[k + 1];
  const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
  const e = u * u * (3 - 2 * u);
  return a.map((v, i) => v + (b[i] - v) * e);
}

// ---- 骨格 → 部位 ------------------------------------------------------------

// 姿勢から部位の一覧を作る（体の座標: x = 右, y = 上, z = 前。足元の中心が原点）
function buildParts(p, pal) {
  const B = BODY;
  const ph = p.phase * Math.PI * 2;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const w = p.walk;
  const r = p.run;
  const sp = p.sprint ?? 0;
  const push = p.push;

  // 脚: 太ももの振り角 a と膝の曲がり k。振り出している脚（遊脚）ほど膝が大きく曲がる。
  const A = (lerp(0.42, 0.72, r) + 0.16 * sp) * w * (1 - 0.35 * push);
  const kSwing = (lerp(1.0, 1.9, r) + 0.3 * sp) * w;
  const kStance = lerp(0.08, 0.4, r) * w + 0.04 + 0.25 * push + 0.35 * p.air;
  // しゃがむ: 腿を前に出し、膝を曲げる（骨盤が下がり、足は地面に残る）
  const squatA = p.crouch * 0.5;
  const squatK = p.crouch * 1.0;
  const legs = [
    { side: -1, a: A * s + squatA, k: kStance + squatK + kSwing * Math.max(0, c) ** 2 },
    { side: 1, a: -A * s + squatA, k: kStance + squatK + kSwing * Math.max(0, -c) ** 2 },
  ];
  for (const leg of legs) {
    leg.height = B.thigh * Math.cos(leg.a) + B.shin * Math.cos(leg.a - leg.k) + B.ankle;
  }
  // 骨盤の高さは、地面に着いている方の脚の長さで決まる → 自然な上下動になる
  const flight = (r * 0.9 + sp * 0.4) * w * s * s; // 走りでは脚が開いた瞬間に両足が浮く
  const hipY = Math.max(legs[0].height, legs[1].height) + flight;
  const sway = p.sway * 0.35 * (1 - w);

  const parts = [];
  const capsule = (a, b, ra, rb, color, bias = 0, tool = false) => parts.push({ type: 'cap', a, b, ra, rb, color, bias, tool });
  // pow = 2 で楕円体、大きくすると角の丸い箱に近づく
  const ellipsoid = (center, radii, color, bias = 0, shade = null, yaw = 0, pow = 2) =>
    parts.push({ type: 'ell', center, radii, color, bias, shade, yaw, pow });

  for (const leg of legs) {
    const hip = [leg.side * B.hipHalf + sway, hipY, 0];
    const knee = add(hip, swingDown(B.thigh, leg.a));
    const ankle = add(knee, swingDown(B.shin, leg.a - leg.k));
    // 足は地面とほぼ平行。蹴り出しでつま先が下がり、振り出しでつま先が上がる。
    const footAng = (leg.a - leg.k) * 0.6;
    const toe = add(ankle, [0, -B.ankle * 0.55 - Math.sin(footAng) * B.foot * 0.5, Math.cos(footAng) * B.foot]);
    const heel = add(ankle, [0, -B.ankle * 0.55, -0.35]);
    capsule(hip, knee, 0.85, 0.68, pal.pants);
    capsule(knee, ankle, 0.66, 0.5, pal.pants);
    capsule(heel, toe, 0.5, 0.45, pal.shoes, 0.1);
  }

  // 胴: 前傾（歩き < 走り < 押す）と、呼吸での胸のふくらみ
  const lean = 0.05 * w + (0.2 * r + 0.14 * sp) * w + 0.35 * push + 0.25 * p.crouch;
  const pelvis = [sway, hipY + 0.35, 0];
  const up = (len) => add(pelvis, tilt([0, len, 0], lean));
  const breathLift = p.breath * 0.3;
  ellipsoid(pelvis, [1.35, 0.75, 1.05], pal.belt ?? pal.pants);
  ellipsoid(up(1.15), [1.2, 0.95, 1.0], pal.shirt);
  ellipsoid(up(2.15), [1.55, 1.2, 1.15 + p.breath * 0.15], pal.shirt, 0.05);
  const neckBase = up(B.spine);

  // 腕: 同じ側の脚と逆向きに振る。肩も少しひねる。
  const armAmp = (lerp(0.38, 0.95, r) + 0.25 * sp) * w * (1 - push);
  const twist = 0.25 * w * s;
  for (const side of [-1, 1]) {
    const shoulder = add(neckBase, [side * B.shoulderHalf, -0.6 + breathLift, side * twist]);
    let swingA = side * armAmp * s + push * 1.3; // side=-1（左）は右脚と同じ向き
    let elbowBend = lerp(lerp(0.2, 0.5, Math.max(0, side * s) * w), 1.55, r * w) * (1 - push) + push * 0.35;
    let lateral = side * (0.06 + 0.45 * p.air); // 落ちるときは腕が開く
    let cock = -1.2; // 手首の返し（斧の柄と前腕の角度）
    const axeArm = pal.axe && side === 1; // 右手に斧
    if (axeArm && p.swing > 0) {
      const [, a, e, lat, k] = chopKey(p.swing);
      const wgt = Math.min(1, p.swing / 0.12, (1 - p.swing) / 0.2);
      swingA = lerp(swingA, a, wgt);
      elbowBend = lerp(elbowBend, e, wgt);
      lateral = lerp(lateral, lat, wgt);
      cock = lerp(cock, k, wgt);
    }
    const elbow = add(shoulder, swingDown(B.upperArm, swingA, lateral));
    const hand = add(elbow, swingDown(B.forearm, swingA + elbowBend));
    capsule(shoulder, elbow, 0.66, 0.6, pal.shirt, 0.15);
    capsule(elbow, hand, 0.6, 0.55, pal.skin, 0.15);
    ellipsoid(hand, [0.6, 0.62, 0.6], pal.skin, 0.2);
    if (axeArm) {
      // 柄は前腕の向きを手首で返した向き。刃は柄に直角で、振り下ろす側を向く
      const f = [hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]];
      const fl = Math.hypot(...f) || 1;
      const fy = f[1] / fl, fz = f[2] / fl;
      let h = [f[0] / fl * 0.3, fy * Math.cos(cock) - fz * Math.sin(cock), fy * Math.sin(cock) + fz * Math.cos(cock)];
      const hl = Math.hypot(...h);
      h = h.map((v) => v / hl);
      const edge = [0, -h[2], h[1]];
      const at = (k, e2 = 0) => [hand[0] + h[0] * k + edge[0] * e2, hand[1] + h[1] * k + edge[1] * e2, hand[2] + h[2] * k + edge[2] * e2];
      capsule(at(-0.6), at(3.4), 0.42, 0.4, pal.axe.handle, 0.45, true);
      capsule(at(3.0, -0.5), at(3.0, 1.4), 0.75, 0.6, pal.axe.blade, 0.5, true);
      capsule(at(3.0, 1.3), at(3.0, 1.8), 0.62, 0.62, pal.axe.edge, 0.55, true);
    }
  }

  // 首と頭（頭は首から上だけ別に回せる）
  const neckTop = add(neckBase, [0, B.neck + breathLift * 0.5, 0.1]);
  capsule(neckBase, neckTop, 0.5, 0.48, pal.skin);
  const head = add(neckTop, [0, B.head[1] * 0.9, 0.05]);
  // 頭の高さはボクセルの中心にそろえる。上下動で頭の形が毎コマ変わらず、1段ずつ上下する。
  head[1] = Math.floor(head[1]) + 0.5;
  ellipsoid(head, B.head, pal.skin, 0.3, headShade(pal, p.blink), p.headYaw, 4);
  return parts;
}

// 頭の中の位置（-1..1 に正規化）から色を決める: 髪・目・肌
function headShade(pal, blink) {
  return (lx, ly, lz) => {
    if (lz > 0.45 && ly > -0.2 && ly < 0.3 && Math.abs(lx) > 0.3 && Math.abs(lx) < 0.95) {
      return blink ? pal.skin : pal.eyes;
    }
    if (ly > 0.4) return pal.hair; // 頭頂
    if (lz < -0.3 && ly > -0.7) return pal.hair; // 後頭部
    if (Math.abs(lx) > 0.6 && ly > -0.2 && lz < 0.3) return pal.hair; // 横髪
    return pal.skin;
  };
}

// ---- ラスタライズ -------------------------------------------------------------

// 1セルを 2×2×2 点で調べ、何割が部位の中にあるかで点灯を決める（斜めを向いても形が崩れにくい）
const SUB = [-0.25, 0.25];
const THRESHOLD = 3 / 8;
const cover = new Float32Array(N);

function distToSegment(px, py, pz, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = ((px - a[0]) * abx + (py - a[1]) * aby + (pz - a[2]) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (a[0] + abx * t), dy = py - (a[1] + aby * t), dz = pz - (a[2] + abz * t);
  return [Math.sqrt(dx * dx + dy * dy + dz * dz), t];
}

// 体の座標を直方体の座標に移す（向き yaw で回してから中心へ）
function toBox(p, cos, sin) {
  return [CX + p[0] * cos + p[2] * sin, p[1], CZ - p[0] * sin + p[2] * cos];
}

// 当たり判定の円柱のセルだけの色（HUMAN_OFFSETS と同じ並び）
const full = new Uint32Array(N);
export function humanColors(palette, pose, out = new Uint32Array(HUMAN_MASK.length)) {
  rasterizeHuman(palette, pose, full);
  for (let k = 0; k < HUMAN_MASK.length; k++) out[k] = full[HUMAN_MASK[k]];
  return out;
}

// palette と pose から、直方体の各セルの色（0 = 消灯）を out に書き込んで返す
export function rasterizeHuman(palette, pose, out = new Uint32Array(N)) {
  out.fill(0);
  cover.fill(0);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  for (const part of buildParts(pose, palette)) {
    let lo, hi, inside;
    if (part.type === 'cap') {
      const a = toBox(part.a, cos, sin);
      const b = toBox(part.b, cos, sin);
      const rMax = Math.max(part.ra, part.rb);
      lo = [Math.min(a[0], b[0]) - rMax, Math.min(a[1], b[1]) - rMax, Math.min(a[2], b[2]) - rMax];
      hi = [Math.max(a[0], b[0]) + rMax, Math.max(a[1], b[1]) + rMax, Math.max(a[2], b[2]) + rMax];
      inside = (x, y, z) => {
        const [d, t] = distToSegment(x, y, z, a, b);
        return d <= part.ra + (part.rb - part.ra) * t;
      };
    } else {
      const c = toBox(part.center, cos, sin);
      const [rx, ry, rz] = part.radii;
      const rMax = Math.max(rx, ry, rz);
      lo = [c[0] - rMax, c[1] - ry, c[2] - rMax];
      hi = [c[0] + rMax, c[1] + ry, c[2] + rMax];
      // 楕円体は体の向き + 自分の向き（頭の首振り）で回す
      const ec = Math.cos(pose.yaw + part.yaw);
      const es = Math.sin(pose.yaw + part.yaw);
      part.local = (x, y, z) => {
        const dx = x - c[0], dz = z - c[2];
        return [(dx * ec - dz * es) / rx, (y - c[1]) / ry, (dx * es + dz * ec) / rz];
      };
      inside = (x, y, z) => {
        const [lx, ly, lz] = part.local(x, y, z);
        return Math.abs(lx) ** part.pow + Math.abs(ly) ** part.pow + Math.abs(lz) ** part.pow <= 1;
      };
    }
    const x0 = Math.max(0, Math.floor(lo[0])), x1 = Math.min(W - 1, Math.floor(hi[0]));
    const y0 = Math.max(0, Math.floor(lo[1])), y1 = Math.min(H - 1, Math.floor(hi[1]));
    const z0 = Math.max(0, Math.floor(lo[2])), z1 = Math.min(D - 1, Math.floor(hi[2]));
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          let n = 0;
          for (const sx of SUB) for (const sy of SUB) for (const sz of SUB) {
            if (inside(x + 0.5 + sx, y + 0.5 + sy, z + 0.5 + sz)) n++;
          }
          const cov = n / 8;
          const i = x + W * (z + D * y);
          if (cov < THRESHOLD || cov + part.bias <= cover[i]) continue;
          cover[i] = cov + part.bias;
          out[i] = part.shade ? part.shade(...part.local(x + 0.5, y + 0.5, z + 0.5)) : part.color;
        }
      }
    }
  }
  return out;
}

// 道具（斧）のうち、当たり判定の円柱からはみ出した部分のセル: [[x, y, z, color], ...]（箱の座標。範囲外もある）
// 体の中に収まる部分は rasterizeHuman が描く。はみ出した部分は、世界の空いているセルにだけ別の持ち主として描く
const MASK_SET = new Set(HUMAN_MASK);
export function rasterizeTool(palette, pose) {
  const cells = new Map();
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  for (const part of buildParts(pose, palette)) {
    if (!part.tool) continue;
    const a = toBox(part.a, cos, sin);
    const b = toBox(part.b, cos, sin);
    const rMax = Math.max(part.ra, part.rb);
    for (let y = Math.floor(Math.min(a[1], b[1]) - rMax); y <= Math.floor(Math.max(a[1], b[1]) + rMax); y++) {
      for (let z = Math.floor(Math.min(a[2], b[2]) - rMax); z <= Math.floor(Math.max(a[2], b[2]) + rMax); z++) {
        for (let x = Math.floor(Math.min(a[0], b[0]) - rMax); x <= Math.floor(Math.max(a[0], b[0]) + rMax); x++) {
          if (x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D && MASK_SET.has(x + W * (z + D * y))) continue;
          let n = 0;
          for (const sx of SUB) for (const sy of SUB) for (const sz of SUB) {
            const [d, t] = distToSegment(x + 0.5 + sx, y + 0.5 + sy, z + 0.5 + sz, a, b);
            if (d <= part.ra + (part.rb - part.ra) * t) n++;
          }
          if (n / 8 >= THRESHOLD) cells.set(`${x},${y},${z}`, [x, y, z, part.color]);
        }
      }
    }
  }
  return [...cells.values()];
}

export const PALETTES = {
  player: { id: 'player', axe: { handle: 0x8a5a32, blade: 0x9aa4ae, edge: 0xe6edf2 }, skin: 0xf1c7a0, hair: 0x3a2618, eyes: 0x4a3229, shirt: 0xf2a541, pants: 0x2f4a7a, belt: 0x3b2b22, shoes: 0x3b2b22 },
  npc: [
    { id: 'npc0', skin: 0xe8b58e, hair: 0x1f1f2b, eyes: 0x4a3229, shirt: 0x3cc4b0, pants: 0x4a4a5c, belt: 0x2a2a30, shoes: 0x2a2a30 },
    { id: 'npc1', skin: 0xc68d63, hair: 0x6b3b1f, eyes: 0x4a3229, shirt: 0x9b7bff, pants: 0x2e3b4e, belt: 0x4a3426, shoes: 0x4a3426 },
    { id: 'npc2', skin: 0xf6d2b5, hair: 0xc9a25a, eyes: 0x4a3229, shirt: 0xff6f6f, pants: 0x5b4a3a, belt: 0x2a2a30, shoes: 0x2a2a30 },
    { id: 'npc3', skin: 0x8d5a3b, hair: 0x14141a, eyes: 0x4a3229, shirt: 0xf0f0f0, pants: 0x3d6b4a, belt: 0x2a2a30, shoes: 0x2a2a30 },
  ],
};
