// ピラミッドの中の骸骨（墓場泥棒）と、赤い骨の王
//
// 骸骨:
// - ダンジョンのあちこちに、墓場泥棒の骸骨がばらばらに崩れて倒れている（錆びた剣がそばに落ちている）
// - プレイヤーが近づくと、骨が組み上がって起き上がり（しゃがんだ姿勢からゆっくり立つ）、錆びた剣で斬りかかってくる
// - 人型キャラと同じ仕組みで歩く（段差・重力・押し合い）。太刀で斬るか、ショットガンで撃つと崩れ落ちる
//
// 赤い骨の王:
// - 玉座の間の奥の玉座に、赤い骨の王が鎮座している（人の 2.4 倍の大きさ。金の王冠、黒い大剣）
// - 近づくと目が赤く光り、2 秒ほどかけて震えながら立ち上がる。そのあとプレイヤーへ歩み寄り、大剣を振り下ろす・薙ぐ
// - 太刀で 5 太刀、ショットガンなら 4〜5 発ほどで倒れ、骨が崩れ落ちる
//
// どちらも、斬られる・撃たれると（e.body の slash / shot）反応する

import { initCharacter, updateCharacter } from './character.js';
import { buildParts, createPose, SKELETON_PALETTE, KING_PALETTE } from './humanoid.js';
import { redrawBody, clearBody } from './body.js';
import { HEIGHT } from './grid.js';
import { hash3 } from './rng.js';

const WAKE_RANGE = 34; // 骸骨が起き上がる距離（ボクセル ≈ 5m）
const STRIKE_REACH = 15;
const SKELETON_DAMAGE = 12;
const KING_SCALE = 2.4;
const KING_WAKE = 70;
const KING_HP = 14;
const KING_DAMAGE = 28;
const KING_SPEED = 9;
const KING_SWING = 1.0; // 大剣ひと振りの時間（秒）

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const BONE = SKELETON_PALETTE.skin;

// 倒れている骸骨の骨（向き yaw で寝かせる）: [[dx, dy, dz, 色], ...]
function pileVoxels(yaw, seed) {
  const out = new Map();
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const put = (a, h, b, color) => {
    const x = Math.round(a * c + b * s), z = Math.round(-a * s + b * c);
    out.set(`${x},${h},${z}`, [x, h, z, color]);
  };
  // どくろ（少し転がっている）
  for (let a = -1; a <= 1; a++) for (let b = 0; b <= 2; b++) for (let h = 0; h <= 1; h++) put(a + 6, h, b, h === 1 && b === 2 && a !== 0 ? 0x140e0a : BONE);
  // 背骨と肋骨
  for (let b = -6; b <= 3; b++) put(0, 0, b, BONE);
  for (let k = 0; k < 4; k++) for (const side of [-1, 1]) for (let a = 1; a <= 2; a++) put(side * a, a === 2 ? 0 : 1, 1 - k * 1.6, BONE);
  // 骨盤と脚・腕の骨（ばらばら）
  for (let a = -2; a <= 2; a++) put(a, 0, -7, BONE);
  const r = (k) => ((hash3(seed, k, 3) % 5) - 2) * 0.5;
  for (const side of [-1, 1]) {
    for (let b = 0; b < 6; b++) put(side * (1.5 + r(side) * b * 0.3), 0, -8 - b, BONE);
    for (let b = 0; b < 5; b++) put(side * (3 + b * 0.4), 0, -1 + r(side + 5) * b * 0.4, BONE);
  }
  // 錆びた剣と、ぼろ布
  for (let b = -6; b <= 4; b++) put(-5, 0, b, b > 2 ? 0x3a2a20 : 0x857766);
  for (let a = -2; a <= 1; a++) put(a, 0, -4, 0x5a4a34);
  return [...out.values()];
}

// ---- 骸骨（墓場泥棒） ----------------------------------------------------------

