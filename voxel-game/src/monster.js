// 黄色い球体のモンスター（液体金属）
//
// - 直径 3m（半径 10 ボクセル）の球。下の地面や木から少し浮かんで、ふわふわ移動する
// - 中まで詰まった液体金属。表面は空を映す明るい黄色で、ゆっくり波打ち、光の帯が流れる。
//   中は惑星のように、中心へいくほど橙 → 赤 → 深い赤になる（えぐれると見える）
// - プレイヤーに気づくと、マゼンタの縞模様が現れて下から上へ流れていく。少し離れた所からついてくる
// - ショットガンで撃たれると大きくえぐれるが、波打ちながら（えぐれた所が盛り上がり、波の輪が表面を広がって）元の球に戻る
// - NPC を見つけると真上へ行き、上から覆いかぶさって包み込み、波打ちながら吸収する。そのたびに少し大きくなる
// - ときどきクルクル回る正八面体に変わり、行く手（プレイヤーに気づいていればプレイヤー）へ頂点を向けて紫の光線を放つ。
//   光線の上にある物はすべて消える（地面・岩・木・NPC・龍の体にも穴があく）。プレイヤーは体力が大きく減る。
//   光線を放つたびに少し縮む
// - 正八面体のときだけ、撃たれた所が欠けたまま戻らない。削られて小さくなりすぎると砕け散る
//
// 1つのボクセルには1つの物だけ: 体は空いているセルにだけ入る。人・NPC がいれば押しのける（包み込む NPC は押しのけない）

import { redrawBody, clearBody, MOVABLE } from './body.js';
import { CHUNK, HEIGHT, LAYER, chunkKeyAt } from './grid.js';
import { EMPTY, GROUND_ID, WATER_ID, ROCK_ID, FALL_ID, PLANT_ID, SOIL_ID } from './ids.js';
import { removeCell } from './shovel.js';
import { eraseTreeCell } from './trees.js';
import { eraseGiantCell } from './giant.js';
import { mulberry32, hash3, shade } from './rng.js';
import { hurtPlayer } from './world.js';

export const MONSTER_RADIUS = 10; // ボクセル（直径 3m）
const vol = (r) => (4 / 3) * Math.PI * r ** 3;
const radiusOf = (mass) => Math.cbrt(mass / ((4 / 3) * Math.PI));
export const MIN_MASS = vol(4.5); // これより小さくなると砕け散る
const MAX_RADIUS = 16;
const OCTA = Math.cbrt(Math.PI); // 同じ体積の正八面体の、中心から頂点まで（半径の何倍か）≈ 1.46
const SEE = 100; // この距離（ボクセル ≈ 15m）までプレイヤーが近づくと気づく
const LOSE = 150; // これより離れると見失う
const HUNT = 90; // この距離までの NPC を見つける
const HUNT_TIME = 12; // これだけ追っても包み込めなければ、あきらめる（秒）
const KEEP = 38; // プレイヤーとの間合い
const HOVER = 3; // 下の物と体のすき間
const ROAM_SPEED = 8, CHASE_SPEED = 15, HUNT_SPEED = 18; // ボクセル/秒
const HOLD = 0.25; // 撃たれたえぐれが、戻り始めるまで（秒）
const WRAP_TIME = 1.3, ABSORB_TIME = 1.8; // 包み込む・吸収する時間（秒）
const ABSORB_GROW = 0.2; // NPC 1 人を吸収して増える体積（はじめの体積に対する割合）
export const BEAM_LENGTH = 200; // 光線の長さ（30m）
const BEAM_RADIUS = 1.8; // 光線が消す太さ（半径）
export const BEAM_DAMAGE = 45; // 光線に当たったプレイヤーの体力の減り
const BEAM_SHRINK = 0.06; // 光線を放つたびに縮む体積の割合
// 正八面体の段取り（変わり始めてからの秒）
export const OCT = { morph: 1.0, spin: 2.4, aim: 3.3, fire: 5.0, unspin: 5.6, end: 6.6 };

export const MONSTER_STATES = {
  roam: 'ただよっている', chase: 'プレイヤーを見ている', hunt: 'NPC を狙っている', wrap: 'NPC を包み込んでいる',
  absorb: 'NPC を吸収している', octa: '正八面体（攻撃できる）', beam: '光線を放っている',
};

