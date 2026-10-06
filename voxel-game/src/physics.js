// 崩れる・落ちる: 支えを失った土砂は落ち、急な斜面は滑り落ちる。地面から切り離された岩の塊はまるごと落ちる
//
// - 土砂: 土・砂・砂利（terrain.js の isSoil）と、盛った土。下が空いていれば 1 ティックに 1 段落ちる。
//   下が詰まっていても、横とその下が空いていれば、斜め下へ滑る。
//   もとの地面の土は粘りがあるので、2 段より急な所だけ崩れる（≈ 63°）。崩れた土と盛った土はさらさらで、45° まで滑る。
//   動いた土は盛り土（また掘れる）になる。水に落ちると、そのぶん川底が上がり、水位が上がる（water.js が床の変化を拾う）
// - 岩の塊: 掘ったり光線でえぐったりした所のまわりで、地面のつながりを調べる。地中の奥まで（チャンクの底まで）つながっていない
//   塊（3000 ボクセルまで）は、地面から外れて、まるごと落ちる物になる（重力で落ち、水に落ちるとしぶきが上がる）
// - 何も起きていない所は調べない。掘った・削った・盛った所のまわりだけを「動くかもしれないセル」として覚えておき、少しずつ調べる

import { EMPTY, GROUND_ID, WATER_ID, ROCK_ID, FALL_ID, PLANT_ID, SOIL_ID } from './ids.js';
import { CHUNK, LAYER, chunkKeyAt } from './grid.js';
import { isSoil, soilColor, groundColor } from './terrain.js';
import { removeCell } from './shovel.js';

const CHECKS_PER_TICK = 400; // 1 ティックに調べる土砂のセル
const ROCK_LIMIT = 3000; // これより大きい塊は地面につながっているとみなす
const ROCK_CHECKS_PER_TICK = 2;

const key3 = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 1024 + y;
const passable = (o) => o === EMPTY || o === WATER_ID || o === FALL_ID || o === PLANT_ID;

export class Physics {
  constructor(world) {
    this.world = world;
    this.active = new Map(); // 動くかもしれない土砂のセル: key → [x, y, z]
    this.rockChecks = new Map(); // つながりを調べる岩のセル: key → [x, y, z]
    this.memo = new Map(); // 列の地形（isSoil に使う）
    this.moved = 0; // 動いた土砂のセルの数（数えるだけ）
    this.fallen = []; // 落ちていった岩の塊
  }

