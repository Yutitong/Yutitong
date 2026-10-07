// 隕石落下: 巨大隕石が遠くの巨大樹の森に落ち、地をえぐって大きなクレーターを残す
//
// - 落ちる所: 出発地点から 1.4〜1.7km 先の、はじめに向いている方向から少し横の所（龍・黄色い球体・古代魚・ピラミッドから遠い所）。
//   地形だけで決まる。巨大樹の森があれば、そこが選ばれやすい
// - 「隕石」ボタンで落ちてくる。空が赤くなり、火の玉が 10 秒ほどかけて斜めに落ちてきて、地面に激突する
// - 激突すると: 深いすり鉢のクレーター（縁から底まで約 100m。底は世界の底まで掘れ、まわりに高い外輪山が盛り上がる）。
//   その瞬間、地面の波が放射状に広がり（描画側で、地面そのものを波打たせる）、衝撃波が空気を伝わる。
//   半径 1km は焼け野原: ふつうの木は燃え尽き、巨大樹は葉を失った黒焦げの幹だけが（外へ傾いて、上が折れて）残る
// - 少しあとから、空に巻き上げられた岩が、プレイヤーのまわりに時間差で降ってくる（当たると痛い）
// - 半径 1km の中にいると、衝撃波で吹き飛ばされ、近いほど大きな傷を受ける（近すぎると力尽きる）
//
// クレーターの形は world.sample を差し替えて作る（チャンクを作るスレッドにも同じ激突を知らせる）。
// このファイルは描画に依存しない（描画は meteorview.js）

import { CHUNK, HEIGHT, floorDiv, chunkKey, chunkKeyAt } from './grid.js';
import { hash3, noise2, noise3, shade, mulberry32 } from './rng.js';
import { EMPTY, GROUND_ID, ROCK_ID, WATER_ID, FALL_ID, PLANT_ID } from './ids.js';
import { redrawBody, clearBody } from './body.js';

// 大きさ（ボクセル。1 ボクセル = 15cm）
export const CRATER_R = 2400; // 外輪山の尾根までの半径（≈ 360m）
export const RIM_Y = 690; // 外輪山の尾根の高さ（≈ 100m）
export const FLOOR_Y = 3; // 底の高さ（世界の底のすぐ上）
export const BLAST_R = 6667; // 甚大な被害を受ける半径（≈ 1km）
const EJECTA_W = 700; // 外輪山の外側の斜面の幅のめやす
export const T_FALL = 10; // ボタンを押してから激突までの秒数
export const GROUND_WAVE = 1600; // 地面の波の速さ（ボクセル/秒 ≈ 240m/s）
export const AIR_BLAST = 2300; // 衝撃波の速さ（ボクセル/秒 ≈ 345m/s）
const DEBRIS_TIME = 50; // 岩が降ってくる時間（秒）

const smooth = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ---- 落ちる所 --------------------------------------------------------------------

// 出発地点から 1.4〜1.7km 先。出発地点ではじめに向いている方向（ピラミッドの方）から少し横にずれた所で、
// 立ったまま落ちてくるのが見える。ピラミッドからは被害の範囲より十分離す。巨大樹の森があればそちらを少し選びやすい
export function meteorSite(world, giantZone, pyramid) {
  if (world._meteorSite !== undefined) return world._meteorSite;
  let best = null, bestScore = -Infinity;
  if (world.terrain) {
    const face = pyramid ? Math.atan2(pyramid.cx, pyramid.cz) : 0; // はじめに向いている向き（0 = +z）
    for (let k = -8; k <= 8; k++) {
      const off = (k / 8) * 0.75; // ±43°
      for (const dist of [9500, 10500, 11500]) {
        const a = face + off;
        const cx = Math.round(Math.sin(a) * dist), cz = Math.round(Math.cos(a) * dist);
        if (pyramid && Math.hypot(cx - pyramid.cx, cz - pyramid.cz) < BLAST_R + 1400) continue;
        let zone = 0, n = 0;
        for (let dz = -1500; dz <= 1500; dz += 750) {
          for (let dx = -1500; dx <= 1500; dx += 750) {
            zone += giantZone(world, cx + dx, cz + dz);
            n++;
          }
        }
        const score = -Math.abs(Math.abs(off) - 0.42) * 2 + (zone / n) * 0.6 - (dist - 9500) / 20000;
        if (score > bestScore) {
          bestScore = score;
          best = { x: cx, z: cz };
        }
      }
    }
  }
  world._meteorSite = best;
  return best;
}

