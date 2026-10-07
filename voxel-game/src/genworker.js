// チャンクを作るスレッド（Web Worker）
//
// 地形・木・岩・シダ・巨大樹を塗ったチャンクを作って、配列ごと送り返す（NPC は受け取った側で置く）。
// 画面を描くスレッドがチャンク作りで止まらないように、重い仕事をこちらでする

import { World, packChunk, PLANT_ID } from './world.js';
import { chunkLod } from './lod.js';
import { applyImpact } from './meteor.js';

let world = null;
const sent = new Set(); // 形を送ったことのある木（受け取った側が忘れたら消す）
let count = 0;

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    world = new World({ seed: m.seed });
    world.noEntities = true;
  } else if (m.type === 'impact') {
    // 隕石が落ちた: このあと作るチャンクはクレーターのある地形で作る
    applyImpact(world, m.at);
  } else if (m.type === 'forget') {
    for (const k of m.keys) sent.delete(k);
  } else if (m.type === 'gen') {
    const c = world.chunkAt(m.cx, m.cz);
    const out = packChunk(world, c, sent);
    world.chunks.delete(c.key);
    world.dirty.clear();
    self.postMessage({ type: 'chunk', epoch: world.impactEpoch ?? 0, ...out }, [out.owner.buffer, out.color.buffer, out.height.buffer, out.water.buffer, out.fixed.buffer]);
    // ときどき、遠くの木や巨大樹の形を忘れる（メモリを使いすぎないように）
    if (++count % 64 === 0) prune(m.cx * 16, m.cz * 16);
  } else if (m.type === 'lod') {
    // 少し遠くのチャンク: 粗いブロックにまとめたものだけを送る
    const c = world.chunkAt(m.cx, m.cz);
    const { i1, i2 } = chunkLod(c, (o) => o === PLANT_ID);
    world.chunks.delete(c.key);
    world.dirty.clear();
    const out = { type: 'lod', epoch: world.impactEpoch ?? 0, cx: m.cx, cz: m.cz, i1: copy(i1), i2: copy(i2) };
    self.postMessage(out, [out.i1.cell.buffer, out.i1.rgb.buffer, out.i2.cell.buffer, out.i2.rgb.buffer]);
    if (++count % 64 === 0) prune(m.cx * 16, m.cz * 16);
  }
};

// 部分配列を、送れる（大きさがちょうどの）配列にする
const copy = (l) => ({ count: l.count, cell: l.cell.slice(), rgb: l.rgb.slice() });

function prune(x, z) {
  const far = (sx, sz) => Math.max(Math.abs(sx - x), Math.abs(sz - z)) > 900;
  for (const [key, tree] of world.trees) {
    if (!far(tree.spec.x, tree.spec.z)) continue;
    world.trees.delete(key);
    world.entities.delete(tree.id);
  }
  for (const [key, g] of world.giants) {
    if (!far(g.spec.x, g.spec.z)) continue;
    world.giants.delete(key);
    world.entities.delete(g.id);
  }
}
