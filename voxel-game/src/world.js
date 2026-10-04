// ボクセル世界のロジック（描画には依存しない）
//
// 世界は「ディスプレイ」のようなもの。各ボクセルは持ち主 (entity id) と色を1つだけ持つ。
// 物体が動く = 古いボクセルを消し、新しいボクセルを点灯すること。
// 1つのボクセルに2つの物体が重なることはないので、衝突時は優先度で
// 「押し出す側」と「押し出される側（または止められる側）」を決める。
//
// 世界は水平方向にどこまでも続く。16×16 の柱（チャンク）単位で、必要になったときに作る。

import { HUMAN_SIZE, HUMAN_OFFSETS, PALETTES, createPose, humanColors } from './humanoid.js';
import { initCharacter, updateCharacter } from './character.js';
import { CHUNK, HEIGHT, floorDiv, chunkKey, cellIndex } from './grid.js';
import { hash3, mulberry32, shade } from './rng.js';
import { terrainHeight, groundColor, waterColor, WATER_LEVEL } from './terrain.js';
import { paintTreesInto, updateWind } from './trees.js';

export { CHUNK, HEIGHT, floorDiv, chunkKey, cellIndex, hash3, mulberry32 };
export const EMPTY = 0;
export const GROUND_ID = 1;
export const WATER_ID = 2;
export const WATER_FLAG = 0x1000000; // 色にこの印がついたセルは半透明（水面）で描く
export const VOXEL_METERS = 0.15;
export const WIND_RADIUS = 140; // プレイヤーからこの距離（ボクセル）以内の木だけ風で揺らす
export const TICK_SECONDS = 0.04; // 1秒に25回更新

// 数値が大きいほど強い。動く側の優先度 > 相手の優先度 のときだけ押し出せる。
// 水は一番弱く、入ってきた物にいつでも場所をゆずる（出ていけば元に戻る）。
export const PRIORITY = {
  TERRAIN: Infinity,
  PLAYER: 3,
  NPC: 2,
  BOX: 1,
  WATER: 0,
};

// 押し出しの段数。1 = 直接触れている物だけ押せる（箱の後ろに物があると止まる）。
// Infinity にすると連鎖押し出しになる。
export const MAX_PUSH_DEPTH = 1;

// 人がこの高さ（足元からのボクセル数）より深い水には入らない（≈ 胸の高さ）
export const WADE_DEPTH = 9;

// 8方向（[dx, dz]）
export const DIRS8 = [
  [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1],
];

// ---- 世界 ------------------------------------------------------------------------

class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.owner = new Int32Array(CHUNK * CHUNK * HEIGHT); // 持ち主 id（0 = 空き）
    this.color = new Uint32Array(CHUNK * CHUNK * HEIGHT); // 表示色（0 = 消灯）
    this.height = new Uint8Array(CHUNK * CHUNK); // 列ごとの地面の高さ
    this.water = new Uint8Array(CHUNK * CHUNK); // 列ごとの水面の高さ（0 = 水なし）
    this.top = 1; // これより上のセルはすべて空（描画で調べる範囲を減らす）
    this.changed = []; // 前回描画してから変わったセル（描画側が読んで空にする）
  }
}

// [[dx, dy, dz, color], ...] を、セルの相対位置（offsets）と色（colors）の配列に分ける
function packVoxels(voxels) {
  const offsets = new Int16Array(voxels.length * 3);
  const colors = new Uint32Array(voxels.length);
  voxels.forEach(([x, y, z, c], k) => {
    offsets.set([x, y, z], k * 3);
    colors[k] = c;
  });
  return { offsets, colors };
}

const NO_CELLS = { offsets: new Int16Array(0), colors: new Uint32Array(0) };