// ---- クレーターの形 ----------------------------------------------------------------

// 激突のあとの列 (x, z) の地形。out は world.sample の結果（h, water など）を書き換える。
// out.blast: 焼け野原の度合い 0..1、out.crater: すり鉢の中（0..1。底ほど 1）、out.ejecta: 外輪山と飛び散った岩屑の上
export function craterShape(world, x, z, out) {
  const I = world.impact;
  const dx = x - I.x, dz = z - I.z;
  const r = Math.hypot(dx, dz);
  out.blast = 0;
  out.crater = 0;
  out.ejecta = 0;
  if (r >= BLAST_R + 400) return out;
  const seed = world.seed;
  // 焼け野原（外の縁はまだらに）
  out.blast = smooth(BLAST_R + 300, BLAST_R - 900, r + (noise2(x / 300, z / 300, seed + 0x51) - 0.5) * 900);
  if (r > CRATER_R + 3200) return out;
  const ang = Math.atan2(dz, dx);
  // 外輪山の尾根の高さは向きによって少し違う（波打つ）
  const rim = RIM_Y * (1 + 0.05 * (noise2(Math.cos(ang) * 3, Math.sin(ang) * 3, seed + 0x52) - 0.5) * 2);
  const g = out.h; // もとの地面
  let h;
  if (r < CRATER_R) {
    // すり鉢: 底は平らで、縁へ向かってだんだん急になる。真ん中には盛り上がった中央丘
    const t = r / CRATER_R;
    h = FLOOR_Y + (rim - FLOOR_Y) * t ** 2.3;
    h += 85 * Math.exp(-((r / 260) ** 2));
    // 内壁は段になって崩れている（地すべりの段）と、でこぼこ
    const wall = smooth(0.25, 0.6, t) * smooth(1.02, 0.85, t);
    h += wall * ((noise2(x / 70, z / 70, seed + 0x53) - 0.5) * 40 + Math.sin(t * 46 + noise2(x / 400, z / 400, seed) * 6) * 9);
    out.crater = smooth(1, 0.3, t);
    out.ejecta = 1 - out.crater;
  } else {
    // 外輪山の外側の斜面と、飛び散った岩屑（放射状のすじ）
    const s = (r - CRATER_R) / EJECTA_W;
    const ray = 0.75 + 0.5 * noise2(Math.cos(ang) * 9, Math.sin(ang) * 9, seed + 0x54);
    const lift = (rim - g) * Math.exp(-(s ** 1.3)) + 26 * ray * Math.exp(-s / 3.2);
    h = g + Math.max(0, lift) + (noise2(x / 55, z / 55, seed + 0x55) - 0.5) * 22 * Math.exp(-s / 2);
    out.ejecta = Math.min(1, Math.exp(-s / 2.4) * 1.4);
  }
  out.h = Math.max(FLOOR_Y, Math.min(HEIGHT - 2, Math.round(h)));
  // 水は干上がる（すり鉢の中・外輪山の上には水はない）
  if (r < CRATER_R + 2600 || Math.abs(out.h - g) > 1) {
    out.water = 0;
    out.channel = false;
    out.bank = false;
    out.pond = false;
    out.edge = Infinity;
    out.lowland = 0;
  }
  return out;
}

