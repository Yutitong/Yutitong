// 斧: 振り下ろした刃が当たった物を削る
//
// - 木: 腰の高さの幹に、手前から切り込みを入れていく。幹が 3 割ほどまで細くなると、
//   切り口より上がプレイヤーと反対側へ倒れる（だんだん速く）。倒れたあとは倒木と切り株が残る
// - 龍: 刃の通った所の鱗が削れて切り傷になり、中の肉が見える。同じ所を切り続けると切り落とせる
//   （切り落とされた尾の側は地面へ落ちる）。龍のほうの処理は dragon.js の wound / sever

import { WATER_ID } from './ids.js';
import { redrawBody } from './body.js';

const REACH = 11.5; // 体の中心から刃が届く距離（ボクセル）
const NOTCH_STEP = 0.9; // 1 回で幹を削る深さ（太い木は 4〜6 回で倒れる）
const FELL_AT = 0.3; // 幹がこの割合まで細くなったら倒れる
const GRAVITY = 65;

// e が斧を振り下ろした。戻り値は出来事 { type: 'chop', actor, target, result, progress }
export function chop(world, e) {
  const yaw = e.pose.yaw;
  const f = [Math.sin(yaw), Math.cos(yaw)]; // 前
  const side = [Math.cos(yaw), -Math.sin(yaw)]; // 横
  const m = [e.pos[0] + 4.5, e.pos[2] + 4.5]; // 体の中心
  const hits = [];
  // 前へまっすぐ伸ばした線ごとに、最初に当たる物を探す
  for (let l = -2.5; l <= 2.5; l += 1) {
    for (let h = 1; h <= 12; h++) {
      for (let d = 4; d <= REACH; d += 0.5) {
        const x = Math.floor(m[0] + f[0] * d + side[0] * l);
        const z = Math.floor(m[1] + f[1] * d + side[1] * l);
        const y = e.pos[1] + h;
        const o = world.ownerAt(x, y, z);
        if (o <= 0 || o === e.id || o === WATER_ID || o === e.toolId) continue;
        if (world.entities.get(o)?.yields) continue;
        hits.push({ o, x, y, z, d, l, h });
        break;
      }
    }
  }
  const ev = { type: 'chop', actor: e, target: null, result: 'miss', progress: 0 };
  const dragon = world.dragon;
  const dh = dragon ? hits.filter((q) => q.o === dragon.id) : [];
  if (dh.length) {
    // 刃の真ん中の通り道で一番近い所
    dh.sort((a, b) => Math.abs(a.l) - Math.abs(b.l) || Math.abs(a.h - 6) - Math.abs(b.h - 6) || a.d - b.d);
    const q = dh[0];
    const res = dragon.wound([q.x + 0.5, q.y + 0.5, q.z + 0.5]);
    ev.target = dragon.entity;
    if (!res) ev.result = 'glance';
    else {
      ev.result = res.severed ? 'severed' : 'wound';
      ev.progress = res.f;
      ev.piece = res.severed;
    }
    return ev;
  }
  const th = hits.find((q) => world.entities.get(q.o)?.tree);
  if (th) return chopTree(world, e, world.entities.get(th.o), f, m, ev);
  if (hits.length) ev.target = world.entities.get(hits[0].o);
  return ev;
}