export class Skeleton {
  // at: 倒れている所（床の上のセル）、yaw: 寝ている向き
  constructor(world, at, yaw, seed = 1) {
    this.world = world;
    this.at = at.map(Math.round);
    // 床の上に置く（坂の洞窟でも浮かないように）
    const [x, , z] = this.at;
    while (this.at[1] > 1 && world.ownerAt(x, this.at[1] - 1, z) === 0) this.at[1]--;
    while (this.at[1] < HEIGHT - 2 && world.ownerAt(x, this.at[1], z) !== 0) this.at[1]++;
    this.yaw = yaw;
    this.seed = seed;
    this.state = 'dormant';
    this.events = [];
    this.lay();
    this.e = null;
    this.timer = 0;
  }

  // 倒れた骨を置く（壁や床にかかる骨は省く）
  lay() {
    const w = this.world;
    const voxels = pileVoxels(this.yaw, this.seed).filter(([dx, dy, dz]) => w.ownerAt(this.at[0] + dx, this.at[1] + dy, this.at[2] + dz) === 0);
    this.pile = voxels.length ? w.spawn({ kind: 'bones', name: '倒れた骸骨', priority: 4, pos: this.at, voxels }) : null;
    if (this.pile) this.pile.body = this;
  }

  get alive() {
    return this.state !== 'dead';
  }

  // 1 ティック分
  update(dt, player, rng, report) {
    this.events = [];
    const w = this.world;
    if (this.state === 'dead') return;
    const P = player?.pos;
    if (this.state === 'dormant') {
      if (!P) return;
      const d = Math.hypot(P[0] - this.at[0], P[2] - this.at[2]);
      if (d < WAKE_RANGE && Math.abs(P[1] - this.at[1]) < 20) this.wake();
      return;
    }
    const e = this.e;
    if (!e || !w.entities.has(e.id)) return;
    this.timer += dt;
    let input = { dir: null, run: false };
    if (this.state === 'rise') {
      // 組み上がった骨が、しゃがんだ姿勢からゆっくり立ち上がる（このあいだは動かない）
      e.pose.crouch = Math.max(e.pose.crouch, 1 - this.timer / 1.1);
      if (this.timer > 1.1) {
        this.state = 'hunt';
        this.timer = 0;
      }
    } else if (P) {
      const dx = P[0] - e.pos[0], dz = P[2] - e.pos[2];
      const d = Math.hypot(dx, dz);
      const face = Math.atan2(dx, dz);
      if (d > 120) {
        input = { dir: null, run: false };
      } else if (d > 11) {
        input = { dir: [dx / d, dz / d], run: d > 40, face };
      } else {
        input = { dir: null, run: false, face };
      }
      this.cool = Math.max(0, (this.cool ?? 0) - dt);
      if (d < STRIKE_REACH + 2 && Math.abs(P[1] - e.pos[1]) < 14 && !this.cool && !e.swingT) {
        input.chop = true;
        this.cool = 1.3; // ひと振りごとに間をおく
      }
      input.tool = 'sword';
    }
    updateCharacter(w, e, input, dt, rng, report, (ent, action) => this.strike(action));
  }

  wake() {
    const w = this.world;
    if (this.pile) {
      w.paint(this.pile, false);
      w.entities.delete(this.pile.id);
      this.pile = null;
    }
    const pos = [this.at[0] - 4, this.at[1], this.at[2] - 4];
    const e = w.spawnHuman({ kind: 'skeleton', name: '骸骨', priority: 2, pos, palette: SKELETON_PALETTE, yaw: this.yaw });
    if (!e) {
      // 起き上がる場所がふさがっていたら、また倒れたままにする
      this.lay();
      return;
    }
    initCharacter(e);
    e.tool = 'sword';
    e.pose.crouch = 1;
    e.body = this;
    this.e = e;
    this.state = 'rise';
    this.timer = 0;
    this.events.push({ type: 'skeletonWake', actor: e });
  }