// 激突のあとの地面の色（焼け野原・岩屑・すり鉢の黒い岩と、底の溶けた岩）。base: もとの色
const ASH = [0x4b4744, 0x3e3a37, 0x56504a, 0x35312f];
const CHARRED = [0x2a2624, 0x231f1e, 0x302a27];
const SCORCH = [0x6a4a34, 0x5c4030];
const RUBBLE = [0x6a5a4c, 0x5c4d41, 0x786656, 0x4f4339, 0x83705c];
const BRECCIA = [0x3a3330, 0x2e2826, 0x4a3c34, 0x5a463a, 0x241f1d, 0x45302a];
const GLASS = [0x1a1614, 0x221b18, 0x140f0e];
const MAGMA = [0xff7a1a, 0xe0401a, 0xffb040, 0xc4301a];
export function scarColor(seed, x, y, z, col, base) {
  if (!col.blast) return base;
  const k = hash3(x, y * 7 + z, seed + 0x5a);
  const f = 0.85 + (k % 30) / 100;
  if (col.crater > 0.85) {
    // 底: 黒いガラス質の岩に、まだ赤く光る溶けた岩の割れ目
    const n = noise3(x / 13, y / 9, z / 13, seed + 0x5b);
    if (n > 0.66 && col.crater > 0.93) return shade(MAGMA[k % MAGMA.length], 0.9 + (k % 20) / 100);
    return shade(GLASS[k % GLASS.length], f);
  }
  if (col.crater > 0) {
    const n = noise3(x / 22, y / 6, z / 22, seed + 0x5c);
    return shade(BRECCIA[(k + Math.floor(n * 6)) % BRECCIA.length], f * (0.85 + col.crater * 0.1));
  }
  if (col.ejecta > 0.5) return shade(RUBBLE[k % RUBBLE.length], f * (0.8 + 0.25 * (1 - col.ejecta)));
  // 焼け野原: 灰と黒焦げ、ところどころ焼けた赤土
  const n = noise2(x / 18, z / 18, seed + 0x5d);
  const burnt = n > 0.62 ? CHARRED[k % CHARRED.length] : n < 0.22 ? SCORCH[k % SCORCH.length] : ASH[k % ASH.length];
  const t = Math.min(1, col.blast * 1.15 + col.ejecta);
  return mix(base, shade(burnt, f), t);
}

function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// (x, z) が焼け野原か（0..1）。激突の前は 0
export function blastAt(world, x, z) {
  const I = world.impact;
  if (!I) return 0;
  const r = Math.hypot(x - I.x, z - I.z);
  if (r >= BLAST_R + 400) return 0;
  return smooth(BLAST_R + 300, BLAST_R - 900, r + (noise2(x / 300, z / 300, world.seed + 0x51) - 0.5) * 900);
}

// 巨大樹の焼け方: { gone: 吹き飛ばされて残らない, cut: 幹の残る高さの割合, lean: 外へ傾く向き, ember } か null（無事）
export function giantBurn(world, x, z, seed) {
  const I = world.impact;
  if (!I) return null;
  const dx = x - I.x, dz = z - I.z;
  const r = Math.hypot(dx, dz);
  if (r > BLAST_R) return null;
  if (r < CRATER_R + 1100) return { gone: true };
  const u = (r - CRATER_R - 1100) / (BLAST_R - CRATER_R - 1100); // 0 = 近い 〜 1 = 1km
  const rnd = (hash3(seed, 3, 7) % 1000) / 1000;
  const push = 0.07 * (1 - u) + 0.015;
  return {
    gone: false,
    cut: Math.min(0.95, 0.32 + 0.5 * u + rnd * 0.18),
    lean: [(dx / r) * push, (dz / r) * push],
    ember: 0.12 * (1 - u) + 0.03,
    twigs: u > 0.45, // 遠い木は焦げた枝が少し残る
  };
}

// ---- 激突 ------------------------------------------------------------------------

// 激突を世界に記録し、覚えておいた木・巨大樹・地形の情報のうち、変わる所を忘れる。
// チャンクを作るスレッドでも呼ぶ（そちらではチャンクを持たないので、覚えた情報を忘れるだけ）
export function applyImpact(world, at) {
  world.impact = { x: at.x, z: at.z };
  world.impactEpoch = (world.impactEpoch ?? 0) + 1;
  const R = BLAST_R + 400;
  const near = (x, z, m) => Math.hypot(x - at.x, z - at.z) < R + m;
  const fromKey = (key) => [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];
  // ふつうの木（区画 24）
  for (const key of [...(world.treeSpecs?.keys() ?? [])]) {
    const [rx, rz] = fromKey(key);
    if (near(rx * 24 + 12, rz * 24 + 12, 60)) world.treeSpecs.delete(key);
  }
  for (const [key, tree] of [...(world.trees ?? [])]) {
    if (!near(tree.spec.x, tree.spec.z, 60)) continue;
    world.trees.delete(key);
    world.entities.delete(tree.id);
  }
  // 巨大樹（区画 210）
  for (const key of [...(world.giantSpecs?.keys() ?? [])]) {
    const [gx, gz] = fromKey(key);
    if (near(gx * 210 + 105, gz * 210 + 105, 400)) world.giantSpecs.delete(key);
  }
  for (const [key, g] of [...(world.giants ?? [])]) {
    if (!near(g.spec.x, g.spec.z, 400)) continue;
    world.giants.delete(key);
    world.entities.delete(g.id);
  }
  world.physics?.memo?.clear();
}