export class World {
  // generate: false にすると平らな地面だけの世界になる（テスト用）。
  // heightAt(x, z) / waterLevel で地形を差し替えられる（テスト用）。
  constructor({ seed = 1, generate = true, heightAt = null, waterLevel = null } = {}) {
    this.seed = seed;
    this.generate = generate;
    this.heightAt = heightAt ?? (generate ? (x, z) => terrainHeight(seed, x, z) : () => 1);
    this.waterLevel = waterLevel ?? (generate ? WATER_LEVEL : 0);
    this.chunks = new Map();
    this.dirty = new Set(); // 描画を更新すべきチャンクの key
    this.entities = new Map();
    this.entities.set(GROUND_ID, { id: GROUND_ID, kind: 'terrain', name: '地面', ground: true, priority: PRIORITY.TERRAIN, pos: [0, 0, 0], ...NO_CELLS });
    this.entities.set(WATER_ID, { id: WATER_ID, kind: 'water', name: '水', priority: PRIORITY.WATER, pos: [0, 0, 0], ...NO_CELLS });
    this.deepWater = { id: WATER_ID, kind: 'water', name: '深い水', priority: PRIORITY.TERRAIN };
    this.nextId = WATER_ID + 1;
    this.tickCount = 0;
    this.player = null;
    this.counts = { npc: 0, crate: 0 }; // 名前の通し番号
    this.trees = new Map(); // 区画 → 木
    this.treeSpecs = new Map(); // 区画 → 木の設計図（なければ null）
    this.time = 0;
  }