  // 作られているチャンクのセルの持ち主（作られていない所・範囲外は -1、地中の奥は地面）
  owner(x, y, z) {
    const c = this.world.chunks.get(chunkKeyAt(x, z));
    if (!c || y < 0) return -1;
    if (y < c.base) return GROUND_ID;
    if ((y - c.base + 1) * LAYER > c.owner.length) return EMPTY;
    return c.owner[c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
  }

  // (x, y, z) のまわりで何かが変わった: 上とまわりの土砂を調べ直す。岩のつながりも調べる
  wake(x, y, z, rock = true) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) this.active.set(key3(x + dx, y + dy, z + dz), [x + dx, y + dy, z + dz]);
      }
    }
    if (rock) {
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        this.rockChecks.set(key3(x + dx, y + dy, z + dz), [x + dx, y + dy, z + dz]);
      }
    }
  }

  // 列の地形（掘る前のもとの地形と、まわりとの高さの差）
  column(x, z) {
    const key = x * 100003 + z;
    let t = this.memo.get(key);
    if (!t) {
      if (this.memo.size > 20000) this.memo.clear();
      const w = this.world;
      const col = w.sample(x, z, {});
      let slope = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) slope = Math.max(slope, Math.abs(w.heightAt(x + dx, z + dz) - col.h));
      this.memo.set(key, (t = { col, slope }));
    }
    return t;
  }

  // セルが土砂か。戻り値: 0 = 土砂ではない、1 = さらさら（45° まで滑る）、2 = 粘りのある土（63° まで）
  grain(o, x, y, z) {
    if (o === SOIL_ID) return 1;
    if (o !== GROUND_ID || !this.world.terrain) return 0;
    const { col, slope } = this.column(x, z);
    return isSoil(this.world.seed, x, y, z, col, slope) ? 2 : 0;
  }

  step() {
    if (this.active.size) this.stepGrains();
    let n = 0;
    for (const [k, p] of this.rockChecks) {
      this.rockChecks.delete(k);
      this.checkRock(p[0], p[1], p[2]);
      if (++n >= ROCK_CHECKS_PER_TICK) break;
    }
  }

  // 土砂を動かす（下のセルから順に。上のセルが先に動くと、宙に浮いた列ができるので）
  stepGrains() {
    const list = [...this.active.values()].sort((a, b) => a[1] - b[1]).slice(0, CHECKS_PER_TICK);
    for (const p of list) this.active.delete(key3(p[0], p[1], p[2]));
    for (const [x, y, z] of list) {
      const o = this.owner(x, y, z);
      if (o !== GROUND_ID && o !== SOIL_ID) continue;
      const kind = this.grain(o, x, y, z);
      if (!kind) continue;
      let to = null;
      if (passable(this.owner(x, y - 1, z))) {
        to = [x, y - 1, z];
      } else {
        // 斜め下へ滑る（向きは毎回ばらばらに試す）
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const r = (x * 7 + z * 13 + y + this.moved) & 3;
        for (let k = 0; k < 4 && !to; k++) {
          const [dx, dz] = dirs[(k + r) & 3];
          let ok = true;
          for (let d = 0; d <= kind && ok; d++) if (!passable(this.owner(x + dx, y - d, z + dz))) ok = false;
          if (ok) to = [x + dx, y - 1, z + dz];
        }
      }
      if (to) this.moveGrain(x, y, z, to);
    }
  }

  moveGrain(x, y, z, [nx, ny, nz]) {
    const w = this.world;
    const color = w.colorAt(x, y, z) || soilColor(x, y, z);
    const wet = w.loadedWaterAt(nx, nz) > ny; // 水の中へ落ちる
    removeCell(w, x, y, z, this.memo);
    if (this.owner(nx, ny, nz) === PLANT_ID) w.setCell(nx, ny, nz, EMPTY, 0); // 草はつぶれる
    w.setCell(nx, ny, nz, SOIL_ID, color);
    w.recomputeHeight(nx, nz);
    this.moved++;
    if (wet && w.loadedWaterAt(nx, nz) <= y) w.splashes?.splash(nx + 0.5, w.loadedWaterAt(nx, nz), nz + 0.5, 1); // 水面に落ちた
    // 動いたあとのまわりを調べ直す（落ちた土はさらに落ちる・滑るかもしれない。上の土は支えを失った）
    this.wake(x, y, z, false);
    this.active.set(key3(nx, ny, nz), [nx, ny, nz]);
  }

  // 岩（土砂でない地面・川の岩・盛った土）のつながりを調べる。地中の奥まで届かない塊は落ちる
  checkRock(x, y, z) {
    const solid = (o) => o === GROUND_ID || o === ROCK_ID || o === SOIL_ID;
    if (!solid(this.owner(x, y, z))) return;
    const seen = new Map();
    const stack = [[x, y, z]];
    seen.set(key3(x, y, z), [x, y, z]);
    while (stack.length) {
      const [cx, cy, cz] = stack.pop();
      // 下を最後に積む（先に取り出される）: 地中の奥へ向かって先に調べるので、地面につながった岩はすぐに分かる
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const k = key3(nx, ny, nz);
        if (seen.has(k)) continue;
        const o = this.owner(nx, ny, nz);
        if (o === -1) return; // まだ作られていない所: その先でつながっているかもしれないので、落とさない
        if (!solid(o)) continue;
        if (ny <= this.world.chunks.get(chunkKeyAt(nx, nz)).base) return; // 地中の奥までつながっている
        seen.set(k, [nx, ny, nz]);
        if (seen.size > ROCK_LIMIT) return; // 大きな塊は地面の一部
        stack.push([nx, ny, nz]);
      }
    }
    this.dropRock([...seen.values()]);
  }

  // 塊を地面から外して、落ちる物にする
  dropRock(cells) {
    const w = this.world;
    const inside = new Set(cells.map(([x, y, z]) => key3(x, y, z)));
    const voxels = [];
    for (const [x, y, z] of cells) {
      let color = w.colorAt(x, y, z);
      if (!color) {
        // 隠れていた面が見えるようになる所に色をつける
        const open = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => !inside.has(key3(x + dx, y + dy, z + dz)));
        if (open) {
          const { col, slope } = this.column(x, z);
          color = groundColor(w.seed, x, y, z, col, Math.max(slope, 3));
        }
      }
      voxels.push([x, y, z, color]);
    }
    for (const [x, y, z] of cells) {
      w.setCell(x, y, z, EMPTY, 0);
      w.recomputeHeight(x, z);
    }
    for (const [x, y, z] of cells) this.wake(x, y, z, false);
    const lo = [0, 1, 2].map((a) => Math.min(...voxels.map((v) => v[a])));
    const piece = w.spawn({
      kind: 'carcass', name: '崩れた岩', priority: 8, falling: true, vy: 0, fall: 0, pos: lo,
      voxels: voxels.map(([x, y, z, c]) => [x - lo[0], y - lo[1], z - lo[2], c]),
    });
    if (piece) this.fallen.push(piece);
  }
}
