import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, spawnPlayer, step, ensureAround, ROCK_ID, GROUND_ID } from '../src/world.js';
import { pyramidSite, toWorld, sitePoint, frontYaw, HB, PH, STATUE_U } from '../src/pyramid.js';
import { spawnTemple } from '../src/temple.js';
import { HUMAN_SIZE } from '../src/humanoid.js';

const SEED = 20261004;
const gameWorld = () => {
  const w = new World({ seed: SEED, npcs: false });
  w.bodyMakesChunks = false;
  return w;
};

// プレイヤーをピラミッドの座標 (u, v, y) へ
function moveTo(w, p, u, v, y) {
  const to = sitePoint(w, u, v, y);
  ensureAround(w, to[0], to[2], 8);
  w.paint(p, false);
  p.pos = [Math.round(to[0]) - 4, to[1], Math.round(to[2]) - 4];
  w.paint(p, true);
}

test('ピラミッド: 出発地点から 250〜360m 先の平らな広場に、底辺 150m・高さ 90m の階段状のピラミッド。広場に木はない', () => {
  const w = gameWorld();
  const s = pyramidSite(w);
  assert.ok(s);
  const dist = Math.hypot(s.cx, s.cz);
  assert.ok(dist >= 1600 && dist <= 2500, `出発地点から ${dist}`);
  // 正面は出発地点を向く
  assert.ok(s.f[0] * -s.cx + s.f[1] * -s.cz > 0);
  // 広場は平ら（高さ P）
  for (const [u, v] of [[-540, -540], [700, 300], [1000, -500], [-540, 500]]) {
    const [x, z] = toWorld(s, u, v);
    assert.equal(w.sample(x, z, {}).h, s.P, `${u},${v}`);
  }
  // 頂上
  const top = sitePoint(w, 0, 0, PH - 1);
  assert.equal(w.ownerAt(top[0], top[1], top[2]), ROCK_ID);
  const above = sitePoint(w, 0, 0, PH + 1);
  assert.equal(w.ownerAt(above[0], above[1], above[2]), 0);
  // 段: 外側ほど低い
  // （表面より深い石は、チャンクが持たない「地中の奥」と同じ扱い）
  const edge = sitePoint(w, HB - 5, 200, 5);
  assert.ok([ROCK_ID, GROUND_ID].includes(w.ownerAt(edge[0], edge[1], edge[2])));
  const out = sitePoint(w, HB - 5, 200, 13);
  assert.equal(w.ownerAt(out[0], out[1], out[2]), 0);
  // 広場とまわりに木がない
  for (const tree of w.trees.values()) {
    const [x, z] = [tree.spec.x, tree.spec.z];
    const d = Math.max(Math.abs(x - s.cx), Math.abs(z - s.cz));
    assert.ok(d > HB + 40, `木 ${x},${z}`);
  }
});

test('ピラミッド: 麓から入り口まで巨大な階段を歩いて登れ、中は廊下・洞窟・祈祷室・隠された道を通って玉座の間まで歩いて行ける', () => {
  const w = gameWorld();
  const s = pyramidSite(w);
  const H = HUMAN_SIZE[1];
  // 立てる所: 足もとの下が石か地面で、そこから上に人の背丈ぶん空いている
  const standable = (x, y, z) => {
    const below = w.ownerAt(x, y - 1, z);
    if (below !== ROCK_ID && below !== GROUND_ID) return false;
    for (let k = 0; k < H; k++) if (w.ownerAt(x, y + k, z) !== 0) return false;
    return true;
  };
  // 階段: 麓（u = 554）から入り口の床（u = 318, 高さ 240）まで、段差はどこも 2 以下
  let prev = null;
  for (let u = 560; u >= 310; u--) {
    const [x, z] = toWorld(s, u, 0);
    let y = s.P + 300;
    while (y > s.P - 2 && w.ownerAt(x, y - 1, z) === 0) y--;
    if (prev !== null) assert.ok(Math.abs(y - prev) <= 2, `u ${u}: ${prev} → ${y}`);
    prev = y;
  }
  assert.equal(prev, s.P + 240);
  // 入り口から玉座の間まで、立てる所をたどって行ける（点のたどり方。段差 2 まで、まわりは広さ 9 以上）
  const start = sitePoint(w, 296, 0, 240);
  const goal = sitePoint(w, -262, 0, 10);
  const key = (x, y, z) => `${x},${y},${z}`;
  const seen = new Set([key(...start)]);
  const queue = [start];
  let found = false;
  // まわり（3 ボクセル先）も、足もとの少し上から頭の上まで空いている（坂道でも通れる広さ）
  const clear = (x, y, z) => {
    for (let k = 3; k < H; k++) if (w.ownerAt(x, y + k, z) !== 0) return false;
    return true;
  };
  const roomy = (x, y, z) => standable(x, y, z) && clear(x + 3, y, z) && clear(x - 3, y, z) && clear(x, y, z + 3) && clear(x, y, z - 3);
  while (queue.length && !found && seen.size < 400000) {
    const [x, y, z] = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1, -1, 2, -2]) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const k = key(nx, ny, nz);
        if (seen.has(k)) continue;
        if (!roomy(nx, ny, nz)) continue;
        seen.add(k);
        if (Math.abs(nx - goal[0]) < 3 && Math.abs(nz - goal[2]) < 3 && Math.abs(ny - goal[1]) < 3) found = true;
        queue.push([nx, ny, nz]);
        break;
      }
    }
  }
  assert.ok(found, `玉座の間まで行けない（調べた所 ${seen.size}）`);
});

