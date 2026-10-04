// ボクセル世界のロジック（描画には依存しない）
//
// 世界は「ディスプレイ」のようなもの。各ボクセルは持ち主 (entity id) と色を1つだけ持つ。
// 物体が動く = 古いボクセルを消灯し、新しいボクセルを点灯すること。
// 1つのボクセルに2つの物体が重なることはないので、衝突時は優先度で
// 「押し出す側」と「押し出される側（または止められる側）」を決める。

export const EMPTY = 0;

// 数値が大きいほど強い。動く側の優先度 > 相手の優先度 のときだけ押し出せる。
export const PRIORITY = {
  TERRAIN: Infinity,
  PLAYER: 3,
  NPC: 2,
  BOX: 1,
};

// 押し出しの段数。1 = 直接触れている物だけ押せる（箱の後ろに箱があると止まる）。
// Infinity にすると連鎖押し出しになる。
export const MAX_PUSH_DEPTH = 1;

export const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export class World {
  constructor(sx, sy, sz) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.cells = new Int32Array(sx * sy * sz); // 各ボクセルの持ち主 id（0 = 消灯）
    this.colors = new Uint32Array(sx * sy * sz); // 各ボクセルの表示色
    this.entities = new Map();
    this.nextId = 1;
    this.tickCount = 0;
    this.player = null;
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  index(x, y, z) {
    return x + this.sx * (z + this.sz * y);
  }

  // 範囲外は -1
  ownerAt(x, y, z) {
    return this.inBounds(x, y, z) ? this.cells[this.index(x, y, z)] : -1;
  }

  // voxels: [[dx, dy, dz, color], ...]（pos からの相対位置）
  // 置けない場合は null を返す
  spawn({ kind, name, priority, pos, voxels, ...extra }) {
    const e = { id: this.nextId, kind, name, priority, pos: [...pos], voxels, ...extra };
    for (const [x, y, z] of this.cellsOf(e)) {
      if (this.ownerAt(x, y, z) !== EMPTY) return null;
    }
    this.nextId++;
    this.entities.set(e.id, e);
    this.paint(e, true);
    return e;
  }

  cellsOf(e, pos = e.pos) {
    return e.voxels.map(([dx, dy, dz, color]) => [pos[0] + dx, pos[1] + dy, pos[2] + dz, color]);
  }

  // 物体のボクセルを点灯 / 消灯する
  paint(e, on) {
    for (const [x, y, z, color] of this.cellsOf(e)) {
      const i = this.index(x, y, z);
      this.cells[i] = on ? e.id : EMPTY;
      this.colors[i] = on ? color : 0;
    }
  }

  // 物体を dir 方向に1マス動かす。必要なら優先度の低い物を押し出す。
  // 戻り値: { ok, pushed: [押し出した物], blocker: 止めた物, via: 動けなかった物, reason }
  tryMove(id, dir) {
    const mover = this.entities.get(id);
    const plan = new Set();
    this._fail = null;
    if (!this.planMove(mover, dir, mover.priority, 0, plan)) {
      return { ok: false, pushed: [], ...this._fail };
    }
    // 計画が全部成立したときだけ一斉に動かす（途中で失敗したら何も動かない）
    const group = [...plan].map((gid) => this.entities.get(gid));
    for (const e of group) this.paint(e, false);
    for (const e of group) {
      e.pos = [e.pos[0] + dir[0], e.pos[1] + dir[1], e.pos[2] + dir[2]];
      this.paint(e, true);
    }
    return { ok: true, pushed: group.filter((e) => e !== mover) };
  }

  planMove(e, dir, power, depth, plan) {
    plan.add(e.id);
    const next = [e.pos[0] + dir[0], e.pos[1] + dir[1], e.pos[2] + dir[2]];
    for (const [x, y, z] of this.cellsOf(e, next)) {
      const owner = this.ownerAt(x, y, z);
      if (owner === -1) {
        this._fail = { blocker: null, via: e, reason: 'edge' };
        return false;
      }
      if (owner === EMPTY || plan.has(owner)) continue;
      const other = this.entities.get(owner);
      if (other.priority >= power) {
        this._fail = { blocker: other, via: e, reason: 'priority' };
        return false;
      }
      if (depth >= MAX_PUSH_DEPTH) {
        this._fail = { blocker: other, via: e, reason: 'depth' };
        return false;
      }
      if (!this.planMove(other, dir, power, depth + 1, plan)) return false;
    }
    return true;
  }
}

