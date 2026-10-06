import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PRIORITY, GROUND_ID, WATER_ID, ROCK_ID, PLANT_ID, SOIL_ID, WATER_FLAG, EMPTY, step, spawnPlayer, ensureAround } from '../src/world.js';
import { HUMAN_SIZE, PALETTES, createPose, rasterizeHuman, rasterizeTool, CHOP_IMPACT } from '../src/humanoid.js';
import { WALK_SPEED, RUN_SPEED, SPRINT_SPEED } from '../src/character.js';
import { CHUNK, chunkKeyAt } from '../src/grid.js';

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
  // 毎回形を描き直す物（龍・炎・斧・倒れていく木）は offsets を持たないので数えない
  const trees = new Set([...w.entities.values()].filter((e) => e.tree || !e.offsets.length).map((e) => e.id));
  let owned = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o > SOIL_ID && !trees.has(o)) owned++;
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

test('人型: 立ち姿は左右対称で、頭・目・靴がある（斧を持たない NPC）', () => {
  const P = PALETTES.npc[0];
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

test('人型: プレイヤーは右手に斧を持ち、振ると斧が前へ出る', () => {
  const P = PALETTES.player;
  const g = rasterizeHuman(P, createPose());
  assert.ok(g.includes(P.axe.handle) && g.includes(P.axe.blade));
  // 振り下ろした瞬間、はみ出した斧の刃は体の前（+z）にある
  const tool = rasterizeTool(P, { ...createPose(), swing: CHOP_IMPACT });
  const blade = tool.filter((c) => c[3] === P.axe.blade || c[3] === P.axe.edge);
  assert.ok(blade.length > 0);
  assert.ok(blade.every((c) => c[2] >= SZ - 1), blade.map((c) => c.join()).join(' '));
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
  assert.ok(walked > 8 && walked < 15, `walked ${walked}`);
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

test('歩き 2m/s・走り 5m/s。走り続けると全力疾走（8m/s）になり、1ティックに数歩進んでもすり抜けない', () => {
  const w = flat();
  const p = spawnPlayer(w);
  assert.ok(Math.abs(WALK_SPEED * 0.15 - 2) < 0.1 && Math.abs(RUN_SPEED * 0.15 - 5) < 0.1 && Math.abs(SPRINT_SPEED * 0.15 - 8) < 0.1);
  let top = 0;
  for (let i = 0; i < 20; i++) {
    step(w, walkInput(1, 0, true));
    top = Math.max(top, p.speed);
  }
  assert.ok(top <= RUN_SPEED + 1e-9, '走り出してすぐは全力疾走にならない');
  const x0 = p.pos[0];
  for (let i = 0; i < 50; i++) step(w, walkInput(1, 0, true));
  assert.equal(p.speed, SPRINT_SPEED);
  const per = (p.pos[0] - x0) / 50;
  assert.ok(per > 1.6, `1ティックに ${per} ボクセル`);
  assert.ok(p.pose.sprint > 0.8);
  assertConsistent(w);
  // 全力疾走で岩に向かっても、岩の手前で止まる
  const rock = w.spawn({ kind: 'terrain', name: '岩', priority: PRIORITY.TERRAIN, pos: [p.pos[0] + 40, 1, p.pos[2]], voxels: Array.from({ length: 9 * 16 }, (_, k) => [0, k % 16, Math.floor(k / 16), 1]) });
  for (let i = 0; i < 40; i++) step(w, walkInput(1, 0, true));
  assert.ok(p.pos[0] + 9 <= rock.pos[0], `x ${p.pos[0]} 岩 ${rock.pos[0]}`);
  assertConsistent(w);
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
  const w = new World({ seed: 4 }); // 出発地点の近くに NPC がいるシード
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
  assert.ok(w.counts.npc > 0);
  assert.ok(![...w.entities.values()].some((e) => e.kind === 'box'), '木箱はもう置かない');
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
    if (!c || tree.ys[i] < c.base) continue;
    const ci = c.index(tree.xs[i] - c.cx * CHUNK, tree.ys[i], tree.zs[i] - c.cz * CHUNK);
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
    return e ? `${e.name.replace(/-\d+$/, '')}@${e.pos}` : 'empty'; // NPC などの通し番号は作る順で変わる
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
      for (let y = 0; y < h; y++) assert.equal(w.ownerAt(c.cx * CHUNK + lx, y, c.cz * CHUNK + lz), GROUND_ID);
      if (c.water[col]) {
        water++;
        assert.ok(h < c.water[col]);
        assert.equal(c.owner[c.index(lx, c.water[col] - 1, lz)] !== EMPTY, true);
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

// ---- シャベル -------------------------------------------------------------------

test('シャベル: 持ち替えて掘ると地面を大きくえぐり、土を持つ。深く掘ると岩に当たる', () => {
  const w = new World({ seed: 20261004 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 3);
  step(w, { dir: null, run: false, tool: 'shovel' });
  assert.equal(p.tool, 'shovel');
  const yaw = p.pose.yaw;
  const fx = Math.floor(p.pos[0] + 4.5 + Math.sin(yaw) * 7.5), fz = Math.floor(p.pos[2] + 4.5 + Math.cos(yaw) * 7.5);
  const h0 = w.groundAt(fx, fz);
  const results = [];
  const amounts = [];
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 120; i++) {
      for (const e of step(w, { dir: null, run: false, chop: true })) {
        if (e.type !== 'dig') continue;
        results.push(e.result);
        amounts.push(e.amount);
      }
    }
    p.soil = 0; // 土を捨てて、また掘る
  }
  assert.ok(results.includes('dug'));
  assert.ok(amounts[0] >= 30, `1 回目に ${amounts[0]} ボクセル`);
  assert.ok(results.includes('rock'), '岩に当たる');
  const h1 = w.groundAt(fx, fz);
  assert.ok(h0 - h1 >= 5 && h0 - h1 <= 7, `穴の深さ ${h0 - h1}`);
  // 穴の底と壁は色がついている（地中の空洞が透けて見えない）
  assert.equal(w.ownerAt(fx, h1 - 1, fz), GROUND_ID);
  assert.ok(w.colorAt(fx, h1 - 1, fz) !== 0);
  for (let y = h1; y < h0; y++) {
    assert.equal(w.ownerAt(fx, y, fz), EMPTY);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (w.ownerAt(fx + dx, y, fz + dz) === GROUND_ID) assert.ok(w.colorAt(fx + dx, y, fz + dz) !== 0, '穴の壁');
    }
  }
  assertConsistent(w);
});

test('シャベル: 持っている土を前に盛る（水の中にも盛れる）。持っていなければ盛れない', () => {
  const w = steps([[0, 6], [16, 3]], 6); // x >= 16 は水深 3 の池
  const p = spawnPlayer(w);
  step(w, { dir: null, run: false, tool: 'shovel' });
  let ev = step(w, { dir: null, run: false, place: true });
  for (let i = 0; i < 30 && !ev.some((e) => e.type === 'place'); i++) ev = step(w, { dir: null, run: false });
  assert.equal(ev.find((e) => e.type === 'place').result, 'empty');
  // 池の方を向いて、岸まで歩く
  for (let i = 0; i < 80; i++) step(w, walkInput(1, 0));
  p.soil = 20;
  const placed = [];
  for (let i = 0; i < 60; i++) placed.push(...step(w, { dir: null, run: false, place: true }).filter((e) => e.type === 'place'));
  assert.ok(placed.some((e) => e.result === 'placed'));
  let soilInWater = 0;
  for (let x = 16; x < 90; x++) for (let z = 0; z < 16; z++) for (let y = 3; y < 6; y++) if (w.ownerAt(x, y, z) === SOIL_ID) soilInWater++;
  assert.ok(soilInWater > 0, '水の中に土を盛った');
  assert.ok(p.soil < 20);
  assertConsistent(w);
});

// ---- 山と川 --------------------------------------------------------------------

test('山: 出発地点から見える所に 40〜60m の山がある', async () => {
  const { Terrain, BASE } = await import('../src/terrain.js');
  const t = new Terrain(20261004);
  let top = 0;
  for (let x = 0; x < 1400; x += 8) for (let z = -1400; z < 400; z += 8) top = Math.max(top, t.height(x, z));
  const m = (top - BASE) * 0.15;
  assert.ok(m >= 40 && m <= 62, `山の高さ ${m.toFixed(1)}m`);
});

test('川: 山から下流へ水面が下がり続け、上流は狭く下流は広い。上流ほど大小の岩が多い', async () => {
  const { Terrain, WATER_LEVEL } = await import('../src/terrain.js');
  const t = new Terrain(20261004);
  t.prepare(0, -1);
  const rivers = t.cell(0, -1).rivers;
  assert.ok(rivers.length >= 3);
  let reachLowland = 0;
  const upRocks = [], downRocks = [];
  for (const r of rivers) {
    for (let i = 1; i < r.pts.length; i++) assert.ok(r.pts[i].S <= r.pts[i - 1].S, '水面は下流で上がらない');
    const first = r.pts[0], last = r.pts[r.pts.length - 1];
    assert.ok(first.w < last.w);
    if (last.S === WATER_LEVEL) reachLowland++;
    for (const k of r.rocks) {
      // 岩のいちばん近い川の点の上流度
      let best = null, bd = Infinity;
      for (const q of r.pts) {
        const d = (q.x - k.x) ** 2 + (q.z - k.z) ** 2;
        if (d < bd) [bd, best] = [d, q];
      }
      (best.f < 0.5 ? upRocks : downRocks).push(k.r);
    }
  }
  assert.ok(reachLowland >= 2, '平地まで流れ下る川がある');
  const all = [...upRocks, ...downRocks];
  assert.ok(Math.min(...all) < 2 && Math.max(...all) > 6, '岩の大きさはまちまち');
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(upRocks.length > downRocks.length && mean(upRocks) > mean(downRocks), '上流ほど岩が多く大きい');
});

test('川: 山の中の水面は平地より高く、段の所は滝のしぶきが見える。岩が水から頭を出す', async () => {
  const { WATER_LEVEL } = await import('../src/terrain.js');
  const w = new World({ seed: 20261004 });
  w.terrain.prepare(0, -1);
  const pts = w.terrain.cell(0, -1).rivers[0].pts;
  // 上流の、段（滝）のある所
  const k = pts.findIndex((q, i) => i > 4 && q.f < 0.5 && pts[i - 1].S - q.S >= 3);
  assert.ok(k > 0);
  const q = pts[k];
  let foam = 0, high = 0, rock = 0;
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const c = w.chunkAt(Math.floor(q.x / 16) + cx, Math.floor(q.z / 16) + cz);
      for (let col = 0; col < 256; col++) {
        if (c.water[col] > WATER_LEVEL) high++;
        const lx = col % 16, lz = Math.floor(col / 16);
        for (let y = c.height[col]; y < c.water[col] - 1; y++) if (c.color[c.index(lx, y, lz)] && !(c.color[c.index(lx, y, lz)] & WATER_FLAG)) foam++;
      }
      for (const o of c.owner) if (o === ROCK_ID) rock++;
    }
  }
  assert.ok(high > 20 && foam > 0, `水面 ${high} しぶき ${foam}`);
  assert.ok(rock > 0, '岩');
});

// 出発地点の山の川で、上流〜中流の段（滝）の落ち口を探し、まわりを作って水を流す
async function riverAtStep() {
  const { WaterSim } = await import('../src/water.js');
  const w = new World({ seed: 20261004 });
  w.terrain.prepare(0, -1);
  const pts = w.terrain.cell(0, -1).rivers[0].pts;
  const k = pts.findIndex((q, i) => i > 3 && q.f > 0.3 && q.f < 0.8 && pts[i + 1]?.step >= 2);
  const lip = pts[k];
  ensureAround(w, lip.x, lip.z, 5);
  const sim = new WaterSim(w);
  const pos = [lip.x - 4, 0, lip.z - 4];
  for (let i = 0; i < 120; i++) sim.update(0.08, pos);
  return { w, sim, pts, k, lip, up: pts[k - 1], next: pts[k + 1], pos };
}

test('水: 川の水は下流へ流れ、段では白い水が落ち、泡が流れに乗って動く', async () => {
  const { sim, pts, k } = await riverAtStep();
  // 淵の中ほどの流れは、川の下る向き
  let along = 0, n = 0;
  for (let m = k - 6; m < k; m++) {
    const a = pts[m], b = pts[m + 1];
    const [vx, vz] = sim.velocity(Math.floor(a.x), Math.floor(a.z));
    along += (vx * (b.x - a.x) + vz * (b.z - a.z)) / Math.hypot(b.x - a.x, b.z - a.z);
    n++;
  }
  assert.ok(along / n > 0.5, `下流向きの速さ ${(along / n).toFixed(2)}`);
  assert.ok(sim.falls.size > 10, `滝のセル ${sim.falls.size}`);
  assert.ok(sim.parts.length > 50);
  // 泡は下流へ動く
  const before = sim.parts.slice(0, 40).map((p) => ({ p, x: p.x, z: p.z }));
  sim.update(0.08, [pts[k].x - 4, 0, pts[k].z - 4]);
  assert.ok(before.some(({ p, x, z }) => Math.hypot(p.x - x, p.z - z) > 0.05));
});

test('水: 落ち口をせき止めると、上流の淵の水位が上がっていく', async () => {
  const { w, sim, lip, up, next, pos } = await riverAtStep();
  const level0 = sim.level(Math.floor(up.x), Math.floor(up.z));
  const dx = next.x - lip.x, dz = next.z - lip.z, l = Math.hypot(dx, dz);
  for (let s = -lip.w - 4; s <= lip.w + 4; s += 0.5) {
    for (let a = -1; a <= 1; a += 0.5) {
      const x = Math.floor(lip.x - (dz / l) * s + (dx / l) * a), z = Math.floor(lip.z + (dx / l) * s + (dz / l) * a);
      for (let y = w.groundAt(x, z); y < lip.S + 8; y++) if (w.ownerAt(x, y, z) !== ROCK_ID) w.setCell(x, y, z, ROCK_ID, 0x777777);
    }
  }
  for (let i = 0; i < 250; i++) sim.update(0.08, pos);
  const level1 = sim.level(Math.floor(up.x), Math.floor(up.z));
  assert.ok(level1 - level0 > 1.5, `水位 ${level0.toFixed(2)} → ${level1.toFixed(2)}`);
  // 水のセルは水位に合っていて、ほかの物を上書きしていない
  const x = Math.floor(up.x), z = Math.floor(up.z);
  assert.equal(w.waterAt(x, z), Math.max(w.groundAt(x, z) + 1, Math.round(level1)));
});

test('渓流: 直径 3m を超える大岩と苔、川沿いの木は川の上へ傾く', async () => {
  const { w } = await riverAtStep();
  const rocks = [...w.terrain.cell(0, -1).rivers.flatMap((r) => r.rocks)];
  assert.ok(rocks.some((r) => r.r * 2 * 0.15 > 3), '大岩');
  assert.ok(rocks.filter((r) => r.r > 4).length > 20);
  const leaning = [...w.treeSpecs.values()].filter((s) => s?.lean);
  assert.ok(leaning.length > 0, '川へ傾く木');
  let plants = 0;
  for (const c of w.chunks.values()) for (const o of c.owner) if (o === PLANT_ID) plants++;
  assert.ok(plants > 50, `シダ ${plants}`);
});

test('山の上のチャンクは地表のまわりから上だけを持つ。それより下は地面として扱う', () => {
  const w = new World({ seed: 20261004 });
  const c = w.chunkAt(40, -33); // 出発地点の山の頂上のあたり
  assert.ok(c.base > 200, `base ${c.base}`);
  assert.ok(c.owner.length < (c.top - c.base + 32) * 256);
  assert.equal(w.ownerAt(c.cx * 16, 5, c.cz * 16), GROUND_ID);
  assert.equal(w.ownerAt(c.cx * 16, c.base - 1, c.cz * 16), GROUND_ID);
  assert.equal(w.colorAt(c.cx * 16, c.base - 1, c.cz * 16), 0);
  const h = c.height[0];
  assert.equal(w.ownerAt(c.cx * 16, h - 1, c.cz * 16), GROUND_ID);
  assert.notEqual(w.ownerAt(c.cx * 16, h + 30, c.cz * 16), GROUND_ID);
});

test('遠くのチャンクは片付けられ、戻ってくると同じ地形が作り直される', async () => {
  const { forgetFar } = await import('../src/world.js');
  const w = new World({ seed: 4 });
  ensureAround(w, 300, 0, 2);
  const before = w.chunkAt(18, 0).height.slice();
  ensureAround(w, 0, 0, 2);
  const npcs = [...w.entities.values()].filter((e) => e.kind === 'npc').length;
  const gone = forgetFar(w, [[0, 0]], 4);
  assert.ok(gone >= 25);
  assert.ok(!w.chunks.has(chunkKeyAt(300, 0)));
  assert.ok([...w.entities.values()].filter((e) => e.kind === 'npc').length <= npcs);
  assertConsistent(w);
  assert.deepEqual(w.chunkAt(18, 0).height, before);
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

test('龍: 地面を歩くときは地面に沿い、行く手の人を押しのける（重ならない）', async () => {
  const { Dragon } = await import('../src/dragon.js');
  const w = new World({ generate: false });
  const p = spawnPlayer(w); // 地面の高さ 1
  const d = new Dragon(w, [0, 60, 0]);
  w.dragon = d;
  // プレイヤーの 40 ボクセル手前に、プレイヤーへ向けて降ろす
  d.land(p.pos[0] + 4, p.pos[2] - 40, 0);
  d.walkTarget = [p.pos[0] + 4, 0, p.pos[2] + 300];
  d.walkTargetLeft = 1e9;
  d.walkTime = 1e9;
  d.nextBreath = 1e9;
  const start = [...p.pos];
  const pushes = [];
  for (let i = 0; i < 80; i++) {
    d.update(0.08, p.pos);
    pushes.push(...d.events);
  }
  assert.equal(d.mode, 'walk');
  assert.ok(pushes.some((ev) => ev.target === p), '押しのけた');
  assert.notDeepEqual(p.pos, start);
  // プレイヤーのセルはすべてプレイヤーのもの（龍と重なっていない）
  for (const [x, y, z] of w.cellsOf(p)) assert.equal(w.ownerAt(x, y, z), p.id);
  // 龍のセルの数が合い、足は地面に着いている
  let owned = 0;
  let low = Infinity;
  for (const c of w.chunks.values()) {
    c.owner.forEach((o, i) => {
      if (o !== d.id) return;
      owned++;
      low = Math.min(low, Math.floor(i / 256));
    });
  }
  assert.equal(owned, d.size);
  assert.ok(low <= 2, `一番低いセル ${low}`);
  assert.ok(Math.abs(d.head[1] - (1 + 12.5)) < 1, `頭の高さ ${d.head[1]}`);
});

test('龍: 火を吹くと木が焦げ、炎はほかの物を上書きしない', async () => {
  const { Dragon } = await import('../src/dragon.js');
  const w = new World({ seed: 5 });
  ensureAround(w, 0, 0, 6);
  const tree = [...w.trees.values()].find((t) => t.spec.scale > 0.8 && Math.abs(t.spec.x) < 60 && Math.abs(t.spec.z) < 60);
  const { x, z } = tree.spec;
  const d = new Dragon(w, [0, 200, 0]);
  w.dragon = d;
  d.land(x - 60, z, Math.PI / 2); // 木の 60 ボクセル西で、東（+x）を向く
  d.fireTarget = [x + 0.5, tree.spec.y + tree.height * 0.6, z + 0.5];
  d.setMode('breathe');
  const others = () => new Map([...w.chunks].map(([k, c]) => [k, Array.from(c.owner, (o) => (o === d.id || o === d.fireId ? 0 : o))]));
  const before = others();
  const litBefore = tree.color.filter((c) => c).length;
  let flames = 0;
  for (let i = 0; i < 45; i++) {
    d.update(0.08, [x, 0, z]);
    flames = Math.max(flames, d.fire.cells.length / 2);
  }
  assert.ok(flames > 100, `炎のセル ${flames}`);
  assert.ok(d.fire.burned > 20, `焦げたセル ${d.fire.burned}`);
  assert.ok(tree.color.filter((c) => c).length < litBefore, '葉が燃え落ちた');
  // 炎と龍は空いた所にしか入らない（地形・木・岩・水・人の持ち主は変わらない）
  for (const [k, owners] of before) {
    const now = w.chunks.get(k).owner;
    owners.forEach((o, i) => {
      const e = w.entities.get(o);
      if (o !== 0 && !['npc', 'box', 'player'].includes(e?.kind)) assert.equal(now[i], o);
    });
  }
});

test('龍: 飛ぶ → 降りる → 歩く → 火を吹く → 飛び立つ', async () => {
  const { spawnDragon } = await import('../src/dragon.js');
  const w = new World({ seed: 20261004 });
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 7);
  const d = spawnDragon(w, p.pos);
  d.nextLanding = 2;
  const seen = [];
  for (let i = 0; i < 1200 && d.mode !== 'takeoff'; i++) {
    d.update(0.08, p.pos);
    if (seen[seen.length - 1] !== d.mode) seen.push(d.mode);
  }
  for (const m of ['fly', 'descend', 'walk', 'breathe', 'takeoff']) assert.ok(seen.includes(m), seen.join(' → '));
  assert.ok(d.fire.burned > 0);
});

// ---- 斧 ----------------------------------------------------------------------

// 木の幹の前（西側）にプレイヤーを立たせ、東（+x）を向かせる
function standBeforeTree(w, tree) {
  const { x, y, z } = tree.spec;
  for (let d = 10; d < 30; d++) {
    const px = x - d - 4, pz = z - 4;
    const p = w.spawnHuman({ kind: 'player', name: 'プレイヤー', priority: PRIORITY.PLAYER, pos: [px, y, pz], palette: PALETTES.player, yaw: Math.PI / 2 });
    if (p) {
      w.player = p;
      return p;
    }
  }
  return null;
}

test('斧: 幹に切り込みを入れていくと、木が向こう側へ倒れて倒木と切り株が残る', () => {
  const w = new World({ seed: 5 });
  ensureAround(w, 0, 0, 6);
  const big = [...w.trees.values()].filter((t) => t.spec.scale > 0.8 && t.spec.species !== 'birch');
  let tree = null;
  let p = null;
  for (const t of big) {
    p = standBeforeTree(w, t);
    if (p) {
      tree = t;
      break;
    }
  }
  assert.ok(p, '木の前に立てる場所がある');
  // 幹まで歩く
  for (let i = 0; i < 80; i++) step(w, walkInput(1, 0));
  const chops = [];
  for (let i = 0; i < 600 && !tree.felled; i++) chops.push(...step(w, { dir: null, run: false, chop: true }).filter((ev) => ev.type === 'chop'));
  assert.ok(tree.felled, chops.map((ev) => ev.result).join(','));
  assert.ok(chops.some((ev) => ev.result === 'notch'));
  assert.equal(chops[chops.length - 1].result, 'felled');
  // 倒れきるまで待つ
  for (let i = 0; i < 200 && w.felling.length; i++) step(w, { dir: null, run: false });
  assert.equal(w.felling.length, 0);
  const log = [...w.entities.values()].find((e) => e.name.endsWith('の倒木'));
  assert.ok(log, '倒木がある');
  // 倒木は寝ている: 倒木のセルの高さは低く、東（+x）へ伸びている
  let top = 0, east = -Infinity, n = 0;
  for (const c of w.chunks.values()) {
    c.owner.forEach((o, i) => {
      if (o !== log.id) return;
      n++;
      top = Math.max(top, Math.floor(i / 256));
      east = Math.max(east, c.cx * 16 + (i % 16));
    });
  }
  assert.ok(n > 500, `倒木のセル ${n}`);
  assert.ok(top - tree.spec.y < tree.height * 0.6, `倒木の高さ ${top - tree.spec.y} / ${tree.height}`);
  assert.ok(east > tree.spec.x + tree.height * 0.5, '東へ倒れた');
  // 切り株が残っている
  assert.equal(w.ownerAt(tree.spec.x, tree.spec.y + 1, tree.spec.z), tree.id);
  for (const [x, y, z] of w.cellsOf(p)) assert.equal(w.ownerAt(x, y, z), p.id);
});

test('斧: 龍を切りつけると傷から肉が見え、切り続けると尾の側が切り落とされて落ちる', async () => {
  const { Dragon } = await import('../src/dragon.js');
  const w = new World({ generate: false });
  const d = new Dragon(w, [0, 60, 0]);
  w.dragon = d;
  d.land(40, 300, 0); // 北（+z）向きに、z = 300 から南へ寝そべる
  d.advance = () => {}; // 動かないようにする
  d.update(0.08, [0, 0, 0]);
  // 胴の s = 300 あたりの横に立って、胴の方を向く
  const pt = d.pts[Math.round(300 / 0.8)];
  const p = w.spawnHuman({
    kind: 'player', name: 'プレイヤー', priority: PRIORITY.PLAYER,
    pos: [Math.round(pt.c[0]) + 9, 1, Math.round(pt.c[2]) - 4], palette: PALETTES.player, yaw: -Math.PI / 2,
  });
  assert.ok(p);
  w.player = p;
  const flesh = new Set([0xa3262e, 0xbc3438, 0xcf4f4c, 0xb02c33]);
  const fleshShown = () => {
    let n = 0;
    for (const c of w.chunks.values()) c.owner.forEach((o, i) => { if (o === d.id && flesh.has(c.color[i])) n++; });
    return n;
  };
  const chops = [];
  let woundFlesh = 0;
  for (let i = 0; i < 800 && !chops.some((ev) => ev.result === 'severed'); i++) {
    const evs = step(w, { dir: [-1, 0], run: false, chop: true }).filter((ev) => ev.type === 'chop');
    chops.push(...evs);
    if (!woundFlesh && evs.some((ev) => ev.result === 'wound' && ev.progress > 0.5)) {
      step(w, { dir: null, run: false }); // 龍が描き直されるまで
      woundFlesh = fleshShown();
    }
  }
  assert.ok(woundFlesh > 10, `切り傷から見える肉 ${woundFlesh}`);
  assert.ok(chops.some((ev) => ev.result === 'wound'), chops.map((ev) => ev.result).join(','));
  const sev = chops.find((ev) => ev.result === 'severed');
  assert.ok(sev, chops.map((ev) => `${ev.result}:${ev.progress?.toFixed(2)}`).join(','));
  assert.ok(d.length < 400 && d.length > 250, `残りの長さ ${d.length}`);
  const piece = sev.piece;
  assert.equal(piece.kind, 'carcass');
  // 切り落とした尾の断面に肉の色が見える
  assert.ok(piece.colors.some((c) => flesh.has(c)), '切り落とした尾の断面');
  // 尾は地面まで落ちる
  for (let i = 0; i < 100 && piece.falling; i++) step(w, { dir: null, run: false });
  assert.equal(piece.falling, false);
  let low = Infinity;
  for (const [, y] of w.cellsOf(piece)) low = Math.min(low, y);
  assert.equal(low, 1);
  assertConsistent(w);
});

test('太刀: 離れた所から龍を深く斬り（一太刀で胴の半分）、振り下ろしと横薙ぎを交互に繰り出し、数太刀で切り落とす', async () => {
  const { Dragon } = await import('../src/dragon.js');
  const w = new World({ generate: false });
  const d = new Dragon(w, [0, 60, 0]);
  w.dragon = d;
  d.land(40, 300, 0);
  d.advance = () => {};
  d.update(0.08, [0, 0, 0]);
  const pt = d.pts[Math.round(300 / 0.8)];
  // 胴から 2m ほど離れて立つ（斧は届かない）
  const p = w.spawnHuman({
    kind: 'player', name: 'プレイヤー', priority: PRIORITY.PLAYER,
    pos: [Math.round(pt.c[0]) + 14, 1, Math.round(pt.c[2]) - 4], palette: PALETTES.player, yaw: -Math.PI / 2,
  });
  w.player = p;
  step(w, { dir: null, run: false, tool: 'sword' });
  assert.equal(p.tool, 'sword');
  const slashes = [];
  for (let i = 0; i < 300 && !slashes.some((ev) => ev.result === 'severed'); i++) {
    slashes.push(...step(w, { dir: null, run: false, chop: true }).filter((ev) => ev.type === 'slash'));
  }
  const log = slashes.map((ev) => `${ev.cut}:${ev.result}:${ev.progress.toFixed(2)}`).join(',');
  assert.equal(slashes[0].result, 'wound', log);
  assert.ok(slashes[0].progress >= 0.45, log);
  assert.ok(slashes.some((ev) => ev.cut === 'v') && slashes.some((ev) => ev.cut === 'h'), log);
  const sev = slashes.findIndex((ev) => ev.result === 'severed');
  assert.ok(sev >= 1 && sev <= 4, log);
  assert.equal(slashes[sev].piece.kind, 'carcass');
  assertConsistent(w);
});

test('龍: 胴に穴がなく、中の空洞が外から見えない（切り傷・切り口も）', async () => {
  const { Dragon } = await import('../src/dragon.js');
  const w = new World({ generate: false });
  const d = new Dragon(w, [0, 90, 0]);
  w.dragon = d;
  d.land(40, 300, 0.3);
  for (let i = 0; i < 10; i++) d.update(0.08, [0, 0, 0]);
  // 何か所か切りつけ、尾の先を切り落とす
  for (const k of [150, 260, 330]) {
    const { c, B } = d.pts[k];
    for (let n = 0; n < (k === 330 ? 12 : 3); n++) d.wound([c[0] + B[0] * 6, c[1] + B[1] * 6, c[2] + B[2] * 6]);
  }
  d.advance = () => {};
  d.update(0.08, [0, 0, 0]);
  const own = (x, y, z) => w.ownerAt(x, y, z) === d.id;
  // 背骨の中心から、龍のセルを面で通り抜けずに（6 近傍で）胴の外へ出られるか
  const radiusOf = (s) => (s / 400 < 0.12 ? 4.6 + 1.6 * (s / 48) : s / 400 < 0.4 ? 7 : Math.max(1.2, 6.2 * (1 - (s / 400 - 0.4) / 0.6) ** 0.9));
  let tested = 0;
  for (let k = 60; k < d.pts.length && d.pts[k].s < d.length - 30; k += 15) {
    const start = d.pts[k].c.map(Math.floor);
    if (own(...start)) continue;
    tested++;
    const seen = new Set([start.join()]);
    const q = [start];
    while (q.length && seen.size < 3000) {
      const [x, y, z] = q.pop();
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = [x + dx, y + dy, z + dz];
        const key = n.join();
        if (seen.has(key) || own(...n) || n[1] < 1) continue;
        seen.add(key);
        let best = Infinity, bs = 0;
        for (const p of d.pts) {
          if (p.s > d.length) break;
          const dd = (n[0] + 0.5 - p.c[0]) ** 2 + (n[1] + 0.5 - p.c[1]) ** 2 + (n[2] + 0.5 - p.c[2]) ** 2;
          if (dd < best) [best, bs] = [dd, p.s];
        }
        assert.ok(Math.sqrt(best) <= radiusOf(bs) + 2, `s = ${d.pts[k].s.toFixed(0)} の中から ${key} へ抜けられる`);
        q.push(n);
      }
    }
  }
  assert.ok(tested >= 12, `調べた所 ${tested}`);
});

test('龍: いろいろな角度から切りつけても、切り落とされるまでは胴が分かれて見えない', async () => {
  const { Dragon } = await import('../src/dragon.js');
  for (const [trial, sTarget] of [[0, 200], [1, 40]]) {
    const w = new World({ generate: false });
    const d = new Dragon(w, [0, 60, 0]);
    w.dragon = d;
    d.land(40, 300, 0.3 * trial);
    d.walkTime = 1e9;
    d.nextBreath = 1e9;
    let seed = trial + 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 60; i++) {
      d.update(0.08, [0, 0, 0]);
      if (i % 3 === 0 && d.length > sTarget) {
        const { c, N, B } = d.pts[Math.round((sTarget + (rnd() - 0.5) * 4) / 0.8)];
        const a = rnd() * Math.PI * 2;
        d.wound([0, 1, 2].map((k) => c[k] + (N[k] * Math.cos(a) + B[k] * Math.sin(a)) * 7));
      }
      if (i % 4 !== 3) continue;
      // 龍のセルが 1 つの塊になっているか（26 近傍）
      const cells = new Set();
      for (const c of w.chunks.values()) c.owner.forEach((o, j) => { if (o === d.id) cells.add(`${c.cx * 16 + (j % 16)},${Math.floor(j / 256)},${c.cz * 16 + (Math.floor(j / 16) % 16)}`); });
      const seen = new Set();
      const parts = [];
      for (const key of cells) {
        if (seen.has(key)) continue;
        let n = 0;
        const q = [key];
        seen.add(key);
        while (q.length) {
          const [x, y, z] = q.pop().split(',').map(Number);
          n++;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const kk = `${x + dx},${y + dy},${z + dz}`;
            if (cells.has(kk) && !seen.has(kk)) {
              seen.add(kk);
              q.push(kk);
            }
          }
        }
        if (n > 50) parts.push(n);
      }
      assert.equal(parts.length, 1, `s = ${sTarget} 付近、${i} フレーム目: ${parts.join(' / ')}`);
    }
    if (sTarget < 60) assert.equal(d.length, 400, '首は切り落とせない');
  }
});

// ---- 黄色い球体とショットガン -----------------------------------------------

// 高さ 10 の平らな地面と、出発地点のプレイヤー
function monsterWorld() {
  const w = new World({ generate: false, heightAt: () => 10 });
  const p = spawnPlayer(w);
  return { w, p };
}

// 球体のセル: [[x, y, z, color], ...]
function monsterCells(w, m) {
  const out = [];
  for (const c of w.chunks.values()) {
    c.owner.forEach((o, i) => {
      if (o === m.id) out.push([c.cx * CHUNK + (i % CHUNK), c.yOf(i), c.cz * CHUNK + (Math.floor(i / CHUNK) % CHUNK), c.color[i]]);
    });
  }
  return out;
}
const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

test('黄色い球体: 直径 3m の中まで詰まった球で、表面は黄色・中は中心ほど赤い', async () => {
  const { Monster, MONSTER_RADIUS } = await import('../src/monster.js');
  const { w } = monsterWorld();
  const m = new Monster(w, [100.5, 40.5, 100.5]);
  m.draw();
  const cells = monsterCells(w, m);
  const ideal = (4 / 3) * Math.PI * MONSTER_RADIUS ** 3;
  assert.ok(Math.abs(cells.length - ideal) < ideal * 0.1, `セルの数 ${cells.length}`);
  const xs = cells.map((c) => c[0]);
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  assert.ok(width >= 19 && width <= 23, `幅 ${width} ボクセル`);
  // 中心は占有しているが消灯（中まで詰まっている）。てっぺんは明るい黄色
  assert.equal(w.ownerAt(100, 40, 100), m.id);
  assert.equal(w.colorAt(100, 40, 100), 0);
  const top = cells.filter((c) => c[0] === 100 && c[2] === 100).sort((a, b) => b[1] - a[1])[0];
  const [r, g, b] = rgb(top[3]);
  assert.ok(r > 200 && g > 150 && b < 140, `てっぺんの色 ${top[3].toString(16)}`);
  // 深くえぐると、中心の近くの赤い所が見える
  for (let k = 0; k < 6; k++) m.hit([100.5, 40.5, 100.5 - 10], 1);
  m.draw();
  const deep = monsterCells(w, m).filter(([x, y, z, c]) => c && Math.hypot(x + 0.5 - 100.5, y + 0.5 - 40.5, z + 0.5 - 100.5) < 4);
  assert.ok(deep.length > 0, 'えぐれた底が中心の近くまで届く');
  for (const [, , , c] of deep) {
    const [cr, cg] = rgb(c);
    assert.ok(cr > cg * 1.8, `中心の近くは赤い ${c.toString(16)}`);
  }
});

test('黄色い球体: プレイヤーに気づくと、マゼンタの縞が下から上へ流れる', async () => {
  const { Monster } = await import('../src/monster.js');
  const { w, p } = monsterWorld();
  const m = new Monster(w, [p.pos[0] + 300, 40, p.pos[2]]);
  m.octaIn = 1e9;
  const magentaRows = () => {
    const rows = new Map();
    for (const [x, y, z, c] of monsterCells(w, m)) {
      if (!c) continue;
      const [r, g, b] = rgb(c);
      if (r > 200 && b > 150 && g < 120) rows.set(y, (rows.get(y) ?? 0) + 1);
    }
    return [...rows.keys()].sort((a, b) => a - b);
  };
  m.update(0.08, p);
  assert.equal(m.spotted, false);
  assert.equal(magentaRows().length, 0, '気づく前は縞がない');
  m.c = [p.pos[0] + 60, 30, p.pos[2]];
  m.update(0.08, p);
  assert.equal(m.events[0]?.type, 'spot');
  for (let k = 0; k < 12; k++) m.update(0.08, p);
  const before = magentaRows();
  assert.ok(before.length > 3, `縞のある段 ${before.length}`);
  // 縞の下の端が上へずれていく（中心からの高さで比べる）
  const lowest = (rows) => {
    const cy = Math.floor(m.c[1]);
    return rows.filter((y) => y >= cy - 4).map((y) => y - cy)[0];
  };
  const y0 = lowest(before);
  m.update(0.08, p);
  m.update(0.08, p);
  const y1 = lowest(magentaRows());
  assert.ok(y1 > y0 || y1 < y0 - 2, `縞が上へ流れる ${y0} → ${y1}`); // 上へずれるか、下から次の縞が上がってくる
});

test('ショットガン: 4 で持ち替え、F で撃つと散弾で球体が大きくえぐれ、波打ちながら元の球に戻る', async () => {
  const { Monster } = await import('../src/monster.js');
  const { PELLETS } = await import('../src/shotgun.js');
  const { w, p } = monsterWorld();
  const m = new Monster(w, [p.pos[0] + 4.5, p.pos[1] + 12, p.pos[2] + 4.5 + 32]);
  w.monster = m;
  m.octaIn = 1e9;
  m.draw();
  const base = m.size;
  const ev = step(w, { dir: null, run: false, chop: true, tool: 'gun' });
  assert.equal(p.tool, 'gun');
  assert.ok(rasterizeTool(p.palette, p.pose).length > 10, '銃身が体からはみ出して見える');
  const shot = ev.find((e) => e.type === 'shoot');
  assert.equal(shot.result, 'dent');
  assert.ok(shot.hits >= PELLETS / 2, `当たった粒 ${shot.hits}`);
  m.draw();
  assert.ok(m.size < base * 0.93, `えぐれた ${base} → ${m.size}`);
  assert.equal(m.mass, (4 / 3) * Math.PI * 1000, '球のときは欠けない');
  // しばらくすると元に戻る（途中で盛り上がる時がある）
  let bulge = false;
  for (let k = 0; k < 50; k++) {
    m.update(0.08, p);
    if (m.size > base * 1.02) bulge = true;
  }
  assert.ok(bulge, '波打つ（えぐれた所がいったん盛り上がる）');
  assert.equal(m.dents.length, 0);
  assert.ok(Math.abs(m.size - base) < base * 0.06, `元の大きさ ${base} → ${m.size}`);
  // 押し続けると 0.6 秒ごとに撃つ
  let shots = 0;
  for (let k = 0; k < 30; k++) shots += step(w, { dir: null, run: false, chop: true }).filter((e) => e.type === 'shoot').length;
  assert.equal(shots, 2);
  assertConsistent(w);
});

test('黄色い球体: 正八面体のときだけ撃った所が欠けたまま戻らず、削り切ると砕け散る', async () => {
  const { Monster, MIN_MASS, OCT } = await import('../src/monster.js');
  const { w, p } = monsterWorld();
  const m = new Monster(w, [p.pos[0] + 200, 40, p.pos[2]]);
  w.monster = m;
  m.startOcta();
  for (let t = 0; t < OCT.morph + 0.1; t += 0.08) m.update(0.08, p);
  assert.equal(m.m, 1);
  assert.ok(m.vulnerable);
  // 正八面体: 中心から頂点まで ≈ 1.46 R
  const cells = monsterCells(w, m);
  const far = Math.max(...cells.map(([x, y, z]) => Math.hypot(x + 0.5 - m.c[0], y + 0.5 - m.c[1], z + 0.5 - m.c[2])));
  assert.ok(far > 13, `頂点まで ${far.toFixed(1)}`);
  const base = m.size;
  const mass0 = m.mass;
  assert.equal(m.hit([m.c[0], m.c[1] + 8, m.c[2]], 1), 'chip');
  assert.ok(m.mass < mass0);
  m.update(0.08, p);
  const chipped = m.size;
  assert.ok(chipped < base - 40, `欠けた ${base} → ${chipped}`);
  m.update(0.08, p);
  m.update(0.08, p);
  assert.ok(m.size < base - 40, '欠けたまま戻らない');
  // 削り切る
  let result = null;
  for (let k = 0; k < 300 && result !== 'killed'; k++) {
    const a = k * 2.4, b = Math.sin(k * 1.7);
    result = m.hit([m.c[0] + Math.cos(a) * 6, m.c[1] + b * 6, m.c[2] + Math.sin(a) * 6], 1);
  }
  assert.equal(result, 'killed');
  assert.ok(m.mass < MIN_MASS);
  assert.equal(w.monster, null);
  assert.ok(m.pieces.length >= 3, `かけら ${m.pieces.length}`);
  assertConsistent(w);
  // かけらは地面へ落ちる
  for (let k = 0; k < 80; k++) step(w, idle);
  for (const e of m.pieces) assert.equal(e.falling, false);
  assertConsistent(w);
});

test('黄色い球体: 正八面体の頂点から紫の光線。線上の地面も NPC も消え、プレイヤーは体力が減って少し縮む', async () => {
  const { Monster, OCT, BEAM_DAMAGE } = await import('../src/monster.js');
  const { w, p } = monsterWorld();
  ensureAround(w, -100, 7, 4);
  const npc = w.spawnHuman({ kind: 'npc', name: 'NPC-1', priority: PRIORITY.NPC, pos: [p.pos[0] - 27, 10, p.pos[2]], palette: PALETTES.npc[0] });
  const m = new Monster(w, [p.pos[0] + 64.5, 0, p.pos[2] + 4.5]);
  m.c[1] = 10 + 3 + m.R;
  w.monster = m;
  m.update(0.08, p);
  assert.ok(m.spotted);
  const ground = () => {
    let n = 0;
    for (let x = -160; x < -60; x++) for (let z = -4; z < 14; z++) for (let y = 3; y < 10; y++) if (w.ownerAt(x, y, z) === GROUND_ID) n++;
    return n;
  };
  const g0 = ground();
  const mass0 = m.mass;
  m.startOcta();
  const types = [];
  for (let t = 0; t < OCT.end + 0.5; t += 0.08) {
    m.update(0.08, p);
    types.push(...m.events.map((e) => e.type));
    if (m.beam) {
      // 光線は頂点から出る
      const v = m.vertex();
      assert.ok(Math.hypot(v[0] - m.beam.o[0], v[1] - m.beam.o[1], v[2] - m.beam.o[2]) < 1.5);
    }
  }
  assert.ok(types.includes('beam'));
  assert.ok(types.includes('beamHit'));
  assert.equal(p.hp, 100 - BEAM_DAMAGE);
  assert.ok(types.includes('vanish'), '後ろの NPC も消えた');
  assert.equal(w.entities.has(npc.id), false);
  assert.ok(ground() < g0 - 50, `地面に穴があいた ${g0} → ${ground()}`);
  assert.ok(m.mass < mass0, '光線を放つと縮む');
  assert.equal(m.state === 'octa', false, '球に戻った');
  // 光線は消えている
  for (const c of w.chunks.values()) assert.equal(c.owner.includes(m.beamId), false);
  assertConsistent(w);
});

test('黄色い球体: NPC を見つけると上から包み込んで吸収し、少し大きくなる', async () => {
  const { Monster } = await import('../src/monster.js');
  const { w, p } = monsterWorld();
  const npc = w.spawnHuman({ kind: 'npc', name: 'NPC-1', priority: PRIORITY.NPC, pos: [-180, 10, 0], palette: PALETTES.npc[1] });
  const m = new Monster(w, [-160, 30, 30]);
  w.monster = m;
  m.octaIn = 1e9;
  const R0 = m.R;
  let wrapped = false;
  for (let k = 0; k < 500 && !(m.absorbed && m.state !== 'absorb'); k++) {
    m.update(0.08, p);
    if (m.state === 'wrap' && m.drape.k > 0.85) {
      // NPC の胸の高さの横にも、球体の膜がある（上から覆いかぶさっている）
      const y = npc.pos[1] + 7;
      const side = monsterCells(w, m).filter(([x, yy, z]) => yy === y && Math.hypot(x + 0.5 - m.drape.ax, z + 0.5 - m.drape.az) < 7.5);
      assert.ok(side.length > 20, `横の膜 ${side.length}`);
      assert.equal(npc.held, true);
      wrapped = true;
    }
    if (m.state !== 'absorb' && m.state !== 'wrap') assertConsistent(w);
  }
  assert.ok(wrapped);
  assert.equal(m.absorbed, 1);
  assert.equal(w.entities.has(npc.id), false);
  for (let k = 0; k < 20; k++) m.update(0.08, p);
  assert.ok(m.R > R0 * 1.04 && m.R < R0 * 1.1, `大きさ ${R0} → ${m.R.toFixed(2)}`);
  assertConsistent(w);
});

test('プレイヤーの体力が 0 になると出発地点に戻り、体力も元に戻る', async () => {
  const { hurtPlayer, PLAYER_HP } = await import('../src/world.js');
  const { w, p } = monsterWorld();
  const start = [...p.pos];
  for (let k = 0; k < 30; k++) step(w, walkInput(1, 0, true));
  assert.ok(p.pos[0] > start[0] + 15);
  assert.equal(hurtPlayer(w, 60), null);
  assert.equal(p.hp, PLAYER_HP - 60);
  // 少しずつ回復する
  for (let k = 0; k < 150; k++) step(w, idle);
  assert.ok(p.hp > 40 && p.hp < PLAYER_HP);
  const r = hurtPlayer(w, 200);
  assert.equal(r.type, 'respawn');
  assert.equal(p.hp, PLAYER_HP);
  assert.ok(Math.hypot(p.pos[0] - start[0], p.pos[2] - start[2]) < 10);
  assertConsistent(w);
});
