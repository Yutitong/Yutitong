// ボクセル世界のロジック（描画には依存しない）
//
// 世界は「ディスプレイ」のようなもの。各ボクセルは持ち主 (entity id) と色を1つだけ持つ。
// 物体が動く = 古いボクセルを消し、新しいボクセルを点灯すること。
// 1つのボクセルに2つの物体が重なることはないので、衝突時は優先度で
// 「押し出す側」と「押し出される側（または止められる側）」を決める。
//
// 世界は水平方向にどこまでも続く。16×16 の柱（チャンク）単位で、必要になったときに作る。

import { HUMAN_SIZE, PALETTES, FACING_DIRS, WALK_CYCLE, facingOf, humanoidVoxels } from './humanoid.js';

export const EMPTY = 0;
export const GROUND_ID = 1;
export const CHUNK = 16; // チャンクの一辺（ボクセル）
export const HEIGHT = 32; // 世界の高さ（ボクセル）。y = 0 が地面
export const VOXEL_METERS = 0.15;

// 数値が大きいほど強い。動く側の優先度 > 相手の優先度 のときだけ押し出せる。
export const PRIORITY = {
  TERRAIN: Infinity,
  PLAYER: 3,
  NPC: 2,
  BOX: 1,
};

// 押し出しの段数。1 = 直接触れている物だけ押せる（箱の後ろに物があると止まる）。
// Infinity にすると連鎖押し出しになる。
export const MAX_PUSH_DEPTH = 1;

export const DIRS = FACING_DIRS;

// ---- 乱数・ハッシュ（同じ座標からは常に同じ世界ができる） -----------------------

export function hash3(a, b, c) {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

// ---- 世界 ------------------------------------------------------------------------

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.owner = new Int32Array(CHUNK * CHUNK * HEIGHT); // 持ち主 id（0 = 空き）
    this.color = new Uint32Array(CHUNK * CHUNK * HEIGHT); // 表示色（0 = 消灯）
  }
}

const floorDiv = (a, b) => Math.floor(a / b);
// チャンクの番号を1つの数値にまとめる（文字列を作らずに Map を引くため）
export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const cellIndex = (lx, y, lz) => lx + CHUNK * (lz + CHUNK * y);

export class World {
  // generate: false にすると地面だけの世界になる（テスト用）
  constructor({ seed = 1, generate = true } = {}) {
    this.seed = seed;
    this.generate = generate;
    this.chunks = new Map();
    this.dirty = new Set(); // 描画を更新すべきチャンクの key
    this.entities = new Map();
    this.entities.set(GROUND_ID, { id: GROUND_ID, kind: 'terrain', name: '地面', priority: PRIORITY.TERRAIN, pos: [0, 0, 0], voxels: [] });
    this.nextId = GROUND_ID + 1;
    this.tickCount = 0;
    this.player = null;
    this.counts = { npc: 0, crate: 0 }; // 名前の通し番号
  }