function randomDir(rng) {
  return DIRS[Math.floor(rng() * DIRS.length)];
}

// 1ティック進める。プレイヤー → NPC の順に処理する。
// 戻り値はこのティックで起きた出来事のリスト。
export function step(world, playerDir, rng = Math.random) {
  world.tickCount++;
  const events = [];
  const act = (e, dir) => {
    const r = world.tryMove(e.id, dir);
    if (r.ok) {
      for (const t of r.pushed) events.push({ type: 'push', actor: e, target: t });
    } else {
      events.push({ type: 'block', actor: e, target: r.blocker, via: r.via, reason: r.reason });
    }
    return r.ok;
  };

  if (world.player && playerDir) act(world.player, playerDir);

  for (const e of world.entities.values()) {
    if (e.kind !== 'npc') continue;
    if (e.wait > 0) {
      e.wait--;
      continue;
    }
    e.wait = e.slowness;
    if (!e.dir || rng() < 0.15) e.dir = randomDir(rng);
    if (!act(e, e.dir)) e.dir = randomDir(rng);
  }
  return events;
}

// ---- デモ用の世界 ----------------------------------------------------------

const COLORS = {
  floorA: 0x2b3352,
  floorB: 0x323b5e,
  wall: 0x6a74a0,
  wallTop: 0x8790bd,
  box: 0xb5824c,
  bigBox: 0x8c5c33,
  playerBody: 0xf2a541,
  playerHead: 0xffe2b8,
};

export const NPC_COLORS = [
  [0x3cc4b0, 0xc9f2ea],
  [0x9b7bff, 0xe2d9ff],
  [0xff6f6f, 0xffd6d6],
];

export function buildDemo(world) {
  const { sx, sz } = world;
  const terrain = [];
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      terrain.push([x, 0, z, (x + z) % 2 ? COLORS.floorA : COLORS.floorB]);
      const border = x === 0 || z === 0 || x === sx - 1 || z === sz - 1;
      if (border) {
        terrain.push([x, 1, z, COLORS.wall], [x, 2, z, COLORS.wallTop]);
      }
    }
  }
  // 内側の障害物
  const pillars = [
    [6, 6], [6, 7], [7, 6],
    [13, 12], [13, 13], [12, 13],
    [10, 3], [10, 4],
  ];
  for (const [x, z] of pillars) terrain.push([x, 1, z, COLORS.wall], [x, 2, z, COLORS.wallTop]);

  world.spawn({ kind: 'terrain', name: '壁', priority: PRIORITY.TERRAIN, pos: [0, 0, 0], voxels: terrain });

  world.player = world.spawn({
    kind: 'player',
    name: 'プレイヤー',
    priority: PRIORITY.PLAYER,
    pos: [4, 1, 10],
    voxels: [
      [0, 0, 0, COLORS.playerBody],
      [0, 1, 0, COLORS.playerHead],
    ],
  });

  const npcStarts = [[15, 4], [4, 15], [15, 16]];
  npcStarts.forEach(([x, z], n) => {
    const [body, head] = NPC_COLORS[n % NPC_COLORS.length];
    world.spawn({
      kind: 'npc',
      name: `NPC-${n + 1}`,
      priority: PRIORITY.NPC,
      pos: [x, 1, z],
      voxels: [
        [0, 0, 0, body],
        [0, 1, 0, head],
      ],
      slowness: 1, // 2ティックに1回動く
      wait: n,
      dir: null,
    });
  });

  const boxes = [[7, 10], [9, 9], [9, 10], [4, 5], [14, 8], [11, 15]];
  boxes.forEach(([x, z], n) => {
    world.spawn({
      kind: 'box',
      name: `箱-${n + 1}`,
      priority: PRIORITY.BOX,
      pos: [x, 1, z],
      voxels: [[0, 0, 0, COLORS.box]],
    });
  });

  world.spawn({
    kind: 'box',
    name: '大箱',
    priority: PRIORITY.BOX,
    pos: [15, 1, 11],
    voxels: [
      [0, 0, 0, COLORS.bigBox],
      [1, 0, 0, COLORS.bigBox],
      [0, 0, 1, COLORS.bigBox],
      [1, 0, 1, COLORS.bigBox],
      [0, 1, 0, COLORS.box],
      [1, 1, 0, COLORS.box],
      [0, 1, 1, COLORS.box],
      [1, 1, 1, COLORS.box],
    ],
  });
}
