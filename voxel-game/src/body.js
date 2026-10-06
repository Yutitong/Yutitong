// 毎回形を描き直す大きな物（龍・倒れていく木）を世界に書き込む
//
// - 新しい形のセルを書き、前回のセルのうち使わなくなったものを消す
// - 空いているセルに入る。人・NPC・箱がいるセルは、その物を away の向きへ押しのけてから入る
//   （押しのけられなければ入らない）。地形・木・岩・水などには入らない
// - 1つのボクセルには1つの物だけ、は常に守られる

import { CHUNK, LAYER, chunkKey } from './grid.js';

export const MOVABLE = new Set(['player', 'npc', 'box']); // 押しのけられる物

// world.bodyMakesChunks が false なら、まだ作られていない（または片付けた）チャンクには描かない。
// ゲームではそうする: 龍の体は長く遠くまで届くので、そこのチャンクを作り始めると重くなる（見えない所なので描かなくてよい）
const chunkOf = (world, key) => world.chunks.get(key)
  ?? (world.bodyMakesChunks === false ? null : world.chunkAt(Math.floor(key / 65536) - 32768, (key % 65536) - 32768));

// セルごとに「この描き直しで書いたか」の印（世代番号）を持たせる。チャンクの配列が伸びたら合わせて伸ばす
function stampOf(chunk) {
  if (!chunk.stamp || chunk.stamp.length !== chunk.owner.length) {
    const s = new Uint32Array(chunk.owner.length);
    if (chunk.stamp) s.set(chunk.stamp);
    chunk.stamp = s;
  }
  return chunk.stamp;
}

// prev: 前回のセル [チャンクの番号, セル番号, ...]
// shape(emit): emit(x, y, z, color) を形の各セルについて呼ぶ（同じセルが何度来てもよい。最後の色になる）
// away(m, e): 位置 m にいる物 e を押しのける向き [dx, dz]（長さは問わない）。null なら押しのけない（そのセルには入らない）
// 戻り値: { cells: 今回のセル, pushed: [押しのけた物] }
//
// 戻り値の cells は Uint32Array（物ごとに 2 つの配列を交互に使い回す。毎回大きな配列を作るとメモリの片付けが重いので）。
// 呼んだ側は、次に描き直すときに prev として渡すだけにすること（ほかの所で取っておかない）
//
// 前回のセルを全部消してから書き直すのではなく、新しい形を書いてから、今回使わなかった前回のセルだけを消す。
// 前回と同じ所・同じ色のセルは書き換えないので、描画側の手間も少ない
const buffers = new Map(); // 物の id → [配列, 配列]