  chunkAt(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(key, c); // 中身を作る前に登録（生成中の spawn が自分自身を参照できるように）
      fillTerrain(this, c);
      if (this.generate) {
        paintTreesInto(this, c); // 木は隣の区画から枝を伸ばしてくることもあるので先に塗る
        generateChunk(this, c);
      }
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

  // 地面の高さ（その列で最初の空でないセルの1つ上）
  groundAt(x, z) {
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    return c.height[x - c.cx * CHUNK + CHUNK * (z - c.cz * CHUNK)];
  }

  // 水面の高さ（水がなければ 0）
  waterAt(x, z) {
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    return c.water[x - c.cx * CHUNK + CHUNK * (z - c.cz * CHUNK)];
  }

  // セルを書き換える。水の中では:
  // - 空けたセルには水が戻る
  // - 物が占有していても消灯しているセルが水面の高さにあれば、水面の色を見せる
  setCell(x, y, z, owner, color) {
    const c = this.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK;
    const i = cellIndex(lx, y, lz);
    const col = lx + CHUNK * lz;
    const level = c.water[col];
    if (level && y < level && y >= c.height[col]) {
      if (owner === EMPTY) owner = WATER_ID;
      if (color === 0 && y === level - 1) color = waterColor(x, z, level - c.height[col]) | WATER_FLAG;
    }
    c.owner[i] = owner;
    c.color[i] = color;
    if (owner && y >= c.top) c.top = y + 1;
    c.changed.push(i);
    this.dirty.add(c.key);
  }

  // voxels: [[dx, dy, dz, color], ...]（pos からの相対位置。color 0 は占有するが消灯）
  // または offsets / colors を直接渡す。置けない場合は null を返す。
  spawn({ voxels, offsets, colors, ...spec }) {
    if (voxels) ({ offsets, colors } = packVoxels(voxels));
    const e = { id: this.nextId, ...spec, pos: [...spec.pos], offsets, colors };
    for (let k = 0; k < colors.length; k++) {
      const o = k * 3;
      if (this.ownerAt(e.pos[0] + offsets[o], e.pos[1] + offsets[o + 1], e.pos[2] + offsets[o + 2]) !== EMPTY) return null;
    }
    this.nextId++;
    this.entities.set(e.id, e);
    this.paint(e, true);
    return e;
  }

  // 人型キャラ: 9×15×9 の箱の中の円柱を占有し、中の見た目は姿勢から描く
  spawnHuman({ palette, yaw = 0, ...spec }, rng = Math.random) {
    const pose = { ...createPose(), yaw };
    const e = this.spawn({ ...spec, palette, yaw, wade: WADE_DEPTH, offsets: HUMAN_OFFSETS, colors: humanColors(palette, pose) });
    return e && initCharacter(e, rng);
  }

  // [[x, y, z, color], ...]（絶対座標）
  cellsOf(e, pos = e.pos) {
    const out = [];
    for (let k = 0; k < e.colors.length; k++) {
      const o = k * 3;
      out.push([pos[0] + e.offsets[o], pos[1] + e.offsets[o + 1], pos[2] + e.offsets[o + 2], e.colors[k]]);
    }
    return out;
  }

  paint(e, on) {
    const { offsets, colors, pos } = e;
    for (let k = 0; k < colors.length; k++) {
      const o = k * 3;
      this.setCell(pos[0] + offsets[o], pos[1] + offsets[o + 1], pos[2] + offsets[o + 2], on ? e.id : EMPTY, on ? colors[k] : 0);
    }
  }

  // 見た目だけを差し替える。占有するセルは同じなので、色が変わったセルだけ書き換える。
  recolor(e, colors) {
    const { offsets, pos } = e;
    for (let k = 0; k < colors.length; k++) {
      if (colors[k] === e.colors[k]) continue;
      e.colors[k] = colors[k];
      const o = k * 3;
      this.setCell(pos[0] + offsets[o], pos[1] + offsets[o + 1], pos[2] + offsets[o + 2], e.id, colors[k]);
    }
  }

  // 物体を dir だけ動かす。push が true なら優先度の低い物を押し出す。
  // 戻り値: { ok, pushed: [押し出した物], blocker: 止めた物, via: 動けなかった物, reason }
  tryMove(id, dir, { push = true } = {}) {
    const mover = this.entities.get(id);
    const plan = new Set();
    this._fail = null;
    if (!this.planMove(mover, dir, push ? mover.priority : 0, push ? 0 : MAX_PUSH_DEPTH, plan)) {
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

  // 実際には動かさずに、動けるかどうかだけ調べる（既定では何も押さない）
  canMove(id, dir, { push = false } = {}) {
    const e = this.entities.get(id);
    return this.planMove(e, dir, push ? e.priority : 0, push ? 0 : MAX_PUSH_DEPTH, new Set());
  }

  planMove(e, dir, power, depth, plan) {
    plan.add(e.id);
    const { offsets, pos } = e;
    const nx = pos[0] + dir[0], ny = pos[1] + dir[1], nz = pos[2] + dir[2];
    const seen = new Set();
    for (let o = 0; o < offsets.length; o += 3) {
      const owner = this.ownerAt(nx + offsets[o], ny + offsets[o + 1], nz + offsets[o + 2]);
      if (owner === -1) {
        this._fail = { blocker: null, via: e, reason: 'edge' };
        return false;
      }
      if (owner === EMPTY || plan.has(owner)) continue;
      if (owner === WATER_ID) {
        // 水は場所をゆずる。ただし人は胸より深い所に入らず、箱は水に入らない
        if (e.wade !== undefined && offsets[o + 1] < e.wade) continue;
        this._fail = { blocker: this.deepWater, via: e, reason: 'priority' };
        return false;
      }
      if (seen.has(owner)) continue;
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
    // 重力のない物（木箱）は、足場のない所へは動かない（宙に浮かないように）
    if (e.needsSupport && !this.supported(e, nx, ny, nz, plan)) {
      this._fail = { blocker: null, via: e, reason: 'support' };
      return false;
    }
    return true;
  }

  // 位置 (x, y, z) に置いたとき、底のセルのどれかの下に地面か物があるか
  supported(e, x, y, z, plan) {
    const { offsets } = e;
    let minY = Infinity;
    for (let o = 1; o < offsets.length; o += 3) minY = Math.min(minY, offsets[o]);
    for (let o = 0; o < offsets.length; o += 3) {
      if (offsets[o + 1] !== minY) continue;
      const below = this.ownerAt(x + offsets[o], y + minY - 1, z + offsets[o + 2]);
      if (below > 0 && below !== WATER_ID && !plan.has(below)) return true;
    }
    return false;
  }

  // 範囲 [x, x + w) × [z, z + d) の地面の一番高い所 / 一番低い所 / 水があるか
  footprint(x, z, w, d) {
    let hi = 0, lo = Infinity, wet = false;
    for (let dz = 0; dz < d; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const h = this.groundAt(x + dx, z + dz);
        hi = Math.max(hi, h);
        lo = Math.min(lo, h);
        if (this.waterAt(x + dx, z + dz)) wet = true;
      }
    }
    return { hi, lo, wet };
  }
}

// ---- 1ティック -------------------------------------------------------------------

export const SIM_RADIUS = 80; // プレイヤーからこの距離（ボクセル）以内の NPC だけ動かす

// NPC の考え: 歩く・立ち止まる・ときどき走る
function npcInput(e, rng, dt) {
  e.aiLeft = (e.aiLeft ?? 0) - dt;
  if (e.aiLeft <= 0) {
    if (rng() < 0.3) {
      e.aiDir = null; // 立ち止まってあたりを見る
      e.aiLeft = 1.5 + rng() * 4;
    } else {
      e.aiDir = DIRS8[Math.floor(rng() * 8)];
      e.aiRun = rng() < 0.15;
      e.aiLeft = 1 + rng() * (e.aiRun ? 2 : 5);
    }
  }
  return { dir: e.aiDir, run: e.aiRun };
}

// playerInput: { dir: [dx, dz] | null, run: boolean }
// 戻り値はこのティックで起きた出来事のリスト
export function step(world, playerInput, rng = Math.random, dt = TICK_SECONDS) {
  world.tickCount++;
  world.time += dt;
  const events = [];
  const report = (e, r) => {
    if (r.ok) {
      for (const t of r.pushed) events.push({ type: 'push', actor: e, target: t });
    } else {
      events.push({ type: 'block', actor: e, target: r.blocker, via: r.via, reason: r.reason });
    }
  };

  const p = world.player;
  if (p) updateCharacter(world, p, playerInput ?? { dir: null, run: false }, dt, rng, report);

  for (const e of [...world.entities.values()]) {
    if (e.kind !== 'npc') continue;
    if (p && Math.max(Math.abs(e.pos[0] - p.pos[0]), Math.abs(e.pos[2] - p.pos[2])) > SIM_RADIUS) continue;
    const before = events.length;
    updateCharacter(world, e, npcInput(e, rng, dt), dt, rng, report);
    // 何かにぶつかったら次は別の方向へ
    if (events.slice(before).some((ev) => ev.type === 'block')) e.aiLeft = 0;
  }
  // 葉の揺れは1ティックおき（1秒に12.5回）で十分
  if (p && world.tickCount % 2 === 0) updateWind(world, world.time, p.pos[0], p.pos[2], WIND_RADIUS);
  return events;
}

// ---- 地形とチャンクの中身 ---------------------------------------------------------

// 地面と水を塗る。地中のセルは地面が占有するが、外から見えるセル（地表と、隣より高い崖の側面）だけ色をつける。
function fillTerrain(world, c) {
  const S = CHUNK + 2;
  const hs = new Int32Array(S * S); // まわり1列も含めた高さ
  for (let z = -1; z <= CHUNK; z++) {
    for (let x = -1; x <= CHUNK; x++) {
      hs[(x + 1) + S * (z + 1)] = Math.min(HEIGHT - 1, world.heightAt(c.cx * CHUNK + x, c.cz * CHUNK + z));
    }
  }
  const W = world.waterLevel;
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const at = (dx, dz) => hs[(lx + 1 + dx) + S * (lz + 1 + dz)];
      const h = at(0, 0);
      const ns = [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)];
      const lowest = Math.min(...ns);
      const slope = Math.max(...ns.map((n) => Math.abs(n - h)));
      const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
      const col = lx + CHUNK * lz;
      c.height[col] = h;
      for (let y = 0; y < h; y++) {
        const i = cellIndex(lx, y, lz);
        c.owner[i] = GROUND_ID;
        if (y >= Math.min(lowest, h - 1)) c.color[i] = groundColor(world.seed, x, y, z, h, slope);
      }
      if (h < W) {
        c.water[col] = W;
        for (let y = h; y < W; y++) c.owner[cellIndex(lx, y, lz)] = WATER_ID;
        c.color[cellIndex(lx, W - 1, lz)] = waterColor(x, z, W - h) | WATER_FLAG;
      }
      c.top = Math.max(c.top, h, h < W ? W : 0);
    }
  }
}

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
  for (let y = 0; y < 7; y++) {
    for (let z = 0; z < 8; z++) {
      for (let x = 0; x < 8; x++) {
        const d = ((x - 3.5) / rx) ** 2 + ((y - 1) / ry) ** 2 + ((z - 3.5) / rz) ** 2;
        if (d <= 1) v.push([x, y, z, shade(0x8a8f98, 0.85 + rng() * 0.3)]);
      }
    }
  }
  return v;
}