// 激突でかたちの変わるチャンクか
export function impactTouches(world, cx, cz) {
  const I = world.impact;
  if (!I) return false;
  const x = Math.max(cx * CHUNK, Math.min(I.x, cx * CHUNK + CHUNK));
  const z = Math.max(cz * CHUNK, Math.min(I.z, cz * CHUNK + CHUNK));
  return Math.hypot(x - I.x, z - I.z) < BLAST_R + 600;
}

// ---- 隕石落下の出来事（画面を描くスレッドの世界でだけ動かす） --------------------------

const DEBRIS_PALETTE = [0x2a2422, 0x3a302a, 0x1f1b19, 0x4a3a30];
const DEBRIS_HOT = [0xff7a1a, 0xe0501a, 0xffa030];

export class MeteorEvent {
  // site: 落ちる所 { x, z }、onImpact(world): 激突の瞬間に呼ぶ（チャンクの作り直しなど、描画側の後始末）
  constructor(world, site, { onImpact = null, seed = 7 } = {}) {
    this.world = world;
    this.site = site;
    this.onImpact = onImpact;
    this.t = 0; // ボタンを押してからの時間（秒）
    this.phase = 'falling';
    this.events = [];
    this.rng = mulberry32(seed);
    this.entity = { id: world.nextId++, kind: 'meteor', name: '巨大隕石', priority: Infinity, pos: [site.x, 0, site.z], offsets: new Int16Array(0), colors: new Uint32Array(0) };
    world.entities.set(this.entity.id, this.entity);
    this.debris = [];
    this.blastDone = false;
    this.quakeDone = false;
    this.spawned = 0;
    this.landed = 0;
    // 入ってくる向き: 落ちる所と出発地点を結ぶ線に対して横から、斜めに
    const toStart = Math.atan2(-site.z, -site.x);
    const a = toStart + Math.PI * 0.62;
    this.from = [site.x + Math.cos(a) * 15000, 14000, site.z + Math.sin(a) * 15000];
    this.first = { type: 'meteorSpotted', actor: this.entity }; // 最初のティックで知らせる
  }

  get impactAt() {
    return T_FALL;
  }

  // 激突からの時間（激突の前は負）
  get since() {
    return this.t - T_FALL;
  }

  // 落ちてくる隕石の位置（t 秒の時点。激突の後は落ちた所）
  meteorPos(t = this.t) {
    const u = Math.min(1, Math.max(0, t / T_FALL));
    const e = u * u * 0.35 + u * 0.65; // 少しずつ速くなる
    const [x0, y0, z0] = this.from;
    const gy = 100; // 地面のあたり
    return [lerp(x0, this.site.x, e), lerp(y0, gy, e), lerp(z0, this.site.z, e)];
  }

  update(dt, player) {
    this.events = this.first ? [this.first] : [];
    this.first = null;
    const w = this.world;
    this.t += dt;
    if (this.phase === 'falling' && this.t >= T_FALL) {
      this.phase = 'impact';
      applyImpact(w, this.site);
      this.onImpact?.(w);
      this.events.push({ type: 'meteorImpact', actor: this.entity });
    }
    if (this.phase === 'falling') return;
    const tau = this.since;
    const P = player?.pos;
    const rp = P ? Math.hypot(P[0] + 4.5 - this.site.x, P[2] + 4.5 - this.site.z) : Infinity;
    // 地面の波が届いた: 足もとが持ち上がって跳ねる
    if (!this.quakeDone && tau * GROUND_WAVE >= rp) {
      this.quakeDone = true;
      const amp = waveAmp(rp);
      if (P && amp > 2) {
        if (player.vy === 0) player.vy = -Math.min(34, 8 + amp * 2.2);
        this.events.push({ type: 'meteorQuake', actor: this.entity, target: player, amp });
      }
    }
    // 衝撃波が届いた: 半径 1km の中なら、吹き飛ばされて傷を受ける
    if (!this.blastDone && tau * AIR_BLAST >= rp) {
      this.blastDone = true;
      if (P && rp < BLAST_R) this.blast(player, rp);
      else if (P) this.events.push({ type: 'meteorWind', actor: this.entity, target: player });
    }
    // 巻き上げられた岩が降ってくる
    if (P) this.rain(dt, player, rp, tau);
    for (const d of this.debris) d.update(dt);
    this.debris = this.debris.filter((d) => !d.done);
    if (this.phase === 'impact' && tau > DEBRIS_TIME + 10 && !this.debris.length) this.phase = 'after';
  }

