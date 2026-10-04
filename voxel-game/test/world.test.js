import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PRIORITY, buildDemo, step } from '../src/world.js';

const X = [1, 0, 0];

function flat() {
  const w = new World(8, 3, 3);
  // 床だけの地形
  const floor = [];
  for (let x = 0; x < 8; x++) for (let z = 0; z < 3; z++) floor.push([x, 0, z, 1]);
  w.spawn({ kind: 'terrain', name: '床', priority: PRIORITY.TERRAIN, pos: [0, 0, 0], voxels: floor });
  return w;
}
const unit = (w, kind, priority, x) =>
  w.spawn({ kind, name: kind, priority, pos: [x, 1, 1], voxels: [[0, 0, 0, 2]] });
const wall = (w, x) => unit(w, 'terrain', PRIORITY.TERRAIN, x);

// どのボクセルも、持ち主の物体の形と一致しているか
function assertConsistent(w) {
  let owned = 0;
  for (const e of w.entities.values()) {
    for (const [x, y, z] of w.cellsOf(e)) assert.equal(w.ownerAt(x, y, z), e.id);
    owned += e.voxels.length;
  }
  assert.equal(w.cells.filter((c) => c !== 0).length, owned);
}

test('プレイヤーは箱を押し出す', () => {
  const w = flat();
  const p = unit(w, 'player', PRIORITY.PLAYER, 1);
  const b = unit(w, 'box', PRIORITY.BOX, 2);
  const r = w.tryMove(p.id, X);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pushed, [b]);
  assert.deepEqual(p.pos, [2, 1, 1]);
  assert.deepEqual(b.pos, [3, 1, 1]);
  assertConsistent(w);
});

test('箱の先が壁なら押せず、誰も動かない', () => {
  const w = flat();
  const p = unit(w, 'player', PRIORITY.PLAYER, 1);
  const b = unit(w, 'box', PRIORITY.BOX, 2);
  wall(w, 3);
  const r = w.tryMove(p.id, X);
  assert.equal(r.ok, false);
  assert.equal(r.via, b);
  assert.deepEqual(p.pos, [1, 1, 1]);
  assert.deepEqual(b.pos, [2, 1, 1]);
  assertConsistent(w);
});

test('NPCはプレイヤーを押せない', () => {
  const w = flat();
  const n = unit(w, 'npc', PRIORITY.NPC, 1);
  const p = unit(w, 'player', PRIORITY.PLAYER, 2);
  const r = w.tryMove(n.id, X);
  assert.equal(r.ok, false);
  assert.equal(r.blocker, p);
  assert.equal(r.reason, 'priority');
});

test('同じ優先度同士は押し合わずに止まる', () => {
  const w = flat();
  const a = unit(w, 'npc', PRIORITY.NPC, 1);
  unit(w, 'npc', PRIORITY.NPC, 2);
  assert.equal(w.tryMove(a.id, X).ok, false);
});

test('連鎖押し出しはしない（押し出しは1段まで）', () => {
  const w = flat();
  const p = unit(w, 'player', PRIORITY.PLAYER, 1);
  unit(w, 'box', PRIORITY.BOX, 2);
  unit(w, 'box', PRIORITY.BOX, 3);
  const r = w.tryMove(p.id, X);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'depth');
  assertConsistent(w);
});

test('複数ボクセルの物体もまとめて押し出される', () => {
  const w = flat();
  const p = w.spawn({
    kind: 'player', name: 'p', priority: PRIORITY.PLAYER, pos: [1, 1, 1],
    voxels: [[0, 0, 0, 1], [0, 1, 0, 1]],
  });
  const big = w.spawn({
    kind: 'box', name: 'big', priority: PRIORITY.BOX, pos: [2, 1, 0],
    voxels: [[0, 0, 0, 3], [1, 0, 0, 3], [0, 0, 1, 3], [1, 0, 1, 3]],
  });
  assert.equal(w.tryMove(p.id, X).ok, true);
  assert.deepEqual(big.pos, [3, 1, 0]);
  assertConsistent(w);
});

test('デモ世界を長く回しても重なりは起きない', () => {
  const w = new World(20, 6, 20);
  buildDemo(w);
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], null];
  for (let t = 0; t < 2000; t++) {
    step(w, dirs[Math.floor(rng() * dirs.length)], rng);
  }
  assertConsistent(w);
});
