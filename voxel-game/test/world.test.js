import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PRIORITY, GROUND_ID, WATER_ID, WATER_FLAG, EMPTY, step, spawnPlayer, ensureAround } from '../src/world.js';
import { HUMAN_SIZE, PALETTES, createPose, rasterizeHuman } from '../src/humanoid.js';
import { WALK_SPEED, RUN_SPEED } from '../src/character.js';
import { CHUNK, chunkKeyAt, cellIndex } from '../src/grid.js';

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
      const shown = w.colorAt(x, y, z);
      // 水面の高さにある消灯セルは、水面の色を見せる
      if (!(color === 0 && shown & WATER_FLAG)) assert.equal(shown, color);
    }
    expected += e.colors.length;
  }
  // 木は形が決まっていて動かないので別に調べる（treeCellsConsistent）
  const trees = new Set([...w.entities.values()].filter((e) => e.tree).map((e) => e.id));
  let owned = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o !== EMPTY && o !== GROUND_ID && o !== WATER_ID && !trees.has(o)) owned++;
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
  const w = new World({ seed: 4 }); // 出発地点の近くに NPC と木箱がいるシード
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

// ---- 木 ----------------------------------------------------------------------

// 木のセルは、作られたチャンクの中では木自身か、先に塗られた別の木のもの
function treeCells(w, tree) {
  let owned = 0;
  let lit = 0;
  for (let i = 0; i < tree.xs.length; i++) {
    const c = w.chunks.get(chunkKeyAt(tree.xs[i], tree.zs[i]));
    if (!c) continue;
    const ci = cellIndex(tree.xs[i] - c.cx * CHUNK, tree.ys[i], tree.zs[i] - c.cz * CHUNK);
    if (c.owner[ci] !== tree.id) continue;
    owned++;
    assert.equal(c.color[ci], tree.color[i]);
    if (c.color[ci]) lit++;
  }
  return { owned, lit };
}

test('木: 大きさも種類もいろいろで、大木は 8m を超える', () => {
  const w = new World({ seed: 5 });
  ensureAround(w, 0, 0, 8);
  const trees = [...w.trees.values()];
  assert.ok(trees.length > 20);
  const species = new Set(trees.map((t) => t.spec.species));
  assert.ok(species.size >= 3, [...species].join());
  const heights = trees.map((t) => t.height);
  assert.ok(Math.max(...heights) > 55 && Math.min(...heights) < 40, heights.join());
  for (const t of trees) {
    // 幹は地面から立っている
    let ground = false;
    for (let i = 0; i < t.xs.length; i++) if (t.ys[i] === t.spec.y && t.clumpOf[i] === -1) ground = true;
    assert.ok(ground);
  }
});

test('木: チャンクを作る順番が違っても同じ森になる', () => {
  const order = [];
  for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) order.push([cx, cz]);
  const a = new World({ seed: 9 });
  const b = new World({ seed: 9 });
  for (const [cx, cz] of order) a.chunkAt(cx, cz);
  for (const [cx, cz] of [...order].reverse()) b.chunkAt(cx, cz);
  const who = (w, id) => {
    const e = w.entities.get(id);
    return e ? `${e.name.replace(/-\d+$/, '')}@${e.pos}` : 'empty'; // 木箱などの通し番号は作る順で変わる
  };
  for (const [cx, cz] of order) {
    const ca = a.chunkAt(cx, cz);
    const cb = b.chunkAt(cx, cz);
    assert.deepEqual(cb.color, ca.color);
    for (let i = 0; i < ca.owner.length; i += 7) assert.equal(who(b, cb.owner[i]), who(a, ca.owner[i]));
  }
});

