// 毎回形を描き直す大きな物（龍・倒れていく木）を世界に書き込む
//
// - 新しい形のセルを書き、前回のセルのうち使わなくなったものを消す
// - 空いているセルに入る。人・NPC・箱がいるセルは、その物を away の向きへ押しのけてから入る
//   （押しのけられなければ入らない）。地形・木・岩・水などには入らない
// - 1つのボクセルには1つの物だけ、は常に守られる

import { CHUNK, chunkKey } from './grid.js';

export const MOVABLE = new Set(['player', 'npc', 'box']); // 押しのけられる物

const chunkOf = (world, key) => world.chunks.get(key) ?? world.chunkAt(Math.floor(key / 65536) - 32768, (key % 65536) - 32768);

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
// away(m): 位置 m にいる物を押しのける向き [dx, dz]（長さは問わない）
// 戻り値: { cells: 今回のセル, pushed: [押しのけた物] }
//
// 前回のセルを全部消してから書き直すのではなく、新しい形を書いてから、今回使わなかった前回のセルだけを消す。
// 前回と同じ所・同じ色のセルは書き換えないので、描画側の手間も少ない
export function redrawBody(world, id, prev, shape, away) {
  const gen = (world.bodyGen = (world.bodyGen ?? 0) + 1);
  let chunk = null;
  let stamp = null;
  let ck = -1;
  const use = (key) => {
    if (key !== ck) {
      ck = key;
      chunk = chunkOf(world, key);
      stamp = null;
      world.dirty.add(key);
    }
  };
  const cells = [];
  const blocked = new Map(); // 押しのける物の id → [チャンク, セル番号, 色, チャンクの番号, ...]
  shape((x, y, z, color) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    use(chunkKey(cx, cz));
    if (y < chunk.base) return; // 地中の奥
    chunk.ensure(y);
    if (!stamp || stamp.length !== chunk.owner.length) stamp = stampOf(chunk);
    const i = chunk.index(x - cx * CHUNK, y, z - cz * CHUNK);
    const owner = chunk.owner[i];
    if (owner === 0) {
      chunk.owner[i] = id;
      if (y >= chunk.top) chunk.top = y + 1;
    } else if (owner !== id) {
      if (MOVABLE.has(world.entities.get(owner)?.kind)) {
        let list = blocked.get(owner);
        if (!list) blocked.set(owner, (list = []));
        list.push(chunk, i, color, ck);
      }
      return;
    }
    if (stamp[i] !== gen) {
      stamp[i] = gen;
      cells.push(ck, i);
    }
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
    for (let n = 0; n < list.length; n += 4) {
      const c = list[n], i = list[n + 1];
      if (c.owner[i] !== 0) continue;
      c.owner[i] = id;
      c.color[i] = list[n + 2];
      stampOf(c)[i] = gen;
      c.top = Math.max(c.top, c.yOf(i) + 1);
      c.changed.push(i);
      world.dirty.add(c.key);
      cells.push(list[n + 3], i);
    }
  }
  // 前回のセルのうち、今回使わなかったものを消す
  for (let n = 0; n < prev.length; n += 2) {
    use(prev[n]);
    const i = prev[n + 1];
    if (chunk.owner[i] !== id || stampOf(chunk)[i] === gen) continue;
    chunk.owner[i] = 0;
    chunk.color[i] = 0;
    chunk.changed.push(i);
  }
  return { cells, pushed };
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
    const [dx, dz] = away(m);
    const a = Math.atan2(dz, dx);
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
