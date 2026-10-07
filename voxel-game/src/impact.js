// 隕石の激突で、世界の地形を時間とともに本当に動かす（プレイヤーのまわりの作ってあるチャンク）
//
// - 列ごとに、激突のときの高さ h0 と、クレーターができたあとの高さ hf を覚えておき、
//   いまの高さ = h0 + (hf - h0) × 進み P + 地面の波 W（meteor.js の式）になるように、地面のセルを積んだり取り除いたりする
// - すり鉢の中は、隕石がえぐった穴が外へ広がりながら深くなる。外は、押しのけられた岩と土が盛り上がった波になって
//   外へ広がり、通ったあとに岩屑が積もって外輪山になる。波はさらに遠くまで伝わる（焼け野原の外でも地面が揺れる）
// - 足もとが盛り上がると、プレイヤーは持ち上げられ、速く盛り上がると空へ投げ出される
// - 川や池の底が持ち上がると、水があふれて流れ出す（水の流れは床の変化を拾って、水の量を保つ）
// - 波が届いた木はばらばらに吹き飛び、巨大樹は葉と枝と上の方が吹き飛んで、焦げた幹だけが残る（近い木は丸ごと吹き飛ぶ）
// - 地中の奥まで掘られるチャンクは、持つ高さの下の端を下げる

import { CHUNK, LAYER, floorDiv } from './grid.js';
import { EMPTY, GROUND_ID, WATER_ID, ROCK_ID, FALL_ID, PLANT_ID, SOIL_ID } from './ids.js';
import { hash3, shade } from './rng.js';
import { craterShape, scarColor, impactP, impactW, waveAmp, cavityR, BLAST_R, CRATER_R, GROUND_WAVE, SETTLE } from './meteor.js';
import { giantSpec, getGiant, stripGiant, paintGiantLoaded } from './giant.js';
import { BoneScatter } from './bones.js';

const ZONE = BLAST_R + 400; // クレーターの形が変わる範囲
const RADIUS = 6; // プレイヤーのまわりで動かすチャンクの半径（world.impactRadius で狭められる）
const FRAGMENT_BUDGET = 6000; // 吹き飛ぶかけらのセルの数の上限（重くなりすぎないように）
const terrainOwner = (o) => o === GROUND_ID || o === SOIL_ID || o === ROCK_ID || o === PLANT_ID || o === WATER_ID || o === FALL_ID;
const openOwner = (o) => o === EMPTY || o === WATER_ID || o === PLANT_ID || o === FALL_ID;
const CHAR = [0x2a221d, 0x332820, 0x1f1a17, 0x3a2e22];

export class ImpactUpdater {
  constructor(world, site) {
    this.world = world;
    this.site = site;
    this.touched = new Set(); // 動かしたチャンク
    this.blown = new Set(); // 吹き飛ばした木・巨大樹（区画の番号）
    this.fragments = 0;
    this.lifted = 0; // プレイヤーを持ち上げた高さ（数えるだけ）
    this.events = [];
  }

  // 列の情報: 激突のときの高さ、最後の高さ、焼け方（色を決める）
  init(c) {
    const w = this.world;
    const st = { h0: Uint16Array.from(c.height), hf: null, look: null, top: new Uint32Array(CHUNK * CHUNK) };
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    for (let col = 0; col < CHUNK * CHUNK; col++) {
      const y = c.height[col] - 1;
      st.top[col] = y >= c.base && (y - c.base + 1) * LAYER <= c.color.length ? c.color[c.index(col % CHUNK, y, Math.floor(col / CHUNK))] & 0xffffff : 0;
    }
    const near = Math.hypot(Math.max(x0, Math.min(this.site.x, x0 + CHUNK)) - this.site.x, Math.max(z0, Math.min(this.site.z, z0 + CHUNK)) - this.site.z) < ZONE;
    if (near) {
      st.hf = new Int16Array(CHUNK * CHUNK);
      st.look = new Float32Array(CHUNK * CHUNK * 3);
      const out = {};
      for (let col = 0; col < CHUNK * CHUNK; col++) {
        out.h = st.h0[col];
        craterShape(w, x0 + (col % CHUNK), z0 + Math.floor(col / CHUNK), out, this.site);
        st.hf[col] = out.h;
        st.look[col * 3] = out.crater;
        st.look[col * 3 + 1] = out.ejecta;
        st.look[col * 3 + 2] = out.blast;
      }
    }
    c.imp = st;
    return st;
  }

