// 人型キャラのボクセル模型
//
// 骨格（腰・膝・足首・肩・肘・首・頭）の角度から体の形を組み立て、
// 太ももやすねなどの部位を「先細りのカプセル」や「楕円体」として
// ボクセルに塗りつぶす（ラスタライズする）。
// 関節は連続的に曲がるが、表示は 15cm のボクセル単位なのでドット感は残る。
//
// キャラは常に 9×15×9 の直方体（当たり判定）を占有する。
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

// 直方体のセルの並び（x が最も速く変わる）。全キャラ共通。
export const HUMAN_OFFSETS = (() => {
  const o = new Int16Array(N * 3);
  let k = 0;
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        o[k++] = x;
        o[k++] = y;
        o[k++] = z;
      }
    }
  }
  return o;
})();

// 姿勢のパラメータ
export function createPose() {
  return {
    yaw: 0, // 体の向き（0 = +z、+x 向きが π/2）
    phase: 0, // 歩行周期の位置 0..1（1周期で左右1歩ずつ）
    walk: 0, // 歩き・走りの振れ幅 0..1（0 = 立ち姿）
    run: 0, // 歩き → 走りの混ざり具合 0..1
    push: 0, // 押す姿勢 0..1
    breath: 0, // 呼吸 0..1
    sway: 0, // 立っているときの重心移動 -1..1
    headYaw: 0, // 首を振る角度
    blink: false,
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

// ---- 骨格 → 部位 ------------------------------------------------------------

// 姿勢から部位の一覧を作る（体の座標: x = 右, y = 上, z = 前。足元の中心が原点）
function buildParts(p, pal) {
  const B = BODY;
  const ph = p.phase * Math.PI * 2;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const w = p.walk;
  const r = p.run;
  const push = p.push;

  // 脚: 太ももの振り角 a と膝の曲がり k。振り出している脚（遊脚）ほど膝が大きく曲がる。
  const A = lerp(0.42, 0.72, r) * w * (1 - 0.35 * push);
  const kSwing = lerp(1.0, 1.9, r) * w;
  const kStance = lerp(0.08, 0.4, r) * w + 0.04 + 0.25 * push;
  const legs = [
    { side: -1, a: A * s, k: kStance + kSwing * Math.max(0, c) ** 2 },
    { side: 1, a: -A * s, k: kStance + kSwing * Math.max(0, -c) ** 2 },
  ];
  for (const leg of legs) {
    leg.height = B.thigh * Math.cos(leg.a) + B.shin * Math.cos(leg.a - leg.k) + B.ankle;
  }
  // 骨盤の高さは、地面に着いている方の脚の長さで決まる → 自然な上下動になる
  const flight = r * w * 0.9 * s * s; // 走りでは脚が開いた瞬間に両足が浮く
  const hipY = Math.max(legs[0].height, legs[1].height) + flight;
  const sway = p.sway * 0.35 * (1 - w);

  const parts = [];
  const capsule = (a, b, ra, rb, color, bias = 0) => parts.push({ type: 'cap', a, b, ra, rb, color, bias });
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
  const lean = 0.05 * w + 0.2 * r * w + 0.35 * push;
  const pelvis = [sway, hipY + 0.35, 0];
  const up = (len) => add(pelvis, tilt([0, len, 0], lean));
  const breathLift = p.breath * 0.3;
  ellipsoid(pelvis, [1.35, 0.75, 1.05], pal.belt ?? pal.pants);
  ellipsoid(up(1.15), [1.2, 0.95, 1.0], pal.shirt);
  ellipsoid(up(2.15), [1.55, 1.2, 1.15 + p.breath * 0.15], pal.shirt, 0.05);
  const neckBase = up(B.spine);

  // 腕: 同じ側の脚と逆向きに振る。肩も少しひねる。
  const armAmp = lerp(0.38, 0.95, r) * w * (1 - push);
  const twist = 0.25 * w * s;
  for (const side of [-1, 1]) {
    const shoulder = add(neckBase, [side * B.shoulderHalf, -0.6 + breathLift, side * twist]);
    const swingA = side * armAmp * s + push * 1.3; // side=-1（左）は右脚と同じ向き
    const elbowBend = lerp(lerp(0.2, 0.5, Math.max(0, side * s) * w), 1.55, r * w) * (1 - push) + push * 0.35;
    const elbow = add(shoulder, swingDown(B.upperArm, swingA, side * 0.06));
    const hand = add(elbow, swingDown(B.forearm, swingA + elbowBend));
    capsule(shoulder, elbow, 0.66, 0.6, pal.shirt, 0.15);
    capsule(elbow, hand, 0.6, 0.55, pal.skin, 0.15);
    ellipsoid(hand, [0.6, 0.62, 0.6], pal.skin, 0.2);
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

export const PALETTES = {
  player: { id: 'player', skin: 0xf1c7a0, hair: 0x3a2618, eyes: 0x4a3229, shirt: 0xf2a541, pants: 0x2f4a7a, belt: 0x3b2b22, shoes: 0x3b2b22 },
  npc: [
    { id: 'npc0', skin: 0xe8b58e, hair: 0x1f1f2b, eyes: 0x4a3229, shirt: 0x3cc4b0, pants: 0x4a4a5c, belt: 0x2a2a30, shoes: 0x2a2a30 },
    { id: 'npc1', skin: 0xc68d63, hair: 0x6b3b1f, eyes: 0x4a3229, shirt: 0x9b7bff, pants: 0x2e3b4e, belt: 0x4a3426, shoes: 0x4a3426 },
    { id: 'npc2', skin: 0xf6d2b5, hair: 0xc9a25a, eyes: 0x4a3229, shirt: 0xff6f6f, pants: 0x5b4a3a, belt: 0x2a2a30, shoes: 0x2a2a30 },
    { id: 'npc3', skin: 0x8d5a3b, hair: 0x14141a, eyes: 0x4a3229, shirt: 0xf0f0f0, pants: 0x3d6b4a, belt: 0x2a2a30, shoes: 0x2a2a30 },
  ],
};