  // 衝撃波: 近いほど大きな傷。外へ吹き飛ばされる
  blast(player, rp) {
    const w = this.world;
    const k = 1 - rp / BLAST_R;
    const damage = Math.round(150 * k ** 1.4);
    const push = Math.round(4 + 26 * k);
    const dx = (player.pos[0] + 4.5 - this.site.x) / rp, dz = (player.pos[2] + 4.5 - this.site.z) / rp;
    // 吹き飛ばされる（1 ボクセルずつ。ぶつかったら少し持ち上げて越える）
    for (let i = 0; i < push; i++) {
      const sx = Math.round(dx * (i + 1)) - Math.round(dx * i), sz = Math.round(dz * (i + 1)) - Math.round(dz * i);
      if (!sx && !sz) continue;
      if (w.tryMove(player.id, [sx, 0, sz], { push: false }).ok) continue;
      if (!w.tryMove(player.id, [sx, 1, sz], { push: false }).ok && !w.tryMove(player.id, [sx, 2, sz], { push: false }).ok) break;
    }
    player.vy = Math.min(player.vy, -Math.min(30, 10 + 30 * k));
    this.events.push({ type: 'meteorBlast', actor: this.entity, target: player, damage });
    if (damage > 0) {
      const r = w.hurt?.(damage);
      if (r) this.events.push(r);
    }
  }

  // プレイヤーのまわりに、岩が時間差で降ってくる
  rain(dt, player, rp, tau) {
    const start = 4 + rp / 3000;
    if (tau < start || tau > start + DEBRIS_TIME) return;
    const rate = 2.6 * Math.exp(-rp / 9000) * Math.exp(-(tau - start) / 20) + 0.15;
    if (this.debris.length >= 12 || this.rng() > rate * dt) return;
    const w = this.world;
    const a = this.rng() * Math.PI * 2, d = 10 + Math.sqrt(this.rng()) * 85;
    const x = Math.round(player.pos[0] + 4 + Math.cos(a) * d), z = Math.round(player.pos[2] + 4 + Math.sin(a) * d);
    const ground = w.loadedGroundAt(x, z);
    if (!ground) return; // まだ作られていない所には降らせない
    const away = [x - this.site.x, z - this.site.z];
    const L = Math.hypot(...away) || 1;
    const size = 1.6 + this.rng() * 2.6;
    this.debris.push(new Debris(w, this, [x, Math.min(HEIGHT - 12, ground + 260 + this.rng() * 120), z], [(away[0] / L) * 24, -150 - this.rng() * 60, (away[1] / L) * 24], size, this.rng));
    this.spawned++;
  }

  get label() {
    if (this.phase === 'falling') return `落下中（激突まで ${Math.max(0, Math.ceil(T_FALL - this.t))} 秒）`;
    if (this.phase === 'impact') return '激突。岩が降っている';
    return 'クレーターが残った';
  }
}

// 地面の波の高さ（激突した所からの距離 r で）。描画側の波と同じ式
export function waveAmp(r) {
  return 70 / (1 + r / 700) + 2;
}

// ---- 降ってくる岩 ----------------------------------------------------------------