  // 剣が振り下ろされた瞬間: 前にいるプレイヤーに当たる
  strike() {
    const w = this.world, e = this.e, p = w.player;
    if (!p || !e) return;
    const dx = p.pos[0] - e.pos[0], dz = p.pos[2] - e.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > STRIKE_REACH || Math.abs(p.pos[1] - e.pos[1]) > 12) return;
    if (Math.abs(wrap(Math.atan2(dx, dz) - e.pose.yaw)) > 1.0) return;
    const r = this.world.hurt?.(SKELETON_DAMAGE);
    this.events.push({ type: 'skeletonHit', actor: e, target: p, damage: SKELETON_DAMAGE });
    if (r) this.events.push(r);
  }

  // 斬られた・撃たれた: 骨が崩れ落ちる。戻り値は出来事の種類
  slash() {
    return this.collapse();
  }

  shot() {
    return this.collapse();
  }

  collapse() {
    const w = this.world;
    if (this.state === 'dead') return null;
    let cells;
    if (this.e) {
      const e = this.e;
      cells = w.cellsOf(e).filter((c) => c[3]);
      for (const [x, y, z] of e.toolCells ?? []) if (w.ownerAt(x, y, z) === e.toolId) w.setCell(x, y, z, 0, 0);
      w.paint(e, false);
      w.entities.delete(e.id);
      if (e.toolId) w.entities.delete(e.toolId);
      this.e = null;
    } else if (this.pile) {
      cells = w.cellsOf(this.pile).filter((c) => c[3]);
      w.paint(this.pile, false);
      w.entities.delete(this.pile.id);
      this.pile = null;
    }
    this.state = 'dead';
    if (cells?.length) dropBones(w, cells);
    this.events.push({ type: 'skeletonDown', actor: { name: '骸骨' } });
    return 'collapse';
  }
}

// 骨を、落ちていく物として世界に置く（崩れ落ちて床に積もる）
function dropBones(w, cells, name = '崩れた骨') {
  const lo = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c[a])));
  const voxels = cells.filter(([x, y, z]) => w.ownerAt(x, y, z) === 0).map(([x, y, z, c]) => [x - lo[0], y - lo[1], z - lo[2], c]);
  if (!voxels.length) return null;
  return w.spawn({ kind: 'carcass', name, priority: 8, falling: true, vy: 0, fall: 0, pos: lo, voxels });
}

// ---- 赤い骨の王 ----------------------------------------------------------------

export class BoneKing {
  // at: 玉座の前の足もと、yaw: 向き、room: 玉座の間の範囲 { x0, x1, z0, z1 }（世界の座標）
  constructor(world, at, yaw, room) {
    this.world = world;
    this.id = world.nextId++;
    this.entity = { id: this.id, kind: 'boneKing', name: '赤い骨の王', priority: 8, pos: at.map(Math.round), offsets: new Int16Array(0), colors: new Uint32Array(0), body: this };
    world.entities.set(this.id, this.entity);
    this.pos = [...at];
    this.home = [...at];
    this.yaw = yaw;
    this.room = room;
    this.pose = createPose();
    this.pose.yaw = yaw;
    this.pose.tool = 'sword';
    this.pose.crouch = 1;
    this.pal = { ...KING_PALETTE };
    this.state = 'seated';
    this.timer = 0;
    this.hp = KING_HP;
    this.cells = [];
    this.events = [];
    this.swing = 0;
    this.lastSlash = 'slashH';
    this.flinch = 0;
    this.acc = 0;
    this.version = 0;
  }

  get label() {
    return { seated: '玉座に鎮座している', rising: '目覚めて立ち上がる', fight: '大剣で襲いかかる', dead: '崩れ落ちた' }[this.state];
  }

