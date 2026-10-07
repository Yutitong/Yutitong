// 太刀: 長い刀で龍を深く斬る
//
// - 振り下ろしと横薙ぎを交互に繰り出す。刃は体の前 2.5m ほど（17 ボクセル）まで届く
// - 振り下ろし: 体の前の縦の面を上から下へ。龍の胴のいちばん上に当たった所から、上から斬り込む
// - 横薙ぎ: 体の前を右から左へ大きく薙ぐ。いちばん近い所に当たった所から、こちら側から斬り込む
// - 一太刀で胴の太さの半分まで裂ける（肉と骨の断面が見える）。同じ所を 2 回斬ると切り落とせる（首は切り落とせない）
// - 斬れるのは龍と、ピラミッドの骸骨・赤い骨の王。木や岩・地面に当たると弾かれる

import { GROUND_ID, ROCK_ID } from './ids.js';

export const SLASH_REACH = 17; // 体の中心から刃先まで
const CUT = 0.5; // 一太刀で裂ける深さ（胴の太さに対する割合）

// 斬る。horizontal: 横薙ぎ（でなければ振り下ろし）。
// 戻り値は出来事 { type: 'slash', actor, target, result: 'wound' | 'severed' | 'glance' | 'blocked' | 'miss', progress, cut }
export function slash(world, e, horizontal) {
  const ev = { type: 'slash', actor: e, target: null, result: 'miss', progress: 0, cut: horizontal ? 'h' : 'v' };
  const dragon = world.dragon;
  const yaw = e.pose.yaw;
  const m = [e.pos[0] + 4.5, e.pos[2] + 4.5]; // 体の中心
  const feet = e.pos[1];
  const hits = [];
  const bodyHits = []; // 骸骨・赤い骨の王
  let blocked = false;
  // 刃の通り道を点で調べる
  const probe = (x, y, z, score) => {
    const o = world.ownerAt(Math.floor(x), Math.floor(y), Math.floor(z));
    if (o <= 0 || o === e.id || o === e.toolId) return;
    const body = world.entities.get(o)?.body;
    if (dragon && o === dragon.id) hits.push({ p: [x, y, z], score });
    else if (body?.slash) bodyHits.push({ p: [x, y, z], score, body, target: world.entities.get(o) });
    else if (o === GROUND_ID || o === ROCK_ID || world.entities.get(o)?.tree || world.entities.get(o)?.giant) {
      blocked = true;
    }
  };
  if (horizontal) {
    // 右から左へ、胸の高さを中心に薙ぐ。いちばん近い所を優先
    for (let a = 1.3; a >= -1.3; a -= 0.08) {
      const fx = Math.sin(yaw + a), fz = Math.cos(yaw + a);
      for (let h = 6; h <= 13; h += 1) {
        for (let d = 4; d <= SLASH_REACH; d += 0.5) probe(m[0] + fx * d, feet + h, m[1] + fz * d, -d - Math.abs(a) * 2);
      }
    }
  } else {
    // 前の縦の面を上から下へ。いちばん上の所を優先（上から斬り込む）
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
    for (let l = -1.5; l <= 1.5; l += 0.5) {
      for (let d = 4; d <= SLASH_REACH; d += 0.5) {
        for (let h = 22; h >= 1; h -= 0.5) probe(m[0] + fx * d + sx * l, feet + h, m[1] + fz * d + sz * l, h - Math.abs(l) * 3 - d * 0.1);
      }
    }
  }
  if (bodyHits.length && !hits.length) {
    // 骸骨・赤い骨の王を斬る（いちばん優先する所）
    bodyHits.sort((a, b) => b.score - a.score);
    const h = bodyHits[0];
    ev.target = h.target;
    ev.result = h.body.slash(h.p) ?? 'glance';
    return ev;
  }
  if (hits.length) {
    ev.target = dragon.entity;
    // 優先する所から順に、胴に当たる所を探す（背びれ・足・鬣などは斬り込めない）。
    // 斬り込む側: 振り下ろしは上から、横薙ぎはこちら側から（当たった所を少しその側へずらして渡す）
    hits.sort((a, b) => b.score - a.score);
    let res = null;
    for (const { p } of hits.slice(0, 40)) {
      const from = horizontal ? [m[0] - p[0], 0, m[1] - p[2]] : [0, 1, 0];
      const l = Math.hypot(...from) || 1;
      res = dragon.wound([p[0] + (from[0] / l) * 0.8, p[1] + (from[1] / l) * 0.8, p[2] + (from[2] / l) * 0.8], 0, CUT);
      if (res) break;
    }
    if (!res) ev.result = 'glance';
    else {
      ev.result = res.severed ? 'severed' : 'wound';
      ev.progress = res.f;
      ev.piece = res.severed;
    }
  } else if (blocked) {
    ev.result = 'blocked';
  }
  return ev;
}