class Debris {
  constructor(world, ev, pos, vel, size, rng) {
    this.world = world;
    this.ev = ev;
    this.p = pos;
    this.v = vel;
    this.size = size;
    this.id = world.nextId++;
    this.entity = { id: this.id, kind: 'debris', name: '降ってきた岩', priority: 8, pos: pos.map(Math.round), offsets: new Int16Array(0), colors: new Uint32Array(0), body: this };
    world.entities.set(this.id, this.entity);
    this.cells = [];
    this.done = false;
    this.seed = Math.floor(rng() * 1e6);
    // 形（でこぼこの塊）
    this.shape = [];
    const R = Math.ceil(size);
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        for (let x = -R; x <= R; x++) {
          const n = noise3(x * 0.6, y * 0.6, z * 0.6, this.seed);
          if (Math.hypot(x, y * 1.15, z) > size * (0.8 + 0.4 * n)) continue;
          const k = hash3(x, y, z + this.seed);
          const hot = n > 0.7 || (k % 9 === 0);
          this.shape.push([x, y, z, hot ? DEBRIS_HOT[k % DEBRIS_HOT.length] : DEBRIS_PALETTE[k % DEBRIS_PALETTE.length]]);
        }
      }
    }
  }

  solid(x, y, z) {
    const o = this.world.ownerAt(x, y, z);
    if (o === EMPTY || o === this.id) return false;
    if (o === -1) return y < 1;
    const e = this.world.entities.get(o);
    return !e?.yields && o !== WATER_ID && o !== FALL_ID && o !== PLANT_ID;
  }

  update(dt) {
    if (this.done) return;
    const w = this.world;
    const steps = Math.max(1, Math.ceil((Math.hypot(...this.v) * dt) / 1.5));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.v[1] -= 60 * h;
      const next = [this.p[0] + this.v[0] * h, this.p[1] + this.v[1] * h, this.p[2] + this.v[2] * h];
      const bx = Math.floor(next[0]), by = Math.floor(next[1] - this.size * 0.8), bz = Math.floor(next[2]);
      if (!w.chunks.has(chunkKeyAt(bx, bz))) {
        // 作られていない所へ出た（片付けられた）: そのまま消える
        clearBody(w, this.id, this.cells);
        w.entities.delete(this.id);
        this.done = true;
        return;
      }
      const o = w.ownerAt(bx, by, bz);
      if (o === w.player?.id) {
        // プレイヤーに当たった
        const damage = Math.round(14 + this.size * 6);
        const r = w.hurt?.(damage);
        this.ev.events.push({ type: 'meteorDebrisHit', actor: this.ev.entity, target: w.player, damage });
        if (r) this.ev.events.push(r);
        this.land();
        return;
      }
      if (this.solid(bx, by, bz) || next[1] < 2) {
        this.land();
        return;
      }
      this.p = next;
    }
    this.draw();
  }

  shapeCells(emit, at = this.p) {
    const cx = Math.round(at[0]), cy = Math.round(at[1]), cz = Math.round(at[2]);
    for (const [x, y, z, c] of this.shape) emit(cx + x, cy + y, cz + z, c);
  }

  draw() {
    const { cells } = redrawBody(this.world, this.id, this.cells, (emit) => this.shapeCells(emit), () => null);
    this.cells = cells;
    this.entity.pos = this.p.map(Math.round);
  }

  // 地面に落ちた: 空いているセルに岩として残る（地面の一部になる）
  land() {
    const w = this.world;
    clearBody(w, this.id, this.cells);
    this.cells = [];
    w.entities.delete(this.id);
    let y0 = Math.round(this.p[1]);
    const x0 = Math.round(this.p[0]), z0 = Math.round(this.p[2]);
    // 地面にめり込んだ所に置く
    while (y0 > 2 && !this.solid(x0, y0 - Math.ceil(this.size) - 1, z0)) y0--;
    y0 -= Math.floor(this.size * 0.4);
    const p = w.player;
    const inPlayer = (x, y, z) => p && x >= p.pos[0] && x < p.pos[0] + 9 && z >= p.pos[2] && z < p.pos[2] + 9 && y >= p.pos[1] - 1 && y < p.pos[1] + 16;
    for (const [dx, dy, dz, c] of this.shape) {
      const x = x0 + dx, y = y0 + dy, z = z0 + dz;
      if (y < 1 || y >= HEIGHT) continue;
      const o = w.ownerAt(x, y, z);
      if ((o !== EMPTY && o !== PLANT_ID) || inPlayer(x, y, z)) continue;
      w.setCell(x, y, z, ROCK_ID, c);
    }
    for (const [dx, , dz] of this.shape) w.recomputeHeight(x0 + dx, z0 + dz);
    this.ev.landed++;
    this.ev.events.push({ type: 'meteorDebris', actor: this.ev.entity, at: [x0, y0, z0], size: this.size });
    this.done = true;
  }
}

export { floorDiv, chunkKey, GROUND_ID };