test('ピラミッド: 中は暗く、松明のそばだけ明るい。壁には竜の紋様と象形文字の帯', () => {
  const w = gameWorld();
  const s = pyramidSite(w);
  const bright = (c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
  // 祈祷室の壁（v = 56 の面）の色を、高さごとに集める
  const colors = [];
  for (let u = -80; u < 40; u++) {
    const [x, z] = toWorld(s, u, 56);
    for (let y = 141; y < 200; y++) colors.push(w.colorAt(x, s.P + y, z));
  }
  const lit = colors.filter(Boolean);
  assert.ok(lit.length > 3000);
  const b = lit.map(bright).sort((a, c) => a - c);
  // いちばん暗い所と明るい所の差が大きい（松明のそば）
  assert.ok(b[Math.floor(b.length * 0.9)] > b[Math.floor(b.length * 0.1)] * 2.2, `${b[Math.floor(b.length * 0.1)]} ${b[Math.floor(b.length * 0.9)]}`);
  // 外の石より暗い
  const outside = w.colorAt(...sitePoint(w, HB - 1, 200, 11));
  assert.ok(outside && bright(outside) > b[Math.floor(b.length * 0.5)]);
  // 色の種類が多い（帯の絵）
  assert.ok(new Set(lit).size > 60);
});

test('巨アヌビス像: 近づくと杖を振りかぶってから叩きつけ、当たると体力が減る。撃って杖を落とすと、もう攻撃しない', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const T = spawnTemple(w);
  moveTo(w, p, STATUE_U + 60, 0, 1);
  p.pos[1] = w.groundAt(p.pos[0] + 4, p.pos[2] + 4);
  const st = T.statues[0];
  const types = [];
  for (let i = 0; i < 80; i++) types.push(...step(w, { dir: null, run: false }).map((e) => `${e.type}:${e.actor?.name ?? ''}`));
  const first = types.findIndex((t) => t.startsWith('statueWindup:右'));
  const slam = types.findIndex((t) => t.startsWith('statueSlam:右'));
  assert.ok(first >= 0 && slam > first, types.filter((t) => t.startsWith('statue')).join());
  assert.ok(types.some((t) => t.startsWith('statueHit')), '叩かれた');
  assert.ok(p.hp < 100);
  // 体ごとプレイヤーの方へ向き直っている（プレイヤーは像の前の内側）
  assert.ok(st.yaw > 0.4, `向き直る ${st.yaw}`);
  assert.ok(st.feet.every((ft) => Math.abs(ft.yaw - st.yaw) < 0.3), '足も踏み替えて向きを変える');
  // 振りかぶっている間は、背中を反らせて膝を曲げて沈み、両手で杖を頭の後ろへ上げる（予備動作）
  st.phase = 'windup';
  st.t = 1.6;
  st.update(0.08, p);
  assert.ok(st.pose.lean < -0.3, `背中を反らせる ${st.pose.lean}`);
  assert.ok(st.pose.dip > 4, `膝を曲げて沈む ${st.pose.dip}`);
  assert.ok(st.pose.w > 0.9, '両手で握る');
  assert.ok(st.rig.staff.G[1] > 80 && st.rig.staff.G[2] < 0, '杖は頭の後ろ');
  const handGap = Math.hypot(...[0, 1, 2].map((i) => st.rig.arms[0].hand[i] - (st.rig.staff.G[i] - st.rig.staff.sd[i] * 11)));
  assert.ok(handGap < 3, `外側の手も杖を握る ${handGap}`);
  // 叩きつけた瞬間は、上体を前へ深く折り、一歩踏み込んで沈み、頭も下を向く
  st.phase = 'hold';
  st.t = 10;
  st.update(0.08, p);
  st.t = 10;
  st.update(0.08, p);
  assert.equal(st.phase, 'recover');
  assert.ok(st.pose.lean > 0.5, `前へ折れる ${st.pose.lean}`);
  assert.ok(st.pose.dip > 8 && st.pose.stepF > 5 && st.pose.nod > 0.3);
  // 杖を撃ち続けると割れて落ちる
  st.phase = 'rest';
  st.t = 10;
  st.pose = { ...st.pose, ...{ lean: 0, dip: 0, nod: 0, shiftF: 0, stepF: 0, beta: 0, w: 0, G: [15, 45, 7], grip: 40 } };
  st.rig = st.buildRig();
  let res = null;
  for (let k = 0; k < 20 && res !== 'break'; k++) res = st.shot(st.staffPoint(40), 0.8);
  assert.equal(res, 'break');
  assert.ok(st.staffBroken || st.armBroken);
  assert.ok([...w.entities.values()].some((e) => e.kind === 'carcass' && e.name.startsWith('アヌビス像')), '割れた部位が落ちる');
  st.phase = 'rest';
  st.t = 10;
  const after = [];
  for (let i = 0; i < 80; i++) after.push(...step(w, { dir: null, run: false }).filter((e) => e.actor === st.entity).map((e) => e.type));
  assert.ok(!after.includes('statueWindup'), '杖を失うと攻撃しない');
  // 頭も撃てば割れて落ちる（向きを変えていても、頭の所に当たる）
  let r2 = null;
  for (let k = 0; k < 30 && r2 !== 'break'; k++) r2 = st.shot(st.pointOf('head', [0, 86, 4]), 0.8);
  assert.equal(r2, 'break');
});