test('木: 風で葉の色（点灯）は変わるが、占有するセルは変わらない', () => {
  const w = new World({ seed: 5 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 3);
  const treeIds = () => new Set([...w.trees.values()].map((t) => t.id));
  const treeOwners = () => [...w.chunks.values()].map((c) => {
    const ids = treeIds();
    return Array.from(c.owner, (o) => (ids.has(o) ? o : 0));
  });
  const ownersBefore = treeOwners();
  const before = [...w.trees.values()].map((t) => treeCells(w, t));
  let shifted = 0;
  for (let i = 0; i < 200; i++) {
    step(w, idle);
    for (const t of w.trees.values()) for (const cl of t.clumps) if (cl.ox || cl.oz) shifted++;
  }
  assert.ok(shifted > 0);
  treeOwners().slice(0, ownersBefore.length).forEach((o, k) => assert.deepEqual(o, ownersBefore[k]));
  const after = [...w.trees.values()].map((t) => treeCells(w, t));
  after.forEach((a, k) => assert.equal(a.owned, before[k].owned));
});

test('木の幹にはぶつかって止まる', () => {
  const w = new World({ seed: 5 });
  ensureAround(w, 0, 0, 6);
  const tree = [...w.trees.values()].find((t) => t.spec.scale > 0.8);
  const { x, z } = tree.spec;
  const y = tree.spec.y + 3;
  assert.equal(w.ownerAt(x, y, z), tree.id);
  // 幹に向かって進む小さな物は、木に止められる
  let start = x - 1;
  while (w.ownerAt(start, y, z) !== EMPTY) start--;
  const b = w.spawn({ kind: 'player', name: 'p', priority: PRIORITY.PLAYER, pos: [start, y, z], voxels: [[0, 0, 0, 1]] });
  const r = w.tryMove(b.id, [1, 0, 0]);
  assert.equal(r.ok, false);
  assert.equal(r.blocker.id, tree.id);
});

// ---- 地形 --------------------------------------------------------------------

// x がある値を超えると地面の高さが変わる世界
const steps = (heights, waterLevel = 0) => new World({
  generate: false,
  waterLevel,
  heightAt: (x) => {
    for (const [from, h] of [...heights].reverse()) if (x >= from) return h;
    return heights[0][1];
  },
});

test('地形: 地面の下はすべて地面、水面より下で地面より上は水', () => {
  const w = new World({ seed: 5 });
  ensureAround(w, 0, 0, 4);
  let water = 0;
  for (const c of w.chunks.values()) {
    for (let col = 0; col < 256; col++) {
      const lx = col % 16, lz = Math.floor(col / 16);
      const h = c.height[col];
      for (let y = 0; y < h; y++) assert.equal(c.owner[cellIndex(lx, y, lz)], GROUND_ID);
      if (c.water[col]) {
        water++;
        assert.ok(h < c.water[col]);
        assert.equal(c.owner[cellIndex(lx, c.water[col] - 1, lz)] !== EMPTY, true);
      }
    }
  }
  assert.ok(water > 0, '池か川がある');
});

test('地形: 起伏があり、ほとんどの場所は歩いて登れる傾き', () => {
  let min = Infinity, max = -Infinity, steep = 0, n = 0;
  const w = new World({ seed: 20261004 });
  for (let x = -400; x < 400; x += 5) {
    for (let z = -400; z < 400; z += 5) {
      const h = w.heightAt(x, z);
      min = Math.min(min, h);
      max = Math.max(max, h);
      if (Math.abs(w.heightAt(x + 1, z) - h) > 2) steep++;
      n++;
    }
  }
  assert.ok(max - min > 25, `高低差 ${max - min}`);
  assert.ok(steep / n < 0.02, `急な所 ${steep / n}`);
});

test('2段までの段差は歩いて登り、3段以上は登れない', () => {
  const up2 = steps([[0, 1], [16, 3]]);
  const p = spawnPlayer(up2);
  for (let i = 0; i < 60; i++) step(up2, walkInput(1, 0));
  assert.equal(p.pos[1], 3);
  assert.ok(p.pos[0] >= 16);
  assertConsistent(up2);

  const up3 = steps([[0, 1], [16, 4]]);
  const q = spawnPlayer(up3);
  for (let i = 0; i < 60; i++) step(up3, walkInput(1, 0));
  assert.equal(q.pos[1], 1);
  assert.ok(q.pos[0] + 8 < 16);
});

test('高い所から歩き出すと落ちて着地し、膝を曲げる', () => {
  const w = steps([[0, 12], [16, 1]]);
  const p = spawnPlayer(w);
  assert.equal(p.pos[1], 12);
  let crouched = 0;
  for (let i = 0; i < 60; i++) {
    step(w, walkInput(1, 0));
    crouched = Math.max(crouched, p.pose.crouch);
  }
  assert.equal(p.pos[1], 1);
  assert.ok(crouched > 0.5);
  assertConsistent(w);
});

test('浅い水は歩いて渡れ、通ったあとは水が戻る。胸より深い水には入らない', () => {
  // 岸はゆるやかに下がって水深3になり、また上がる。水面の高さ 6
  const w = steps([[0, 6], [14, 5], [16, 4], [18, 3], [36, 4], [38, 5], [40, 6]], 6);
  const p = spawnPlayer(w);
  for (let i = 0; i < 120; i++) step(w, walkInput(1, 0));
  assert.ok(p.pos[0] >= 40, `x ${p.pos[0]}`);
  for (let x = 18; x < 36; x++) {
    for (let y = 3; y < 6; y++) assert.equal(w.ownerAt(x, y, 4), WATER_ID);
  }
  assertConsistent(w);

  const deep = steps([[0, 14], [16, 2]], 14); // 水深 12
  const q = spawnPlayer(deep);
  const events = [];
  for (let i = 0; i < 60; i++) events.push(...step(deep, walkInput(1, 0)));
  assert.ok(q.pos[0] + 4 < 16); // 体の中心は岸に残る
  assert.equal(q.pos[1], 14);
  assert.ok(events.some((ev) => ev.type === 'block' && ev.target?.name === '深い水'));
});

test('木箱は足場のない所（水の上）へは押せない', () => {
  const w = steps([[0, 6], [20, 3]], 6);
  const p = spawnPlayer(w);
  const box = w.spawn({ kind: 'box', name: '木箱', priority: PRIORITY.BOX, needsSupport: true, pos: [p.pos[0] + 11, 6, p.pos[2] + 2], voxels: [[0, 0, 0, 1], [0, 1, 0, 1]] });
  for (let i = 0; i < 80; i++) step(w, walkInput(1, 0));
  assert.equal(box.pos[0], 19); // 岸の端で止まる（水の上に浮かない）
  assertConsistent(w);
});

// ---- 龍 ----------------------------------------------------------------------

test('龍: 全長 300 ボクセル以上で、木や地面の上を飛び、ほかの物のセルを上書きしない', async () => {
  const { spawnDragon } = await import('../src/dragon.js');
  const w = new World({ seed: 20261004 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 4);
  const d = spawnDragon(w, p.pos);
  // 龍以外の持ち主を覚えておく
  const snapshot = () => new Map([...w.chunks].map(([k, c]) => [k, Array.from(c.owner, (o) => (o === d.id ? 0 : o))]));
  const before = snapshot();
  let minGap = Infinity;
  for (let i = 0; i < 120; i++) {
    d.update(0.08, p.pos);
    minGap = Math.min(minGap, d.head[1] - d.clearance(d.head[0], d.head[2]));
  }
  // ほかの物のセルは1つも変わっていない（龍が空けたセルは空き）
  for (const [k, owners] of before) {
    const now = w.chunks.get(k).owner;
    owners.forEach((o, i) => {
      if (o !== 0) assert.equal(now[i], o);
    });
  }
  // 龍のセルの数と、世界の中の龍のセルの数が一致する
  let owned = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o === d.id) owned++;
  assert.equal(owned, d.size);
  assert.ok(d.size > 15000, `cells ${d.size}`);
  // 体の端から端まで
  const pts = d.spine();
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(...[0, 1, 2].map((a) => pts[i].c[a] - pts[i - 1].c[a]));
  assert.ok(len > 300, `length ${len}`);
  assert.ok(minGap >= 9, `gap ${minGap}`);
});