  update(dt, player) {
    this.events = [];
    if (this.state === 'dead') return;
    // 体の描き直しは 1 秒に 12.5 回
    this.acc += dt;
    if (this.acc < 0.079) return;
    const step = this.acc;
    this.acc = 0;
    const p = player;
    const P = p ? [p.pos[0] + 4.5, p.pos[1], p.pos[2] + 4.5] : null;
    const d = P ? Math.hypot(P[0] - this.pos[0], P[2] - this.pos[2]) : Infinity;
    const pose = this.pose;
    this.timer += step;
    this.flinch = Math.max(0, this.flinch - step * 3);
    if (this.state === 'seated') {
      pose.crouch = 1;
      if (d < KING_WAKE && Math.abs(P[1] - this.pos[1]) < 30) this.wake();
    } else if (this.state === 'rising') {
      // 震えながら、ゆっくり立ち上がる（目は赤く光る）
      const u = Math.min(1, this.timer / 2.2);
      pose.crouch = 1 - u * u;
      pose.sway = Math.sin(this.timer * 40) * 0.4 * (1 - u);
      if (u >= 1) {
        this.state = 'fight';
        this.timer = 0;
      }
    } else if (this.state === 'fight' && P) {
      // プレイヤーの方を向き、歩み寄り、大剣を振る
      const want = Math.atan2(P[0] - this.pos[0], P[2] - this.pos[2]);
      this.yaw += Math.max(-2.5 * step, Math.min(2.5 * step, wrap(want - this.yaw)));
      pose.yaw = this.yaw;
      let moving = false;
      if (!this.swing && d > 26) {
        const sp = KING_SPEED * step;
        const nx = this.pos[0] + Math.sin(this.yaw) * sp, nz = this.pos[2] + Math.cos(this.yaw) * sp;
        const R = this.room;
        if (nx > R.x0 + 8 && nx < R.x1 - 8 && nz > R.z0 + 8 && nz < R.z1 - 8) {
          this.pos[0] = nx;
          this.pos[2] = nz;
          moving = true;
        }
        pose.phase = (pose.phase + sp / (10 * KING_SCALE)) % 1;
      }
      pose.walk += ((moving ? 1 : 0) - pose.walk) * Math.min(1, step * 5);
      pose.crouch = Math.max(0, pose.crouch - step * 2);
      this.rest = Math.max(0, (this.rest ?? 0) - step);
      if (!this.swing && !this.rest && d < 34) {
        this.swing = 1e-4;
        this.struck = false;
        this.action = this.lastSlash === 'slashV' ? 'slashH' : 'slashV';
        this.lastSlash = this.action;
      }
      if (this.swing) {
        this.swing += step / KING_SWING;
        if (!this.struck && this.swing >= 0.5) {
          this.struck = true;
          this.strike(P, d);
        }
        if (this.swing >= 1) {
          this.swing = 0;
          this.rest = 0.7; // ひと振りごとに少し間をおく（そのすきに斬り返せる）
        }
      }
      pose.swing = this.swing;
      pose.action = this.action ?? 'slashV';
    }
    this.draw();
  }

  wake() {
    this.state = 'rising';
    this.timer = 0;
    this.pal.eyes = 0xff3a1a; // 目が赤く光る
    this.events.push({ type: 'kingWake', actor: this.entity });
  }

  strike(P, d) {
    if (d > 38 || Math.abs(P[1] - this.pos[1]) > 30) return;
    if (Math.abs(wrap(Math.atan2(P[0] - this.pos[0], P[2] - this.pos[2]) - this.yaw)) > 1.1) return;
    const r = this.world.hurt?.(KING_DAMAGE);
    this.events.push({ type: 'kingHit', actor: this.entity, target: this.world.player, damage: KING_DAMAGE });
    if (r) this.events.push(r);
  }

