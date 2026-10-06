// 空を泳ぐ古代魚: 小魚の群れが融け合ってできた、全長およそ 10m の 1 匹の魚
//
// - 1 匹のときは、204 匹の小魚がすっかり融け合って 1 匹の古代魚になっている（継ぎ目は見えない）。
//   ナマズのように平たく幅の広い頭、長い髭（口の両端の 2 本と、あごの 4 本）、大きな扇のような胸びれ
// - 小魚はそれぞれ体の決まった場所（持ち場）を受け持つ。持ち場に着いた小魚は体に融け込み、そこの体が見える。
//   持ち場へ向かっている途中の小魚だけが、1 匹ずつの小魚として見える
// - 木や巨大樹の幹が行く手にあると、左右 2 匹の小さな古代魚に分かれて（体積は同じ）両側を回り込み、通り過ぎるとまた 1 匹に融け合う。
//   分かれる・融け合う瞬間は、小魚がほどけて組み替わる
// - 撃たれると一気にほどけて小魚の群れになり、散らばって逃げる。数秒後に集まり直して、また 1 匹の古代魚になる。
//   ばらけた小魚は撃つと落とせる。減った分だけ、集まり直した古代魚は小さくなる。ほとんどいなくなると逃げ去り、しばらくして別の群れが来る
// - 速く泳ぐとき（ときどき回遊する・撃たれたあと逃げるとき）は、マグロのような回遊魚の形に変わる:
//   とがった頭、紡錘形の体、三日月形の尾びれ、小さな胸びれ、背と腹の黄色い小離鰭。髭は縮んで消える
//
// 1つのボクセルには1つの物だけ: 体は空いているセルにだけ入る。人・NPC がいれば押しのける

import { redrawBody, MOVABLE } from './body.js';
import { CHUNK, HEIGHT, LAYER, chunkKeyAt } from './grid.js';
import { EMPTY, WATER_ID, FALL_ID, PLANT_ID } from './ids.js';
import { mulberry32, hash3, shade } from './rng.js';

