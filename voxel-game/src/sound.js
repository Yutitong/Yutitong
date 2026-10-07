// 効果音: 音声ファイルは使わず、Web Audio でその場で合成する。
// - 出来事（斧で切った・撃った・隕石が落ちた…）ごとに短い音を鳴らす（cuesFor が出来事 → 音の名前を決める）
// - 足音・水の音・風・鳥・龍・隕石の轟音など、続く音は毎フレームの様子から作る
// - 音の出た所が遠いほど小さく、こもって（高い音が消えて）、遅れて届く。カメラの左右に合わせて左右に分かれる
// AudioContext は最初のクリック / キー入力で作る（ブラウザの決まり）。作られていない間は何もしない（テストでも動く）
import { EMPTY, GROUND_ID, ROCK_ID, PLANT_ID, SOIL_ID, WATER_ID } from './ids.js';
import { T_FALL, AIR_BLAST, GROUND_WAVE, CRATER_R } from './meteor.js';

export const SOUND_SPEED = AIR_BLAST; // 音の速さ（ボクセル/秒 ≈ 345m/s）。隕石の爆音は衝撃波と一緒に届く
const PREF_KEY = 'voxel-sound';
const MAX_VOICES = 56;

// 音ごとの、大きさが下がり始める距離（ボクセル）と、続けて鳴らすときの最短の間隔（秒）
const REF = {
  boom: 26000, quake: 0, blast: 0, gust: 0, omen: 9000,
  debrisHit: 260, debrisWhistle: 200, treeCrash: 400, giantCrash: 1500, creak: 120,
  dragonRoar: 600, dragonGrowl: 300, beam: 200, gunshot: 120, slam: 160,
};
const GAP = { treeCrash: 0.12, giantCrash: 0.15, debrisHit: 0.05, splash: 0.06, hitPellets: 0.04, boneRattle: 0.1, stoneChip: 0.05, bloop: 0.15 };

// ---- 出来事 → 鳴らす音 -------------------------------------------------------------

const center = (e) => (e?.pos ? [e.pos[0] + 4.5, e.pos[1] + 8, e.pos[2] + 4.5] : null);
const posOf = (e) => (e?.kind === 'player' || e?.kind === 'human' ? center(e) : e?.pos ? [e.pos[0], e.pos[1], e.pos[2]] : null);

// 出来事 1 つに対して鳴らす音の一覧 [{ name, at, gain }]（at: 音の出た所。null なら聞き手のすぐそば）
export function cuesFor(ev, world) {
  const me = world.player;
  const self = center(ev.actor?.id === me?.id ? me : ev.actor) ?? center(me);
  const at = (e) => posOf(e) ?? self;
  const cue = (name, where = self, gain = 1) => ({ name, at: where, gain });
  const t = ev.target;
  switch (ev.type) {
    case 'chop':
      switch (ev.result) {
        case 'miss': return [cue('swing')];
        case 'notch': return [cue('swing', self, 0.6), cue('chopWood', self)];
        case 'felled': return [cue('chopWood', self, 1.2)]; // 倒れる音・倒れきった音は倒れていく木から
        case 'wound': return [cue('swing', self, 0.6), cue('slashHit', self)];
        case 'severed': return [cue('slashHeavy', self)];
        case 'glance': return [cue('swing', self, 0.6), cue('clang', self, 0.6)];
        default: return [cue('swing', self, 0.6)];
      }
    case 'dig':
      return [cue({ dug: 'dig', rock: 'clinkRock', full: 'tick' }[ev.result] ?? 'swing', self, ev.result === 'miss' ? 0.5 : 1)];
    case 'place':
      return [cue(ev.result === 'placed' ? 'place' : 'tick')];
    case 'slash': {
      const out = [cue('swordSwing')];
      const where = at(t);
      switch (ev.result) {
        case 'wound': out.push(cue('slashHit', where)); break;
        case 'severed': out.push(cue('slashHeavy', where)); break;
        case 'glance': out.push(cue('clang', where)); break;
        case 'blocked': out.push(cue('clang', where, 1.2)); break;
        case 'collapse': out.push(cue('boneRattle', where)); break;
        case 'kingHurt': out.push(cue('slashHit', where), cue('boneClack', where)); break;
        case 'kingDown': out.push(cue('boneRattle', where, 1.5), cue('kingGroan', where)); break;
      }
      return out;
    }
    case 'shoot': {
      const out = [cue('gunshot'), cue('pump')];
      const where = at(t);
      switch (ev.result) {
        case 'dent': out.push(cue('hitPellets', where), cue('gloop', where)); break;
        case 'chip': out.push(cue('crystalHit', where)); break;
        case 'killed': out.push(cue('shatter', where)); break;
        case 'severed': case 'wound': out.push(cue('hitPellets', where)); break;
        case 'kingHurt': out.push(cue('boneClack', where)); break;
        case 'kingDown': out.push(cue('boneRattle', where, 1.5), cue('kingGroan', where)); break;
        case 'collapse': case 'bonesKick': out.push(cue('boneRattle', where)); break;
        case 'statueBreak': out.push(cue('stoneBreak', where)); break;
        case 'statueChip': out.push(cue('stoneChip', where)); break;
        case 'burst': case 'fishKill': out.push(cue('splash', where, 1.4)); break;
        case 'graze': out.push(cue('ricochet', where)); break;
        case 'blocked': case 'miss': out.push(cue('hitPellets', where, 0.5)); break;
      }
      return out;
    }
    case 'skeletonWake': return [cue('skeletonWake', at(ev.actor))];
    case 'skeletonHit': return [cue('boneClack', at(ev.actor))];
    case 'kingWake': return [cue('kingWake', at(ev.actor))];
    case 'kingHit': return [cue('boneClack', at(ev.actor), 1.4), cue('slam', center(me), 0.4)];
    case 'kingDown': return [cue('kingGroan', at(ev.actor))];
    case 'statueWindup': return [cue('stoneScrape', at(ev.actor))];
    case 'statueSlam': return [cue('slam', at(ev.actor))];
    case 'statueHit': return [cue('slam', center(me), 0.6)];
    case 'statueBreak': return [cue('stoneBreak', at(ev.actor))];
    case 'statueStep': return [cue('statueStep', at(ev.actor))];
    case 'fishSplit': case 'fishMerge': case 'fishMorph': case 'fishRegroup': case 'fishBack':
      return [cue('bloop', at(ev.actor))];
    case 'fishBurst': return [cue('splash', at(ev.actor), 1.6)];
    case 'fishGone': return [cue('splash', at(ev.actor), 0.8)];
    case 'spot': return [cue('monsterSpot', at(ev.actor))];
    case 'octa': return [cue('octa', at(ev.actor))];
    case 'beam': return [cue('beam', at(ev.actor))];
    case 'beamHit': return [cue('sizzle', at(t))];
    case 'absorb': return [cue('absorb', at(ev.actor))];
    case 'vanish': return [cue('vanish', at(t))];
    case 'beamDragon': return [cue('sizzle', world.dragon?.head ?? at(t)), cue('dragonRoar', world.dragon?.head ?? at(t))];
    case 'respawn': return [cue('respawn', null)];
    case 'meteorSpotted': return [cue('omen', world.meteor?.meteorPos?.() ?? null)];
    case 'meteorImpact': {
      const s = world.meteor?.site ?? world.impact;
      return s ? [cue('boom', [s.x, world.loadedGroundAt?.(Math.round(s.x), Math.round(s.z)) || 300, s.z])] : [];
    }
    case 'meteorQuake': return [cue('quake', null, Math.min(1.5, 0.4 + (ev.amp ?? 10) / 60))];
    case 'meteorBlast': return [cue('blast', null, 0.8 + Math.min(1, (ev.damage ?? 0) / 80))];
    case 'meteorWind': return [cue('gust', null)];
    case 'meteorDebris': return ev.at ? [cue('debrisHit', ev.at, Math.min(1.6, 0.5 + (ev.size ?? 2) / 3))] : [];
    case 'meteorDebrisHit': return [cue('debrisHit', center(me), 1.3)];
    case 'meteorGiant': return ev.at ? [cue('giantCrash', ev.at)] : [];
    default: return [];
  }
}