// チャンクの中に物を置く。物はそのチャンクの内側に収まるように、地面の上に置く。
function generateChunk(world, c) {
  if (c.cx === 0 && c.cz === 0) return; // 出発地点は空けておく
  const rng = mulberry32(hash3(c.cx, c.cz, world.seed));
  const ox = c.cx * CHUNK;
  const oz = c.cz * CHUNK;
  const pick = (size) => [ox + Math.floor(rng() * (CHUNK - size + 1)), oz + Math.floor(rng() * (CHUNK - size + 1))];

  // 半分くらいのチャンクは何もない野原にする（木は trees.js が別に置く）
  const tries = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 1.6);
  for (let t = 0; t < tries; t++) {
    const r = rng();
    if (r < 0.3) {
      // 岩は地面に半分埋まる（地面と重なるセルは削る）
      const [x, z] = pick(8);
      const f = world.footprint(x, z, 8, 8);
      const voxels = rockVoxels(rng);
      if (f.wet) continue;
      const pos = [x, f.lo - 1, z];
      const free = voxels.filter(([vx, vy, vz]) => world.ownerAt(x + vx, pos[1] + vy, z + vz) === EMPTY);
      if (free.length) world.spawn({ kind: 'terrain', name: '岩', priority: PRIORITY.TERRAIN, pos, voxels: free });
    } else if (r < 0.75) {
      const [x, z] = pick(5);
      const f = world.footprint(x, z, 5, 5);
      if (f.wet) continue;
      const e = world.spawn({ kind: 'box', name: `木箱-${world.counts.crate + 1}`, priority: PRIORITY.BOX, needsSupport: true, pos: [x, f.hi, z], voxels: crateVoxels() });
      if (e) world.counts.crate++;
    } else if (r < 0.92) {
      const palette = PALETTES.npc[Math.floor(rng() * PALETTES.npc.length)];
      const yaw = Math.floor(rng() * 8) * (Math.PI / 4);
      // 森の中は木の枝で場所がふさがりやすいので、何か所か試す
      for (let k = 0; k < 4; k++) {
        const [x, z] = pick(HUMAN_SIZE[0]);
        const f = world.footprint(x, z, HUMAN_SIZE[0], HUMAN_SIZE[2]);
        if (f.wet) continue;
        const e = world.spawnHuman({
          kind: 'npc', name: `NPC-${world.counts.npc + 1}`, priority: PRIORITY.NPC,
          pos: [x, f.hi, z], palette, yaw,
        }, rng);
        if (e) {
          world.counts.npc++;
          break;
        }
      }
    }
  }
}

// 出発地点の近くの、水でない空いている場所にプレイヤーを置く
export function spawnPlayer(world) {
  const x0 = Math.floor((CHUNK - HUMAN_SIZE[0]) / 2);
  const z0 = Math.floor((CHUNK - HUMAN_SIZE[2]) / 2);
  for (let r = 0; r < 60 && !world.player; r++) {
    for (let dz = -r; dz <= r && !world.player; dz++) {
      for (let dx = -r; dx <= r && !world.player; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = x0 + dx * 4, z = z0 + dz * 4;
        const f = world.footprint(x, z, HUMAN_SIZE[0], HUMAN_SIZE[2]);
        if (f.wet) continue;
        world.player = world.spawnHuman({
          kind: 'player', name: 'プレイヤー', priority: PRIORITY.PLAYER,
          pos: [x, f.hi, z], palette: PALETTES.player, yaw: 0,
        });
      }
    }
  }
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