// 色: 中心からの距離（半径に対する割合）→ 中の色。中心ほど赤い
const CORE = [[0, 0xa8061a], [0.3, 0xe01c1c], [0.55, 0xff5212], [0.72, 0xff8f14], [0.85, 0xffbd1d], [1, 0xffd52a]];
const MAGENTA = 0xff26d4;
const GOLD_DARK = 0x7a4c05, GOLD_MID = 0xc98f10, GOLD = 0xffcf1c, GLINT = 0xfff3b4;
const PURPLE = [0xffe2ff, 0xe58cff, 0xb847ff, 0x8a2be2];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
function mix(a, b, t) {
  t = clamp(t, 0, 1);
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
function coreColor(u) {
  for (let k = 1; k < CORE.length; k++) {
    if (u <= CORE[k][0]) return mix(CORE[k - 1][1], CORE[k][1], (u - CORE[k - 1][0]) / (CORE[k][0] - CORE[k - 1][0]));
  }
  return CORE[CORE.length - 1][1];
}

// 包み込まれる NPC の形（足元の中心 ax, az、足元 y0、頭の上 y1）
const NPC_R = 4.6;

export class Monster {
  constructor(world, start, rng = mulberry32(11)) {
    this.world = world;
    this.rng = rng;
    this.id = world.nextId++;
    this.entity = {
      id: this.id, kind: 'monster', name: '黄色い球体', priority: 7, pos: start.map(Math.round),
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    };
    world.entities.set(this.id, this.entity);
    // 光線は別の持ち主（いつでも場所をゆずる）
    this.beamId = world.nextId++;
    world.entities.set(this.beamId, {
      id: this.beamId, kind: 'beam', name: '紫の光線', priority: 0, yields: true, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    });
    this.c = [...start]; // 中心（小数）
    this.home = [...start];
    this.mass = vol(MONSTER_RADIUS);
    this.R = MONSTER_RADIUS; // 見た目の半径（体積の変化に少し遅れてついていく）
    this.time = 0;
    this.state = 'roam';
    this.stateTime = 0;
    this.heading = 0;
    this.wander = null;
    this.wanderLeft = 0;
    this.spotted = false;
    this.alert = 0; // 縞模様の濃さ 0..1
    this.agitate = 0; // 波打つ強さ（吸収・撃たれたとき）
    this.dents = []; // 球のときのえぐれ: { n: 体の座標の向き, D: 深さ, w: 広さ（ラジアン）, t: 経過 }
    this.bites = []; // 正八面体のときの欠け: { c: 体の座標の位置, r: 半径 }
    this.biteLoss = 0; // 今回の正八面体で欠けた体積
    this.m = 0; // 球 0 → 正八面体 1
    this.spin = 0; // 縦の軸まわりの回転
    this.spinRate = 0.4;
    this.tilt = 0; // 頂点を上下に向ける傾き
    this.glow = 0; // 光線を放つ頂点の光 0..1
    this.axis = 1; // 光線を放つ頂点（体の座標の +x なら 1、-x なら -1）
    this.octaIn = 10 + rng() * 6; // 次に正八面体になるまで（秒）
    this.prey = null; // 狙っている NPC
    this.skip = new Map(); // 包み込めなかった NPC → また狙えるようになる時刻
    this.drape = null; // 包み込んでいる NPC の形
    this.beam = null; // 光線: { o, dir, cells: [x, y, z, 中心線からの距離, ...] }
    this.beamCells = [];
    this.cells = [];
    this.events = [];
    this.dead = false;
    this.absorbed = 0;
    this.lastDragonHit = -1;
  }

  get vulnerable() {
    return this.state === 'octa' && this.m > 0.5;
  }

  get label() {
    if (this.state === 'octa') return this.beam ? MONSTER_STATES.beam : MONSTER_STATES.octa;
    return MONSTER_STATES[this.state];
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  // ---- 体の座標 ------------------------------------------------------------
  // 体の座標 → 世界: 縦の軸のまわりに spin、そのあと頂点 (+x) を tilt だけ上へ傾ける
  frame() {
    this.cs = Math.cos(this.spin);
    this.sn = Math.sin(this.spin);
    this.ct = Math.cos(this.tilt);
    this.st = Math.sin(this.tilt);
  }

  toBody(px, py, pz, out) {
    const x1 = px * this.cs - pz * this.sn, z1 = px * this.sn + pz * this.cs;
    out[0] = x1 * this.ct + py * this.st;
    out[1] = -x1 * this.st + py * this.ct;
    out[2] = z1;
    return out;
  }

  toWorld(v) {
    const x1 = v[0] * this.ct - v[1] * this.st, y1 = v[0] * this.st + v[1] * this.ct;
    return [x1 * this.cs + v[2] * this.sn, y1, -x1 * this.sn + v[2] * this.cs];
  }

  // 光線を放つ頂点（体の座標の +x か -x）の世界での位置
  vertex() {
    const A = this.R * OCTA * this.m;
    const d = this.toWorld([this.axis, 0, 0]);
    return [this.c[0] + d[0] * A, this.c[1] + d[1] * A, this.c[2] + d[2] * A];
  }

  // ---- 形 --------------------------------------------------------------------

  // 球の表面の上下（体の座標の向き n）: いつものゆらぎ + えぐれと、そこから広がる波
  surface(nx, ny, nz) {
    const t = this.time;
    const amp = 0.4 + 1.2 * this.agitate;
    let d = amp * (Math.sin(nx * 3.1 + t * 2.1) * Math.sin(nz * 2.7 - t * 1.6) * 0.8 + Math.sin(ny * 4.3 + t * 2.6) * 0.55);
    for (const w of this.dents) {
      const cos = clamp(nx * w.n[0] + ny * w.n[1] + nz * w.n[2], -1, 1);
      const th = Math.acos(cos);
      // くぼみ: 波打ちながら（いったん盛り上がって）浅くなる
      const u = th / w.w;
      if (u < 1) d -= w.D * w.env * (1 - u * u) ** 2;
      // 戻り始めると、えぐれの縁から波の輪が表面を広がっていく
      const u2 = w.t - HOLD;
      if (u2 > 0) {
        const x = th * this.R - (w.w * this.R + 12 * u2);
        if (x > -8 && x < 8) d += w.D * 0.28 * Math.min(1, u2 / 0.2) * Math.exp(-1.1 * u2) * Math.cos(x * 0.75) * Math.exp(-((x / 3.5) ** 2));
      }
    }
    return d;
  }

  // 位置 p（中心からの世界の座標）の符号付き距離（負なら体の中）
  field(px, py, pz, q) {
    this.toBody(px, py, pz, q);
    const r = Math.hypot(q[0], q[1], q[2]) || 1e-6;
    const m = this.m;
    let d = 0;
    if (m < 1) {
      if (r < this.inner) d = r - this.Rs; // 深い所（えぐれも届かない）
      else d = r - (this.Rs + this.surface(q[0] / r, q[1] / r, q[2] / r));
    }
    if (m > 0) {
      const dO = (Math.abs(q[0]) + Math.abs(q[1]) + Math.abs(q[2]) - this.A) * 0.57735;
      d = m >= 1 ? dO : d + (dO - d) * m;
    }
    for (const b of this.bites) {
      const e = b.r * this.biteW - Math.hypot(q[0] - b.c[0], q[1] - b.c[1], q[2] - b.c[2]);
      if (e > d) d = e;
    }
    return d;
  }

  // 包み込んでいる NPC のまわりの膜（世界の座標）
  drapeField(x, y, z) {
    const D = this.drape;
    const h = Math.hypot(x - D.ax, z - D.az);
    const wave = 0.6 * Math.sin(y * 0.8 - this.time * 7) * this.agitate;
    let R1, bottom;
    if (this.state === 'wrap') {
      R1 = NPC_R + 1.9 + wave;
      bottom = D.cap - smooth(D.k) * (D.cap - D.y0); // 上から下へ垂れていく
    } else {
      const a = smooth(D.k);
      R1 = (NPC_R + 1.9) * (1 - 0.75 * a) + wave;
      bottom = D.y0 + a * (D.cap - D.y0); // 下から上へ縮んで、球に戻っていく
    }
    return Math.max(h - R1, y - D.cap - 0.5, bottom - y);
  }

  // 形の各セルを emit(x, y, z, color) で返す。fill: 中のセルにも色をつける（砕けるとき）
  shape(emit, fill = false) {
    this.frame();
    const c = this.c;
    // 包み込むときは、球の一部が膜になって NPC のまわりへ垂れる（そのぶん球は小さくなる）
    this.Rs = this.R * (1 - (this.state === 'wrap' ? 0.14 * smooth(this.drape.k) : this.state === 'absorb' ? 0.14 * (1 - smooth(this.drape.k)) : 0));
    this.A = this.R * OCTA;
    this.biteW = this.state === 'octa' ? Math.min(1, this.m * 1.5) : 0;
    let deep = 0.4 + 1.2 * this.agitate;
    for (const w of this.dents) deep += w.D * Math.abs(w.env) + w.D * 0.32;
    this.inner = this.Rs - deep - 1;
    const B = Math.max(this.Rs + deep, this.m > 0 ? this.A * (this.m > 0.99 ? 1 : 1.05) : 0) + 1.5;
    let x0 = Math.floor(c[0] - B), x1 = Math.floor(c[0] + B);
    let y0 = Math.floor(c[1] - B), y1 = Math.floor(c[1] + B);
    let z0 = Math.floor(c[2] - B), z1 = Math.floor(c[2] + B);
    const D = this.drape;
    if (D) {
      x0 = Math.min(x0, Math.floor(D.ax - 9));
      x1 = Math.max(x1, Math.floor(D.ax + 9));
      z0 = Math.min(z0, Math.floor(D.az - 9));
      z1 = Math.max(z1, Math.floor(D.az + 9));
      y0 = Math.min(y0, D.y0 - 1);
      y1 = Math.max(y1, Math.ceil(D.cap) + 2);
    }
    y0 = Math.max(1, y0);
    y1 = Math.min(HEIGHT - 1, y1);
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
    const inside = new Uint8Array(nx * ny * nz); // 1 = 球の部分、2 = 膜の部分
    const q = [0, 0, 0];
    const B2 = B * B;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - c[1];
      for (let z = z0; z <= z1; z++) {
        const pz = z + 0.5 - c[2];
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - c[0];
          const i = (x - x0) + nx * ((z - z0) + nz * (y - y0));
          if (px * px + py * py + pz * pz <= B2 && this.field(px, py, pz, q) <= 0) inside[i] = 1;
          else if (D && this.drapeField(x + 0.5, y + 0.5, z + 0.5) <= 0) inside[i] = 2;
        }
      }
    }
    const filled = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz && inside[x + nx * (z + nz * y)] !== 0;
    const vx = this.m > 0 ? this.vertex() : null;
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const kind = inside[x + nx * (z + nz * y)];
          if (!kind) continue;
          const seen = !filled(x + 1, y, z) || !filled(x - 1, y, z) || !filled(x, y + 1, z) || !filled(x, y - 1, z)
            || !filled(x, y, z + 1) || !filled(x, y, z - 1);
          const wx = x + x0, wy = y + y0, wz = z + z0;
          emit(wx, wy, wz, seen || fill ? this.colorAt(wx, wy, wz, kind === 2, vx, q) : 0);
        }
      }
    }
  }

  // セルの色: 表面は空を映す液体金属の黄色（縞模様・頂点の光）、えぐれた奥は中心ほど赤い
  colorAt(x, y, z, membrane, vx, q) {
    const c = this.c;
    const px = x + 0.5 - c[0], py = y + 0.5 - c[1], pz = z + 0.5 - c[2];
    const r = Math.hypot(px, py, pz) || 1e-6;
    const u = membrane ? 1 : r / this.Rs;
    const h = hash3(x, y, z);
    const grain = 0.96 + ((h >>> 8) & 15) / 200;
    let color;
    const core = coreColor(Math.min(1, u));
    if (u < 0.8) {
      color = core;
    } else {
      // 表面の向き: 球なら中心から外へ、正八面体なら面の向き
      let n = [px / r, py / r, pz / r];
      if (membrane) {
        // 膜は NPC を囲む筒: 横向き（てっぺんは上向き）
        const hx = x + 0.5 - this.drape.ax, hz = z + 0.5 - this.drape.az;
        const hl = Math.hypot(hx, hz) || 1;
        n = y + 0.5 > this.drape.cap - 1 ? [0, 1, 0] : [hx / hl, 0.1, hz / hl];
      } else if (this.m > 0) {
        this.toBody(px, py, pz, q);
        const f = this.toWorld([Math.sign(q[0]) * 0.57735, Math.sign(q[1]) * 0.57735, Math.sign(q[2]) * 0.57735]);
        n = [n[0] + (f[0] - n[0]) * this.m, n[1] + (f[1] - n[1]) * this.m, n[2] + (f[2] - n[2]) * this.m];
        const l = Math.hypot(...n) || 1;
        n = n.map((v) => v / l);
      }
      // 鏡のようにまわりを映す: 上は空で明るい金色（てっぺんは白っぽく光る）、
      // 横には地平線の暗い帯、下は地面を映す落ち着いた金色。地平線は表面の波でゆらぐ
      const t = this.time;
      const hz = n[1] + 0.14 * Math.sin(n[0] * 4 + t * 1.7) * Math.cos(n[2] * 3 - t * 1.3);
      let metal;
      if (hz > 0.04) metal = mix(GOLD, GLINT, smooth((hz - 0.5) / 0.45) * 0.6);
      else if (hz > -0.14) metal = mix(GOLD_DARK, GOLD, smooth((hz + 0.02) / 0.06));
      else metal = mix(GOLD_DARK, GOLD_MID, smooth((-hz - 0.14) / 0.5));
      const band = Math.sin(n[1] * 6 + n[0] * 2.3 - n[2] * 1.7 + this.time * 0.9 + (this.m > 0 ? this.spin : 0));
      if (band > 0.72) metal = mix(metal, GLINT, ((band - 0.72) / 0.28) * 0.75);
      // プレイヤーに気づいているとき: マゼンタの縞が下から上へ流れる
      if (this.alert > 0) {
        const ph = (y + 0.5 - c[1]) / 5.5 - this.time * 1.25;
        const f = ph - Math.floor(ph);
        const edge = Math.min(smooth((f - 0.02) / 0.08), smooth((0.42 - f) / 0.08));
        if (edge > 0) metal = mix(metal, MAGENTA, edge * this.alert * 0.92);
      }
      color = u < 0.9 ? mix(core, metal, (u - 0.8) / 0.1) : metal;
    }
    // 光線を放つ頂点が紫に光る
    if (vx && this.glow > 0) {
      const d = Math.hypot(x + 0.5 - vx[0], y + 0.5 - vx[1], z + 0.5 - vx[2]);
      if (d < 6) color = mix(color, PURPLE[d < 2.5 ? 0 : d < 4 ? 1 : 2], this.glow * (1 - d / 6) * 1.6);
    }
    return shade(color, grain) || 0x010101;
  }

  // ---- まわりの高さ --------------------------------------------------------

  // (x, z) の列で、自分・光線・人・NPC を除いた一番上の物の高さ（作られていない所は地形から求める）
  columnTop(x, z) {
    const w = this.world;
    const c = w.chunks.get(chunkKeyAt(x, z));
    if (!c) {
      const s = w.sample(x, z, {});
      return Math.max(s.h, s.water);
    }
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
    const top = Math.min(c.top, c.base + c.owner.length / LAYER);
    for (let y = top - 1; y >= c.base; y--) {
      const o = c.owner[c.index(lx, y, lz)];
      if (!o || o === this.id || o === this.beamId) continue;
      const e = w.entities.get(o);
      if (e && (e.yields || MOVABLE.has(e.kind))) continue;
      return y + 1;
    }
    return c.height[lx + CHUNK * lz];
  }

  // 体の下（半径 r の円）で一番高い所
  floorUnder(x, z, r) {
    let top = 0;
    for (let dz = -r; dz <= r; dz += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        if (dx * dx + dz * dz > r * r + 8) continue;
        top = Math.max(top, this.columnTop(Math.round(x + dx), Math.round(z + dz)));
      }
    }
    return top;
  }

  // ゴール (gx, gz) へ向かって浮かんだまま進む。gy: 中心の高さ（null なら下の物から HOVER だけ浮く）
  moveToward(gx, gz, gy, speed, dt) {
    const c = this.c;
    let dx = gx - c[0], dz = gz - c[2];
    const d = Math.hypot(dx, dz);
    let v = Math.min(speed, d * 1.5);
    if (d > 0.01) {
      dx /= d;
      dz /= d;
      this.heading = Math.atan2(dx, dz);
    } else {
      dx = dz = 0;
    }
    const bob = Math.sin(this.time * 1.3) * 1.2;
    const r = Math.ceil(this.R * 0.8);
    const floor = Math.max(this.floorUnder(c[0], c[2], r), this.floorUnder(c[0] + dx * this.R, c[2] + dz * this.R, r));
    let ty = floor + HOVER + this.R + bob;
    if (gy !== null) ty = Math.max(gy, floor + this.R * 0.35);
    if (ty - c[1] > 5) v *= 0.25; // 高い所を越えるときは、先に浮き上がる
    c[0] += dx * v * dt;
    c[2] += dz * v * dt;
    c[1] = approach(c[1], Math.min(HEIGHT - this.R - 4, ty), 22 * dt);
  }

  // ---- 1回分の動き -----------------------------------------------------------

  update(dt, player) {
    this.events = [];
    if (this.dead) return;
    this.time += dt;
    this.stateTime += dt;
    // えぐれは一瞬そのまま残り、そこから波打ちながら（いったん盛り上がって）戻る
    for (const w of this.dents) {
      w.t += dt;
      const u = Math.max(0, w.t - HOLD);
      w.env = Math.exp(-1.4 * u) * Math.cos(3.4 * u);
    }
    this.dents = this.dents.filter((w) => w.t < 3.6);
    this.agitate = Math.max(0, this.agitate - dt * 0.7);
    const P = player ? [player.pos[0] + 4.5, player.pos[1] + 9, player.pos[2] + 4.5] : null;
    const dp = P ? Math.hypot(P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]) : Infinity;
    if (!this.spotted && dp < SEE) {
      this.spotted = true;
      this.events.push({ type: 'spot', actor: this.entity, target: player });
    } else if (this.spotted && dp > LOSE) {
      this.spotted = false;
    }
    this.alert = approach(this.alert, this.spotted ? 1 : 0, dt * 1.6);

    if (this.state === 'octa') this.octaStep(dt, P);
    else if (this.state === 'wrap' || this.state === 'absorb') this.engulfStep(dt);
    else this.floatStep(dt, P);
    if (this.dead) return;

    // 見た目の大きさは、体積の変化に少し遅れてついていく（正八面体の間は変えない。欠けた所が見えるので）
    if (this.state !== 'octa' || this.stateTime > OCT.unspin) this.R = approach(this.R, Math.min(MAX_RADIUS, radiusOf(this.mass)), dt * 2.5);
    if (this.state !== 'octa') this.spin += this.spinRate * dt;
    this.draw();
    this.entity.pos = this.c.map(Math.round);
  }

  // ただよう・プレイヤーを見る・NPC を狙う
  floatStep(dt, P) {
    const rng = this.rng;
    this.octaIn -= dt;
    this.spinRate = approach(this.spinRate, 0.4, dt * 2);
    // NPC を探す（ときどき）
    if (this.state !== 'hunt' && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) {
      const prey = this.findPrey();
      if (prey) {
        this.prey = prey;
        this.setState('hunt');
      }
    }
    if (this.state === 'hunt') {
      const e = this.prey;
      if (!e || !this.world.entities.has(e.id) || e.held || this.stateTime > HUNT_TIME) {
        // 木の下などで真上まで降りられないときは、あきらめてしばらく狙わない
        if (e && this.stateTime > HUNT_TIME) this.skip.set(e.id, this.time + 30);
        this.prey = null;
        this.setState('roam');
        return;
      }
      const ax = e.pos[0] + 4.5, az = e.pos[2] + 4.5, top = e.pos[1] + 15;
      const gy = top + this.R + 1.5;
      this.moveToward(ax, az, gy, HUNT_SPEED, dt);
      // 真上に来たら、覆いかぶさる
      if (Math.hypot(ax - this.c[0], az - this.c[2]) < 1.5 && Math.abs(this.c[1] - gy) < 3) {
        e.held = true;
        this.drape = { npc: e, ax, az, y0: e.pos[1], cap: top + 0.5, k: 0 };
        this.setState('wrap');
      }
      return;
    }
    if (this.octaIn <= 0) {
      this.startOcta();
      return;
    }
    if (this.spotted && P) {
      if (this.state !== 'chase') this.setState('chase');
      // 少し離れた所から、ゆっくり回り込みながら見ている
      const a = Math.atan2(this.c[0] - P[0], this.c[2] - P[2]) + 0.25 * dt * 4;
      this.moveToward(P[0] + Math.sin(a) * KEEP, P[2] + Math.cos(a) * KEEP, null, CHASE_SPEED, dt);
      return;
    }
    if (this.state !== 'roam') this.setState('roam');
    this.wanderLeft -= dt;
    if (!this.wander || this.wanderLeft <= 0 || Math.hypot(this.wander[0] - this.c[0], this.wander[1] - this.c[2]) < 3) {
      const a = rng() * Math.PI * 2, r = rng() * 70;
      this.wander = [this.home[0] + Math.cos(a) * r, this.home[2] + Math.sin(a) * r];
      this.wanderLeft = 6 + rng() * 6;
    }
    this.moveToward(this.wander[0], this.wander[1], null, ROAM_SPEED, dt);
  }

  findPrey() {
    let best = null;
    let bd = HUNT;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'npc' || e.held || (this.skip.get(e.id) ?? -1) > this.time) continue;
      const d = Math.hypot(e.pos[0] + 4.5 - this.c[0], e.pos[1] + 8 - this.c[1], e.pos[2] + 4.5 - this.c[2]);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // 包み込む → 吸収する
  engulfStep(dt) {
    const D = this.drape;
    const c = this.c;
    this.agitate = Math.max(this.agitate, this.state === 'wrap' ? 0.5 : 1);
    if (this.state === 'wrap') {
      D.k = Math.min(1, D.k + dt / WRAP_TIME);
      // 球は NPC の頭の上に沈み込みながら、膜を下へ垂らしていく
      const ty = D.cap + this.R * (0.75 - 0.15 * smooth(D.k));
      c[0] = approach(c[0], D.ax, 20 * dt);
      c[2] = approach(c[2], D.az, 20 * dt);
      c[1] = approach(c[1], ty, 20 * dt);
      if (D.k >= 1) {
        // 中の NPC を吸収する（体の一部になる）
        const e = D.npc;
        if (this.world.entities.has(e.id)) {
          this.world.paint(e, false);
          this.world.entities.delete(e.id);
          this.events.push({ type: 'absorb', actor: this.entity, target: e });
        }
        this.mass += vol(MONSTER_RADIUS) * ABSORB_GROW;
        this.absorbed++;
        this.prey = null;
        D.k = 0;
        this.setState('absorb');
      }
    } else {
      D.k = Math.min(1, D.k + dt / ABSORB_TIME);
      c[1] = approach(c[1], D.cap + this.R + HOVER, 8 * dt);
      if (D.k >= 1) {
        this.drape = null;
        this.setState('roam');
      }
    }
  }

  startOcta() {
    this.setState('octa');
    this.events.push({ type: 'octa', actor: this.entity });
    this.bites = [];
    this.biteLoss = 0;
    this.beamHitPlayer = false;
  }

  // 正八面体: 変わる → 回る → 頂点を向ける → 光線 → 回る → 球に戻る
  octaStep(dt, P) {
    const T = this.stateTime;
    this.moveToward(this.c[0], this.c[2], null, 0, dt); // その場に浮かぶ
    if (T < OCT.morph) {
      this.m = smooth(T / OCT.morph);
      this.spinRate = approach(this.spinRate, 7, dt * 8);
      this.spin += this.spinRate * dt;
    } else if (T < OCT.spin) {
      this.m = 1;
      this.spin += this.spinRate * dt;
    } else if (T < OCT.aim) {
      if (!this.aim) this.planAim(P);
      const u = (T - OCT.spin) / (OCT.aim - OCT.spin);
      const e = 1 - (1 - u) ** 3;
      this.spin = this.aim.from + (this.aim.to - this.aim.from) * e;
      this.tilt = this.aim.tilt * smooth(u);
      this.glow = u;
    } else if (T < OCT.fire) {
      if (!this.beam) this.fireBeam();
      this.spin = this.aim.to;
      this.tilt = this.aim.tilt;
      this.glow = 0.85 + 0.15 * Math.sin(T * 40);
      this.burn();
    } else if (T < OCT.unspin) {
      if (this.beam) this.stopBeam();
      this.glow = approach(this.glow, 0, dt * 3);
      this.tilt = approach(this.tilt, 0, dt * 2);
      this.spinRate = 6;
      this.spin += this.spinRate * dt;
    } else if (T < OCT.end) {
      this.m = 1 - smooth((T - OCT.unspin) / (OCT.end - OCT.unspin));
      this.glow = 0;
      this.tilt = approach(this.tilt, 0, dt * 2);
      this.spinRate = approach(this.spinRate, 0.4, dt * 6);
      this.spin += this.spinRate * dt;
    } else {
      this.m = 0;
      this.tilt = 0;
      this.bites = [];
      this.biteLoss = 0;
      this.aim = null;
      this.octaIn = 14 + this.rng() * 9;
      this.agitate = 0.8; // 球に戻るときに波打つ
      this.setState(this.spotted ? 'chase' : 'roam');
    }
  }

  // 光線の向きを決め、頂点のどれかがそちらを向くように回転を緩める
  planAim(P) {
    let dir;
    if (this.spotted && P) {
      const v = [P[0] - this.c[0], P[1] - this.c[1], P[2] - this.c[2]];
      const h = Math.hypot(v[0], v[2]) || 1;
      const pitch = clamp(Math.atan2(v[1], h), -0.6, 0.6);
      dir = [(v[0] / h) * Math.cos(pitch), Math.sin(pitch), (v[2] / h) * Math.cos(pitch)];
    } else {
      dir = [Math.sin(this.heading), -0.12, Math.cos(this.heading)];
      const l = Math.hypot(...dir);
      dir = dir.map((v) => v / l);
    }
    // 体の +x 軸が dir を向く回転: spin = atan2(-dz, dx)、tilt = asin(dy)。
    // -x 軸の頂点（半回転先）でもよい（そのときは傾きが逆になる）。近い方を選ぶ
    const target = Math.atan2(-dir[2], dir[0]);
    const Q = Math.PI;
    let rem = (target - this.spin) % Q;
    if (rem < 0) rem += Q;
    // 回る速さがなめらかにつながるように、何回り分か足す
    const extra = Math.max(0, Math.round((this.spinRate * (OCT.aim - OCT.spin)) / 3 / Q - rem / Q));
    const to = this.spin + rem + extra * Q;
    this.axis = Math.cos(to) * dir[0] - Math.sin(to) * dir[2] >= 0 ? 1 : -1;
    this.aim = { from: this.spin, to, tilt: this.axis * Math.asin(clamp(dir[1], -1, 1)), dir };
  }

  // ---- 光線 ------------------------------------------------------------------

  fireBeam() {
    this.frame();
    const o = this.vertex();
    const dir = this.aim.dir;
    // 光線が通るセル（中心線からの距離つき）
    const seen = new Map();
    for (let s = 0.5; s <= BEAM_LENGTH; s += 0.6) {
      const px = o[0] + dir[0] * s, py = o[1] + dir[1] * s, pz = o[2] + dir[2] * s;
      if (py < 0 || py >= HEIGHT) break;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = Math.floor(px) + dx, y = Math.floor(py) + dy, z = Math.floor(pz) + dz;
            const vx = x + 0.5 - o[0], vy = y + 0.5 - o[1], vz = z + 0.5 - o[2];
            const t = vx * dir[0] + vy * dir[1] + vz * dir[2];
            if (t < 0) continue;
            const perp = Math.hypot(vx - dir[0] * t, vy - dir[1] * t, vz - dir[2] * t);
            if (perp > BEAM_RADIUS) continue;
            const key = `${x},${y},${z}`;
            if (!seen.has(key)) seen.set(key, [x, y, z, perp, t]);
          }
        }
      }
    }
    const cells = [...seen.values()];
    this.beam = { o, dir, cells };
    this.beamHitPlayer = false;
    // 光線を放つと少し縮む
    const loss = this.mass * BEAM_SHRINK;
    this.mass -= loss;
    this.biteLoss += loss;
    this.events.push({ type: 'beam', actor: this.entity, dir });
  }

  // 光線の上の物を消す（1回分）。プレイヤーは体力が減る
  burn() {
    const w = this.world;
    const memo = new Map();
    const partial = new Map(); // 一部が消える物 → 消えるセルの key
    const gone = new Set();
    for (const [x, y, z] of this.beam.cells) {
      const c = w.chunks.get(chunkKeyAt(x, z));
      if (!c || y < c.base || y >= c.base + c.owner.length / LAYER) continue;
      const o = c.owner[c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
      if (o === EMPTY || o === this.id || o === this.beamId || o === WATER_ID || o === FALL_ID || gone.has(o)) continue;
      if (o === GROUND_ID || o === SOIL_ID) {
        if (y - 1 >= c.base) removeCell(w, x, y, z, memo);
      } else if (o === ROCK_ID) {
        w.setCell(x, y, z, EMPTY, 0);
        exposeRock(w, x, y, z);
      } else if (o === PLANT_ID) {
        w.setCell(x, y, z, EMPTY, 0);
      } else {
        const e = w.entities.get(o);
        if (!e || e.yields) continue;
        if (e.tree) {
          eraseTreeCell(e.tree, x, y, z);
          w.setCell(x, y, z, EMPTY, 0);
        } else if (e.giant) {
          eraseGiantCell(w, e.giant, x, y, z);
        } else if (e.kind === 'player') {
          if (!this.beamHitPlayer) {
            this.beamHitPlayer = true;
            const hp = Math.max(0, e.hp - BEAM_DAMAGE);
            this.events.push({ type: 'beamHit', actor: this.entity, target: e, hp });
            const r = hurtPlayer(w, BEAM_DAMAGE);
            if (r) this.events.push(r);
          }
        } else if (e.kind === 'npc') {
          // NPC は消える
          w.paint(e, false);
          w.entities.delete(e.id);
          gone.add(o);
          this.events.push({ type: 'vanish', actor: this.entity, target: e });
        } else if (e.kind === 'dragon') {
          if (this.time - this.lastDragonHit > 0.4 && w.dragon) {
            this.lastDragonHit = this.time;
            const res = w.dragon.wound([x + 0.5, y + 0.5, z + 0.5], 0, 0.5);
            if (res) this.events.push({ type: 'beamDragon', actor: this.entity, target: e, severed: Boolean(res.severed) });
          }
        } else if (e.offsets?.length) {
          let keys = partial.get(e);
          if (!keys) partial.set(e, (keys = new Set()));
          keys.add(`${x - e.pos[0]},${y - e.pos[1]},${z - e.pos[2]}`);
        }
      }
    }
    for (const [e, keys] of partial) eraseCells(w, e, keys);
    // 光線を描く（空いたセルにだけ。いつでも場所をゆずる）
    const flick = Math.floor(this.time * 25);
    const { cells } = redrawBody(w, this.beamId, this.beamCells, (emit) => {
      for (const [x, y, z, perp, t] of this.beam.cells) {
        if (perp > 1.45) continue;
        const k = (hash3(x, y, z) + flick * 7) % 9;
        const color = perp < 0.6 ? PURPLE[0] : perp < 1.05 ? (k < 3 ? PURPLE[0] : PURPLE[1]) : (k < 4 ? PURPLE[2] : PURPLE[3]);
        // 先の方ほど少しまばらに（光が散っていく）
        if (perp > 1.05 && t > BEAM_LENGTH * 0.7 && k > 5) continue;
        emit(x, y, z, color);
      }
    }, () => null);
    this.beamCells = cells;
  }

  stopBeam() {
    clearBody(this.world, this.beamId, this.beamCells);
    this.beamCells = [];
    this.beam = null;
  }

  // ---- 撃たれる ----------------------------------------------------------------

  // 散弾の粒が点 p に当たった。power: 近いほど大きい（0..1）。
  // 戻り値: 'dent'（えぐれたが戻る）/ 'chip'（欠けた）/ 'killed'（砕け散った）
  hit(p, power) {
    if (this.dead) return null;
    this.frame();
    const q = this.toBody(p[0] - this.c[0], p[1] - this.c[1], p[2] - this.c[2], [0, 0, 0]);
    const r = Math.hypot(...q) || 1;
    if (this.vulnerable) {
      const br = 1.8 + 2.6 * power;
      this.bites.push({ c: q, r: br });
      if (this.bites.length > 80) this.bites.shift();
      const loss = vol(br) * 0.45;
      this.mass -= loss;
      this.biteLoss += loss;
      if (this.mass < MIN_MASS) {
        this.shatter();
        return 'killed';
      }
      return 'chip';
    }
    const n = q.map((v) => v / r);
    this.agitate = Math.max(this.agitate, 0.3);
    // 近くの新しいえぐれがあれば、それを深く・広くする（1 発の散弾で大きくえぐれる）
    for (const w of this.dents) {
      if (w.t > HOLD) continue;
      if (n[0] * w.n[0] + n[1] * w.n[1] + n[2] * w.n[2] < Math.cos(w.w * 0.9)) continue;
      w.D = Math.min(this.R * 0.85, w.D + 0.9 + 1.4 * power);
      w.w = Math.min(1.1, w.w + 0.04);
      w.t = 0;
      w.env = 1;
      return 'dent';
    }
    this.dents.push({ n, D: 2.6 + 4.8 * power, w: 0.38 + 0.3 * power, t: 0, env: 1 });
    if (this.dents.length > 14) this.dents.shift();
    return 'dent';
  }

  // 砕け散る: 体がいくつかのかけらに割れて落ちる
  shatter() {
    const w = this.world;
    const cells = [];
    this.shape((x, y, z, color) => cells.push([x, y, z, color]), true);
    clearBody(w, this.id, this.cells);
    this.cells = [];
    if (this.beam) this.stopBeam();
    this.dead = true;
    w.entities.delete(this.id);
    w.entities.delete(this.beamId);
    if (this.drape?.npc) this.drape.npc.held = false;
    // かけらの中心をいくつか選び、いちばん近い中心ごとにまとめる
    const free = cells.filter(([x, y, z]) => w.ownerAt(x, y, z) === EMPTY);
    const seeds = [];
    for (let k = 0; k < 7 && free.length; k++) seeds.push(free[Math.floor(this.rng() * free.length)]);
    const groups = seeds.map(() => []);
    for (const cell of free) {
      let best = 0, bd = Infinity;
      seeds.forEach((s, k) => {
        const d = (s[0] - cell[0]) ** 2 + (s[1] - cell[1]) ** 2 + (s[2] - cell[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      groups[best].push(cell);
    }
    this.pieces = [];
    for (const g of groups) {
      if (!g.length) continue;
      const lo = [0, 1, 2].map((a) => Math.min(...g.map((c) => c[a])));
      const piece = w.spawn({
        kind: 'carcass', name: '液体金属のかけら', priority: 8, falling: true, vy: 0, fall: 0, pos: lo,
        voxels: g.map(([x, y, z, color]) => [x - lo[0], y - lo[1], z - lo[2], color]),
      });
      if (piece) this.pieces.push(piece);
    }
    if (w.monster === this) w.monster = null;
  }

  // ---- 描く --------------------------------------------------------------------

  draw() {
    const held = this.drape?.npc;
    const { cells, pushed } = redrawBody(this.world, this.id, this.cells, (emit) => this.shape(emit), (m, e) => {
      if (e === held) return null; // 包み込む NPC は押しのけない
      const dx = m[0] - this.c[0], dz = m[2] - this.c[2];
      return Math.hypot(dx, dz) < 0.5 ? [1, 0] : [dx, dz];
    });
    this.cells = cells;
    for (const e of pushed) this.events.push({ type: 'push', actor: this.entity, target: e });
  }

  // いま占有しているセルの数
  get size() {
    return this.cells.length / 2;
  }
}

// 光線で空いた穴の壁になった岩のセルに色をつける（岩の中は消灯しているので）
function exposeRock(world, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (world.ownerAt(nx, ny, nz) !== ROCK_ID || world.colorAt(nx, ny, nz)) continue;
    const h = hash3(nx, ny, nz);
    world.setCell(nx, ny, nz, ROCK_ID, shade(0x9b9a94, 0.82 + (h % 30) / 100));
  }
}

// 物 e のセルのうち、keys（e.pos からの相対位置 "x,y,z"）のものを消す
function eraseCells(world, e, keys) {
  const offsets = [], colors = [];
  for (let k = 0; k < e.colors.length; k++) {
    const o = k * 3;
    const ox = e.offsets[o], oy = e.offsets[o + 1], oz = e.offsets[o + 2];
    if (keys.has(`${ox},${oy},${oz}`)) {
      world.setCell(e.pos[0] + ox, e.pos[1] + oy, e.pos[2] + oz, EMPTY, 0);
    } else {
      offsets.push(ox, oy, oz);
      colors.push(e.colors[k]);
    }
  }
  e.offsets = Int16Array.from(offsets);
  e.colors = Uint32Array.from(colors);
  delete e._box;
  delete e._mid;
  if (!colors.length) world.entities.delete(e.id);
}

// プレイヤーから少し離れた所に、浮かんだモンスターを置く
export function spawnMonster(world, near, offset = [55, -75]) {
  const x = near[0] + offset[0], z = near[2] + offset[1];
  const m = new Monster(world, [x, 0, z]);
  m.c[1] = m.floorUnder(x, z, 8) + HOVER + m.R + 2;
  m.home = [...m.c];
  world.monster = m;
  return m;
}