// 音の出た所 → 大きさ・こもり方・左右・遅れ（listener: 聞き手の位置、right: 聞き手の右向き）
export function spatial(listener, right, at, ref = 40) {
  if (!at) return { gain: 1, cutoff: 20000, pan: 0, delay: 0, dist: 0 };
  const dx = at[0] - listener[0], dy = at[1] - listener[1], dz = at[2] - listener[2];
  const d = Math.hypot(dx, dy, dz);
  const gain = ref <= 0 ? 1 : d <= ref ? 1 : ref / d;
  // 空気は高い音ほど吸う: 遠いほどこもる（1km 先ではずいぶん低い音だけになる）
  const cutoff = Math.max(110, Math.min(20000, 20000 * Math.exp(-d / 2600)));
  const side = d > 0 ? (dx * right[0] + dy * right[1] + dz * right[2]) / d : 0;
  const pan = Math.max(-1, Math.min(1, side * Math.min(1, d / 24) * 0.85));
  return { gain, cutoff, pan, delay: d / SOUND_SPEED, dist: d };
}

// 足もとの音の種類（体の下の 9×9 のどこかで支えられているので、真ん中と四隅、1〜2 段下を見る）
export function surfaceAt(world, p) {
  const cx = p.pos[0] + 4, cz = p.pos[2] + 4;
  if (world.loadedWaterAt?.(cx, cz) > p.pos[1]) return 'stepWater';
  for (const dy of [1, 2]) {
    for (const [dx, dz] of [[4, 4], [1, 1], [7, 7], [1, 7], [7, 1]]) {
      const x = p.pos[0] + dx, y = p.pos[1] - dy, z = p.pos[2] + dz;
      const o = world.ownerAt(x, y, z);
      if (o === EMPTY || o === -1 || o === p.id) continue;
      if (o === WATER_ID) return 'stepWater';
      if (o === ROCK_ID) return 'stepStone';
      if (o === PLANT_ID) return 'stepGrass';
      if (o !== GROUND_ID && o !== SOIL_ID) return 'stepWood'; // 倒木・骨・石像の台などの上
      const c = world.colorAt(x, y, z);
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14) return 'stepStone';
      if (g > r + 6 && g > b) return 'stepGrass';
      if (r > 160 && g > 130) return 'stepSand';
      return 'stepDirt';
    }
  }
  return null;
}

// ---- 音を作る ----------------------------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a);

