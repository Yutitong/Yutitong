// ショットガン: 散弾を扇形に撃つ
//
// - F で撃つ（1 発ごとに 0.6 秒。弾は無限）。9 粒の散弾が前へ扇形に広がって飛ぶ。届くのは 25m（167 ボクセル）まで
// - 黄色い球体が前の方（左右 26° 以内）にいれば、そちらへ向けて撃つ（上下も合わせる）
// - 近いほど大きくえぐれる。正八面体のときだけ、当たった所が欠けたまま戻らない（monster.js の hit）
// - 散弾は木や地面に当たると止まる（何も壊さない）
// - 弾の通り道は一瞬だけ光の筋として見える（いつでも場所をゆずる）

import { WATER_ID, FALL_ID } from './ids.js';
import { redrawBody } from './body.js';
import { CHUNK, HEIGHT, LAYER, chunkKeyAt } from './grid.js';
import { mulberry32 } from './rng.js';

export const SHOT_RANGE = 167; // ボクセル（25m）
export const PELLETS = 9;
const SPREAD = 0.15; // 扇の広がり（左右の半分。ラジアン）
const ASSIST = 0.45; // この角度以内に球体がいれば、そちらへ向けて撃つ
const TRACE_TIME = 0.1; // 光の筋が見えている時間（秒）

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// 作られているチャンクだけを見る（遠くへ飛ぶ弾がチャンクを作り始めないように）。作られていない所は空とみなす
function ownerLoaded(world, x, y, z) {
  if (y < 0 || y >= HEIGHT) return -1;
  const c = world.chunks.get(chunkKeyAt(x, z));
  if (!c) return 0;
  if (y < c.base) return 1;
  if (y >= c.base + c.owner.length / LAYER) return 0;
  return c.owner[c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
}

// 銃口の位置（体の前、胸の高さ）
export function muzzleOf(e) {
  const yaw = e.pose.yaw;
  return [e.pos[0] + 4.5 + Math.sin(yaw) * 9.5, e.pos[1] + 10.5, e.pos[2] + 4.5 + Math.cos(yaw) * 9.5];
}

// 撃つ。戻り値は出来事 { type: 'shoot', actor, target, result: 'dent' | 'chip' | 'killed' | 'blocked' | 'miss', hits }
export function shoot(world, e) {
  const ev = { type: 'shoot', actor: e, target: null, result: 'miss', hits: 0 };
  const rng = mulberry32(world.tickCount * 7919 + 13);
  const muzzle = muzzleOf(e);
  let yaw = e.pose.yaw, pitch = 0;
  const mon = world.monster;
  if (mon && !mon.dead) {
    const dx = mon.c[0] - muzzle[0], dy = mon.c[1] - muzzle[1], dz = mon.c[2] - muzzle[2];
    const h = Math.hypot(dx, dz);
    const a = Math.atan2(dx, dz);
    if (h < SHOT_RANGE + mon.R && Math.abs(wrap(a - yaw)) < ASSIST) {
      yaw = a;
      pitch = Math.atan2(dy, h);
    }
  }
  const trails = [];
  const results = new Set();
  let blocked = false;
  for (let k = 0; k < PELLETS; k++) {
    const da = ((k / (PELLETS - 1)) - 0.5) * 2 * SPREAD + (rng() - 0.5) * 0.05;
    const dp = (rng() - 0.5) * 0.12;
    const cp = Math.cos(pitch + dp);
    const dir = [Math.sin(yaw + da) * cp, Math.sin(pitch + dp), Math.cos(yaw + da) * cp];
    let end = SHOT_RANGE;
    for (let s = 0; s <= SHOT_RANGE; s += 0.5) {
      const p = [muzzle[0] + dir[0] * s, muzzle[1] + dir[1] * s, muzzle[2] + dir[2] * s];
      const o = ownerLoaded(world, Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
      if (o === -1) break; // 空の上・地の底
      if (o === 0 || o === e.id || o === e.toolId || o === WATER_ID || o === FALL_ID) continue;
      if (o > 0 && world.entities.get(o)?.yields) continue;
      end = s;
      const m = world.monster;
      if (m && !m.dead && o === m.id) {
        const power = Math.max(0.08, 1 - s / SHOT_RANGE) ** 1.3;
        const r = m.hit(p, power);
        if (r) {
          results.add(r);
          ev.hits++;
          ev.target = m.entity;
        }
      } else {
        blocked = true;
      }
      break;
    }
    trails.push([muzzle, dir, end]);
  }
  if (results.has('killed')) ev.result = 'killed';
  else if (results.has('chip')) ev.result = 'chip';
  else if (results.has('dent')) ev.result = 'dent';
  else if (blocked) ev.result = 'blocked';
  drawTrails(world, trails);
  return ev;
}

// 弾の通り道を光の筋として描く（空いているセルにだけ。少しあとに消える）
function drawTrails(world, trails) {
  const s = shotsOf(world);
  const { cells } = redrawBody(world, s.id, s.cells, (emit) => {
    for (const [o, dir, end] of trails) {
      for (let d = 1; d < end; d += d < 12 ? 1 : 2.5) {
        const color = d < 3 ? 0xfff8d8 : d < 30 ? 0xffe28a : 0xf0c060;
        emit(Math.floor(o[0] + dir[0] * d), Math.floor(o[1] + dir[1] * d), Math.floor(o[2] + dir[2] * d), color);
      }
    }
    // 銃口の火
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) emit(Math.floor(trails[0][0][0]) + dx, Math.floor(trails[0][0][1]) + dy, Math.floor(trails[0][0][2]), 0xfff1a8);
    }
  }, () => null);
  s.cells = cells;
  s.left = TRACE_TIME;
}

function shotsOf(world) {
  if (!world.shots) {
    const id = world.nextId++;
    world.entities.set(id, {
      id, kind: 'shot', name: '散弾', priority: 0, yields: true, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    });
    world.shots = { id, cells: [], left: 0 };
  }
  return world.shots;
}

// 光の筋を消す（毎ティック）
export function updateShots(world, dt) {
  const s = world.shots;
  if (!s || s.left <= 0) return;
  s.left -= dt;
  if (s.left > 0) return;
  redrawBody(world, s.id, s.cells, () => {}, () => null);
  s.cells = [];
}