function chopTree(world, e, ent, f, m, ev) {
  const tree = ent.tree;
  ev.target = ent;
  if (tree.felled) return ev;
  if (!tree.cut) {
    // 切る高さ: プレイヤーの腰のあたり。そこの幹（中心から 6 ボクセル以内の幹と枝）を数えておく
    const y = Math.max(tree.spec.y + 1, e.pos[1] + 5);
    const cx = tree.spec.x + 0.5, cz = tree.spec.z + 0.5;
    const cells = [];
    for (let i = 0; i < tree.xs.length; i++) {
      if (tree.gone[i] || tree.clumpOf[i] !== -1) continue;
      if (tree.ys[i] !== y && tree.ys[i] !== y + 1) continue;
      if (Math.hypot(tree.xs[i] + 0.5 - cx, tree.zs[i] + 0.5 - cz) > 6) continue;
      cells.push(i);
    }
    if (!cells.length) return ev;
    const center = [0, 0];
    for (const i of cells) {
      center[0] += tree.xs[i] + 0.5;
      center[1] += tree.zs[i] + 0.5;
    }
    tree.cut = { y, cells, total: cells.length, center: center.map((v) => v / cells.length) };
  }
  const cut = tree.cut;
  const left = cut.cells.filter((i) => !tree.gone[i]);
  // 手前（プレイヤーに近い側）から NOTCH_STEP ずつ削る
  const depth = (i) => (tree.xs[i] + 0.5 - m[0]) * f[0] + (tree.zs[i] + 0.5 - m[1]) * f[1];
  const near = Math.min(...left.map(depth));
  let remaining = 0;
  for (const i of left) {
    if (depth(i) > near + NOTCH_STEP) {
      remaining++;
      continue;
    }
    tree.gone[i] = 1;
    tree.color[i] = 0;
    const x = tree.xs[i], y = tree.ys[i], z = tree.zs[i];
    if (world.ownerAt(x, y, z) === ent.id) world.setCell(x, y, z, 0, 0);
  }
  ev.progress = 1 - remaining / cut.total;
  ev.result = 'notch';
  if (remaining <= cut.total * FELL_AT) {
    // プレイヤーと反対側へ倒れる
    let dx = cut.center[0] - m[0], dz = cut.center[1] - m[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    world.felling.push(new FallingTree(world, ent, cut.y, [dx, dz], cut.center, Math.sqrt(cut.total / 2 / Math.PI)));
    ev.result = 'felled';
  }
  return ev;
}

// 切り口より上が、切り口の向こう側の縁を支点に倒れていく
export class FallingTree {
  constructor(world, ent, cutY, dir, center, radius) {
    const tree = ent.tree;
    this.world = world;
    this.name = ent.name;
    // 切り口より上のセルを、木から取り外して倒れる物にする
    const src = [];
    let top = cutY;
    for (let i = 0; i < tree.xs.length; i++) {
      if (tree.gone[i] || tree.ys[i] <= cutY + 1) continue;
      tree.gone[i] = 1;
      const x = tree.xs[i], y = tree.ys[i], z = tree.zs[i];
      if (tree.color[i] && world.ownerAt(x, y, z) === ent.id) {
        src.push(x + 0.5, y + 0.5, z + 0.5, tree.color[i]);
        top = Math.max(top, y);
      }
      if (world.ownerAt(x, y, z) === ent.id) world.setCell(x, y, z, 0, 0);
    }
    tree.felled = true; // 風で揺れない
    this.src = src;
    this.id = world.nextId++;
    this.entity = {
      id: this.id, kind: 'falling', name: `${ent.name}（倒れていく）`, priority: 8, pos: [Math.round(center[0]), cutY, Math.round(center[1])],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    };
    world.entities.set(this.id, this.entity);
    this.dir = [dir[0], 0, dir[1]];
    this.axis = [dir[1], 0, -dir[0]]; // 上向き → dir の向きへ回す軸
    this.pivot = [center[0] + dir[0] * radius, cutY + 2, center[1] + dir[1] * radius];
    this.height = Math.max(10, top - cutY);
    this.angle = 0.03;
    this.omega = 0;
    this.cells = [];
    this.done = false;
    this.draw();
  }

  // 点 p を支点のまわりに ang だけ回す
  rotate(p, ang) {
    const [ax, ay, az] = this.axis;
    const v = [p[0] - this.pivot[0], p[1] - this.pivot[1], p[2] - this.pivot[2]];
    const c = Math.cos(ang), s = Math.sin(ang);
    const cr = [ay * v[2] - az * v[1], az * v[0] - ax * v[2], ax * v[1] - ay * v[0]];
    const d = (ax * v[0] + ay * v[1] + az * v[2]) * (1 - c);
    return [
      this.pivot[0] + v[0] * c + cr[0] * s + ax * d,
      this.pivot[1] + v[1] * c + cr[1] * s + ay * d,
      this.pivot[2] + v[2] * c + cr[2] * s + az * d,
    ];
  }

  // 角度 ang のとき、幹が地面に当たっているか
  touches(ang) {
    const w = this.world;
    for (let h = 6; h <= this.height; h += 4) {
      const p = this.rotate([this.pivot[0], this.pivot[1] + h, this.pivot[2]], ang);
      const x = Math.round(p[0]), z = Math.round(p[2]);
      if (p[1] - 1.5 < Math.max(w.groundAt(x, z), w.waterAt(x, z))) return true;
    }
    return false;
  }

  // 細い棒が倒れるように、傾くほど速くなる
  update(dt) {
    if (this.done) return;
    this.omega += ((3 * GRAVITY) / (2 * this.height)) * Math.sin(this.angle) * dt;
    let next = Math.min(Math.PI / 2, this.angle + this.omega * dt);
    if (this.touches(next)) {
      // 地面に着く角度を細かく探す
      let lo = this.angle, hi = next;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (this.touches(mid)) hi = mid;
        else lo = mid;
      }
      next = lo;
      this.done = true;
    } else if (next >= Math.PI / 2) {
      this.done = true;
    }
    this.angle = next;
    this.draw();
    if (this.done) {
      // 倒木になる: もう動かず、誰にも押されない
      this.entity.kind = 'terrain';
      this.entity.name = `${this.name}の倒木`;
      this.entity.priority = Infinity;
    }
  }

  draw() {
    const ang = this.angle;
    const c = Math.cos(ang), s = Math.sin(ang);
    // 回したあとの「上」と「倒れる向き」。1 つのセルを 4 点に分けて置き、回したときの隙間をふさぐ
    const up = [this.dir[0] * s, c, this.dir[2] * s];
    const fw = [this.dir[0] * c, -s, this.dir[2] * c];
    const src = this.src;
    const { cells, pushed } = redrawBody(this.world, this.id, this.cells, (emit) => {
      for (let n = 0; n < src.length; n += 4) {
        const p = this.rotate([src[n], src[n + 1], src[n + 2]], ang);
        for (const [a, b] of [[0.25, 0.25], [0.25, -0.25], [-0.25, 0.25], [-0.25, -0.25]]) {
          const y = Math.floor(p[1] + up[1] * a + fw[1] * b);
          if (y < 1) continue;
          emit(Math.floor(p[0] + up[0] * a + fw[0] * b), y, Math.floor(p[2] + up[2] * a + fw[2] * b), src[n + 3]);
        }
      }
    }, (m) => {
      // 倒れてくる木の下から、横へ押し出す
      const side = (m[0] - this.pivot[0]) * this.axis[0] + (m[2] - this.pivot[2]) * this.axis[2];
      return side >= 0 ? [this.axis[0], this.axis[2]] : [-this.axis[0], -this.axis[2]];
    });
    this.cells = cells;
    this.pushed = pushed;
  }
}

// 支えのない物（切り落とされた龍の尾）を重力で落とす
export function dropFalling(world, e, dt) {
  e.vy = Math.min(e.vy + GRAVITY * dt, 40);
  e.fall += e.vy * dt;
  while (e.fall >= 1) {
    if (!world.tryMove(e.id, [0, -1, 0]).ok) {
      e.falling = false;
      e.vy = 0;
      return;
    }
    e.fall -= 1;
  }
}