// 音の作り方: (s, out, t, k) s: SoundSystem（noise / tone）、out: つなぐ先、t: 鳴らし始める時刻、k: { gain, p: 音の高さの揺らぎ }
const RECIPES = {
  // 道具
  swing: (s, o, t, k) => s.noise(o, t, { type: 'bandpass', f: 350 * k.p, f2: 1600 * k.p, q: 1.3, dur: 0.22, attack: 0.07, gain: 0.22 * k.gain }),
  chopWood: (s, o, t, k) => {
    s.tone(o, t, { wave: 'triangle', f: 210 * k.p, f2: 95, dur: 0.14, gain: 0.55 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 950 * k.p, q: 2.5, dur: 0.1, gain: 0.7 * k.gain });
    s.noise(o, t, { type: 'highpass', f: 2600, dur: 0.035, gain: 0.35 * k.gain });
  },
  creak: (s, o, t, k) => {
    s.tone(o, t, { wave: 'sawtooth', f: 95 * k.p, f2: 58, dur: 1.8, attack: 0.25, gain: 0.12 * k.gain, filter: { type: 'bandpass', f: 520, q: 7 }, vib: { rate: 11, depth: 9 } });
    for (let i = 0; i < 6; i++) s.noise(o, t + rnd(0.1, 1.6), { type: 'highpass', f: 1800, dur: 0.03, gain: 0.25 * k.gain });
  },
  treeCrash: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 600, f2: 110, dur: 1.6, attack: 0.01, gain: 1.4 * k.gain });
    s.tone(o, t, { f: 62 * k.p, f2: 34, dur: 0.7, gain: 0.9 * k.gain });
    s.noise(o, t, { type: 'highpass', f: 2600, dur: 1.4, attack: 0.03, gain: 0.25 * k.gain }); // 葉や枝
    for (let i = 0; i < 8; i++) s.noise(o, t + rnd(0, 0.9), { type: 'bandpass', f: rnd(700, 1600), q: 2, dur: 0.06, gain: 0.35 * k.gain });
  },
  giantCrash: (s, o, t, k) => {
    RECIPES.treeCrash(s, o, t, { ...k, p: k.p * 0.6, gain: k.gain * 1.4 });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 220, dur: 3.2, attack: 0.05, gain: 1.2 * k.gain });
  },
  dig: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 750 * k.p, q: 0.9, dur: 0.2, attack: 0.01, gain: 0.55 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 320, dur: 0.22, gain: 0.8 * k.gain });
  },
  clinkRock: (s, o, t, k) => {
    s.tone(o, t, { f: 1450 * k.p, dur: 0.18, gain: 0.18 * k.gain });
    s.tone(o, t, { f: 2310 * k.p, dur: 0.12, gain: 0.12 * k.gain });
    s.noise(o, t, { type: 'highpass', f: 3000, dur: 0.04, gain: 0.4 * k.gain });
  },
  place: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 260, dur: 0.28, gain: 1 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 520 * k.p, q: 1, dur: 0.16, gain: 0.35 * k.gain });
  },
  tick: (s, o, t, k) => s.tone(o, t, { wave: 'triangle', f: 330 * k.p, dur: 0.07, gain: 0.12 * k.gain }),
  swordSwing: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 700 * k.p, f2: 3200 * k.p, q: 2.2, dur: 0.24, attack: 0.06, gain: 0.32 * k.gain });
    s.tone(o, t, { f: 1300 * k.p, f2: 2100 * k.p, dur: 0.2, attack: 0.06, gain: 0.025 * k.gain });
  },
  slashHit: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 1500 * k.p, q: 1, dur: 0.13, gain: 0.55 * k.gain });
    s.tone(o, t, { f: 230 * k.p, f2: 110, dur: 0.12, gain: 0.35 * k.gain });
  },
  slashHeavy: (s, o, t, k) => {
    RECIPES.slashHit(s, o, t, { ...k, gain: k.gain * 1.3 });
    s.noise(o, t + 0.05, { brown: true, type: 'lowpass', f: 400, dur: 0.5, gain: 0.9 * k.gain });
  },
  clang: (s, o, t, k) => {
    for (const [f, g] of [[620, 0.12], [931, 0.1], [1427, 0.08], [2210, 0.06], [3120, 0.04]]) s.tone(o, t, { f: f * k.p, dur: 0.9, gain: g * k.gain });
    s.noise(o, t, { type: 'highpass', f: 3800, dur: 0.05, gain: 0.45 * k.gain });
  },
  gunshot: (s, o, t, k) => {
    s.noise(o, t, { type: 'lowpass', f: 7000, f2: 700, dur: 0.4, attack: 0.001, gain: 1.1 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 260, dur: 0.6, attack: 0.001, gain: 1.3 * k.gain });
    s.tone(o, t, { f: 110 * k.p, f2: 38, dur: 0.22, gain: 0.9 * k.gain });
    s.noise(o, t + 0.11, { type: 'bandpass', f: 600, q: 0.6, dur: 0.7, attack: 0.04, gain: 0.12 * k.gain }); // こだま
  },
  pump: (s, o, t, k) => {
    for (const dt of [0.42, 0.58]) {
      s.noise(o, t + dt, { type: 'highpass', f: 2200, dur: 0.035, gain: 0.25 * k.gain });
      s.tone(o, t + dt, { wave: 'square', f: 420 * k.p, dur: 0.03, gain: 0.04 * k.gain });
    }
  },
  hitPellets: (s, o, t, k) => {
    for (let i = 0; i < 5; i++) s.noise(o, t + rnd(0, 0.04), { type: 'bandpass', f: rnd(1500, 3200), q: 1.5, dur: 0.05, gain: 0.25 * k.gain });
  },
  ricochet: (s, o, t, k) => s.tone(o, t, { f: 2600 * k.p, f2: 900, dur: 0.45, gain: 0.08 * k.gain, vib: { rate: 40, depth: 60 } }),
  gloop: (s, o, t, k) => s.tone(o, t, { f: 150 * k.p, f2: 90, dur: 0.5, gain: 0.35 * k.gain, vib: { rate: 18, depth: 40 } }),
  crystalHit: (s, o, t, k) => {
    for (const f of [1568, 2349, 3136, 4186]) s.tone(o, t, { f: f * k.p, dur: 1.1, gain: 0.06 * k.gain });
    s.noise(o, t, { type: 'highpass', f: 4000, dur: 0.08, gain: 0.35 * k.gain });
  },
  shatter: (s, o, t, k) => {
    s.noise(o, t, { type: 'highpass', f: 2500, dur: 0.6, gain: 0.5 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 300, dur: 0.6, gain: 0.8 * k.gain });
    for (let i = 0; i < 14; i++) s.tone(o, t + rnd(0, 0.6), { f: rnd(1800, 5200), dur: 0.12, gain: 0.05 * k.gain });
  },
  // 骨・石像
  boneClack: (s, o, t, k) => {
    for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.035, { wave: 'triangle', f: rnd(900, 1500) * k.p, dur: 0.05, gain: 0.2 * k.gain });
  },
  boneRattle: (s, o, t, k) => {
    for (let i = 0; i < 16; i++) s.tone(o, t + rnd(0, 0.75) ** 1.5, { wave: 'triangle', f: rnd(700, 1900) * k.p, dur: 0.05, gain: 0.18 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 1200, q: 1, dur: 0.5, gain: 0.15 * k.gain });
  },
  skeletonWake: (s, o, t, k) => {
    RECIPES.boneClack(s, o, t, k);
    s.noise(o, t + 0.1, { type: 'bandpass', f: 320 * k.p, f2: 260, q: 4, dur: 0.9, attack: 0.2, gain: 0.35 * k.gain });
  },
  kingWake: (s, o, t, k) => {
    s.tone(o, t, { wave: 'sawtooth', f: 72 * k.p, f2: 58, dur: 1.6, attack: 0.15, gain: 0.3 * k.gain, filter: { type: 'lowpass', f: 450, q: 2 }, vib: { rate: 7, depth: 4 } });
    RECIPES.boneRattle(s, o, t, { ...k, gain: k.gain * 0.7 });
  },
  kingGroan: (s, o, t, k) => s.tone(o, t, { wave: 'sawtooth', f: 80 * k.p, f2: 40, dur: 1.8, attack: 0.05, gain: 0.3 * k.gain, filter: { type: 'lowpass', f: 380, q: 3 }, vib: { rate: 5, depth: 5 } }),
  stoneScrape: (s, o, t, k) => s.noise(o, t, { brown: true, type: 'bandpass', f: 330 * k.p, q: 1.2, dur: 1, attack: 0.3, gain: 1 * k.gain, trem: { rate: 13, depth: 0.6 } }),
  slam: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 330, dur: 1, attack: 0.002, gain: 1.6 * k.gain });
    s.tone(o, t, { f: 62 * k.p, f2: 30, dur: 0.55, gain: 1 * k.gain });
    s.noise(o, t + 0.03, { type: 'bandpass', f: 1300, q: 0.8, dur: 0.45, gain: 0.3 * k.gain });
  },
  statueStep: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 170, dur: 0.4, gain: 1.1 * k.gain });
    s.tone(o, t, { f: 52 * k.p, f2: 38, dur: 0.28, gain: 0.6 * k.gain });
  },
  stoneChip: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 2000 * k.p, q: 0.8, dur: 0.12, gain: 0.5 * k.gain });
    for (let i = 0; i < 4; i++) s.noise(o, t + rnd(0.05, 0.35), { type: 'bandpass', f: rnd(1500, 3000), q: 2, dur: 0.04, gain: 0.2 * k.gain });
  },
  stoneBreak: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 1600 * k.p, q: 0.6, dur: 0.4, gain: 0.7 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 300, dur: 0.9, gain: 1.3 * k.gain });
    for (let i = 0; i < 10; i++) s.noise(o, t + rnd(0.1, 1), { type: 'bandpass', f: rnd(900, 2600), q: 2, dur: 0.05, gain: 0.3 * k.gain });
  },
  // 水
  splash: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 1400 * k.p, f2: 500, q: 0.7, dur: 0.35 + 0.2 * k.gain, attack: 0.005, gain: 0.45 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 350, dur: 0.3, gain: 0.5 * k.gain });
    for (let i = 0; i < 5; i++) s.tone(o, t + rnd(0.05, 0.5), { f: rnd(500, 1300), f2: rnd(1400, 2400), dur: 0.05, gain: 0.04 * k.gain });
  },
  bloop: (s, o, t, k) => {
    s.tone(o, t, { f: 280 * k.p, f2: 620 * k.p, dur: 0.16, gain: 0.25 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 900, q: 1, dur: 0.25, gain: 0.2 * k.gain });
  },
  // 足音
  stepGrass: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 3200 * k.p, q: 0.6, dur: 0.1, attack: 0.01, gain: 0.13 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 200, dur: 0.07, gain: 0.25 * k.gain });
  },
  stepDirt: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 900 * k.p, q: 0.8, dur: 0.08, gain: 0.18 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 180, dur: 0.08, gain: 0.32 * k.gain });
  },
  stepSand: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 2300 * k.p, q: 0.7, dur: 0.14, attack: 0.015, gain: 0.12 * k.gain, rate: rnd(0.7, 1.3) });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 190, dur: 0.07, gain: 0.22 * k.gain });
  },
  stepStone: (s, o, t, k) => {
    s.noise(o, t, { type: 'highpass', f: 3000 * k.p, dur: 0.025, gain: 0.16 * k.gain });
    s.tone(o, t, { f: 170 * k.p, f2: 100, dur: 0.05, gain: 0.14 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 160, dur: 0.06, gain: 0.22 * k.gain });
  },
  stepWood: (s, o, t, k) => {
    s.tone(o, t, { wave: 'triangle', f: 230 * k.p, f2: 160, dur: 0.08, gain: 0.22 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 200, dur: 0.06, gain: 0.2 * k.gain });
  },
  stepWater: (s, o, t, k) => {
    s.noise(o, t, { type: 'bandpass', f: 900 * k.p, f2: 400, q: 0.8, dur: 0.22, gain: 0.22 * k.gain });
    s.tone(o, t + 0.04, { f: rnd(500, 900), f2: rnd(1100, 1800), dur: 0.05, gain: 0.04 * k.gain });
  },
  land: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 230, dur: 0.22, gain: 0.7 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 1000, q: 0.7, dur: 0.12, gain: 0.25 * k.gain });
  },
  hurt: (s, o, t, k) => {
    s.tone(o, t, { wave: 'square', f: 240 * k.p, f2: 120, dur: 0.16, gain: 0.12 * k.gain, filter: { type: 'lowpass', f: 1300, q: 1 } });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 250, dur: 0.18, gain: 0.5 * k.gain });
  },
  respawn: (s, o, t, k) => {
    [523, 659, 784, 1047].forEach((f, i) => s.tone(o, t + i * 0.09, { f, dur: 0.5, gain: 0.07 * k.gain }));
  },
  // 龍・球体
  dragonRoar: (s, o, t, k) => {
    const filter = { type: 'bandpass', f: 650, q: 2.5 };
    s.tone(o, t, { wave: 'sawtooth', f: 115 * k.p, f2: 68, dur: 2.3, attack: 0.25, gain: 0.5 * k.gain, filter, vib: { rate: 6, depth: 6 }, trem: { rate: 27, depth: 0.5 } });
    s.tone(o, t, { wave: 'sawtooth', f: 171 * k.p, f2: 101, dur: 2.2, attack: 0.3, gain: 0.3 * k.gain, filter, vib: { rate: 5, depth: 7 } });
    s.noise(o, t, { type: 'bandpass', f: 900, f2: 500, q: 1.2, dur: 2.2, attack: 0.3, gain: 0.45 * k.gain });
  },
  dragonGrowl: (s, o, t, k) => s.tone(o, t, { wave: 'sawtooth', f: 66 * k.p, f2: 54, dur: 1.4, attack: 0.3, gain: 0.35 * k.gain, filter: { type: 'lowpass', f: 380, q: 3 }, trem: { rate: 22, depth: 0.6 } }),
  dragonStep: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 140, dur: 0.5, gain: 1.1 * k.gain });
    s.tone(o, t, { f: 46 * k.p, f2: 32, dur: 0.3, gain: 0.6 * k.gain });
  },
  monsterSpot: (s, o, t, k) => {
    s.tone(o, t, { f: 880 * k.p, f2: 1320 * k.p, dur: 0.8, attack: 0.05, gain: 0.12 * k.gain, trem: { rate: 9, depth: 0.7 } });
    s.tone(o, t + 0.08, { f: 1318 * k.p, f2: 1980 * k.p, dur: 0.8, attack: 0.05, gain: 0.08 * k.gain, trem: { rate: 9, depth: 0.7 } });
  },
  octa: (s, o, t, k) => {
    for (const f of [784, 1175, 1568, 2349]) s.tone(o, t, { f: f * k.p, dur: 1.8, attack: 0.02, gain: 0.07 * k.gain, vib: { rate: 5, depth: 3 } });
  },
  beam: (s, o, t, k) => {
    s.tone(o, t, { wave: 'sawtooth', f: 1900 * k.p, f2: 180, dur: 0.7, gain: 0.16 * k.gain, filter: { type: 'bandpass', f: 1500, q: 3 } });
    s.tone(o, t, { f: 120, dur: 0.8, gain: 0.3 * k.gain, trem: { rate: 30, depth: 0.5 } });
  },
  sizzle: (s, o, t, k) => {
    s.noise(o, t, { type: 'highpass', f: 3000, dur: 0.5, gain: 0.35 * k.gain, trem: { rate: 35, depth: 0.7 } });
    s.tone(o, t, { f: 320 * k.p, f2: 80, dur: 0.25, gain: 0.2 * k.gain });
  },
  absorb: (s, o, t, k) => {
    s.tone(o, t, { f: 180 * k.p, f2: 1300 * k.p, dur: 0.9, attack: 0.1, gain: 0.16 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 400, f2: 3000, q: 3, dur: 0.9, attack: 0.2, gain: 0.3 * k.gain });
  },
  vanish: (s, o, t, k) => {
    s.tone(o, t, { f: 1300 * k.p, f2: 90, dur: 1.1, gain: 0.16 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 3000, f2: 300, q: 2, dur: 1, gain: 0.3 * k.gain });
  },
  // 隕石
  omen: (s, o, t, k) => s.noise(o, t, { brown: true, type: 'lowpass', f: 160, dur: 4, attack: 2, gain: 0.6 * k.gain }),
  boom: (s, o, t, k) => {
    s.noise(o, t, { type: 'lowpass', f: 9000, f2: 350, dur: 2.5, attack: 0.004, gain: 1.6 * k.gain }); // 割れるような音
    s.noise(o, t, { brown: true, type: 'lowpass', f: 700, f2: 60, dur: 10, attack: 0.01, gain: 2.6 * k.gain });
    s.tone(o, t, { f: 48, f2: 21, dur: 4, attack: 0.01, gain: 1.6 * k.gain });
    for (let i = 0; i < 26; i++) s.noise(o, t + rnd(0.2, 5) ** 1.2, { type: 'bandpass', f: rnd(200, 900), q: 1.5, dur: rnd(0.15, 0.5), gain: rnd(0.2, 0.6) * k.gain }); // ばりばり
  },
  quake: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 130, dur: 4.5, attack: 0.25, gain: 1.6 * k.gain, trem: { rate: 7, depth: 0.4 } });
    s.tone(o, t, { f: 31, f2: 24, dur: 3.5, attack: 0.2, gain: 1.1 * k.gain });
    for (let i = 0; i < 18; i++) s.noise(o, t + rnd(0.1, 3), { type: 'bandpass', f: rnd(300, 1400), q: 1.5, dur: 0.08, gain: 0.25 * k.gain }); // 岩がきしむ
  },
  blast: (s, o, t, k) => {
    s.noise(o, t, { type: 'lowpass', f: 9000, f2: 300, dur: 1.4, attack: 0.003, gain: 1.6 * k.gain });
    s.noise(o, t, { brown: true, type: 'lowpass', f: 260, dur: 3, attack: 0.01, gain: 1.6 * k.gain });
    RECIPES.gust(s, o, t + 0.1, k);
  },
  gust: (s, o, t, k) => s.noise(o, t, { type: 'bandpass', f: 520, f2: 260, q: 0.7, dur: 3.5, attack: 0.35, gain: 0.7 * k.gain }),
  debrisWhistle: (s, o, t, k) => {
    s.tone(o, t, { f: 1700 * k.p, f2: 480, dur: 1.6, attack: 0.5, gain: 0.07 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 3000, f2: 700, q: 6, dur: 1.6, attack: 0.5, gain: 0.35 * k.gain });
  },
  debrisHit: (s, o, t, k) => {
    s.noise(o, t, { brown: true, type: 'lowpass', f: 330, dur: 0.8, attack: 0.002, gain: 1.4 * k.gain });
    s.tone(o, t, { f: 72 * k.p, f2: 34, dur: 0.4, gain: 0.8 * k.gain });
    s.noise(o, t, { type: 'bandpass', f: 950, q: 0.8, dur: 0.4, gain: 0.45 * k.gain });
    for (let i = 0; i < 6; i++) s.noise(o, t + rnd(0.05, 0.6), { type: 'bandpass', f: rnd(800, 2200), q: 2, dur: 0.05, gain: 0.2 * k.gain });
  },
  chirp: (s, o, t, k) => {
    // 小鳥: 種類ごとに鳴き方が違う
    const kind = Math.floor(rnd(0, 3));
    const n = kind === 2 ? 1 : Math.floor(rnd(2, 6));
    const base = rnd(2400, 4200);
    for (let i = 0; i < n; i++) {
      const at = t + i * (kind === 0 ? 0.11 : 0.17);
      if (kind === 0) s.tone(o, at, { f: base, f2: base * 1.35, dur: 0.07, attack: 0.01, gain: 0.05 * k.gain });
      else if (kind === 1) s.tone(o, at, { f: base * 1.3, f2: base * 0.8, dur: 0.12, attack: 0.01, gain: 0.045 * k.gain, vib: { rate: 60, depth: 180 } });
      else s.tone(o, at, { f: base * 0.7, f2: base * 1.1, dur: 0.45, attack: 0.05, gain: 0.04 * k.gain, vib: { rate: 22, depth: 140 } });
    }
  },
};
export const SOUND_NAMES = Object.keys(RECIPES);

