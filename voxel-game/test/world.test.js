import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PRIORITY, GROUND_ID, EMPTY, step, spawnPlayer, ensureAround } from '../src/world.js';
import { HUMAN_SIZE, PALETTES, WALK_CYCLE, humanoidVoxels } from '../src/humanoid.js';

const X = [1, 0, 0];

const flat = () => new World({ generate: false });
const block = (w, kind, priority, x, size = 1) => {
  const voxels = [];
  for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) for (let dx = 0; dx < size; dx++) voxels.push([dx, y, z, 0x123456]);
  return w.spawn({ kind, name: kind, priority, pos: [x, 1, 0], voxels });
};

// どのボクセルも、持ち主の物体の形と一致しているか
function assertConsistent(w) {
  let expected = 0;
  for (const e of w.entities.values()) {
    if (e.id === GROUND_ID) continue;
    for (const [x, y, z, color] of w.cellsOf(e)) {
      assert.equal(w.ownerAt(x, y, z), e.id);
      assert.equal(w.colorAt(x, y, z), color);
    }
    expected += e.voxels.length;
  }
  let owned = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o !== EMPTY && o !== GROUND_ID) owned++;
  assert.equal(owned, expected);
}

test('プレイヤーは箱を押し出す', () => {
  const w = flat();
  const p = block(w, 'player', PRIORITY.PLAYER, 1);
  const b = block(w, 'box', PRIORITY.BOX, 2);
  const r = w.tryMove(p.id, X);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pushed, [b]);
  assert.deepEqual(b.pos, [3, 1, 0]);
  assertConsistent(w);
});

test('箱の先が動かない物なら押せず、誰も動かない', () => {
  const w = flat();
  const p = block(w, 'player', PRIORITY.PLAYER, 1);
  const b = block(w, 'box', PRIORITY.BOX, 2);
  block(w, 'terrain', PRIORITY.TERRAIN, 3);
  const r = w.tryMove(p.id, X);
  assert.equal(r.ok, false);
  assert.equal(r.via, b);
  assert.deepEqual(p.pos, [1, 1, 0]);
  assertConsistent(w);
});

test('NPCはプレイヤーを押せない / 同じ優先度同士は止まる', () => {
  const w = flat();
  const n = block(w, 'npc', PRIORITY.NPC, 1);
  const p = block(w, 'player', PRIORITY.PLAYER, 2);
  assert.equal(w.tryMove(n.id, X).blocker, p);
  const w2 = flat();
  const a = block(w2, 'npc', PRIORITY.NPC, 1);
  block(w2, 'npc', PRIORITY.NPC, 2);
  assert.equal(w2.tryMove(a.id, X).ok, false);
});

test('連鎖押し出しはしない（押し出しは1段まで）', () => {
  const w = flat();
  const p = block(w, 'player', PRIORITY.PLAYER, 1);
  block(w, 'box', PRIORITY.BOX, 2);
  block(w, 'box', PRIORITY.BOX, 3);
  assert.equal(w.tryMove(p.id, X).reason, 'depth');
});

test('チャンクの境目をまたいで大きな物を押せる', () => {
  const w = flat();
  const p = block(w, 'player', PRIORITY.PLAYER, 10, 3);
  const b = block(w, 'box', PRIORITY.BOX, 13, 5);
  for (let i = 0; i < 6; i++) assert.equal(w.tryMove(p.id, X).ok, true);
  assert.deepEqual(b.pos, [19, 1, 0]); // チャンク 0 と 1 にまたがる
  assertConsistent(w);
});

test('人型: どのコマ・向きでも 9×14×9 の直方体をちょうど埋める', () => {
  const [sx, sy, sz] = HUMAN_SIZE;
  for (let facing = 0; facing < 4; facing++) {
    for (let frame = 0; frame < WALK_CYCLE.length; frame++) {
      const v = humanoidVoxels(PALETTES.player, facing, frame);
      const keys = new Set(v.map(([x, y, z]) => `${x},${y},${z}`));
      assert.equal(keys.size, sx * sy * sz);
      for (const [x, y, z] of v) assert.ok(x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz);
    }
  }
});

test('人型: 歩くコマで脚の形が変わり、立ち姿は左右対称', () => {
  const lit = (frame) => humanoidVoxels(PALETTES.player, 0, frame).filter((v) => v[3] !== 0).map((v) => v.join()).sort().join('|');
  assert.notEqual(lit(0), lit(2));
  const stand = humanoidVoxels(PALETTES.player, 0, 0).filter((v) => v[3] !== 0 && v[1] < 10);
  const mirrored = new Set(stand.map(([x, y, z]) => `${8 - x},${y},${z}`));
  for (const [x, y, z] of stand) assert.ok(mirrored.has(`${x},${y},${z}`));
});

test('歩くとコマが進み、立ち止まると立ち姿に戻る', () => {
  const w = flat();
  const p = spawnPlayer(w);
  step(w, X);
  step(w, X);
  assert.equal(p.frame, 2);
  assert.equal(p.facing, 1);
  step(w, null);
  assert.equal(p.frame, 0);
  assertConsistent(w);
});

test('同じシードなら同じ世界ができる', () => {
  const a = new World({ seed: 7 });
  const b = new World({ seed: 7 });
  ensureAround(a, 0, 0, 3);
  ensureAround(b, 0, 0, 3);
  for (const [key, c] of a.chunks) assert.deepEqual(b.chunks.get(key).color, c.color);
});

test('広い世界を長く歩き回っても重なりは起きない', () => {
  const w = new World({ seed: 3 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 3);
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  let dir = dirs[0];
  for (let t = 0; t < 1500; t++) {
    if (rng() < 0.05) dir = dirs[Math.floor(rng() * 4)];
    step(w, rng() < 0.1 ? null : dir, rng);
    if (t % 50 === 0) ensureAround(w, p.pos[0], p.pos[2], 3);
  }
  assert.ok(w.counts.npc > 0 && w.counts.crate > 0);
  assertConsistent(w);
});