export function redrawBody(world, id, prev, shape, away) {
  const gen = (world.bodyGen = (world.bodyGen ?? 0) + 1);
  // 今回のセルを書く配列: 前回のセルが入っていない方
  let pair = buffers.get(id);
  if (!pair) buffers.set(id, (pair = [new Uint32Array(1024), new Uint32Array(1024)])); // チャンクの番号は 2^31 を超えるので符号なし
  const side = prev.buffer === pair[0].buffer ? 1 : 0;
  let out = pair[side];
  let n = 0;
  const push = (key, i) => {
    if (n + 2 > out.length) {
      const bigger = new Uint32Array(out.length * 2);
      bigger.set(out);
      out = pair[side] = bigger;
    }
    out[n++] = key;
    out[n++] = i;
  };
  let chunk = null;
  let stamp = null;
  let ck = -1;
  let ccx = NaN, ccz = NaN; // いま開いているチャンクの番号
  const use = (key) => {
    if (key !== ck) {
      ck = key;
      chunk = chunkOf(world, key);
      stamp = null;
      ccx = NaN;
      if (chunk) world.dirty.add(key);
    }
  };
  const blocked = new Map(); // 押しのける物の id → [チャンク, セル番号, 色, チャンクの番号, ...]
  shape((x, y, z, color) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    if (cx !== ccx || cz !== ccz) {
      use(chunkKey(cx, cz));
      ccx = cx;
      ccz = cz;
    }
    if (!chunk || y < chunk.base) return; // 作られていない所・地中の奥
    if ((y - chunk.base + 1) * LAYER > chunk.owner.length) {
      chunk.ensure(y);
      stamp = null;
    }
    if (stamp === null) stamp = stampOf(chunk);
    const i = (x - cx * CHUNK) + CHUNK * ((z - cz * CHUNK) + CHUNK * (y - chunk.base));
    // 同じセルが何度か来ることがある（2 回目からは何もしない。最初の色になる）
    if (stamp[i] === gen && chunk.owner[i] === id) return;
    const owner = chunk.owner[i];
    if (owner !== 0 && owner !== id) {
      const other = world.entities.get(owner);
      if (other?.yields) {
        // いつでも場所をゆずる物（滝の水・炎など）の所には入る
        chunk.owner[i] = id;
      } else {
        if (MOVABLE.has(other?.kind)) {
          let list = blocked.get(owner);
          if (!list) blocked.set(owner, (list = []));
          list.push(chunk, i, color, ck);
        }
        return;
      }
    } else if (owner === 0) {
      chunk.owner[i] = id;
    }
    if (y >= chunk.top) chunk.top = y + 1;
    stamp[i] = gen;
    push(ck, i);
    if (chunk.color[i] !== color) {
      chunk.color[i] = color;
      chunk.changed.push(i);
    }
  });
  const pushed = [];
  for (const [eid, list] of blocked) {
    const e = world.entities.get(eid);
    if (shove(world, e, list, away)) pushed.push(e);
    // 空いたセルに入る
    for (let k = 0; k < list.length; k += 4) {
      const c = list[k], i = list[k + 1];
      if (c.owner[i] !== 0) continue;
      c.owner[i] = id;
      c.color[i] = list[k + 2];
      stampOf(c)[i] = gen;
      c.top = Math.max(c.top, c.yOf(i) + 1);
      c.changed.push(i);
      world.dirty.add(c.key);
      push(list[k + 3], i);
    }
  }
  // 前回のセルのうち、今回使わなかったものを消す
  for (let k = 0; k < prev.length; k += 2) {
    use(prev[k]);
    const i = prev[k + 1];
    if (!chunk || chunk.owner[i] !== id || stampOf(chunk)[i] === gen) continue;
    chunk.owner[i] = 0;
    chunk.color[i] = 0;
    chunk.changed.push(i);
  }
  return { cells: out.subarray(0, n), pushed };
}

// 物 e を1ボクセルずつ押しのける。セルの一覧 list と重ならなくなるまで
function shove(world, e, list, away) {
  if (!e._mid) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let o = 0; o < e.offsets.length; o += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], e.offsets[o + a]);
        hi[a] = Math.max(hi[a], e.offsets[o + a] + 1);
      }
    }
    e._mid = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  }
  const overlapping = () => {
    for (let n = 0; n < list.length; n += 4) if (list[n].owner[list[n + 1]] === e.id) return true;
    return false;
  };
  let moved = false;
  for (let step = 0; step < 24 && overlapping(); step++) {
    const m = [e.pos[0] + e._mid[0], e.pos[1] + e._mid[1], e.pos[2] + e._mid[2]];
    const dir = away(m, e);
    if (!dir) break;
    const a = Math.atan2(dir[1], dir[0]);
    // 押しのける向き（8方向）。だめなら少しずつ横へずらす。段差は 2 段まで押し上げる
    let ok = false;
    for (const turn of [0, 0.785, -0.785, 1.571, -1.571]) {
      const mx = Math.round(Math.cos(a + turn)), mz = Math.round(Math.sin(a + turn));
      if (!mx && !mz) continue;
      for (const dy of [0, 1, 2]) {
        if (world.tryMove(e.id, [mx, dy, mz]).ok) {
          ok = true;
          break;
        }
      }
      if (ok) break;
    }
    if (!ok) break;
    moved = true;
  }
  return moved;
}

// 前回のセルを消すだけ（物がなくなるとき）
export function clearBody(world, id, prev) {
  redrawBody(world, id, prev, () => {}, () => [1, 0]);
}