  chunkAt(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(key, c); // 中身を作る前に登録（生成中の spawn が自分自身を参照できるように）
      fillGround(this, c);
      if (this.generate) generateChunk(this, c);
      this.dirty.add(key);
    }
    return c;
  }

  // 範囲外（地面より下 / 空の上限）は -1
  ownerAt(x, y, z) {
    if (y < 0 || y >= HEIGHT) return -1;
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    return c.owner[cellIndex(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
  }

  colorAt(x, y, z) {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    return c.color[cellIndex(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
  }

  setCell(x, y, z, owner, color) {
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    const i = cellIndex(x - c.cx * CHUNK, y, z - c.cz * CHUNK);
    c.owner[i] = owner;
    c.color[i] = color;
    this.dirty.add(c.key);
  }

  // voxels: [[dx, dy, dz, color], ...]（pos からの相対位置。color 0 は占有するが消灯）
  // 置けない場合は null を返す
  spawn({ kind, name, priority, pos, voxels, ...extra }) {
    const e = { id: this.nextId, kind, name, priority, pos: [...pos], voxels, ...extra };
    for (const [x, y, z] of this.cellsOf(e)) {
      if (this.ownerAt(x, y, z) !== EMPTY) return null;
    }
    this.nextId++;
    this.entities.set(e.id, e);
    this.paint(e, true);
    return e;
  }

  spawnHuman({ kind, name, priority, pos, palette, facing = 0, ...extra }) {
    return this.spawn({
      kind, name, priority, pos, palette, facing, frame: 0,
      voxels: humanoidVoxels(palette, facing, 0),
      ...extra,
    });
  }

  cellsOf(e, pos = e.pos) {
    return e.voxels.map(([dx, dy, dz, color]) => [pos[0] + dx, pos[1] + dy, pos[2] + dz, color]);
  }

  paint(e, on) {
    for (const [x, y, z, color] of this.cellsOf(e)) {
      this.setCell(x, y, z, on ? e.id : EMPTY, on ? color : 0);
    }
  }

  // 見た目だけを差し替える（占有するセルは同じであること）。色だけを書き換える。
  setLook(e, voxels) {
    if (voxels === e.voxels) return;
    e.voxels = voxels;
    this.paint(e, true);
  }

  // 人型キャラの向きとコマを変える。当たり判定の直方体は変わらないので衝突は起きない。
  pose(e, facing, frame) {
    e.facing = facing;
    e.frame = frame % WALK_CYCLE.length;
    this.setLook(e, humanoidVoxels(e.palette, e.facing, e.frame));
  }

  // 物体を dir 方向に1マス動かす。必要なら優先度の低い物を押し出す。
  // 戻り値: { ok, pushed: [押し出した物], blocker: 止めた物, via: 動けなかった物, reason }
  tryMove(id, dir) {
    const mover = this.entities.get(id);
    const plan = new Set();
    this._fail = null;
    if (!this.planMove(mover, dir, mover.priority, 0, plan)) {
      return { ok: false, pushed: [], ...this._fail };
    }
    // 計画が全部成立したときだけ一斉に動かす（途中で失敗したら何も動かない）
    const group = [...plan].map((gid) => this.entities.get(gid));
    for (const e of group) this.paint(e, false);
    for (const e of group) {
      e.pos = [e.pos[0] + dir[0], e.pos[1] + dir[1], e.pos[2] + dir[2]];
      this.paint(e, true);
    }
    return { ok: true, pushed: group.filter((e) => e !== mover) };
  }

  planMove(e, dir, power, depth, plan) {
    plan.add(e.id);
    const next = [e.pos[0] + dir[0], e.pos[1] + dir[1], e.pos[2] + dir[2]];
    const seen = new Set();
    for (const [x, y, z] of this.cellsOf(e, next)) {
      const owner = this.ownerAt(x, y, z);
      if (owner === -1) {
        this._fail = { blocker: null, via: e, reason: 'edge' };
        return false;
      }
      if (owner === EMPTY || plan.has(owner) || seen.has(owner)) continue;
      seen.add(owner);
      const other = this.entities.get(owner);
      if (other.priority >= power) {
        this._fail = { blocker: other, via: e, reason: 'priority' };
        return false;
      }
      if (depth >= MAX_PUSH_DEPTH) {
        this._fail = { blocker: other, via: e, reason: 'depth' };
        return false;
      }
      if (!this.planMove(other, dir, power, depth + 1, plan)) return false;
    }
    return true;
  }
}

// ---- 1ティック -------------------------------------------------------------------

export const SIM_RADIUS = 80; // プレイヤーからこの距離（ボクセル）以内の NPC だけ動かす

function randomDir(rng) {
  return DIRS[Math.floor(rng() * DIRS.length)];
}

// 人型キャラを1歩進める。進めたらコマを1つ進め、止まったら立ち姿に戻す。
function walk(world, e, dir, act) {
  const facing = facingOf(dir);
  if (facing !== e.facing) world.pose(e, facing, e.frame);
  const ok = act(e, dir);
  world.pose(e, facing, ok ? e.frame + 1 : 0);
  return ok;
}

// playerDir: [dx, 0, dz] または null（立ち止まる）
// 戻り値はこのティックで起きた出来事のリスト
export function step(world, playerDir, rng = Math.random) {
  world.tickCount++;
  const events = [];
  const act = (e, dir) => {
    const r = world.tryMove(e.id, dir);
    if (r.ok) {
      for (const t of r.pushed) events.push({ type: 'push', actor: e, target: t });
    } else {
      events.push({ type: 'block', actor: e, target: r.blocker, via: r.via, reason: r.reason });
    }
    return r.ok;
  };

  const p = world.player;
  if (p) {
    if (playerDir) walk(world, p, playerDir, act);
    else if (p.frame !== 0) world.pose(p, p.facing, 0);
  }

  for (const e of [...world.entities.values()]) {
    if (e.kind !== 'npc') continue;
    if (p && Math.max(Math.abs(e.pos[0] - p.pos[0]), Math.abs(e.pos[2] - p.pos[2])) > SIM_RADIUS) continue;
    if (e.rest > 0) {
      e.rest--;
      if (e.rest === 0) e.dir = randomDir(rng);
      else if (e.frame !== 0) world.pose(e, e.facing, 0);
      continue;
    }
    if (e.wait > 0) {
      e.wait--;
      continue;
    }
    e.wait = e.slowness;
    if (!e.dir) e.dir = randomDir(rng);
    if (rng() < 0.02) {
      e.rest = 10 + Math.floor(rng() * 30); // ときどき立ち止まる
      continue;
    }
    if (rng() < 0.03) e.dir = randomDir(rng);
    if (!walk(world, e, e.dir, act)) e.dir = randomDir(rng);
  }
  return events;
}

// ---- 地形とチャンクの中身 ---------------------------------------------------------

const GRASS = [0x5f9a46, 0x67a34c, 0x588f41, 0x6eab52];
const FLOWERS = [0xf3e37c, 0xf4f1f7, 0xe58fb2];

function groundColor(seed, x, z) {
  const h = hash3(x, z, seed);
  if (h % 97 === 0) return FLOWERS[(h >>> 8) % FLOWERS.length];
  // 大きめの斑模様（4×4 ごと）と細かいばらつきを重ねる
  const patch = hash3(floorDiv(x, 4), floorDiv(z, 4), seed + 7) % 2;
  return GRASS[((h >>> 4) % 2) + patch * 2];
}

function fillGround(world, c) {
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const i = cellIndex(lx, 0, lz);
      c.owner[i] = GROUND_ID;
      c.color[i] = groundColor(world.seed, c.cx * CHUNK + lx, c.cz * CHUNK + lz);
    }
  }
}

const shade = (rgb, f) => {
  const r = Math.min(255, Math.round(((rgb >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((rgb >> 8) & 255) * f));
  const b = Math.min(255, Math.round((rgb & 255) * f));
  return (r << 16) | (g << 8) | b;
};

function crateVoxels() {
  const v = [];
  const n = 5;
  for (let y = 0; y < n; y++) {
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const edges = (x === 0 || x === n - 1) + (y === 0 || y === n - 1) + (z === 0 || z === n - 1);
        v.push([x, y, z, edges >= 2 ? 0x7a4f2a : (x + y + z) % 2 ? 0xb5824c : 0xa87643]);
      }
    }
  }
  return v;
}

function rockVoxels(rng) {
  const v = [];
  const rx = 2.6 + rng() * 1.2;
  const rz = 2.6 + rng() * 1.2;
  const ry = 2.5 + rng() * 2;
  for (let y = 0; y < 6; y++) {
    for (let z = 0; z < 8; z++) {
      for (let x = 0; x < 8; x++) {
        const d = ((x - 3.5) / rx) ** 2 + (y / ry) ** 2 + ((z - 3.5) / rz) ** 2;
        if (d <= 1) v.push([x, y, z, shade(0x8a8f98, 0.85 + rng() * 0.3)]);
      }
    }
  }
  return v;
}

function treeVoxels(rng) {
  const v = [];
  const top = 9 + Math.floor(rng() * 4);
  for (let y = 0; y < top; y++) {
    for (let z = 3; z <= 5; z++) for (let x = 3; x <= 5; x++) v.push([x, y, z, shade(0x7a5534, 0.9 + rng() * 0.2)]);
  }
  const cy = top + 2;
  for (let y = top - 2; y <= top + 5; y++) {
    for (let z = 0; z < 9; z++) {
      for (let x = 0; x < 9; x++) {
        const d = ((x - 4) / 4.4) ** 2 + ((y - cy) / 3.6) ** 2 + ((z - 4) / 4.4) ** 2;
        const trunk = x >= 3 && x <= 5 && z >= 3 && z <= 5 && y < top;
        if (d <= 1 && !trunk && rng() > 0.08) v.push([x, y, z, shade(0x3f8a3a, 0.8 + rng() * 0.35)]);
      }
    }
  }
  return v;
}

// チャンクの中に物を置く。物はそのチャンクの内側に収まるように置く。
function generateChunk(world, c) {
  if (c.cx === 0 && c.cz === 0) return; // 出発地点は空けておく
  const rng = mulberry32(hash3(c.cx, c.cz, world.seed));
  const ox = c.cx * CHUNK;
  const oz = c.cz * CHUNK;
  const place = (size) => [ox + Math.floor(rng() * (CHUNK - size + 1)), 1, oz + Math.floor(rng() * (CHUNK - size + 1))];

  // 半分くらいのチャンクは何もない野原にする
  const tries = rng() < 0.45 ? 0 : 1 + Math.floor(rng() * 1.6);
  for (let t = 0; t < tries; t++) {
    const r = rng();
    if (r < 0.28) {
      world.spawn({ kind: 'terrain', name: '木', priority: PRIORITY.TERRAIN, pos: place(9), voxels: treeVoxels(rng) });
    } else if (r < 0.48) {
      world.spawn({ kind: 'terrain', name: '岩', priority: PRIORITY.TERRAIN, pos: place(8), voxels: rockVoxels(rng) });
    } else if (r < 0.78) {
      const e = world.spawn({ kind: 'box', name: `木箱-${world.counts.crate + 1}`, priority: PRIORITY.BOX, pos: place(5), voxels: crateVoxels() });
      if (e) world.counts.crate++;
    } else if (r < 0.9) {
      const palette = PALETTES.npc[Math.floor(rng() * PALETTES.npc.length)];
      const e = world.spawnHuman({
        kind: 'npc', name: `NPC-${world.counts.npc + 1}`, priority: PRIORITY.NPC,
        pos: place(HUMAN_SIZE[0]), palette, facing: Math.floor(rng() * 4),
        slowness: 1, wait: 0, rest: 0, dir: null,
      });
      if (e) world.counts.npc++;
    }
  }
}

// 出発地点にプレイヤーを置く
export function spawnPlayer(world) {
  world.chunkAt(0, 0);
  world.player = world.spawnHuman({
    kind: 'player', name: 'プレイヤー', priority: PRIORITY.PLAYER,
    pos: [Math.floor((CHUNK - HUMAN_SIZE[0]) / 2), 1, Math.floor((CHUNK - HUMAN_SIZE[2]) / 2)],
    palette: PALETTES.player, facing: 0,
  });
  return world.player;
}

// プレイヤーの周り radius チャンク分を用意する
export function ensureAround(world, x, z, radius) {
  const cx = floorDiv(x, CHUNK);
  const cz = floorDiv(z, CHUNK);
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) world.chunkAt(cx + dx, cz + dz);
  }
}

export { cellIndex, floorDiv };
