import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, PLANT_ID, GROUND_ID } from '../src/world.js';
import { downsample, coarser, lodInstances, chunkLod } from '../src/lod.js';
import { CHUNK, LAYER } from '../src/grid.js';

// 平らな地面のチャンク（地表の 1 段だけ色がつき、中は消灯）
function flatChunk(h, base = 0) {
  const layers = h - base + 32;
  const c = {
    base, top: h, owner: new Int32Array(layers * LAYER), color: new Uint32Array(layers * LAYER),
    height: new Uint16Array(CHUNK * CHUNK).fill(h),
  };
  for (let y = base; y < h; y++) {
    for (let i = 0; i < LAYER; i++) {
      c.owner[(y - base) * LAYER + i] = GROUND_ID;
      if (y === h - 1) c.color[(y - base) * LAYER + i] = 0x55aa33;
    }
  }
  return c;
}

const put = (c, x, y, z, owner, color) => {
  const i = x + CHUNK * (z + CHUNK * (y - c.base));
  c.owner[i] = owner;
  c.color[i] = color;
  c.top = Math.max(c.top, y + 1);
};

test('平らな地面は、地表の 1 層の粗いブロックになる（色は地表の色）', () => {
  const c = flatChunk(20, 10);
  const l1 = downsample(c);
  assert.equal(l1.s, 2);
  const i1 = lodInstances(l1);
  assert.equal(i1.count, 8 * 8);
  for (let k = 0; k < i1.count; k++) {
    assert.equal(i1.cell[k * 4 + 1], 19); // 18〜20 のブロックの中心
    assert.deepEqual([...i1.rgb.subarray(k * 3, k * 3 + 3)], [0x55, 0xaa, 0x33]);
  }
  const i2 = lodInstances(coarser(l1));
  assert.equal(i2.count, 4 * 4);
  assert.equal(i2.cell[1], 18); // 16〜20 のブロックの中心
});

test('ブロックの色は、中で一番上のセルの色。細い幹も消えない', () => {
  const c = flatChunk(20);
  // 1 本の細い柱（幹）と、そのてっぺんの葉
  for (let y = 20; y < 40; y++) put(c, 5, y, 5, 99, 0x664422);
  put(c, 5, 40, 5, 99, 0x22aa22);
  const l1 = downsample(c);
  const n = CHUNK / 2;
  assert.equal(l1.grid[2 + n * (2 + n * 10)] & 0xffffff, 0x664422); // y 20〜21
  assert.equal(l1.grid[2 + n * (2 + n * 20)] & 0xffffff, 0x22aa22); // y 40〜41
  const i1 = lodInstances(l1);
  // 柱は 11 個のブロック（y 20〜41）がすべて描かれる
  let column = 0;
  for (let k = 0; k < i1.count; k++) if (i1.cell[k * 4] === 5 && i1.cell[k * 4 + 1] >= 21) column++;
  assert.equal(column, 11);
});

test('草と、除いた持ち主のセルは粗いブロックに入らない', () => {
  const c = flatChunk(20);
  put(c, 3, 20, 3, PLANT_ID, 0x33cc33);
  put(c, 9, 20, 9, 1234, 0xff0000); // 動く物
  const skip = (o) => o === PLANT_ID || o === 1234;
  assert.equal(lodInstances(downsample(c, skip)).count, 64);
  assert.equal(lodInstances(downsample(c)).count, 66);
});

test('色の値が黒（RGB がすべて 0）のセルも粗いブロックになる', () => {
  const c = flatChunk(20);
  put(c, 8, 30, 8, 99, 0x02000000); // 消灯（0）ではないが、RGB は黒
  assert.equal(lodInstances(downsample(c)).count, 65);
});

test('囲まれたブロックは描かない（外に面したブロックだけ）', () => {
  const c = flatChunk(40);
  // 中まで色のついた 8×8×8 の塊（チャンクの真ん中）
  for (let y = 40; y < 48; y++) for (let z = 4; z < 12; z++) for (let x = 4; x < 12; x++) put(c, x, y, z, 99, 0x888888);
  const i1 = lodInstances(downsample(c));
  // 塊は 4×4×4 = 64 ブロック。下の 3 段の真ん中の 2×2（下は地面、まわりと上は塊）は描かない
  // 地面 64 のうち、塊の真下の 16 は上がふさがるが、地面の下は空（消灯）なので描く
  assert.equal(i1.count, 64 + 64 - 12);
});

test('本物のチャンク: 地表のどの列にもブロックがあり、セルよりずっと少ない', () => {
  const w = new World({ seed: 20261004 });
  w.noEntities = true;
  for (const [cx, cz] of [[7, 3], [-9, 12], [15, -15]]) {
    const c = w.chunkAt(cx, cz);
    const { i1, i2 } = chunkLod(c, (o) => o === PLANT_ID);
    let colored = 0;
    for (let i = 0; i < LAYER * (c.top - c.base); i++) if (c.color[i]) colored++;
    assert.ok(i1.count > 0 && i1.count < colored, `${i1.count} < ${colored}`);
    assert.ok(i2.count > 0 && i2.count < i1.count);
    // 列ごとの地面の高さのそばに、2×2×2 のブロックがある
    for (let bz = 0; bz < 8; bz++) {
      for (let bx = 0; bx < 8; bx++) {
        let h = 0;
        for (let z = bz * 2; z < bz * 2 + 2; z++) for (let x = bx * 2; x < bx * 2 + 2; x++) h = Math.max(h, c.height[x + CHUNK * z]);
        let found = false;
        for (let k = 0; k < i1.count && !found; k++) {
          found = i1.cell[k * 4] === bx * 2 + 1 && i1.cell[k * 4 + 2] === bz * 2 + 1 && Math.abs(i1.cell[k * 4 + 1] - (h - 1)) <= 2;
        }
        assert.ok(found, `column ${bx},${bz} of chunk ${cx},${cz} (h ${h})`);
      }
    }
  }
});