// ---- 鳴らす仕組み -------------------------------------------------------------------

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.muted = false;
    this.listener = [0, 0, 0];
    this.right = [1, 0, 0];
    this.ends = []; // 鳴っている音の終わる時刻
    this.lastAt = new Map(); // 音ごとの最後に鳴らした時刻（続けて鳴らしすぎない）
    this.loops = {};
    this.seenDebris = new WeakSet();
    this.seenFelling = new WeakSet();
    this.fallingTrees = new Set();
    this.birdIn = 2;
    this.scanIn = 0;
    this.forest = 0;
    this.water = { level: 0, at: null };
    this.indoor = 0;
    this.stepPhase = 0;
    this.lastHp = null;
    this.vyWas = 0;
    this.dragonWas = { mode: null, anger: 0, step: 0 };
    try {
      const saved = JSON.parse(globalThis.localStorage?.getItem(PREF_KEY) ?? 'null');
      if (saved) {
        this.volume = Math.max(0, Math.min(1, Number(saved.volume ?? 0.7)));
        this.muted = Boolean(saved.muted);
      }
    } catch {
      // 保存できない環境（プライベートウィンドウなど）
    }
  }

  // 最初のクリック / キー入力で呼ぶ
  unlock() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  build() {
    const c = this.ctx;
    const rate = c.sampleRate;
    // 白色雑音と、低い音の多い雑音（ブラウン）
    this.white = c.createBuffer(1, rate * 3, rate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, rate * 4, rate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(c.destination);
    // 響き（ピラミッドの中・洞窟ではよく響く）
    const ir = c.createBuffer(2, Math.floor(rate * 2.4), rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    }
    this.reverb = c.createConvolver();
    this.reverb.buffer = ir;
    this.send = c.createGain();
    this.send.gain.value = 0.08;
    this.send.connect(this.reverb).connect(this.master);
    this.applyVolume();
    this.makeLoops();
  }

  // ---- 音量 ----

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.save();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolume();
    this.save();
  }

  applyVolume() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume ** 1.5, this.ctx.currentTime, 0.03);
  }

  save() {
    try {
      globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch {
      // 保存できなくても鳴らすのは続ける
    }
  }

  // ---- 部品 ----

  env(t, { gain = 1, attack = 0.003, dur }) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    return g;
  }

  filter(node, t, { type, f, f2, q = 0.7, dur }) {
    const fl = this.ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    fl.Q.value = q;
    node.connect(fl);
    return fl;
  }

  // 振幅のゆれ（震える音）
  tremolo(node, t, { rate, depth }, dur) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 1 - depth / 2;
    const lfo = c.createOscillator();
    lfo.frequency.value = rate;
    const amt = c.createGain();
    amt.gain.value = depth / 2;
    lfo.connect(amt).connect(g.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    node.connect(g);
    return g;
  }

  noise(out, t, o) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    src.playbackRate.value = o.rate ?? 1;
    const len = src.buffer.duration;
    if (o.dur > len - 0.2) src.loop = true;
    let node = src;
    if (o.type) node = this.filter(node, t, o);
    if (o.trem) node = this.tremolo(node, t, o.trem, o.dur);
    node.connect(this.env(t, o)).connect(out);
    src.start(t, src.loop ? 0 : Math.random() * (len - o.dur - 0.1));
    src.stop(t + o.dur + 0.05);
    this.end = Math.max(this.end, t + o.dur);
  }

  tone(out, t, o) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = o.wave ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    if (o.vib) {
      const lfo = c.createOscillator();
      lfo.frequency.value = o.vib.rate;
      const amt = c.createGain();
      amt.gain.value = o.vib.depth;
      lfo.connect(amt).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.05);
    }
    let node = osc;
    if (o.filter) node = this.filter(node, t, { ...o.filter, dur: o.dur });
    if (o.trem) node = this.tremolo(node, t, o.trem, o.dur);
    node.connect(this.env(t, o)).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
    this.end = Math.max(this.end, t + o.dur);
  }

  // 音の出た所に合わせて、大きさ・こもり方・左右を付ける入り口を作る
  chain(sp) {
    const c = this.ctx;
    const input = c.createGain();
    input.gain.value = sp.gain;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = sp.cutoff;
    input.connect(lp);
    let out = lp;
    if (c.createStereoPanner) {
      const pan = c.createStereoPanner();
      pan.pan.value = sp.pan;
      lp.connect(pan);
      out = pan;
    }
    out.connect(this.master);
    out.connect(this.send);
    return input;
  }

  // ---- 鳴らす ----

  // name の音を at で鳴らす（遠いほど小さく、こもって、遅れて届く）
  play(name, at = null, gain = 1) {
    if (!this.ctx || this.muted || !RECIPES[name]) return false;
    const now = this.ctx.currentTime;
    const gap = GAP[name] ?? 0;
    if (gap && now - (this.lastAt.get(name) ?? -1) < gap) return false;
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= MAX_VOICES && !REF[name]) return false;
    const sp = spatial(this.listener, this.right, at, REF[name] ?? 40);
    if (sp.gain * gain < 0.004) return false;
    this.lastAt.set(name, now);
    const t = now + 0.01 + sp.delay;
    this.end = t;
    RECIPES[name](this, this.chain(sp), t, { gain, p: rnd(0.93, 1.07) });
    this.ends.push(this.end);
    return true;
  }

  event(ev, world) {
    if (!this.ctx) return;
    for (const c of cuesFor(ev, world)) this.play(c.name, c.at, c.gain);
  }

  // 水しぶき（どこで上がったものも）
  splash(x, y, z, size) {
    this.play('splash', [x, y, z], Math.min(1.8, 0.4 + size * 0.35));
  }

  // ---- 続く音 ----

  makeLoops() {
    const c = this.ctx;
    const mk = (buf, filter, positional = false) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const fl = c.createBiquadFilter();
      fl.type = filter.type;
      fl.frequency.value = filter.f;
      fl.Q.value = filter.q ?? 0.7;
      const level = c.createGain();
      level.gain.value = 0;
      src.connect(fl).connect(level);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      level.connect(lp);
      let out = lp;
      let pan = null;
      if (positional && c.createStereoPanner) {
        pan = c.createStereoPanner();
        lp.connect(pan);
        out = pan;
      }
      out.connect(this.master);
      out.connect(this.send);
      src.start(0, Math.random() * buf.duration);
      return { src, fl, level, lp, pan };
    };
    this.loops = {
      wind: mk(this.white, { type: 'bandpass', f: 420, q: 0.5 }),
      river: mk(this.white, { type: 'bandpass', f: 1500, q: 0.4 }, true),
      rumble: mk(this.brown, { type: 'lowpass', f: 95 }),
      roar: mk(this.brown, { type: 'lowpass', f: 300 }, true),
      scream: mk(this.white, { type: 'bandpass', f: 500, q: 3 }, true),
      fire: mk(this.white, { type: 'bandpass', f: 650, q: 0.6 }, true),
      dragon: mk(this.brown, { type: 'bandpass', f: 260, q: 0.8 }, true),
    };
  }

  // 続く音の大きさと位置を合わせる（level: 0〜、at: 音の出る所 / null、ref: 下がり始める距離）
  setLoop(name, level, at = null, ref = 40, tc = 0.12) {
    const L = this.loops[name];
    if (!L) return;
    const now = this.ctx.currentTime;
    const sp = spatial(this.listener, this.right, at, ref);
    L.level.gain.setTargetAtTime(Math.max(0, level * sp.gain), now, tc);
    L.lp.frequency.setTargetAtTime(sp.cutoff, now, 0.1);
    if (L.pan) L.pan.pan.setTargetAtTime(sp.pan, now, 0.08);
  }

  // 毎フレーム呼ぶ。view: { pos, right, shake }（カメラの位置と右向き、隕石の揺れ）
  update(dt, world, view) {
    if (!this.ctx) return;
    this.listener = view.pos;
    this.right = view.right;
    const p = world.player;
    const t = this.ctx.currentTime;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 0.5;
      this.scan(world);
    }
    this.send.gain.setTargetAtTime(0.06 + 0.5 * this.indoor, t, 0.3);
    this.steps(dt, world, p);
    this.meteor(world, view);
    this.dragon(world);
    // 傷を受けた
    if (this.lastHp !== null && p.hp < this.lastHp - 0.5) this.play('hurt', null, Math.min(1.5, 0.5 + (this.lastHp - p.hp) / 30));
    this.lastHp = p.hp;
    // 倒れていく木: 倒れ始めにきしみ、倒れきったら地響き
    for (const f of world.felling ?? []) {
      if (this.seenFelling.has(f)) continue;
      this.seenFelling.add(f);
      this.fallingTrees.add(f);
      if (f.pivot) this.play('creak', [f.pivot[0], f.pivot[1] + 10, f.pivot[2]]);
    }
    for (const f of this.fallingTrees) {
      if (!f.done) continue;
      this.fallingTrees.delete(f);
      const h = f.height ?? f.length ?? 60;
      const d = f.dir ?? [0, 0, 0];
      if (f.pivot) this.play(h > 300 ? 'giantCrash' : 'treeCrash', [f.pivot[0] + d[0] * h * 0.5, f.pivot[1], f.pivot[2] + d[2] * h * 0.5], Math.min(1.6, 0.6 + h / 120));
    }
    // 鳥
    const hush = world.meteor && world.meteor.t > T_FALL - 4 && world.meteor.t < T_FALL + 400;
    this.birdIn -= dt;
    if (this.birdIn <= 0) {
      this.birdIn = rnd(0.6, 3.5) / Math.max(0.3, this.forest);
      if (this.forest > 0.1 && !hush && this.indoor < 0.5) {
        const a = rnd(0, Math.PI * 2), d = rnd(30, 160);
        const L = this.listener;
        this.play('chirp', [L[0] + Math.cos(a) * d, L[1] + rnd(10, 60), L[2] + Math.sin(a) * d], Math.min(1, this.forest));
      }
    }
    // 風: いつも少し。高い所・隕石のあとは強く、屋内では弱い
    const ground = world.loadedGroundAt?.(Math.floor(this.listener[0]), Math.floor(this.listener[2])) ?? 0;
    const high = Math.max(0, Math.min(1, (this.listener[1] - ground - 30) / 400));
    const gustT = performance?.now ? performance.now() / 1000 : t;
    const gusty = 0.6 + 0.4 * Math.sin(gustT * 0.37) * Math.sin(gustT * 0.23 + 1);
    const after = world.meteor && world.meteor.since > 0 ? 0.25 * Math.exp(-world.meteor.since / 90) : 0;
    this.setLoop('wind', (0.05 + 0.18 * high + after) * gusty * (1 - 0.85 * this.indoor));
    this.loops.wind.fl.frequency.setTargetAtTime(300 + 260 * gusty + 200 * high, t, 0.5);
    // 川・池のせせらぎ
    const wl = this.water;
    this.setLoop('river', 0.16 * wl.level * (0.85 + 0.15 * Math.sin(t * 3.1) * Math.sin(t * 1.7)), wl.at, 60, 0.3);
  }

  // まわりの様子をときどき調べる（森・水・屋内）
  scan(world) {
    const L = this.listener;
    // 森: まわりの木の数
    let trees = 0;
    for (const tree of world.trees?.values?.() ?? []) {
      const s = tree.spec;
      if (s && Math.abs(s.x - L[0]) < 220 && Math.abs(s.z - L[2]) < 220) trees++;
      if (trees > 30) break;
    }
    this.forest = Math.min(1, trees / 12) + Math.min(0.6, (world.giants?.size ?? 0) > 0 ? this.giantsNear(world) : 0);
    // 水: まわりの水面を粗く調べ、近い所ほど重く数える
    let sum = 0, wx = 0, wy = 0, wz = 0;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const x = Math.floor(L[0] + i * 28), z = Math.floor(L[2] + j * 28);
        const lv = world.loadedWaterAt?.(x, z) ?? 0;
        if (!lv) continue;
        const wgt = 1 / (1 + Math.hypot(i, j) * 0.8);
        sum += wgt;
        wx += x * wgt;
        wy += lv * wgt;
        wz += z * wgt;
      }
    }
    this.water = sum > 0 ? { level: Math.min(1, sum / 2.5), at: [wx / sum, wy / sum, wz / sum] } : { level: 0, at: null };
    // 屋内: 頭の上がふさがっているか（ピラミッドの中・洞窟）
    const p = world.player;
    let covered = 0;
    for (const [dx, dz] of [[4, 4], [-8, 4], [16, 4], [4, -8], [4, 16]]) {
      if ((world.loadedGroundAt?.(p.pos[0] + dx, p.pos[2] + dz) ?? 0) > p.pos[1] + 24) covered++;
    }
    this.indoor = covered >= 4 ? 1 : 0;
  }

  giantsNear(world) {
    const L = this.listener;
    for (const g of world.giants.values()) {
      const s = g.spec ?? g;
      if (s.x !== undefined && Math.hypot(s.x - L[0], s.z - L[2]) < 400) return 0.6;
    }
    return 0;
  }

  // 足音（歩く周期の半分ごとに 1 歩）と着地
  steps(dt, world, p) {
    const grounded = p.vy === 0;
    if (this.vyWas > 14 && grounded) this.play('land', center(p), Math.min(1.6, this.vyWas / 30));
    this.vyWas = p.vy;
    const phase = p.pose?.phase ?? 0;
    const half = Math.floor(phase * 2);
    if (half !== this.stepPhase) {
      this.stepPhase = half;
      if (grounded && p.speed > 0.6) {
        const kind = surfaceAt(world, p);
        if (kind) this.play(kind, [p.pos[0] + 4.5, p.pos[1], p.pos[2] + 4.5], Math.min(1.4, 0.55 + p.speed / 30));
      }
    }
  }

  // 隕石: 落ちてくる間の轟音と甲高い音、激突のあとの地鳴りと、雲の昇る低い音
  meteor(world, view) {
    const m = world.meteor;
    if (!m) {
      this.setLoop('roar', 0);
      this.setLoop('scream', 0);
      this.setLoop('rumble', 0);
      return;
    }
    const L = this.listener;
    const s = m.site;
    const ground = world.loadedGroundAt?.(Math.round(s.x), Math.round(s.z)) || 300;
    const t = this.ctx.currentTime;
    if (m.phase === 'falling') {
      const u = Math.min(1, m.t / T_FALL);
      const mp = m.meteorPos(m.t);
      this.setLoop('roar', 0.5 + 2.2 * u * u, mp, 7000);
      this.loops.roar.fl.frequency.setTargetAtTime(160 + 700 * u * u, t, 0.2);
      this.setLoop('scream', 0.05 + 0.5 * u ** 3, mp, 7000);
      this.loops.scream.fl.frequency.setTargetAtTime(380 + 1500 * u * u, t, 0.2);
      this.setLoop('rumble', 0.3 * u * u);
      return;
    }
    const tau = m.since;
    const rp = Math.hypot(L[0] - s.x, L[2] - s.z);
    const heard = tau - rp / SOUND_SPEED; // 激突の音が届いてからの時間
    // 雲が昇っていく間の低い轟き（届いてから。数分かけて小さくなる）
    const roar = heard > 0 ? 1.4 * Math.exp(-heard / 30) + 0.3 * Math.exp(-heard / 200) : 0;
    this.setLoop('roar', roar, [s.x, ground + 400, s.z], 9000, 0.4);
    this.loops.roar.fl.frequency.setTargetAtTime(220, t, 0.5);
    this.setLoop('scream', 0);
    // 地鳴り: 地面の波が近づくほど、届いたら大きく揺れる。クレーターのそばでは地形が動いている間ずっと
    const front = tau * GROUND_WAVE;
    const wave = Math.exp(-(((front - rp) / 900) ** 2)) * Math.min(1, 6000 / Math.max(1, rp - CRATER_R));
    const live = m.phase === 'live' ? 0.5 * Math.min(1, 9000 / Math.max(1, rp)) : 0;
    const shake = Math.min(1.5, (view.shake ?? 0) / 1.2);
    this.setLoop('rumble', Math.min(2.2, 1.2 * wave + live + shake + (front > rp ? 0.15 * Math.exp(-(tau - rp / GROUND_WAVE) / 10) : 0)), null, 0, 0.15);
    // 空から降ってくる岩: ひゅうという音
    for (const d of m.debris ?? []) {
      if (this.seenDebris.has(d)) continue;
      this.seenDebris.add(d);
      this.play('debrisWhistle', d.p, Math.min(1.4, 0.5 + d.size / 4));
    }
  }

  // 龍: 体が風を切る音・火を吹く音・吠え声・歩く足音
  dragon(world) {
    const D = world.dragon;
    if (!D?.head) {
      this.setLoop('dragon', 0);
      this.setLoop('fire', 0);
      return;
    }
    const was = this.dragonWas;
    if (D.mode !== was.mode) {
      if (D.mode === 'aim') this.play('dragonGrowl', D.head);
      if (D.mode === 'takeoff' || (D.mode === 'breathe' && was.mode !== 'aim')) this.play('dragonRoar', D.head);
      was.mode = D.mode;
    }
    if (D.anger > 0 && was.anger <= 0) this.play('dragonRoar', D.head, 1.3);
    was.anger = D.anger;
    const flying = D.mode === 'fly' || D.mode === 'descend' || D.mode === 'takeoff';
    this.setLoop('dragon', flying ? 0.25 + Math.min(0.5, (D.speed ?? 0) / 200) : 0.05, D.head, 120, 0.3);
    if (D.blowing) {
      const { mouth } = D.mouth?.() ?? { mouth: D.head };
      this.setLoop('fire', 0.9 * (0.8 + 0.2 * Math.random()), mouth, 120, 0.05);
    } else {
      this.setLoop('fire', 0, D.head, 120, 0.15);
    }
    // 歩くときの足音（ずしん）
    if (D.mode === 'walk' && (D.speed ?? 0) > 1) {
      const n = Math.floor((D.walkClock ?? 0) * 1.6);
      if (n !== was.step) {
        was.step = n;
        this.play('dragonStep', D.head, 1);
      }
    }
  }
}

export function soundEnabled() {
  return Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext);
}
