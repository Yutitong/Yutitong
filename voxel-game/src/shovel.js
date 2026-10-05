// シャベル: 足元の前の地面を掘って土を持ち、好きな所に盛る
//
// - 掘る: 体の前の 3×3 の列から、いちばん上の土のセルを 1 つずつすくう（1 回で最大 9 ボクセル）。
//   掘れるのは土・砂・砂利だけ。深く掘ると岩に当たって刃が弾かれる（terrain.js の isSoil）
// - すくった土はシャベルにのせて持ち運ぶ。持てるのは SOIL_MAX まで
// - 盛る: 体の前の 3×3 の列の上に、持っている土を 1 段ずつ置く（水の中にも置けるので、川をせき止められる）
// - 掘った穴の壁と底には、土の層や岩の色が見える。穴が水より低ければ水が流れ込む（water.js が計算する）

import { EMPTY, GROUND_ID, WATER_ID, FALL_ID, PLANT_ID, SOIL_ID } from './ids.js';
import { isSoil, groundColor, soilColor } from './terrain.js';
import { CHUNK, floorDiv } from './grid.js';

export const SOIL_MAX = 40; // シャベルで持てる土（ボクセル。≈ 135 リットル）
const REACH = 6.5; // 体の中心から刃先まで

// 体の前の 3×3 の列（近い順）
function frontColumns(e) {
  const yaw = e.pose.yaw;
  const cx = e.pos[0] + 4.5 + Math.sin(yaw) * REACH, cz = e.pos[2] + 4.5 + Math.cos(yaw) * REACH;
  const cols = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) cols.push([Math.floor(cx) + dx, Math.floor(cz) + dz]);
  }
  const d = ([x, z]) => Math.hypot(x + 0.5 - e.pos[0] - 4.5, z + 0.5 - e.pos[2] - 4.5);
  return cols.sort((a, b) => d(a) - d(b));
}

// もとの地形（掘る前）と、まわりとの高さの差。同じ列は 1 回の作業の間は使い回す
function terrainAt(world, x, z, memo) {
  const key = x * 100003 + z;
  let t = memo.get(key);
  if (!t) {
    const col = world.sample(x, z, {});
    let slope = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, Math.abs(world.heightAt(x + dx, z + dz) - col.h));
    memo.set(key, (t = { col, slope }));
  }
  return t;
}

const passable = (o) => o === EMPTY || o === WATER_ID || o === FALL_ID || o === PLANT_ID;

// セルを取り除き、あいた穴のまわりの、いままで地中に隠れていた面に色をつける
function removeCell(world, x, y, z, memo) {
  if (world.ownerAt(x, y + 1, z) === PLANT_ID) world.setCell(x, y + 1, z, EMPTY, 0); // 上の草も一緒に
  world.setCell(x, y, z, EMPTY, 0);
  world.recomputeHeight(x, z);
  world.setCell(x, y, z, EMPTY, 0); // 水より低ければ水が入る
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (world.ownerAt(nx, ny, nz) !== GROUND_ID || world.colorAt(nx, ny, nz)) continue;
    const { col, slope } = terrainAt(world, nx, nz, memo);
    world.setCell(nx, ny, nz, GROUND_ID, groundColor(world.seed, nx, ny, nz, col, slope));
  }
}

// 掘る。戻り値は出来事 { type: 'dig', actor, result: 'dug' | 'rock' | 'full' | 'miss', amount, soil }
export function dig(world, e) {
  const ev = { type: 'dig', actor: e, result: 'miss', amount: 0, soil: e.soil };
  if (e.soil >= SOIL_MAX) {
    ev.result = 'full';
    return ev;
  }
  const memo = new Map();
  const feet = e.pos[1];
  let rock = 0;
  for (const [x, z] of frontColumns(e)) {
    if (e.soil >= SOIL_MAX) break;
    const y = world.groundAt(x, z) - 1; // いちばん上の地面のセル
    if (y < feet - 7 || y > feet + 3) continue; // 届かない（足元より 1m ほど下まで）
    const c = world.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    if (y - 1 < c.base) continue; // 底が見えなくなるほど深い所
    const o = world.ownerAt(x, y, z);
    if (o !== GROUND_ID && o !== SOIL_ID) continue;
    if (!passable(world.ownerAt(x, y + 1, z))) continue; // 上に岩や木の根がのっている
    if (o === GROUND_ID) {
      const { col, slope } = terrainAt(world, x, z, memo);
      if (!isSoil(world.seed, x, y, z, col, slope)) {
        rock++;
        continue;
      }
    }
    removeCell(world, x, y, z, memo);
    e.soil++;
    ev.amount++;
  }
  ev.soil = e.soil;
  ev.result = ev.amount ? 'dug' : rock ? 'rock' : 'miss';
  return ev;
}

// 盛る。戻り値は出来事 { type: 'place', actor, result: 'placed' | 'empty' | 'blocked', amount, soil }
export function place(world, e) {
  const ev = { type: 'place', actor: e, result: 'blocked', amount: 0, soil: e.soil };
  if (e.soil <= 0) {
    ev.result = 'empty';
    return ev;
  }
  const feet = e.pos[1];
  for (const [x, z] of frontColumns(e)) {
    if (e.soil <= 0) break;
    const y = world.groundAt(x, z); // 地面のすぐ上（水の中なら川底の上）
    if (y > feet + 6) continue; // 高すぎて届かない
    if (!passable(world.ownerAt(x, y, z))) continue; // 人・岩・木などがある
    world.setCell(x, y, z, SOIL_ID, soilColor(x, y, z));
    world.recomputeHeight(x, z);
    e.soil--;
    ev.amount++;
  }
  ev.soil = e.soil;
  if (ev.amount) ev.result = 'placed';
  return ev;
}
