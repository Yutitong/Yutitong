import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, spawnPlayer, step, startMeteor, ensureAround, ROCK_ID, EMPTY } from '../src/world.js';
import { pyramidSite } from '../src/pyramid.js';
import { meteorSite, applyImpact, CRATER_R, RIM_Y, BLAST_R, T_FALL, AIR_BLAST, GROUND_WAVE } from '../src/meteor.js';
import { giantZone, giantSpecsNear } from '../src/giant.js';
import { regionSpec } from '../src/trees.js';

const SEED = 20261004;
const gameWorld = () => {
  const w = new World({ seed: SEED, npcs: false });
  w.bodyMakesChunks = false;
  return w;
};
const idle = { dir: null, run: false };
const run = (w, seconds) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / 0.04); i++) events.push(...step(w, idle));
  return events;
};
// プレイヤーを (x, z) の地面の上へ
function moveTo(w, p, x, z) {
  ensureAround(w, x, z, 3);
  w.paint(p, false);
  p.pos = [Math.round(x) - 4, w.groundAt(Math.round(x), Math.round(z)), Math.round(z) - 4];
  w.paint(p, true);
}

test('隕石: 出発地点から 1.4km 以上先の、はじめに向いている方向から少し横の所に落ちる。ピラミッドは被害の範囲の外', () => {
  const w = gameWorld();
  const s = meteorSite(w, giantZone, pyramidSite(w));
  const d = Math.hypot(s.x, s.z);
  assert.ok(d > 9000 && d < 12000, `出発地点から ${d * 0.15}m`);
  const py = pyramidSite(w);
  assert.ok(Math.hypot(s.x - py.cx, s.z - py.cz) > BLAST_R + 1000, 'ピラミッドから遠い');
  // はじめに向いている向き（ピラミッドの方）から 45° 以内
  const face = Math.atan2(py.cx, py.cz), a = Math.atan2(s.x, s.z);
  const diff = Math.abs(((a - face + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  assert.ok(diff < 0.8, `向きの差 ${diff}`);
});

test('隕石: ボタンで落ちてきて、激突すると深いクレーター（縁から底まで約 100m）と高い外輪山ができる。1km の外は変わらない', () => {
  const w = gameWorld();
  spawnPlayer(w);
  const before = (r) => w.sample(w._meteorSite?.x + r, w._meteorSite?.z, {}).h;
  const m = startMeteor(w);
  assert.ok(m);
  const s = m.site;
  const far0 = w.sample(s.x + BLAST_R + 1500, s.z, {}).h;
  const center0 = w.sample(s.x, s.z, {}).h;
  void before;
  // 落ちてくる間は、まだ地形は変わらない
  const ev1 = run(w, T_FALL - 1);
  assert.ok(ev1.some((e) => e.type === 'meteorSpotted'));
  assert.equal(w.impact, undefined);
  assert.equal(w.sample(s.x, s.z, {}).h, center0);
  const ev2 = run(w, 1.5);
  assert.ok(ev2.some((e) => e.type === 'meteorImpact'), '激突した');
  assert.ok(w.impact);
  // すり鉢の底と外輪山
  let floor = Infinity, rim = 0;
  for (let a = 0; a < 12; a++) {
    const c = Math.cos((a / 12) * Math.PI * 2), sn = Math.sin((a / 12) * Math.PI * 2);
    for (let r = 300; r <= CRATER_R * 0.5; r += 150) floor = Math.min(floor, w.sample(s.x + c * r, s.z + sn * r, {}).h);
    rim = Math.max(rim, w.sample(s.x + c * CRATER_R, s.z + sn * CRATER_R, {}).h);
  }
  assert.ok(floor < 40, `底 ${floor}`);
  assert.ok(rim > RIM_Y * 0.9 && rim < 1000, `外輪山 ${rim}`);
  assert.ok((rim - floor) * 0.15 > 90, `縁から底まで ${((rim - floor) * 0.15).toFixed(0)}m`);
  // すり鉢の中に水はない
  for (let r = 0; r < CRATER_R + 1500; r += 300) assert.equal(w.sample(s.x + r, s.z + 40, {}).water, 0);
  // 1km の外は変わらない
  assert.equal(w.sample(s.x + BLAST_R + 1500, s.z, {}).h, far0);
  // 焼け野原の中は焼けている
  assert.ok(w.sample(s.x + BLAST_R * 0.7, s.z, {}).blast > 0.5);
  assert.equal(w.sample(s.x + BLAST_R + 1500, s.z, {}).blast, 0);
});

test('隕石: 半径 1km の森は焼かれる（ふつうの木は残らず、巨大樹は葉のない黒焦げの幹だけが外へ傾いて残る）', () => {
  const w = gameWorld();
  const s = meteorSite(w, giantZone, pyramidSite(w));
  const giantsBefore = giantSpecsNear(w, s.x - BLAST_R, s.z - BLAST_R, s.x + BLAST_R, s.z + BLAST_R).filter((g) => Math.hypot(g.x - s.x, g.z - s.z) < BLAST_R - 300);
  let treesBefore = 0;
  for (let rz = Math.floor((s.z - 3000) / 24); rz < (s.z + 3000) / 24; rz += 7) for (let rx = Math.floor((s.x + 3500) / 24); rx < (s.x + 6000) / 24; rx += 7) if (regionSpec(w, rx, rz)) treesBefore++;
  applyImpact(w, s);
  let treesAfter = 0;
  for (let rz = Math.floor((s.z - 3000) / 24); rz < (s.z + 3000) / 24; rz += 7) for (let rx = Math.floor((s.x + 3500) / 24); rx < (s.x + 6000) / 24; rx += 7) if (regionSpec(w, rx, rz)) treesAfter++;
  assert.ok(treesBefore > 5, `もとの木 ${treesBefore}`);
  assert.ok(treesAfter <= treesBefore * 0.05, `焼けたあとの木 ${treesAfter}`);
  const giants = giantSpecsNear(w, s.x - BLAST_R, s.z - BLAST_R, s.x + BLAST_R, s.z + BLAST_R).filter((g) => Math.hypot(g.x - s.x, g.z - s.z) < BLAST_R - 300);
  assert.ok(giants.every((g) => g.burn), '1km の中の巨大樹はすべて焼けている');
  assert.ok(giants.every((g) => Math.hypot(g.x - s.x, g.z - s.z) > CRATER_R + 1000), 'クレーターの近くの巨大樹は吹き飛ばされた');
  if (giantsBefore.length && giants.length) {
    // 焼けた巨大樹を塗ったチャンクに、葉の緑はない
    const g = giants[0];
    ensureAround(w, g.x, g.z, 1);
    let green = 0, charred = 0;
    for (const c of w.chunks.values()) {
      for (let i = 0; i < c.owner.length; i++) {
        const e = w.entities.get(c.owner[i]);
        if (!e?.giant || !c.color[i]) continue;
        const col = c.color[i], r = (col >> 16) & 255, gg = (col >> 8) & 255, b = col & 255;
        if (gg > r + 10 && gg > b + 10) green++;
        else charred++;
      }
    }
    assert.ok(charred > 200, `焦げた幹 ${charred}`);
    assert.equal(green, 0, '葉は焼け落ちた');
  }
});

test('隕石: チャンクを作るスレッドの世界でも、同じクレーターと焼けた巨大樹になる', () => {
  const a = gameWorld();
  spawnPlayer(a);
  const m = startMeteor(a);
  run(a, T_FALL + 0.2);
  const b = new World({ seed: SEED });
  b.noEntities = true;
  applyImpact(b, m.site);
  for (const [dx, dz] of [[0, 0], [800, 300], [CRATER_R, 0], [-CRATER_R - 600, 200], [4000, -3000]]) {
    const x = m.site.x + dx, z = m.site.z + dz;
    assert.equal(b.sample(x, z, {}).h, a.sample(x, z, {}).h, `${dx},${dz}`);
  }
  const ga = giantSpecsNear(a, m.site.x + 3800, m.site.z - 2000, m.site.x + 6000, m.site.z + 2000);
  const gb = giantSpecsNear(b, m.site.x + 3800, m.site.z - 2000, m.site.x + 6000, m.site.z + 2000);
  assert.deepEqual(gb.map((g) => [g.x, g.z, g.y, g.burn?.cut]), ga.map((g) => [g.x, g.z, g.y, g.burn?.cut]));
});

test('隕石: クレーターの近くにいると、地面の波で持ち上がり、衝撃波で外へ吹き飛ばされて大きな傷を受ける', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const m = startMeteor(w);
  const s = m.site;
  // 外輪山の外、700m ほどの所に立つ
  const R = 4600;
  moveTo(w, p, s.x + R, s.z);
  const types = [];
  const ev = run(w, T_FALL + R / AIR_BLAST + 0.5);
  types.push(...ev.map((e) => e.type));
  const blast = ev.find((e) => e.type === 'meteorBlast');
  assert.ok(blast, types.filter((t) => t.startsWith('meteor')).join());
  assert.ok(blast.damage >= 20 && blast.damage < 100, `傷 ${blast.damage}`);
  assert.ok(p.hp <= 100 - blast.damage + 1, `体力 ${p.hp}`);
  assert.ok(p.pos[0] + 4 > s.x + R, '外へ吹き飛ばされた');
  // 地面の波も届く
  const ev2 = run(w, (R / GROUND_WAVE) - (R / AIR_BLAST) + 0.5);
  assert.ok(ev2.some((e) => e.type === 'meteorQuake'));
  // 立っている所は地面の上（地面に埋もれていない）
  for (let o = 0; o < p.offsets.length; o += 3) assert.equal(w.ownerAt(p.pos[0] + p.offsets[o], p.pos[1] + p.offsets[o + 1], p.pos[2] + p.offsets[o + 2]), p.id);
});

test('隕石: クレーターの真ん中のすぐそばにいると、力尽きて出発地点に戻る', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const m = startMeteor(w);
  moveTo(w, p, m.site.x + 300, m.site.z + 200);
  const ev = run(w, T_FALL + 1);
  assert.ok(ev.some((e) => e.type === 'meteorBlast'));
  assert.ok(ev.some((e) => e.type === 'respawn'), '力尽きた');
  assert.ok(Math.hypot(p.pos[0], p.pos[2]) < 200, '出発地点に戻った');
});

test('隕石: 激突のあと、空に巻き上げられた岩がプレイヤーのまわりに時間差で降ってきて、地面に岩として残る', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 7);
  const m = startMeteor(w);
  run(w, T_FALL + 4);
  assert.equal(m.spawned, 0, 'すぐには降ってこない');
  run(w, 40);
  assert.ok(m.spawned >= 3, `降ってきた岩 ${m.spawned}`);
  assert.ok(m.landed >= 2, `地面に落ちた岩 ${m.landed}`);
  // 落ちた岩は地面の上に残っている
  let rocks = 0;
  for (const c of w.chunks.values()) for (let i = 0; i < c.owner.length; i++) if (c.owner[i] === ROCK_ID && [0xff7a1a, 0xe0501a, 0xffa030, 0x2a2422, 0x3a302a, 0x1f1b19, 0x4a3a30].includes(c.color[i])) rocks++;
  assert.ok(rocks > 10, `残った岩のセル ${rocks}`);
  void EMPTY;
});