  // 落ちてくる間に、プレイヤーのまわりのチャンクの最後の形を、近い順に少しずつ計算しておく
  prepare(player, budget = 6) {
    const P = player?.pos;
    if (!P) return;
    const pcx = floorDiv(P[0] + 4, CHUNK), pcz = floorDiv(P[2] + 4, CHUNK);
    let n = 0;
    for (let r = 0; r <= RADIUS && n < budget; r++) {
      for (let dz = -r; dz <= r && n < budget; dz++) {
        for (let dx = -r; dx <= r && n < budget; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c = this.world.chunks.get(((pcx + dx) + 32768) * 65536 + ((pcz + dz) + 32768));
          if (!c || c.imp) continue;
          this.init(c);
          n++;
        }
      }
    }
  }

  // 激突から tau 秒の地形にする。player: プレイヤー（持ち上げる）
  update(tau, player) {
    this.events = [];
    const w = this.world;
    const P = player?.pos;
    if (!P) return;
    const pcx = floorDiv(P[0] + 4, CHUNK), pcz = floorDiv(P[2] + 4, CHUNK);
    const front = GROUND_WAVE * tau;
    // プレイヤーの足もとの、これからの高さ（先に持ち上げておく。地面のセルがプレイヤーに入り込まないように）
    this.liftPlayer(player, tau);
    const work = [];
    const R = Math.min(RADIUS, w.impactRadius ?? RADIUS);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const c = w.chunks.get(((pcx + dx) + 32768) * 65536 + ((pcz + dz) + 32768));
        if (!c) continue;
        // チャンクのいちばん近い所と遠い所の、落ちた所からの距離
        const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
        const rmin = Math.hypot(Math.max(x0, Math.min(this.site.x, x0 + CHUNK)) - this.site.x, Math.max(z0, Math.min(this.site.z, z0 + CHUNK)) - this.site.z);
        const rmax = Math.hypot(Math.max(Math.abs(x0 - this.site.x), Math.abs(x0 + CHUNK - this.site.x)), Math.max(Math.abs(z0 - this.site.z), Math.abs(z0 + CHUNK - this.site.z)));
        // まだ何も届いていない所・もう動き終わった所は調べない
        if (rmin > Math.max(front + 520, cavityR(tau) + 300)) continue;
        const waving = front - rmax < 920;
        if (rmin > ZONE && !waving) continue;
        if (c.imp?.fresh || (c.imp?.final && !waving)) continue;
        work.push(c);
      }
    }
    for (const c of work) this.updateChunk(c, tau);
    this.blowTrees(tau, pcx, pcz);
  }

  updateChunk(c, tau) {
    const w = this.world;
    const st = c.imp ?? this.init(c);
    this.touched.add(c.key);
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    const target = new Int16Array(CHUNK * CHUNK);
    let changed = false, lowest = Infinity, highest = 0, settled = true;
    for (let col = 0; col < CHUNK * CHUNK; col++) {
      const x = x0 + (col % CHUNK), z = z0 + Math.floor(col / CHUNK);
      const r = Math.hypot(x + 0.5 - this.site.x, z + 0.5 - this.site.z);
      const h0 = st.h0[col], hf = st.hf ? st.hf[col] : h0;
      const p = impactP(r, tau), wv = impactW(r, tau);
      if (p < 1 || Math.abs(wv) > 0.4) settled = false;
      const h = Math.max(2, Math.round(h0 + (hf - h0) * p + wv));
      target[col] = h;
      if (h !== c.height[col]) changed = true;
      lowest = Math.min(lowest, h);
      highest = Math.max(highest, h, c.height[col]);
    }
    if (settled && tau > 1) st.final = true;
    if (!changed) return;
    if (lowest - 6 < c.base) c.lower(lowest - 10);
    c.ensure(highest + 1); // 配列は一度に広げる（列ごとに広げると何度も写し直して遅い）
    const water = w.water;
    const mark = new Uint8Array(CHUNK * CHUNK); // 色を調べる列（変わった列と、そのとなり）
    for (let col = 0; col < CHUNK * CHUNK; col++) {
      const cur = c.height[col], h = target[col];
      if (cur === h) continue;
      mark[col] = 1;
      if (col % CHUNK) mark[col - 1] = 1;
      if (col % CHUNK < CHUNK - 1) mark[col + 1] = 1;
      if (col >= CHUNK) mark[col - CHUNK] = 1;
      if (col < CHUNK * (CHUNK - 1)) mark[col + CHUNK] = 1;
      const lx = col % CHUNK, lz = Math.floor(col / CHUNK);
      if (h > cur) {
        // 盛り上がる: 空いている所（水・草も）を地面にする。木や物の入っている所はそのまま
        const wet = c.water[col] > cur;
        const owner = c.owner, color = c.color, ch = c.changed;
        for (let y = cur, i = c.index(lx, cur, lz); y < h; y++, i += LAYER) {
          const o = owner[i];
          if (o !== EMPTY && o !== WATER_ID && o !== PLANT_ID && o !== FALL_ID) continue;
          owner[i] = GROUND_ID;
          color[i] = 0;
          ch.push(i);
        }
        if (wet && water && (lx + lz) % 3 === 0) water.impulse(x0 + lx, z0 + lz, 6 + (h - cur) * 3, 5); // 水を押しのける
      } else {
        // 下がる: 地面・岩・草・水のセルを取り除く
        const owner = c.owner, color = c.color, ch = c.changed;
        for (let y = h, i = c.index(lx, h, lz); y < cur; y++, i += LAYER) {
          if (!terrainOwner(owner[i])) continue;
          owner[i] = EMPTY;
          color[i] = 0;
          ch.push(i);
        }
      }
      c.height[col] = h;
      if (h > c.top) c.top = h + 1;
    }
    // 見えるようになった面に色をつける（この列と、となりの列の側面）
    for (let col = 0; col < CHUNK * CHUNK; col++) {
      if (!mark[col]) continue;
      const lx = col % CHUNK, lz = Math.floor(col / CHUNK);
      const x = x0 + lx, z = z0 + lz;
      const h = c.height[col];
      let lo = h - 1;
      // となりの列の高さ（チャンクの中なら直接読む）
      const hh = c.height;
      lo = Math.min(lo, lx < CHUNK - 1 ? hh[col + 1] : this.heightAt(x + 1, z, h), lx > 0 ? hh[col - 1] : this.heightAt(x - 1, z, h));
      lo = Math.min(lo, lz < CHUNK - 1 ? hh[col + CHUNK] : this.heightAt(x, z + 1, h), lz > 0 ? hh[col - CHUNK] : this.heightAt(x, z - 1, h));
      const y0 = Math.max(c.base, lo);
      for (let y = y0, i = c.index(lx, y0, lz); y < h; y++, i += LAYER) {
        if (c.color[i] || c.owner[i] !== GROUND_ID) continue;
        c.color[i] = this.colorOf(st, col, x, y, z, h - 1 - y);
        c.changed.push(i);
      }
    }
    w.dirty.add(c.key);
  }

  // 作ってあるチャンクの列の高さ（なければ dflt）
  heightAt(x, z, dflt) {
    const c = this.world.chunks.get((floorDiv(x, CHUNK) + 32768) * 65536 + (floorDiv(z, CHUNK) + 32768));
    return c ? c.height[(x - c.cx * CHUNK) + CHUNK * (z - c.cz * CHUNK)] : dflt;
  }

  // 列の色（焼け方と岩屑で決まる地表の色）は列ごとに一度だけ決めて、セルごとには明るさだけ変える（速さのため）
  colorOf(st, col, x, y, z, depth) {
    let top = st.cc?.[col];
    if (!top) {
      top = st.top[col] || 0x6b5a48;
      if (st.look && st.look[col * 3 + 2]) {
        top = scarColor(this.world.seed, x, y, z, { crater: st.look[col * 3], ejecta: st.look[col * 3 + 1], blast: st.look[col * 3 + 2] }, top);
      }
      (st.cc ??= new Uint32Array(CHUNK * CHUNK))[col] = top || 0x101010;
    }
    const k = hash3(x, y, z);
    return shade(top, (depth === 0 ? 0.92 : 0.7) + (k % 16) / 100) || 0x101010;
  }

  // 足もとが盛り上がるなら、プレイヤーを先に持ち上げる（速ければ空へ投げ出す）
  liftPlayer(p, tau) {
    const w = this.world;
    let hi = -Infinity;
    for (let dz = 0; dz < 9; dz += 2) {
      for (let dx = 0; dx < 9; dx += 2) {
        const x = p.pos[0] + dx, z = p.pos[2] + dz;
        const c = w.chunks.get((floorDiv(x, CHUNK) + 32768) * 65536 + (floorDiv(z, CHUNK) + 32768));
        if (!c) continue;
        const col = (x - c.cx * CHUNK) + CHUNK * (z - c.cz * CHUNK);
        const st = c.imp;
        const h0 = st ? st.h0[col] : c.height[col];
        const hf = st?.hf ? st.hf[col] : h0;
        const r = Math.hypot(x + 0.5 - this.site.x, z + 0.5 - this.site.z);
        hi = Math.max(hi, Math.round(h0 + (hf - h0) * impactP(r, tau) + impactW(r, tau)));
      }
    }
    const rise = hi - p.pos[1];
    if (rise <= 0) return;
    w.paint(p, false);
    const free = (y) => {
      for (let o = 0; o < p.offsets.length; o += 3) {
        const own = w.ownerAt(p.pos[0] + p.offsets[o], y + p.offsets[o + 1], p.pos[2] + p.offsets[o + 2]);
        if (own !== EMPTY && !openOwner(own) && !terrainOwner(own)) return false;
      }
      return true;
    };
    let y = hi;
    while (y < hi + 30 && !free(y)) y++;
    if (free(y)) p.pos[1] = y;
    // 盛り上がった地面のセルと重なる所は、プレイヤーの体が上書きする（プレイヤーは地面より先に動く）
    w.paint(p, true);
    this.lifted += rise;
    // 速く盛り上がるほど、空へ投げ出される（1 回の更新は 0.08 秒）
    if (rise > 2) p.vy = Math.min(p.vy, -Math.min(48, rise / 0.08 * 0.5));
  }

  // 波が届いた木・巨大樹を吹き飛ばす
  blowTrees(tau, pcx, pcz) {
    const w = this.world;
    const front = GROUND_WAVE * tau;
    const range = (RADIUS + 3) * CHUNK;
    const px = pcx * CHUNK, pz = pcz * CHUNK;
    const reached = (x, z) => {
      const r = Math.hypot(x - this.site.x, z - this.site.z);
      return r < BLAST_R && r < front + 40 ? r : -1;
    };
    for (const [key, tree] of [...w.trees]) {
      const sp = tree.spec;
      if (Math.abs(sp.x - px) > range || Math.abs(sp.z - pz) > range) continue;
      const r = reached(sp.x, sp.z);
      if (r < 0) continue;
      const cells = [];
      for (const [ck, list] of tree.buckets) {
        const c = w.chunks.get(ck);
        if (!c) continue;
        for (const i of list) {
          const y = tree.ys[i];
          if (y < c.base || (y - c.base + 1) * LAYER > c.owner.length) continue;
          const ci = c.index(tree.xs[i] - c.cx * CHUNK, y, tree.zs[i] - c.cz * CHUNK);
          if (c.owner[ci] !== tree.id) continue;
          if (c.color[ci] && hash3(i, 3, 7) % 8 === 0) cells.push([tree.xs[i], y, tree.zs[i], shade(c.color[ci], 0.55)]);
          c.owner[ci] = EMPTY;
          c.color[ci] = 0;
          c.changed.push(ci);
          w.dirty.add(c.key);
        }
      }
      tree.gone.fill(1);
      w.trees.delete(key);
      w.entities.delete(tree.id);
      this.scatter(cells, [sp.x, sp.y, sp.z], r, '吹き飛ばされた木', 3);
    }
    for (const [key, g] of [...(w.giants ?? [])]) {
      if (g.spec.burn || this.blown.has(key)) continue; // もう焼けた形
      const sp = g.spec;
      if (Math.abs(sp.x - px) > range + 150 || Math.abs(sp.z - pz) > range + 150) continue;
      const r = reached(sp.x, sp.z);
      if (r < 0) continue;
      this.blown.add(key);
      // 元の木を取り除き、焼けた形（なければ何も残らない）で塗り直す。取り除いたセルの一部が、かけらになって吹き飛ぶ
      const removed = stripGiant(w, g, 12);
      w.giants.delete(key);
      w.entities.delete(g.id);
      const spec = giantSpec(w, sp.gx, sp.gz);
      if (spec) paintGiantLoaded(w, getGiant(w, spec));
      const cells = removed.map(([x, y, z, col]) => [x, y, z, hash3(x, y, z) % 3 ? CHAR[hash3(x, z, y) % CHAR.length] : shade(col, 0.5)]);
      this.scatter(cells, [sp.x, sp.y, sp.z], r, spec ? '焼けた巨大樹の枝葉' : '吹き飛ばされた巨大樹', 6);
      this.events.push({ type: 'meteorGiant', actor: this.actor ?? { kind: 'meteor', name: '巨大隕石' }, gone: !spec });
    }
  }

  // かけらを外へ吹き飛ばす（上限を超えた分は燃え尽きる）
  scatter(cells, at, r, name, block) {
    if (!cells.length || this.fragments >= FRAGMENT_BUDGET) return;
    const room = FRAGMENT_BUDGET - this.fragments;
    if (cells.length > room) cells = cells.filter((_, k) => k % Math.ceil(cells.length / room) === 0);
    this.fragments += cells.length;
    const k = Math.max(0.6, 1 - r / BLAST_R);
    const from = [this.site.x, at[1], this.site.z];
    new BoneScatter(this.world, cells, { name, center: [at[0], at[1], at[2]], block, power: 1.2 + 3 * k, from, seed: hash3(at[0], at[2], 5), upK: 0.04 }).register(this.world);
  }

  // 波が通り過ぎて、最後の形になったチャンクか
  isFinal(c) {
    return Boolean(c.imp?.final);
  }
}

export { CRATER_R, SETTLE, waveAmp };