test('骸骨: 倒れている骸骨は、近づくと起き上がって斬りかかってくる。太刀で斬ると崩れ落ちる', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const T = spawnTemple(w);
  moveTo(w, p, 284, 0, 240);
  const yaw = frontYaw(pyramidSite(w)) + Math.PI;
  const types = [];
  for (let i = 0; i < 60; i++) types.push(...step(w, { dir: null, run: false, face: yaw, pitch: 0, tool: 'sword' }).map((e) => e.type));
  assert.ok(types.includes('skeletonWake'));
  const sk = T.skeletons[0].actor;
  assert.equal(sk.state, 'hunt');
  for (let i = 0; i < 40 && !types.includes('skeletonHit'); i++) types.push(...step(w, { dir: null, run: false, face: yaw, pitch: 0 }).map((e) => e.type));
  assert.ok(types.includes('skeletonHit'), '斬りかかってくる');
  assert.ok(p.hp < 100);
  let slashed = null;
  for (let i = 0; i < 40 && sk.state !== 'dead'; i++) {
    const ev = step(w, { dir: null, run: false, chop: true, face: Math.atan2(sk.e.pos[0] - p.pos[0], sk.e.pos[2] - p.pos[2]), pitch: 0 });
    slashed = ev.find((e) => e.type === 'slash' && e.result === 'collapse') ?? slashed;
  }
  assert.ok(slashed, '太刀で斬った');
  assert.equal(sk.state, 'dead');
  // 骨がばらばらに飛び散り、床に薄く散らばる
  const sc = sk.scatter;
  assert.ok(sc && w.entities.get(sc.id).name === '崩れた骨');
  assert.ok(w.entities.get(sc.id).ground, '散らばった骨は段差としてまたげる');
  const heights = [];
  for (let i = 0; i < 25; i++) {
    step(w, { dir: null, run: false });
    if (i === 3) heights.push(...sc.frags.filter((f) => !f.flat).map((f) => f.pos[1]));
  }
  assert.ok(heights.length > 4, '骨のかけらが宙を飛んでいる');
  for (let i = 0; i < 100 && !sc.settled; i++) step(w, { dir: null, run: false });
  assert.ok(sc.settled, '床に落ちた');
  const cells = sc.frags.flatMap((f) => f.flat);
  assert.ok(cells.length > 40);
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[2]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 14 || Math.max(...zs) - Math.min(...zs) > 14, '広く散らばる');
  const keys = new Set(cells.map(([x, y, z]) => `${x},${y},${z}`));
  for (const [x, y, z] of cells) assert.ok(!keys.has(`${x},${y - 1},${z}`), '骨は積み重ならない（1 段だけ）');
  assert.ok(![...w.entities.values()].some((e) => e.kind === 'carcass' && e.name === '崩れた骨'), '通せんぼする骨の山は残らない');
});