  // 体の部位を、人の 2.4 倍の大きさで世界に描く
  shape(emit) {
    const S = KING_SCALE;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const X = this.pos[0], Y = this.pos[1], Z = this.pos[2];
    const toW = (p) => [X + S * (p[0] * c + p[2] * s), Y + S * p[1], Z + S * (-p[0] * s + p[2] * c)];
    const parts = buildParts(this.pose, this.pal).sort((a, b) => b.bias - a.bias);
    const shake = this.flinch > 0 ? Math.sin(this.flinch * 30) * this.flinch * 1.5 : 0;
    for (const part of parts) {
      if (part.type === 'cap') {
        const a = toW(part.a), b = toW(part.b);
        a[0] += shake;
        b[0] += shake;
        const R = Math.max(part.ra, part.rb) * S + 0.5;
        const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
        const L2 = abx * abx + aby * aby + abz * abz || 1e-9;
        for (let y = Math.floor(Math.min(a[1], b[1]) - R); y <= Math.floor(Math.max(a[1], b[1]) + R); y++) {
          if (y < 1 || y >= HEIGHT) continue;
          for (let z = Math.floor(Math.min(a[2], b[2]) - R); z <= Math.floor(Math.max(a[2], b[2]) + R); z++) {
            for (let x = Math.floor(Math.min(a[0], b[0]) - R); x <= Math.floor(Math.max(a[0], b[0]) + R); x++) {
              const px = x + 0.5 - a[0], py = y + 0.5 - a[1], pz = z + 0.5 - a[2];
              let t = (px * abx + py * aby + pz * abz) / L2;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const dx = px - abx * t, dy = py - aby * t, dz = pz - abz * t;
              const r = (part.ra + (part.rb - part.ra) * t) * S;
              if (dx * dx + dy * dy + dz * dz <= r * r) emit(x, y, z, part.color);
            }
          }
        }
      } else {
        const cw = toW(part.center);
        cw[0] += shake;
        const [rx, ry, rz] = part.radii.map((v) => v * S);
        const R = Math.max(rx, ry, rz) + 0.5;
        const ec = Math.cos(this.yaw + part.yaw), es = Math.sin(this.yaw + part.yaw);
        for (let y = Math.floor(cw[1] - ry - 0.5); y <= Math.floor(cw[1] + ry + 0.5); y++) {
          if (y < 1 || y >= HEIGHT) continue;
          for (let z = Math.floor(cw[2] - R); z <= Math.floor(cw[2] + R); z++) {
            for (let x = Math.floor(cw[0] - R); x <= Math.floor(cw[0] + R); x++) {
              const dx = x + 0.5 - cw[0], dz = z + 0.5 - cw[2];
              const lx = (dx * ec - dz * es) / rx, ly = (y + 0.5 - cw[1]) / ry, lz = (dx * es + dz * ec) / rz;
              if (Math.abs(lx) ** part.pow + Math.abs(ly) ** part.pow + Math.abs(lz) ** part.pow > 1) continue;
              const color = part.shade ? part.shade(lx, ly, lz) : part.color;
              if (color) emit(x, y, z, color);
            }
          }
        }
      }
    }
  }

  draw() {
    const { cells } = redrawBody(this.world, this.id, this.cells, (emit) => this.shape(emit), () => null);
    this.cells = cells;
    this.version++;
    this.entity.pos = this.pos.map(Math.round);
  }

  // 斬られた・撃たれた
  slash() {
    return this.hurt(3);
  }

  shot(p, power) {
    return this.hurt(0.35 + power * 0.55);
  }

  hurt(amount) {
    if (this.state === 'dead') return null;
    if (this.state === 'seated') this.wake();
    this.hp -= amount;
    this.flinch = 1;
    if (this.hp > 0) return 'kingHurt';
    // 崩れ落ちる
    const cells = [];
    this.shape((x, y, z, c) => cells.push([x, y, z, c]));
    clearBody(this.world, this.id, this.cells);
    this.cells = [];
    this.state = 'dead';
    dropBones(this.world, cells, '赤い骨の王の骨');
    this.version++;
    this.events.push({ type: 'kingDown', actor: this.entity });
    return 'kingDown';
  }
}
