// ピラミッドの住人たちをまとめて動かす: 頂上の水晶、門の巨アヌビス像 2 体、ダンジョンの骸骨、玉座の赤い骨の王
//
// 水晶と像ははじめから置く（遠くからも見える）。骸骨と骨の王は、プレイヤーが近づいてそこのチャンクができてから置く

import { pyramidSite, sitePoint, toWorld, frontYaw, SKELETON_SPOTS, KING_SPOT, THRONE_ROOM, STATUE_U, STATUE_V, PEDESTAL_H, CRYSTAL_Y } from './pyramid.js';
import { Anubis, Crystal } from './guardians.js';
import { Skeleton, BoneKing } from './bones.js';
import { chunkKeyAt } from './grid.js';
import { hash3 } from './rng.js';

const NEAR = 260; // 骸骨・骨の王を置き始める距離（ボクセル）
const SIM = 150; // 起き上がった骸骨を動かす距離

export class Temple {
  constructor(world) {
    this.world = world;
    const s = pyramidSite(world);
    this.site = s;
    this.crystal = new Crystal(world, sitePoint(world, 0, 0, CRYSTAL_Y));
    // 像は参道を向いて（+u）立つ。内側（参道の中央）へ杖を振り下ろす
    const fwd = s.f;
    const vdir = [-s.f[1], s.f[0]]; // v の向き（世界）
    this.statues = [1, -1].map((side) => new Anubis(world, sitePoint(world, STATUE_U, side * STATUE_V, PEDESTAL_H), fwd, [-vdir[0] * side, -vdir[1] * side], side > 0 ? '右のアヌビス像' : '左のアヌビス像'));
    this.statues[1].delay = 1.6; // 左の像は少し遅れて振りかぶる
    this.skeletons = SKELETON_SPOTS.map(([u, v, y], k) => ({ at: sitePoint(world, u, v, y), yaw: (hash3(k, 5, 9) % 8) * (Math.PI / 4), seed: k, actor: null }));
    this.king = null;
    const [x0, z0] = toWorld(s, THRONE_ROOM.u0, THRONE_ROOM.v0), [x1, z1] = toWorld(s, THRONE_ROOM.u1, THRONE_ROOM.v1);
    this.throneRoom = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }

  get actors() {
    return [this.crystal, ...this.statues, ...(this.king ? [this.king] : []), ...this.skeletons.map((k) => k.actor).filter(Boolean)];
  }

  // 1 ティック分。戻り値は出来事
  step(dt, player, rng, report) {
    const w = this.world;
    const events = [];
    const P = player?.pos;
    const loaded = (p) => w.chunks.has(chunkKeyAt(Math.floor(p[0]), Math.floor(p[2])));
    const near = (p, r) => P && Math.hypot(P[0] - p[0], P[2] - p[2]) < r;
    for (const a of [this.crystal, ...this.statues]) {
      a.update(dt, player);
      events.push(...a.events);
    }
    // 骸骨: 近づいたら置き、起き上がったら動かす
    for (const k of this.skeletons) {
      if (!k.actor) {
        if (near(k.at, NEAR) && loaded(k.at)) k.actor = new Skeleton(w, k.at, k.yaw, k.seed);
        continue;
      }
      if (!k.actor.busy || !near(k.actor.e?.pos ?? k.at, SIM)) continue;
      k.actor.update(dt, player, rng, report);
      events.push(...k.actor.events);
    }
    // 赤い骨の王
    const ks = sitePoint(w, KING_SPOT[0], KING_SPOT[1], KING_SPOT[2]);
    if (!this.king && near(ks, NEAR) && loaded(ks)) this.king = new BoneKing(w, ks, frontYaw(this.site), this.throneRoom);
    if (this.king && near(this.king.pos, NEAR)) {
      this.king.update(dt, player);
      events.push(...this.king.events);
    }
    return events;
  }
}

export function spawnTemple(world) {
  if (!pyramidSite(world)) return null;
  world.temple = new Temple(world);
  return world.temple;
}