test('骸骨: 倒した骸骨の散らばった骨は、またいで先へ進める', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const T = spawnTemple(w);
  moveTo(w, p, 284, 0, 240);
  for (let i = 0; i < 3; i++) step(w, { dir: null, run: false });
  const k = T.skeletons[0];
  assert.ok(k.actor);
  // 寝ている骸骨の向こう（ピラミッドの奥）へ、骨の上を通って歩く
  const s = pyramidSite(w);
  const back = [-s.f[0], -s.f[1]];
  moveTo(w, p, 284 + 30, 0, 240);
  k.actor.collapse([p.pos[0] + 4.5, p.pos[1], p.pos[2] + 4.5], 1.4);
  for (let i = 0; i < 120 && !k.actor.scatter.settled; i++) step(w, { dir: null, run: false });
  assert.ok(k.actor.scatter.settled);
  const start = [...p.pos];
  for (let i = 0; i < 160; i++) step(w, { dir: back, run: false });
  const went = (p.pos[0] - start[0]) * back[0] + (p.pos[2] - start[2]) * back[1];
  assert.ok(went > 65, `骨の上を越えて進めた（${went}）`);
});

test('赤い骨の王: 玉座に鎮座し、近づくと目を赤く光らせて立ち上がり、大剣で襲ってくる。撃ち続けると崩れ落ちる', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const T = spawnTemple(w);
  moveTo(w, p, -200, 0, 10);
  for (let i = 0; i < 4; i++) step(w, { dir: null, run: false });
  const king = T.king;
  assert.ok(king);
  assert.equal(king.state, 'seated');
  assert.ok(king.pose.crouch > 0.9, '座っている');
  // 近づく
  moveTo(w, p, -262, 0, 10);
  const types = [];
  for (let i = 0; i < 160; i++) types.push(...step(w, { dir: null, run: false }).map((e) => e.type));
  assert.ok(types.includes('kingWake'));
  assert.equal(king.pal.eyes, 0xff3a1a, '目が赤く光る');
  assert.equal(king.state, 'fight');
  assert.ok(types.includes('kingHit'), '大剣で斬られる');
  // 赤い骨の王の体に当てる
  let res = null;
  for (let k = 0; k < 40 && res !== 'kingDown'; k++) res = king.shot([king.pos[0], king.pos[1] + 20, king.pos[2]], 0.9);
  assert.equal(res, 'kingDown');
  assert.equal(king.state, 'dead');
  assert.ok([...w.entities.values()].some((e) => e.name === '赤い骨の王の骨' && e.ground));
  for (let i = 0; i < 120 && !king.scatter.settled; i++) step(w, { dir: null, run: false });
  assert.ok(king.scatter.settled, '王の骨も床に散らばる');
});

test('水晶: ピラミッドの頂上の上に浮かび、紫に光りながら回る', () => {
  const w = gameWorld();
  spawnPlayer(w);
  const T = spawnTemple(w);
  const cr = T.crystal;
  const top = sitePoint(w, 0, 0, PH);
  assert.ok(cr.c[1] > top[1] + 20);
  const shot1 = [];
  cr.shape((x, y, z, c) => shot1.push(`${x},${y},${z}`));
  assert.ok(shot1.length > 3000);
  const colors = new Set();
  cr.shape((x, y, z, c) => colors.add(c));
  // 紫
  for (const c of colors) assert.ok((c & 255) > ((c >> 8) & 255), c.toString(16));
  for (let i = 0; i < 10; i++) cr.update(0.08);
  const shot2 = new Set();
  cr.shape((x, y, z) => shot2.add(`${x},${y},${z}`));
  assert.ok(shot1.filter((k) => !shot2.has(k)).length > 300, '回っている');
});
