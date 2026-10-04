import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PRIORITY, GROUND_ID, EMPTY, step, spawnPlayer, ensureAround } from '../src/world.js';
import { HUMAN_SIZE, PALETTES, createPose, rasterizeHuman } from '../src/humanoid.js';
import { WALK_SPEED, RUN_SPEED } from '../src/character.js';

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
    expected += e.colors.length;
  }
  let owned = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o !== EMPTY && o !== GROUND_ID) owned++;
  assert.equal(owned, expected);
}

const walkInput = (dx, dz, run = false) => ({ dir: [dx, dz], run });
const idle = { dir: null, run: false };

// ---- 押し出し ---------------------------------------------------------------

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

// ---- 人型の模型 -------------------------------------------------------------

const [SX, SY, SZ] = HUMAN_SIZE;
const at = (g, x, y, z) => g[x + SX * (z + SZ * y)];
const lit = (g) => g.reduce((n, c) => n + (c !== 0), 0);

test('人型: 立ち姿は左右対称で、頭・目・靴がある', () => {
  const P = PALETTES.player;
  const g = rasterizeHuman(P, createPose());
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) assert.equal(at(g, x, y, z) !== 0, at(g, SX - 1 - x, y, z) !== 0);
    }
  }
  const colors = new Set(g);
  for (const c of [P.skin, P.hair, P.eyes, P.shirt, P.pants, P.shoes]) assert.ok(colors.has(c));
  // 足は地面に着き、頭は直方体の上の方にある
  assert.ok([...Array(SX * SZ).keys()].some((i) => g[i] === P.shoes));
  assert.ok(g.slice(SX * SZ * (SY - 2)).some((c) => c === P.hair));
});

test('人型: 90°回すと形もそのまま90°回る', () => {
  const P = PALETTES.player;
  const pose = { ...createPose(), walk: 1, phase: 0.3 };
  const a = rasterizeHuman(P, pose);
  const b = rasterizeHuman(P, { ...pose, yaw: Math.PI / 2 });
  let same = 0;
  let total = 0;
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        if (!at(a, x, y, z)) continue;
        total++;
        // +z 向き → +x 向き: (x, z) は (z, 8 - x) へ
        if (at(b, z, y, SX - 1 - x)) same++;
      }
    }
  }
  assert.ok(same / total > 0.97, `${same}/${total}`);
});

test('人型: 歩行周期のどこでも片足は地面に着いている（歩き）', () => {
  const P = PALETTES.player;
  for (let i = 0; i < 16; i++) {
    const g = rasterizeHuman(P, { ...createPose(), walk: 1, phase: i / 16 });
    assert.ok(g.slice(0, SX * SZ).some((c) => c === P.shoes), `phase ${i}/16`);
  }
});

test('人型: 歩く・走る・押すで形が変わる', () => {
  const P = PALETTES.player;
  const key = (pose) => rasterizeHuman(P, { ...createPose(), ...pose }).join();
  const shapes = new Set([key({}), key({ walk: 1, phase: 0.25 }), key({ walk: 1, run: 1, phase: 0.25 }), key({ push: 1 })]);
  assert.equal(shapes.size, 4);
  assert.ok(lit(rasterizeHuman(P, createPose())) > 60);
});

// ---- キャラの動き -------------------------------------------------------------

test('歩き出しは加速し、止まると減速して立ち姿に戻る', () => {
  const w = flat();
  const p = spawnPlayer(w);
  const x0 = p.pos[0];
  step(w, walkInput(1, 0));
  assert.ok(p.speed > 0 && p.speed < WALK_SPEED);
  for (let i = 0; i < 25; i++) step(w, walkInput(1, 0));
  assert.equal(p.speed, WALK_SPEED);
  const walked = p.pos[0] - x0;
  assert.ok(walked > 5 && walked < 10, `walked ${walked}`);
  for (let i = 0; i < 25; i++) step(w, idle);
  assert.equal(p.speed, 0);
  assert.ok(p.pose.walk < 0.01);
  assertConsistent(w);
});