export const FISH_LENGTH = 67; // ボクセル（≈ 10m）
const SEG = 17, ANG = 12; // 持ち場: 体の長さを 17、まわりを 12 に分ける
export const FISH_COUNT = SEG * ANG; // 小魚の数
const BODY_END = 0.9; // 胴（この先は尾びれ）
const CRUISE = 12, DASH = 32, FLEE = 30; // 泳ぐ速さ（ボクセル/秒）
const HEIGHT_ABOVE = 60; // 地面からの高さ（ボクセル ≈ 9m。背の高い木の梢や巨大樹の幹の間を泳ぐ）
const SCATTER_TIME = 3.5; // 撃たれてから集まり始めるまで（秒）
const LOCK = 2.2; // 持ち場までこの距離になると、体に融け込む
const MIN_FISH = 12; // これより減ると、群れは逃げ去る
const RETURN_TIME = 40; // 逃げ去ってから次の群れが来るまで（秒）

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function mix(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// 体の太さ（t: 頭 0 → 尾 1、u: ナマズ 0 → マグロ 1）。w: 横の半径、h: 縦の半径
function widthAt(t, u) {
  const cat = t < 0.12 ? lerp(6, 9.5, t / 0.12) : t < 0.3 ? lerp(9.5, 8.2, (t - 0.12) / 0.18) : lerp(8.2, 1.3, ease((t - 0.3) / 0.6));
  const tuna = t < 0.35 ? 0.8 + 5.4 * Math.sin((t / 0.35) * Math.PI / 2) : lerp(6.2, 0.8, ease((t - 0.35) / 0.55));
  return lerp(cat, tuna, u);
}
function heightAt(t, u) {
  const cat = t < 0.12 ? lerp(3.4, 5.6, t / 0.12) : t < 0.3 ? lerp(5.6, 6.2, (t - 0.12) / 0.18) : lerp(6.2, 1.8, ease((t - 0.3) / 0.6));
  const tuna = t < 0.35 ? 1 + 7.4 * Math.sin((t / 0.35) * Math.PI / 2) : lerp(8.4, 1.1, ease((t - 0.35) / 0.55));
  return lerp(cat, tuna, u);
}

// 色（ナマズの古代魚 → マグロ）
const CAT = {
  back: 0x2f3b2c, side: 0x5d6646, spot: 0x3a3324, belly: 0xcfc49a, line: 0x8a8a62, scute: 0x7a7458,
  fin: 0x4a4a36, ray: 0x37372a, edge: 0x8a7d55, barbel: 0x2b2a22, mouth: 0x1e1a14,
};
const TUNA = {
  back: 0x1b2c58, side: 0x9fb0c2, spot: 0x8597ab, belly: 0xe9eef2, line: 0xc9d4de, scute: 0x2a3d6e,
  fin: 0x253457, ray: 0x1b2848, edge: 0x3a4c78, barbel: 0x1b2c58, mouth: 0x101a30,
};
const FINLET = 0xf0c22c;
const EYE = 0xd8b23a, PUPIL = 0x0d0d0d;

export class AncientFish {
  constructor(world, start, rng = mulberry32(23)) {
    this.world = world;
    this.rng = rng;
    this.id = world.nextId++;
    this.entity = {
      id: this.id, kind: 'fish', name: '古代魚', priority: 6, pos: [0, 0, 0],
      offsets: new Int16Array(0), colors: new Uint32Array(0),
    };
    world.entities.set(this.id, this.entity);
    this.home = [start[0], start[2]];
    this.cells = [];
    this.events = [];
    this.time = 0;
    this.version = 0;
    this.reset(start);
  }

  // 群れを最初の姿にする（はじめと、逃げ去ったあとに次の群れが来るとき）
  reset(at, scattered = false) {
    this.head = [...at];
    this.yaw = this.rng() * Math.PI * 2;
    this.pitch = 0;
    this.speed = CRUISE;
    this.u = 0; // ナマズ 0 → マグロ 1
    this.state = scattered ? 'regroup' : 'swim';
    this.stateTime = 0;
    this.split = null;
    this.splitCooldown = 0;
    this.dashIn = 20 + this.rng() * 15;
    this.waypoint = null;
    this.swimPhase = 0;
    this.finPhase = 0;
    this.dist = 0; // 頭が泳いだ距離
    // 軌跡: 頭が通った点（新しい順）と、そこまでに泳いだ距離
    this.trail = [];
    const back = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
    for (let s = 0; s <= FISH_LENGTH + 12; s += 2) this.trail.push({ p: [at[0] + back[0] * s, at[1], at[2] + back[2] * s], d: -s });
    this.fish = [];
    for (let i = 0; i < FISH_COUNT; i++) {
      const r = scattered ? 30 : 0;
      this.fish.push({
        p: [at[0] + (this.rng() - 0.5) * r, at[1] + (this.rng() - 0.5) * r * 0.5, at[2] + (this.rng() - 0.5) * r],
        v: [0, 0, 0], alive: true, locked: !scattered, hue: hash3(i, 7, 3),
      });
    }
    this.alive = this.fish.slice();
    this.formKey = null;
    this.forms = this.makeForms();
    this.place(!scattered);
  }

  get label() {
    const shape = this.u > 0.5 ? 'マグロの形で' : '';
    switch (this.state) {
      case 'swim': return this.forms?.length === 2 ? '2 匹に分かれて木をよけている' : `${shape}泳いでいる`;
      case 'dash': return this.forms?.length === 2 ? '2 匹に分かれて木をよけている' : `${shape}回遊している`;
      case 'flee': return `${shape}逃げている`;
      case 'scatter': return '小魚の群れにほどけた';
      case 'regroup': return '小魚が集まって融け合っている';
      default: return '逃げ去った';
    }
  }

  // ---- 動き ------------------------------------------------------------------

  update(dt, player) {
    this.events = [];
    this.time += dt;
    this.stateTime += dt;
    this.splitCooldown = Math.max(0, this.splitCooldown - dt);
    const P = player ? [player.pos[0] + 4.5, player.pos[1] + 9, player.pos[2] + 4.5] : null;
    this.decide(dt, P);
    if (this.state !== 'gone') this.swim(dt);
    else if (this.time > this.vanishAt) this.alive = [];
    // 速く泳ぐとマグロの形に変わる（ゆっくり）
    const was = this.u;
    this.u = approach(this.u, this.speed > 18 ? 1 : 0, dt / 1.6);
    // 木をよけている間は、胸びれを体に沿わせてたたむ
    this.tuck = approach(this.tuck ?? 0, this.split ? 1 : 0, dt / 0.5);
    if ((was < 0.5) !== (this.u < 0.5)) this.events.push({ type: 'fishMorph', actor: this.entity, tuna: this.u >= 0.5 });
    this.swimPhase += dt * lerp(3 + this.speed * 0.12, 9 + this.speed * 0.1, this.u);
    this.finPhase += dt * lerp(1.8, 4, this.u) * (0.6 + this.speed / 30);
    this.forms = this.makeForms();
    this.place(false, dt, P);
    this.draw();
    this.version++;
    this.entity.pos = this.head.map(Math.round);
  }

  // 行動を決める
  decide(dt, P) {
    const rng = this.rng;
    switch (this.state) {
      case 'swim':
        this.dashIn -= dt;
        if (this.dashIn <= 0 && !this.split) {
          // ときどき遠くまで回遊する（速く泳ぐのでマグロの形になる）
          this.setState('dash');
          const a = this.yaw + (rng() - 0.5) * 1.2;
          const r = 170 + rng() * 60;
          this.waypoint = [this.home[0] + Math.sin(a) * r, 0, this.home[1] + Math.cos(a) * r];
        }
        this.targetSpeed = CRUISE;
        break;
      case 'dash':
        this.targetSpeed = DASH;
        if (this.stateTime > 7) {
          this.setState('swim');
          this.dashIn = 25 + rng() * 20;
          this.waypoint = null;
        }
        break;
      case 'flee':
        this.targetSpeed = FLEE;
        if (this.stateTime > 6) {
          this.setState('swim');
          this.waypoint = null;
        }
        break;
      case 'scatter':
        this.targetSpeed = 14;
        if (P && this.stateTime < dt * 1.5) {
          const a = Math.atan2(this.head[0] - P[0], this.head[2] - P[2]);
          this.waypoint = [this.head[0] + Math.sin(a) * 120, 0, this.head[2] + Math.cos(a) * 120];
        }
        if (this.stateTime > SCATTER_TIME) {
          this.setState('regroup');
          this.events.push({ type: 'fishRegroup', actor: this.entity });
        }
        break;
      case 'regroup': {
        this.targetSpeed = 5;
        const locked = this.alive.filter((f) => f.locked).length;
        if (locked >= this.alive.length * 0.95 || this.stateTime > 8) {
          for (const f of this.alive) f.locked = true;
          this.setState(this.fled && P ? 'flee' : 'swim');
          this.waypoint = null;
          if (this.fled && P) {
            // 撃った相手から遠ざかる
            const a = Math.atan2(this.head[0] - P[0], this.head[2] - P[2]) + (rng() - 0.5) * 0.6;
            this.waypoint = [this.head[0] + Math.sin(a) * 160, 0, this.head[2] + Math.cos(a) * 160];
          }
          this.fled = false;
        }
        break;
      }
      case 'gone':
        if (this.stateTime > RETURN_TIME) {
          // 別の群れが、出発地点の近くへ集まってくる
          const a = rng() * Math.PI * 2;
          const x = this.home[0] + Math.sin(a) * 60, z = this.home[1] + Math.cos(a) * 60;
          this.reset([x, this.floorAt(x, z) + HEIGHT_ABOVE, z], true);
          this.events.push({ type: 'fishBack', actor: this.entity });
        }
        break;
    }
  }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  // 地面（と水面）の高さ。木は数えない（木はよける）
  floorAt(x, z) {
    const w = this.world;
    if (!w.terrain) return w.heightAt(Math.floor(x), Math.floor(z));
    const s = w.sample(Math.floor(x), Math.floor(z), {});
    return Math.max(s.h, s.water ?? 0);
  }

  // 作られているチャンクだけを見て、ふさがっているか（作られていない所は地形だけ）
  solidAt(x, y, z) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 1) return true;
    if (y >= HEIGHT) return false;
    const w = this.world;
    const c = w.chunks.get(chunkKeyAt(x, z));
    if (!c) return y < this.floorAt(x, z);
    if (y < c.base) return true;
    if ((y - c.base + 1) * LAYER > c.owner.length) return false;
    const o = c.owner[c.index(x - c.cx * CHUNK, y, z - c.cz * CHUNK)];
    if (o === EMPTY || o === WATER_ID || o === FALL_ID || o === PLANT_ID || o === this.id) return false;
    const e = w.entities.get(o);
    return !(e && (e.yields || MOVABLE.has(e.kind)));
  }

  // 向き yaw の前方 d、横 o の所が、高さ y のまわり（±band）でふさがっているか
  blockedAt(yaw, d, o, y, band) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const x = this.head[0] + fx * d + fz * o, z = this.head[2] + fz * d - fx * o;
    for (let dy = -band; dy <= band; dy += 3) if (this.solidAt(x, y + dy, z)) return true;
    return false;
  }

  // 頭を動かす（行く手の木をよける・地面の上の高さを保つ）
  swim(dt) {
    const rng = this.rng;
    const w = this.world;
    const reached = this.waypoint && Math.hypot(this.waypoint[0] - this.head[0], this.waypoint[2] - this.head[2]) < 20;
    if (!this.waypoint || reached) {
      if (reached && (this.state === 'dash' || this.state === 'flee')) {
        this.setState('swim');
        this.dashIn = 25 + rng() * 20;
      }
      // 出発地点のまわりをゆったり回る
      const a = rng() * Math.PI * 2, r = 40 + rng() * 100;
      this.waypoint = [this.home[0] + Math.sin(a) * r, 0, this.home[1] + Math.cos(a) * r];
    }
    let wantYaw = Math.atan2(this.waypoint[0] - this.head[0], this.waypoint[2] - this.head[2]);
    const sc = this.scale;
    const formed = this.state !== 'scatter' && this.state !== 'regroup';
    // 行く手の木: 分かれて両側を回り込む（片側しか空いていなければ、そちらへ曲がる）
    if (formed && !this.split && this.splitCooldown <= 0 && w.terrain !== false) {
      const y = this.head[1];
      const half = 9 * sc;
      let D = null;
      for (let d = 10; d <= 46 && D === null; d += 4) {
        for (const o of [-half, -half / 2, 0, half / 2, half]) {
          if (this.blockedAt(this.yaw, d, o, y, 6)) {
            D = d;
            break;
          }
        }
      }
      if (D !== null) {
        const sub = 8.5 * sc; // 分かれた 1 匹の半分の幅（頭の横幅と、たたんだ胸びれ）
        const free = (side) => {
          for (let o = 4; o <= 44; o += 2) {
            let ok = true;
            for (const dd of [D - 4, D, D + 4, D + 8, D + 14]) {
              for (let k = -sub; k <= sub + 0.01 && ok; k += 2) if (this.blockedAt(this.yaw, dd, side * (o + k), y, 4)) ok = false;
              if (!ok) break;
            }
            if (ok) return o;
          }
          return null;
        };
        const L = free(-1), R = free(1);
        if (L !== null && R !== null && this.alive.length >= 24) {
          // 木の 20 ボクセルほど手前から左右へ分かれ始め、木の横では離れきり、通り過ぎると寄っていく
          const d1 = this.dist + Math.max(4, D - 6);
          this.split = {
            d0: Math.max(this.dist, d1 - 22), d1, d2: this.dist + D + 10, d3: this.dist + D + 22,
            off: [-(L + 4), R + 4], lift: [3, -3],
          };
        } else if (L !== null || R !== null) {
          wantYaw = this.yaw + (L !== null && (R === null || L < R) ? 1 : -1) * 0.9;
        } else {
          this.climb = 2; // 上へよける
        }
      }
    }
    // 分かれていたのが通り過ぎたら、また 1 匹に融け合う
    // （頭が通り過ぎたら、尾の側はまだ離れていても、小魚が寄り集まって融け合う）
    if (this.split && this.dist > this.split.d3 + 6) {
      this.split = null;
      this.splitCooldown = 3;
    }
    const turn = lerp(0.7, 1.1, this.u) * (this.split ? 0.3 : 1);
    this.yaw += clamp(wrap(wantYaw - this.yaw), -turn * dt, turn * dt);
    // 高さ: 地面（前方も）から HEIGHT_ABOVE ほど。よけられない物があれば上へ
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let floor = Math.max(this.floorAt(this.head[0], this.head[2]), this.floorAt(this.head[0] + fx * 30, this.head[2] + fz * 30));
    this.climb = Math.max(0, (this.climb ?? 0) - dt);
    const ty = Math.min(HEIGHT - 30, floor + HEIGHT_ABOVE + 6 * Math.sin(this.time * 0.21) + (this.climb > 0 ? 40 : 0));
    const wantPitch = clamp(Math.atan2(ty - this.head[1], 35), -0.35, 0.35);
    this.pitch += clamp(wantPitch - this.pitch, -0.5 * dt, 0.5 * dt);
    this.speed = approach(this.speed, this.targetSpeed ?? CRUISE, 14 * dt);
    const cp = Math.cos(this.pitch);
    const step = this.speed * dt;
    this.head[0] += fx * cp * step;
    this.head[1] += Math.sin(this.pitch) * step;
    this.head[2] += fz * cp * step;
    this.dist += step;
    if (Math.hypot(this.head[0] - this.trail[0].p[0], this.head[1] - this.trail[0].p[1], this.head[2] - this.trail[0].p[2]) > 0.5) {
      this.trail.unshift({ p: [...this.head], d: this.dist });
    }
    while (this.trail.length > 4 && this.trail[this.trail.length - 2].d < this.dist - FISH_LENGTH - 12) this.trail.pop();
  }

  // 生きている小魚の数に合わせた大きさ（減ると小さくなる）
  get scale() {
    return clamp(Math.sqrt(this.alive.length / FISH_COUNT), 0.45, 1);
  }

  // ---- 形 --------------------------------------------------------------------

  // いまの体: 1 匹（k = -1）か、分かれた 2 匹（k = 0, 1）。ほどけているときは空
  makeForms() {
    if (this.state === 'scatter' || this.state === 'gone') return [];
    const sc = this.scale;
    // 分かれ始める所まで来たら 2 匹になる
    if (!this.split || this.dist < this.split.d0 - 1) return [this.spineOf(-1, sc)];
    return [this.spineOf(0, sc * 0.8), this.spineOf(1, sc * 0.8)];
  }

  // 軌跡の上で、頭から距離 s の点（軌跡より後ろはまっすぐ伸ばす）
  spineOf(k, sc) {
    const L = FISH_LENGTH * sc;
    const pts = [];
    const tr = this.trail;
    let i = 0;
    const S = this.split;
    const u = this.u;
    for (let s = 0; s <= L; s += 1) {
      const d = this.dist - s;
      while (i < tr.length - 2 && tr[i + 1].d > d) i++;
      const a = tr[i], b = tr[i + 1] ?? tr[i];
      const span = a.d - b.d || 1;
      const f = clamp((a.d - d) / span, 0, 2);
      const c = [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f];
      let T = norm([a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]]);
      if (s === 0) {
        T = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
        c[0] = this.head[0];
        c[1] = this.head[1];
        c[2] = this.head[2];
      }
      const B = norm(cross(T, [0, 1, 0])); // 横（右）
      const t = s / L;
      // 泳ぐうねり: ナマズは体全体を大きくくねらせ、マグロは尾のあたりだけを速く振る
      const ampC = (0.3 + 3.6 * t * t) * sc, ampT = 4.2 * Math.max(0, (t - 0.65) / 0.35) ** 2 * sc;
      const wave = lerp(ampC * Math.sin(t * Math.PI * 1.8 - this.swimPhase), ampT * Math.sin(t * Math.PI - this.swimPhase), u);
      // 分かれているときは、木の両側へ回り込む（その点を頭が通ったときの、泳いだ距離で決まる）
      let off = 0, lift = 0;
      if (S && k >= 0) {
        const r = d < S.d0 ? 0 : d < S.d1 ? ease((d - S.d0) / (S.d1 - S.d0)) : d < S.d2 ? 1 : d < S.d3 ? 1 - ease((d - S.d2) / (S.d3 - S.d2)) : 0;
        off = S.off[k] * r;
        lift = S.lift[k] * r;
      }
      pts.push({ c: [c[0] + B[0] * (wave + off), c[1] + lift, c[2] + B[2] * (wave + off)], T, B });
    }
    // うねりを加えたあとの向き
    for (let j = 0; j < pts.length; j++) {
      const a = pts[Math.max(0, j - 2)], b = pts[Math.min(pts.length - 1, j + 2)];
      const T = norm([a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]]);
      const B = norm(cross(T, [0, 1, 0]));
      pts[j].T = T;
      pts[j].B = B;
      pts[j].N = cross(B, T);
    }
    return { k, sc, L, pts };
  }

  // 体の座標（t: 頭 0 → 尾 1、θ: 横 0 / 上 π/2、r: 表面からの深さ）→ 世界
  pointOn(form, t, th, depth = 0) {
    const x = clamp(t, 0, 1) * (form.pts.length - 1);
    const j = Math.min(form.pts.length - 2, Math.floor(x));
    const f = x - j;
    const a = form.pts[j], b = form.pts[j + 1];
    const w = widthAt(t, this.u) * form.sc - depth, h = heightAt(t, this.u) * form.sc - depth;
    const cw = Math.cos(th) * Math.max(0, w), sh = Math.sin(th) * Math.max(0, h);
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) out[i] = a.c[i] + (b.c[i] - a.c[i]) * f + a.B[i] * cw + a.N[i] * sh;
    return out;
  }

  // 小魚 a（生きている小魚の何番目か）の持ち場
  slotOf(a) {
    const seg = Math.floor(a / ANG), ang = a % ANG;
    const t = ((seg + 0.5) / SEG) * BODY_END;
    if (this.forms.length === 1) return { form: this.forms[0], t, th: ((ang + 0.5) / ANG) * Math.PI * 2 };
    const bin = ang >> 1;
    return { form: this.forms[ang & 1], t, th: ((bin + 0.5) / (ANG / 2)) * Math.PI * 2 };
  }

  // 小魚を動かす。持ち場に着いた小魚は体に融け込む
  place(snap, dt = 0, P = null) {
    const key = this.forms.length === 0 ? 'none' : this.forms.length === 1 ? 'one' : 'two';
    if (key !== this.formKey) {
      // 体の組み替え: 小魚がほどけて、新しい持ち場へ向かう
      if (this.formKey === 'one' && key === 'two') this.events.push({ type: 'fishSplit', actor: this.entity });
      if (this.formKey === 'two' && key === 'one') this.events.push({ type: 'fishMerge', actor: this.entity });
      if (this.formKey !== null && key !== 'none') {
        for (const f of this.alive) {
          if (!f.locked) continue;
          f.locked = false;
          f.v = [(this.rng() - 0.5) * 16, (this.rng() - 0.5) * 10, (this.rng() - 0.5) * 16];
        }
      }
      this.formKey = key;
    }
    const n = this.alive.length;
    if (!this.forms.length) {
      // ほどけた群れ: 散らばったあと、泳いでいく頭のまわりへゆるく集まる
      const c = this.head;
      for (let a = 0; a < n; a++) {
        const f = this.alive[a];
        f.locked = false;
        if (this.state === 'gone') {
          f.v[1] += 20 * dt;
        } else {
          const k = this.stateTime < 1 ? 0.2 : 1.2;
          for (let i = 0; i < 3; i++) f.v[i] += (c[i] - f.p[i]) * k * dt + (this.rng() - 0.5) * 30 * dt;
        }
        const sp = Math.hypot(...f.v), max = 45;
        if (sp > max) f.v = f.v.map((v) => (v * max) / sp);
        for (let i = 0; i < 3; i++) {
          f.v[i] *= Math.exp(-0.6 * dt);
          f.p[i] += f.v[i] * dt;
        }
      }
      return;
    }
    for (let a = 0; a < n; a++) {
      const f = this.alive[a];
      const { form, t, th } = this.slotOf(a);
      const target = this.pointOn(form, t, th, 0.8);
      if (snap || f.locked) {
        f.p = target;
        f.locked = true;
        continue;
      }
      const d = [target[0] - f.p[0], target[1] - f.p[1], target[2] - f.p[2]];
      const dist = Math.hypot(...d);
      if (dist < LOCK) {
        f.p = target;
        f.locked = true;
        f.v = [0, 0, 0];
        continue;
      }
      // 集まり直すときは、渦を巻きながらゆっくり寄ってくる。組み替えのときは素早く
      const regroup = this.state === 'regroup';
      const sp = Math.min(regroup ? 24 : 70, dist * (regroup ? 2 : 5) + 12);
      const swirl = regroup && dist > 6 ? 0.6 : 0;
      const want = [d[0] / dist + (d[2] / dist) * swirl, d[1] / dist, d[2] / dist - (d[0] / dist) * swirl];
      const m = Math.min(1, dt * (regroup ? 3 : 6));
      for (let i = 0; i < 3; i++) {
        f.v[i] += (want[i] * sp - f.v[i]) * m;
        f.p[i] += f.v[i] * dt;
      }
    }
  }

  // 形の各セルを emit(x, y, z, color) で返す。keep(x, z, 大きさ): その部分を作るか（描く範囲の外は作らない）
  shape(emit, keep = null) {
    const n = this.alive.length;
    if (!n) return;
    const u = this.u;
    const col = {};
    for (const k of Object.keys(CAT)) col[k] = mix(CAT[k], TUNA[k], u);
    for (const form of this.forms) {
      // 持ち場の小魚が体に融け込んでいる所だけ見える
      const vis = new Uint8Array(SEG * ANG);
      for (let i = 0; i < SEG * ANG; i++) {
        let idx = i;
        if (form.k >= 0) {
          const seg = Math.floor(i / ANG), bin = i % ANG;
          if (bin >= ANG / 2) continue;
          idx = seg * ANG + bin * 2 + form.k;
        }
        vis[i] = this.alive[idx % n].locked ? 1 : 0;
      }
      const angBins = form.k >= 0 ? ANG / 2 : ANG;
      const visible = (t, th) => {
        const seg = Math.min(SEG - 1, Math.floor((clamp(t, 0, BODY_END - 1e-6) / BODY_END) * SEG));
        const bin = Math.floor((((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * angBins) % angBins;
        return vis[seg * ANG + bin] === 1;
      };
      this.shapeForm(form, emit, keep, visible, col);
    }
    // まだ融け込んでいない小魚: 1 匹ずつ
    const tunaish = u > 0.5;
    for (const f of this.alive) {
      if (f.locked) continue;
      if (keep && !keep(f.p[0], f.p[2], 3)) continue;
      const sp = Math.hypot(...f.v);
      const d = sp > 0.5 ? f.v.map((v) => v / sp) : [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
      const base = shade(tunaish ? 0xb8c4cf : 0x8c8a62, 0.85 + (f.hue % 30) / 100);
      for (let s = 0; s < 3; s++) emit(Math.floor(f.p[0] - d[0] * s), Math.floor(f.p[1] - d[1] * s), Math.floor(f.p[2] - d[2] * s), s === 0 ? shade(base, 0.8) : base);
      const wag = Math.sin(this.time * 14 + f.hue) > 0 ? 1 : -1;
      emit(Math.floor(f.p[0] - d[0] * 3.5 + d[2] * 0.6 * wag), Math.floor(f.p[1] - d[1] * 3.5 + 0.6), Math.floor(f.p[2] - d[2] * 3.5 - d[0] * 0.6 * wag), tunaish ? FINLET : col.fin);
    }
  }

  // 1 匹分の体（胴・顔・胸びれ・背びれ・しりびれ・尾びれ・髭・小離鰭）
  shapeForm(form, emit, keep, visible, col) {
    const u = this.u, sc = form.sc, pts = form.pts;
    const L = pts.length - 1;
    const put = (p, color) => {
      const y = Math.floor(p[1]);
      if (y < 1 || y >= HEIGHT) return;
      emit(Math.floor(p[0]), y, Math.floor(p[2]), color);
    };
    // 胴: 楕円の輪を 0.5 ボクセルごとに並べ、表面から 1.5 ボクセルの厚さの所に色を置く（中は空）
    for (let s = 0; s <= L * BODY_END; s += 0.5) {
      const t = s / L;
      const j = Math.min(L - 1, Math.floor(s));
      const pa = pts[j];
      if (keep && !keep(pa.c[0], pa.c[2], 14 * sc)) continue;
      const w = widthAt(t, u) * sc, h = heightAt(t, u) * sc;
      const nAng = Math.ceil((Math.PI * 2 * Math.max(w, h)) / 0.45);
      const gill = Math.abs(t - lerp(0.15, 0.22, u)) < 0.008;
      for (let q = 0; q < nAng; q++) {
        const th = (q / nAng) * Math.PI * 2;
        if (!visible(t, th)) continue;
        const sn = Math.sin(th), cs = Math.cos(th);
        // 色: 背は暗く、腹は明るい。横はまだら模様と側線。背には骨の板（古代魚らしく）
        let color;
        if (sn > 0.45) color = sn > 0.96 && Math.floor(s / 3) % 2 === 0 ? col.scute : col.back;
        else if (sn < -0.5) color = col.belly;
        else if (Math.abs(sn - 0.05) < 0.06) color = col.line;
        else color = hash3(Math.floor(s / 3), Math.floor(th * 3), 5) % 4 === 0 ? col.spot : col.side;
        if (gill && sn > -0.6) color = col.mouth;
        for (const dd of [0, 0.75, 1.5]) {
          if (w - dd < 0.2 && dd > 0) break;
          const f = s - j;
          const pb = pts[j + 1];
          const ww = Math.max(0, w - dd), hh = Math.max(0, h - dd);
          const x = pa.c[0] + (pb.c[0] - pa.c[0]) * f + pa.B[0] * cs * ww + pa.N[0] * sn * hh;
          const y = pa.c[1] + (pb.c[1] - pa.c[1]) * f + pa.B[1] * cs * ww + pa.N[1] * sn * hh;
          const z = pa.c[2] + (pb.c[2] - pa.c[2]) * f + pa.B[2] * cs * ww + pa.N[2] * sn * hh;
          put([x, y, z], color);
        }
      }
    }
    const head = pts[0];
    if (!keep || keep(head.c[0], head.c[2], 40 * sc)) {
      // 顔の前の面と、口（ナマズは横に大きく裂けた口）
      if (visible(0, Math.PI)) {
        const w0 = widthAt(0, u) * sc, h0 = heightAt(0, u) * sc;
        for (let a = -w0; a <= w0; a += 0.5) {
          for (let b = -h0; b <= h0; b += 0.5) {
            if ((a / w0) ** 2 + (b / h0) ** 2 > 1) continue;
            const mouth = Math.abs(b + h0 * 0.25) < 0.6 && Math.abs(a) < w0 * lerp(0.85, 0.3, u);
            put([head.c[0] + head.B[0] * a + head.N[0] * b, head.c[1] + head.B[1] * a + head.N[1] * b, head.c[2] + head.B[2] * a + head.N[2] * b], mouth ? col.mouth : b > 0 ? col.back : col.belly);
          }
        }
      }
      // 目: 頭の横の上寄り（ナマズは小さく、マグロは大きい）
      const te = lerp(0.07, 0.1, u);
      for (const side of [-1, 1]) {
        const th = side > 0 ? 0.55 : Math.PI - 0.55;
        if (!visible(te, th)) continue;
        const c = this.pointOn(form, te, th, -0.4);
        const r = lerp(0.8, 1.4, u) * sc;
        for (let a = -r; a <= r; a += 0.5) for (let b = -r; b <= r; b += 0.5) {
          if (a * a + b * b > r * r) continue;
          const T = pts[Math.round(te * L)].T;
          put([c[0] + T[0] * a, c[1] + b, c[2] + T[2] * a], a * a + b * b < r * r * 0.35 ? PUPIL : EYE);
        }
      }
      // 髭: 口の両端の長い 2 本と、あごの短い 4 本。泳ぐ向きに遅れてなびく（マグロの形では縮んで消える）
      const blen = 30 * sc * (1 - u);
      if (blen > 1.5 && visible(0.01, Math.PI)) {
        const { T, B, N } = head;
        const w0 = widthAt(0, u) * sc, h0 = heightAt(0, u) * sc;
        const barbel = (start, d0, len, side, phase) => {
          let p = [...start];
          for (let i = 0; i < len / 0.5; i++) {
            const k = (i * 0.5) / len;
            const sway = Math.sin(this.time * 2.2 + phase + k * 4) * 0.5;
            const back = [-T[0] + B[0] * side * 0.5 + N[0] * (-0.3 + sway * 0.4), -T[1] + B[1] * side * 0.5 + N[1] * (-0.3 + sway * 0.4), -T[2] + B[2] * side * 0.5 + N[2] * (-0.3 + sway * 0.4)];
            const dir = norm([lerp(d0[0], back[0], ease(k * 1.6)), lerp(d0[1], back[1], ease(k * 1.6)), lerp(d0[2], back[2], ease(k * 1.6))]);
            for (let a = 0; a < 3; a++) p[a] += dir[a] * 0.5;
            put(p, k > 0.8 ? col.edge : col.barbel);
          }
        };
        for (const side of [-1, 1]) {
          const st = [head.c[0] + B[0] * side * w0 * 0.85 - N[0] * h0 * 0.25, head.c[1] + B[1] * side * w0 * 0.85 - N[1] * h0 * 0.25, head.c[2] + B[2] * side * w0 * 0.85 - N[2] * h0 * 0.25];
          barbel(st, norm([T[0] * 0.7 + B[0] * side * 0.7, T[1] * 0.7, T[2] * 0.7 + B[2] * side * 0.7]), blen, side, side);
          for (const o of [1.2, 3]) {
            const cst = [head.c[0] + B[0] * side * o * sc - N[0] * h0 * 0.85, head.c[1] - N[1] * h0 * 0.85 - h0 * 0.1, head.c[2] + B[2] * side * o * sc - N[2] * h0 * 0.85];
            barbel(cst, norm([T[0] * 0.5 - N[0] * 0.8, T[1] * 0.5 - N[1] * 0.8 - 0.3, T[2] * 0.5 - N[2] * 0.8]), blen * 0.3, side, o * 2);
          }
        }
      }
    }
    // 胸びれ: 大きな扇。ゆっくり羽ばたく（マグロの形では小さな鎌形になり、体に沿う）
    const tp = lerp(0.17, 0.27, u);
    const jp = Math.round(tp * L);
    const P = pts[jp];
    if (!keep || keep(P.c[0], P.c[2], 30 * sc)) {
      const flap = Math.sin(this.finPhase) * lerp(0.5, 0.2, u);
      const tuck = this.tuck ?? 0;
      const span = lerp(22, 8, u) * sc * (1 - 0.6 * tuck), root = lerp(11, 5, u) * sc, tip = lerp(7, 1.2, u) * sc, sweep = lerp(5, 9, u) * sc;
      for (const side of [-1, 1]) {
        const th0 = side > 0 ? -0.35 : Math.PI + 0.35;
        if (!visible(tp, th0)) continue;
        const r0 = this.pointOn(form, tp, th0, 0.5);
        const up = Math.sin(flap * side + lerp(-0.1, -0.35, u));
        const across = Math.cos(flap * side);
        const backward = lerp(0.3, 0.9, u) + 1.2 * (this.tuck ?? 0);
        const dir = norm([P.B[0] * side * across + P.N[0] * up - P.T[0] * backward, P.B[1] * side * across + P.N[1] * up - P.T[1] * backward, P.B[2] * side * across + P.N[2] * up - P.T[2] * backward]);
        for (let a = 0; a <= span; a += 0.5) {
          const k = a / span;
          const chord = lerp(root, tip, k);
          const b0 = [r0[0] + dir[0] * a - P.T[0] * sweep * k * k, r0[1] + dir[1] * a - P.T[1] * sweep * k * k, r0[2] + dir[2] * a - P.T[2] * sweep * k * k];
          for (let c = 0; c <= chord; c += 0.5) {
            const edge = c > chord - 1 || a > span - 1;
            const color = edge ? col.edge : Math.floor(a / 2.2) % 2 ? col.fin : col.ray;
            put([b0[0] - P.T[0] * c, b0[1] - P.T[1] * c, b0[2] - P.T[2] * c], color);
          }
        }
      }
    }
    // 背びれ・しりびれ（マグロは高い鎌形の背びれ）と、マグロの小離鰭
    const fin = (t0, t1, height, upSide, color) => {
      for (let s = t0 * L; s <= t1 * L; s += 0.5) {
        const t = s / L;
        if (!visible(t, upSide > 0 ? Math.PI / 2 : -Math.PI / 2)) continue;
        const k = (t - t0) / (t1 - t0);
        const hh = height * Math.sin(Math.min(1, k * 1.3) * Math.PI) * (1 - k * 0.3);
        const base = this.pointOn(form, t, upSide > 0 ? Math.PI / 2 : -Math.PI / 2, 0.3);
        const Np = pts[Math.round(s)].N, Tp = pts[Math.round(s)].T;
        for (let h = 0; h <= hh; h += 0.5) put([base[0] + Np[0] * h * upSide - Tp[0] * h * 0.4, base[1] + Np[1] * h * upSide - Tp[1] * h * 0.4, base[2] + Np[2] * h * upSide - Tp[2] * h * 0.4], h > hh - 1 ? col.edge : color);
      }
    };
    fin(lerp(0.3, 0.3, u), lerp(0.42, 0.42, u), lerp(4, 10, u) * sc, 1, col.fin);
    fin(lerp(0.58, 0.6, u), lerp(0.72, 0.7, u), lerp(3, 6, u) * sc, -1, col.fin);
    if (u > 0.4) {
      for (let t = 0.74; t < BODY_END - 0.02; t += 0.035) {
        for (const side of [1, -1]) {
          if (!visible(t, side * Math.PI / 2)) continue;
          const base = this.pointOn(form, t, side * Math.PI / 2, 0.3);
          const Np = pts[Math.round(t * L)].N;
          for (let h = 0; h <= 1.6 * sc * u; h += 0.5) put([base[0] + Np[0] * h * side, base[1] + Np[1] * h * side, base[2] + Np[2] * h * side], FINLET);
        }
      }
    }
    // 尾びれ: ナマズは丸い扇、マグロは三日月形（真ん中が切れ込む）
    const tail = pts[L];
    if (!keep || keep(tail.c[0], tail.c[2], 20 * sc)) {
      for (let s = (BODY_END - 0.03) * L; s <= L; s += 0.5) {
        const x = (s / L - (BODY_END - 0.03)) / (1 - BODY_END + 0.03);
        const p = pts[Math.min(L, Math.round(s))];
        const hTop = lerp(2.5 + 9 * Math.sin(Math.min(1, x * 1.1) * Math.PI * 0.55), 1.5 + 15 * x ** 1.4, u) * sc;
        const notch = lerp(0, 0.8, u) * hTop * x * x;
        for (let v = -hTop; v <= hTop; v += 0.5) {
          if (Math.abs(v) < notch) continue;
          if (!visible(BODY_END - 0.01, v > 0 ? Math.PI / 2 : -Math.PI / 2)) continue;
          const edge = Math.abs(v) > hTop - 1 || x > 0.92;
          const color = edge ? col.edge : Math.floor(v / 1.5) % 2 ? col.fin : col.ray;
          put([p.c[0] + p.N[0] * v, p.c[1] + p.N[1] * v, p.c[2] + p.N[2] * v], color);
        }
      }
    }
  }

  // 体を描き直す（細かく描く範囲の中だけ。外は画面の側が粗いブロックで描く）
  draw() {
    const w = this.world;
    const F = w.drawCenter, R = w.drawRadius;
    const inside = F && R ? (x, z, extra) => Math.max(Math.abs(x - F[0]), Math.abs(z - F[2])) < R + extra : null;
    const { cells, pushed } = redrawBody(w, this.id, this.cells, (emit) => this.shape(inside ? (x, y, z, c) => {
      if (Math.max(Math.abs(x + 0.5 - F[0]), Math.abs(z + 0.5 - F[2])) < R) emit(x, y, z, c);
    } : emit, inside), (m) => {
      const dx = m[0] - this.head[0], dz = m[2] - this.head[2];
      return Math.hypot(dx, dz) < 0.5 ? [1, 0] : [dx, dz];
    });
    this.cells = cells;
    for (const e of pushed) this.events.push({ type: 'push', actor: this.entity, target: e });
  }

  // 遠くの粗いブロック用: skip(中心, 大きさ) で、細かく描く範囲にすっぽり入る部分を飛ばす
  shapeAll(emit, skip) {
    this.shape(emit, skip ? (x, z, extra) => !skip([x, 0, z], extra) : null);
  }

  // ---- 撃たれる --------------------------------------------------------------

  // 点 o から向き dir へ飛ぶ弾が当たる距離と、当たった物（{ t, fish: 小魚の番号 } / { t, body: true }）。当たらなければ null
  rayHit(o, dir, maxT) {
    let best = null;
    const sphere = (c, r) => {
      const ox = c[0] - o[0], oy = c[1] - o[1], oz = c[2] - o[2];
      const tc = ox * dir[0] + oy * dir[1] + oz * dir[2];
      if (tc < -r || tc - r > Math.min(best?.t ?? Infinity, maxT)) return Infinity;
      const d2 = ox * ox + oy * oy + oz * oz - tc * tc;
      if (d2 > r * r) return Infinity;
      return Math.max(0, tc - Math.sqrt(r * r - d2));
    };
    for (const form of this.forms) {
      for (let j = 0; j < form.pts.length; j += 2) {
        const t0 = j / (form.pts.length - 1);
        if (t0 > BODY_END) break;
        const r = Math.max(widthAt(t0, this.u), heightAt(t0, this.u)) * form.sc;
        const t = sphere(form.pts[j].c, r);
        if (t < (best?.t ?? Infinity)) best = { t, body: true };
      }
    }
    this.alive.forEach((f, a) => {
      if (f.locked) return;
      const t = sphere(f.p, 1.8);
      if (t < (best?.t ?? Infinity)) best = { t, fish: a };
    });
    return best && best.t <= maxT ? best : null;
  }

  // 散弾が当たった。体なら一気にほどけて小魚の群れになる（当たった所の小魚は落ちる）。小魚なら、その小魚が落ちる。
  // 戻り値: 'burst' | 'kill' | null
  hit(p, part, from) {
    if (this.state === 'gone') return null;
    let result = null;
    if (part?.body || part?.fish === undefined) {
      if (this.state !== 'scatter') {
        this.burst(p, from);
        result = 'burst';
      }
      // 当たった所に一番近い小魚を落とす
      let best = -1, bd = Infinity;
      this.alive.forEach((f, a) => {
        const d = (f.p[0] - p[0]) ** 2 + (f.p[1] - p[1]) ** 2 + (f.p[2] - p[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = a;
        }
      });
      if (best >= 0) this.kill(best);
      return result ?? 'kill';
    }
    this.kill(part.fish);
    // まわりの小魚は驚いて散る
    for (const f of this.alive) {
      const d = [f.p[0] - p[0], f.p[1] - p[1], f.p[2] - p[2]];
      const l = Math.hypot(...d);
      if (l < 10 && l > 0.01) for (let i = 0; i < 3; i++) f.v[i] += (d[i] / l) * 25;
    }
    if (this.state === 'regroup') {
      // 集まり直している途中で撃たれたら、また散る
      this.setState('scatter');
    }
    return 'kill';
  }

  burst(p, from) {
    this.split = null;
    this.setState('scatter');
    this.fled = true;
    const c = this.head;
    const away = from ? norm([c[0] - from[0], 0, c[2] - from[2]]) : [0, 0, 0];
    for (const f of this.alive) {
      f.locked = false;
      const out = norm([f.p[0] - p[0] + (this.rng() - 0.5) * 6, f.p[1] - p[1] + (this.rng() - 0.5) * 6, f.p[2] - p[2] + (this.rng() - 0.5) * 6]);
      const sp = 30 + this.rng() * 25;
      f.v = [out[0] * sp + away[0] * 15, out[1] * sp + 6, out[2] * sp + away[2] * 15];
    }
    this.events.push({ type: 'fishBurst', actor: this.entity, left: this.alive.length });
  }

  kill(a) {
    const f = this.alive[a];
    if (!f) return;
    f.alive = false;
    f.locked = false;
    this.alive.splice(a, 1);
    if (this.alive.length < MIN_FISH && this.state !== 'gone') {
      this.split = null;
      this.setState('gone');
      this.events.push({ type: 'fishGone', actor: this.entity });
      // 残った小魚は空高く逃げ去り、3 秒ほどで見えなくなる
      this.vanishAt = this.time + 3;
    }
  }
}

// 出発地点の近くの空に、古代魚の群れを置く
export function spawnFish(world, near, offset = [-70, 40]) {
  const x = near[0] + offset[0], z = near[2] + offset[1];
  const tmp = { world };
  const floor = AncientFish.prototype.floorAt.call(tmp, x, z);
  const fish = new AncientFish(world, [x, Math.min(HEIGHT - 30, floor + HEIGHT_ABOVE), z]);
  fish.home = [near[0], near[2]];
  world.fish = fish;
  return fish;
}
