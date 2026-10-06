// シャベル: 足元の前の地面を掘って土を持ち、好きな所に盛る
//
// - 掘る: 体の前の地面を、お椀の形に大きくえぐる（1 回で最大 40 ボクセルほど。幅 80cm・深さ 30cm）。
//   掘れるのは土・砂・砂利だけ。深く掘ると岩に当たって刃が弾かれる（terrain.js の isSoil）
// - すくった土はシャベルにのせて持ち運ぶ。持てるのは SOIL_MAX まで
// - 盛る: 体の前に、持っている土を小山の形にどさっと置く（水の中にも置けるので、川をせき止められる）
// - 掘った穴の壁と底には、土の層や岩の色が見える。穴が水より低ければ水が流れ込む（water.js が計算する）

import { EMPTY, GROUND_ID, WATER_ID, FALL_ID, PLANT_ID, SOIL_ID } from './ids.js';
import { isSoil, groundColor, soilColor } from './terrain.js';
import { CHUNK, floorDiv } from './grid.js';

export const SOIL_MAX = 200; // 持てる土（ボクセル）
const REACH = 7.5; // 体の中心から、えぐる所の中心まで（足元はえぐらない）
const SCOOP = [2.8, 2.2]; // えぐるお椀の半径（横・深さ）
const DUMP = 40; // 1 回に盛る土
const AIM_REACH = 18; // 一人称のとき、視線の先の地面が（水平に）これより遠ければ届かない（ふつうの前の所を掘る）

// 体の前の、えぐる所（盛る所）の中心の列。
// 一人称のとき（視線の上下 e.aimPitch がある）は、目から視線の先をたどって当たった地面（届く所まで）
function frontCenter(world, e) {
  const yaw = e.pose.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (e.aimPitch !== null && e.aimPitch !== undefined) {
    const cp = Math.cos(e.aimPitch), sp = Math.sin(e.aimPitch);
    const eye = [e.pos[0] + 4.5, e.pos[1] + 13.5, e.pos[2] + 4.5];
    for (let s = 3; s <= AIM_REACH * 2; s += 0.5) {
      const x = eye[0] + fx * cp * s, y = eye[1] + sp * s, z = eye[2] + fz * cp * s;
      const o = world.ownerAt(Math.floor(x), Math.floor(y), Math.floor(z));
      if (o === EMPTY || o === e.id || o === e.toolId || o === WATER_ID || o === FALL_ID || o === PLANT_ID) continue;
      if (world.entities.get(o)?.yields) continue;
      const h = Math.hypot(x - eye[0], z - eye[2]);
      if (h < 4.5 || h > AIM_REACH) break; // 足元すぎる所・遠すぎる所は、ふつうの前の所
      return [x, z];
    }
  }
  return [e.pos[0] + 4.5 + fx * REACH, e.pos[2] + 4.5 + fz * REACH];
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
export function removeCell(world, x, y, z, memo) {
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

// 掘る。体の前の地面をお椀の形にえぐる（上のセルから順に）。
// 戻り値は出来事 { type: 'dig', actor, result: 'dug' | 'rock' | 'full' | 'miss', amount, soil }
export function dig(world, e) {
  const ev = { type: 'dig', actor: e, result: 'miss', amount: 0, soil: e.soil };
  if (e.soil >= SOIL_MAX) {
    ev.result = 'full';
    return ev;
  }
  const memo = new Map();
  const feet = e.pos[1];
  const [cx, cz] = frontCenter(world, e);
  const top = world.groundAt(Math.floor(cx), Math.floor(cz)) - 1; // 刃が入る所の地面
  if (top < feet - 7 || top > feet + 3) return ev; // 届かない
  const [R, D] = SCOOP;
  const cells = [];
  for (let z = Math.floor(cz - R); z <= Math.floor(cz + R); z++) {
    for (let x = Math.floor(cx - R); x <= Math.floor(cx + R); x++) {
      const hor = ((x + 0.5 - cx) / R) ** 2 + ((z + 0.5 - cz) / R) ** 2;
      if (hor > 1) continue;
      // お椀: 真ん中ほど深い。地面のでこぼこに沿って、その列の地面から掘り下げる
      const ground = world.groundAt(x, z) - 1;
      const depth = Math.round(D * Math.sqrt(1 - hor) + 0.3);
      for (let y = ground; y > ground - depth && y >= top - D - 1; y--) cells.push([x, y, z, hor]);
    }
  }
  // 上のセルから、真ん中に近い順に
  cells.sort((a, b) => b[1] - a[1] || a[3] - b[3]);
  let rock = 0;
  const hitRock = new Set(); // 岩に当たった列は、その下を掘らない
  for (const [x, y, z] of cells) {
    if (e.soil >= SOIL_MAX) break;
    const key = x * 100003 + z;
    if (hitRock.has(key)) continue;
    const c = world.chunkAt(floorDiv(x, CHUNK), floorDiv(z, CHUNK));
    if (y - 1 < c.base) continue; // 底が見えなくなるほど深い所
    const o = world.ownerAt(x, y, z);
    if (o !== GROUND_ID && o !== SOIL_ID) continue;
    if (!passable(world.ownerAt(x, y + 1, z))) continue; // 上に岩や木の根がのっている
    if (o === GROUND_ID) {
      const { col, slope } = terrainAt(world, x, z, memo);
      if (!isSoil(world.seed, x, y, z, col, slope)) {
        rock++;
        hitRock.add(key);
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

// 盛る。体の前に、持っている土を小山の形に置く（真ん中ほど高い）。
// 戻り値は出来事 { type: 'place', actor, result: 'placed' | 'empty' | 'blocked', amount, soil }
export function place(world, e) {
  const ev = { type: 'place', actor: e, result: 'blocked', amount: 0, soil: e.soil };
  if (e.soil <= 0) {
    ev.result = 'empty';
    return ev;
  }
  const feet = e.pos[1];
  const [cx, cz] = frontCenter(world, e);
  const R = SCOOP[0];
  const cols = [];
  for (let z = Math.floor(cz - R); z <= Math.floor(cz + R); z++) {
    for (let x = Math.floor(cx - R); x <= Math.floor(cx + R); x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / R;
      if (d <= 1) cols.push([x, z, d]);
    }
  }
  cols.sort((a, b) => a[2] - b[2]);
  // 1 段ずつ、真ん中から広く置いていく。上の段ほど狭い（小山になる）
  for (let layer = 0; layer < 4 && e.soil > 0 && ev.amount < DUMP; layer++) {
    for (const [x, z, d] of cols) {
      if (e.soil <= 0 || ev.amount >= DUMP) break;
      if (d > 1 - layer * 0.28) continue;
      const y = world.groundAt(x, z); // 地面のすぐ上（水の中なら川底の上）
      if (y > feet + 6) continue; // 高すぎて届かない
      if (!passable(world.ownerAt(x, y, z))) continue; // 人・岩・木などがある
      world.setCell(x, y, z, SOIL_ID, soilColor(x, y, z));
      world.recomputeHeight(x, z);
      e.soil--;
      ev.amount++;
    }
  }
  ev.soil = e.soil;
  if (ev.amount) ev.result = 'placed';
  return ev;
}