test('走ると歩きより速い', () => {
  const dist = (run) => {
    const w = flat();
    const p = spawnPlayer(w);
    const x0 = p.pos[0];
    for (let i = 0; i < 50; i++) step(w, walkInput(1, 0, run));
    return p.pos[0] - x0;
  };
  const walk = dist(false);
  const run = dist(true);
  assert.ok(run > walk * 1.8, `walk ${walk} run ${run}`);
  assert.ok(RUN_SPEED > WALK_SPEED);
});

test('向きはすぐには変わらず、少しずつ回る', () => {
  const w = flat();
  const p = spawnPlayer(w);
  step(w, walkInput(0, -1)); // 真後ろへ
  assert.ok(Math.abs(p.pose.yaw) > 0.1 && Math.abs(p.pose.yaw) < Math.PI - 0.1);
  for (let i = 0; i < 20; i++) step(w, walkInput(0, -1));
  assert.ok(Math.abs(Math.abs(p.pose.yaw) - Math.PI) < 1e-6);
});

test('斜めに歩くと x と z の両方に進む', () => {
  const w = flat();
  const p = spawnPlayer(w);
  const [x0, , z0] = p.pos;
  for (let i = 0; i < 50; i++) step(w, walkInput(1, 1));
  const dx = p.pos[0] - x0;
  const dz = p.pos[2] - z0;
  assert.ok(dx > 4 && Math.abs(dx - dz) <= 1, `dx ${dx} dz ${dz}`);
  assertConsistent(w);
});

test('木箱を押すときは押す姿勢になり、遅くなる', () => {
  const w = flat();
  const p = spawnPlayer(w);
  w.spawn({ kind: 'box', name: '木箱', priority: PRIORITY.BOX, pos: [p.pos[0] + 10, 1, p.pos[2] + 2], voxels: [[0, 0, 0, 1], [0, 1, 0, 1]] });
  for (let i = 0; i < 40; i++) step(w, walkInput(1, 0));
  assert.ok(p.pose.push > 0.5);
  assert.ok(p.speed <= 4);
  assertConsistent(w);
});

test('立ち止まっていると、まばたきして周りを見る', () => {
  const w = flat();
  const p = spawnPlayer(w);
  let blinked = false;
  let looked = false;
  let seed = 1;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 400; i++) {
    step(w, idle, rng);
    blinked ||= p.pose.blink;
    looked ||= Math.abs(p.pose.headYaw) > 0.2;
  }
  assert.ok(blinked && looked);
  assertConsistent(w);
});

// ---- 世界 --------------------------------------------------------------------

test('同じシードなら同じ世界ができる', () => {
  const a = new World({ seed: 7 });
  const b = new World({ seed: 7 });
  ensureAround(a, 0, 0, 3);
  ensureAround(b, 0, 0, 3);
  for (const [key, c] of a.chunks) assert.deepEqual(b.chunks.get(key).owner, c.owner);
});

test('広い世界を長く歩き回っても重なりは起きない', () => {
  const w = new World({ seed: 3 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 3);
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]];
  let dir = dirs[0];
  for (let t = 0; t < 1500; t++) {
    if (rng() < 0.03) dir = dirs[Math.floor(rng() * dirs.length)];
    step(w, rng() < 0.1 ? idle : { dir, run: rng() < 0.3 }, rng);
    if (t % 50 === 0) ensureAround(w, p.pos[0], p.pos[2], 3);
  }
  assert.ok(w.counts.npc > 0 && w.counts.crate > 0);
  assertConsistent(w);
});

test('動かせない物にぶつかったら足踏みせずに立ち止まる', () => {
  const w = flat();
  const p = spawnPlayer(w);
  w.spawn({ kind: 'terrain', name: '岩', priority: PRIORITY.TERRAIN, pos: [p.pos[0] + 12, 1, p.pos[2] + 3], voxels: [[0, 0, 0, 1], [0, 1, 0, 1]] });
  for (let i = 0; i < 40; i++) step(w, walkInput(1, 0));
  let maxWalk = 0;
  for (let i = 0; i < 8; i++) {
    step(w, walkInput(1, 0));
    maxWalk = Math.max(maxWalk, p.pose.walk);
  }
  assert.ok(maxWalk < 0.5, `walk ${maxWalk}`);
  assert.equal(p.pose.push, 0);
});
