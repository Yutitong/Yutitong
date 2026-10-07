import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, spawnPlayer, step, ensureAround } from '../src/world.js';
import { SoundSystem, cuesFor, spatial, surfaceAt, SOUND_NAMES, SOUND_SPEED } from '../src/sound.js';

// Web Audio の代わり（つないだ部品を数えるだけ）
class Param {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v) { assert.ok(v > 0, 'exponential ramp to 0'); this.value = v; return this; }
  setTargetAtTime(v) { assert.ok(Number.isFinite(v), 'target is a number'); this.value = v; return this; }
}
class Node {
  constructor(ctx, params = []) {
    this.ctx = ctx;
    for (const p of params) this[p] = new Param(1);
    ctx.made++;
  }
  connect(n) { assert.ok(n, 'connect to a node'); return n; }
  disconnect() {}
  start(t) { assert.ok(Number.isFinite(t ?? 0)); this.ctx.started++; }
  stop() {}
}
class FakeAudio {
  constructor() { this.made = 0; this.started = 0; this.currentTime = 1; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  createGain() { return new Node(this, ['gain']); }
  createBiquadFilter() { return new Node(this, ['frequency', 'Q']); }
  createOscillator() { return new Node(this, ['frequency']); }
  createStereoPanner() { return new Node(this, ['pan']); }
  createDynamicsCompressor() { return new Node(this, ['threshold', 'knee', 'ratio', 'attack', 'release']); }
  createConvolver() { return new Node(this); }
  createBufferSource() { return Object.assign(new Node(this, ['playbackRate']), { loop: false }); }
  createBuffer(ch, len, rate) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { duration: len / rate, getChannelData: (i) => data[i] };
  }
  resume() {}
}

const SEED = 20261004;
const gameWorld = () => {
  const w = new World({ seed: SEED, npcs: false });
  w.bodyMakesChunks = false;
  return w;
};

test('出来事ごとに鳴らす音は、どれも作り方がある', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  const target = { id: 999, kind: 'monster', pos: [p.pos[0] + 30, p.pos[1], p.pos[2]] };
  const evs = [];
  const results = {
    chop: ['miss', 'notch', 'felled', 'wound', 'severed', 'glance'],
    dig: ['dug', 'rock', 'full', 'miss'],
    place: ['placed', 'empty', 'blocked'],
    slash: ['miss', 'wound', 'collapse', 'kingHurt', 'kingDown', 'severed', 'glance', 'blocked'],
    shoot: ['dent', 'chip', 'killed', 'severed', 'wound', 'kingDown', 'kingHurt', 'collapse', 'statueBreak', 'statueChip', 'bonesKick', 'burst', 'fishKill', 'graze', 'blocked', 'miss'],
  };
  for (const [type, list] of Object.entries(results)) for (const result of list) evs.push({ type, actor: p, target, result });
  for (const type of ['skeletonWake', 'skeletonHit', 'kingWake', 'kingHit', 'kingDown', 'statueWindup', 'statueSlam', 'statueHit', 'statueBreak', 'statueStep',
    'fishSplit', 'fishMerge', 'fishBurst', 'fishRegroup', 'fishMorph', 'fishGone', 'fishBack', 'spot', 'octa', 'beam', 'beamHit', 'absorb', 'vanish', 'beamDragon',
    'respawn', 'meteorQuake', 'meteorWind', 'meteorBlast', 'meteorDebrisHit']) {
    evs.push({ type, actor: target, target: p, amp: 40, damage: 30 });
  }
  evs.push({ type: 'meteorDebris', actor: target, at: [10, 20, 30], size: 3 }, { type: 'meteorGiant', actor: target, at: [10, 200, 30] });
  for (const ev of evs) {
    const cues = cuesFor(ev, w);
    assert.ok(cues.length > 0, `${ev.type} ${ev.result ?? ''} に音がある`);
    for (const c of cues) {
      assert.ok(SOUND_NAMES.includes(c.name), `${c.name} の作り方がある`);
      assert.ok(c.at === null || c.at.every(Number.isFinite), `${c.name} の場所`);
    }
  }
  // 押した・塞がれたは鳴らさない（多すぎる）
  assert.equal(cuesFor({ type: 'push', actor: p, target }, w).length, 0);
});

test('遠い音ほど小さく、こもって、遅れて届き、右の音は右から聞こえる', () => {
  const ear = [0, 0, 0], right = [1, 0, 0];
  const near = spatial(ear, right, [0, 0, 30]);
  const far = spatial(ear, right, [0, 0, 3000]);
  assert.ok(far.gain < near.gain / 50);
  assert.ok(far.cutoff < near.cutoff / 2);
  assert.ok(far.delay > 1 && near.delay < 0.02);
  assert.ok(spatial(ear, right, [200, 0, 0]).pan > 0.7);
  assert.ok(spatial(ear, right, [-200, 0, 0]).pan < -0.7);
  // 5km 先の隕石の爆音は 10 秒以上遅れ、低い音だけが届く
  const boom = spatial(ear, right, [33000, 0, 0], 26000);
  assert.ok(boom.delay > 10 && boom.delay === 33000 / SOUND_SPEED);
  assert.ok(boom.cutoff < 300 && boom.gain > 0.5);
});

test('AudioContext がなければ何もしない。あれば、どの音も組み立てられる', () => {
  const w = gameWorld();
  const p = spawnPlayer(w);
  ensureAround(w, p.pos[0], p.pos[2], 2);
  const view = { pos: [p.pos[0], p.pos[1] + 12, p.pos[2]], right: [1, 0, 0], shake: 0 };
  const off = new SoundSystem();
  off.update(0.016, w, view);
  assert.equal(off.play('boom'), false);

  globalThis.AudioContext = FakeAudio;
  try {
    const s = new SoundSystem();
    s.unlock();
    assert.ok(s.ctx instanceof FakeAudio);
    for (const name of SOUND_NAMES) {
      s.lastAt.clear();
      s.ends = [];
      assert.equal(s.play(name, [p.pos[0] + 5, p.pos[1], p.pos[2]]), true, name);
    }
    // 消音中は鳴らさない
    s.setMuted(true);
    assert.equal(s.play('gunshot'), false);
    s.setMuted(false);
    // 歩くと足音が鳴る
    const before = s.ctx.started;
    for (let i = 0; i < 40; i++) {
      step(w, { dir: [0, 1], run: true });
      s.update(0.04, w, view);
    }
    assert.ok(s.ctx.started > before, '足音');
    assert.ok(surfaceAt(w, p), '足もとの種類');
  } finally {
    delete globalThis.AudioContext;
  }
});
