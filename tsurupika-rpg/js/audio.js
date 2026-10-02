// ===== 音：WebAudio による簡易チップチューン =====
const Audio8 = (() => {
  let ac = null, master = null, muted = false;
  let current = null;          // 再生中の曲名
  let timer = null;            // スケジューラ
  let jingleTimer = null;

  const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
  function freq(n) {
    const m = /^([a-g](?:#|b)?)(\d)$/.exec(n);
    if (!m) return 0;
    const midi = (parseInt(m[2], 10) + 1) * 12 + NOTE[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  // "c5:4 r:2 | e5:2" → [{f, d}]  (d は16分音符単位)
  function parse(s) {
    return s.replace(/\|/g, ' ').trim().split(/\s+/).map(t => {
      const [n, d] = t.split(':');
      return { f: n === 'r' ? 0 : freq(n), d: parseInt(d, 10) };
    });
  }
  // ベースのアルペジオ：各小節 [低音, 高音] 8分音符交互
  function arp(roots, per = 8) {
    return roots.map(r => {
      const lo = r, oct = parseInt(r.slice(-1), 10) + 1, hi = r.slice(0, -1) + oct;
      const out = [];
      for (let i = 0; i < 16 / (16 / per) / 2; i++) out.push(lo + ':2', hi + ':2');
      return out.join(' ');
    }).join(' ');
  }

  const SONGS = {
    title: { bpm: 120, tracks: [
      { w: 'square', v: .11, n: 'g4:4 c5:4 e5:4 g5:4 | f5:6 e5:2 d5:8 | e5:4 d5:4 c5:4 a4:4 | b4:6 c5:2 d5:8 | g4:4 c5:4 e5:4 g5:4 | a5:6 g5:2 f5:8 | e5:4 g5:4 d5:4 b4:4 | c5:16' },
      { w: 'triangle', v: .22, n: 'c3:8 g3:8 | f3:8 c3:8 | a2:8 e3:8 | g2:8 g3:8 | c3:8 e3:8 | f3:8 a3:8 | g3:8 g2:8 | c3:16' },
    ] },
    town: { bpm: 100, tracks: [
      { w: 'square', v: .09, n: 'e5:2 g5:2 a5:4 g5:2 e5:2 d5:4 | c5:2 d5:2 e5:4 g5:8 | a5:2 g5:2 e5:4 d5:2 c5:2 a4:4 | c5:4 d5:4 c5:8 | e5:2 g5:2 a5:4 g5:2 e5:2 d5:4 | c5:2 d5:2 e5:4 a5:8 | g5:2 e5:2 d5:4 c5:2 a4:2 g4:4 | a4:4 c5:4 c5:8' },
      { w: 'triangle', v: .2, n: 'c3:4 g3:4 c3:4 g3:4 | a2:4 e3:4 a2:4 e3:4 | f2:4 c3:4 f2:4 c3:4 | g2:4 d3:4 c3:8 | c3:4 g3:4 c3:4 g3:4 | a2:4 e3:4 a2:4 e3:4 | f2:4 c3:4 g2:4 d3:4 | f2:4 g2:4 c3:8' },
    ] },
    field: { bpm: 132, tracks: [
      { w: 'square', v: .09, n: 'c5:4 g4:2 c5:2 e5:4 g5:4 | f5:4 e5:2 d5:2 e5:8 | d5:4 a4:2 d5:2 f5:4 a5:4 | g5:4 f5:2 e5:2 d5:8 | c5:4 g4:2 c5:2 e5:4 g5:4 | a5:4 g5:2 f5:2 e5:4 c5:4 | d5:4 e5:2 f5:2 g5:4 b4:4 | c5:12 r:4' },
      { w: 'triangle', v: .2, n: 'c3:4 g3:4 c3:4 g3:4 | f3:4 c3:4 c3:4 g3:4 | d3:4 a3:4 d3:4 a3:4 | g3:4 d3:4 g3:4 g2:4 | c3:4 g3:4 c3:4 g3:4 | f3:4 c4:4 f3:4 a3:4 | g3:4 d3:4 g3:4 g2:4 | c3:8 c3:8' },
    ] },
    dungeon: { bpm: 96, tracks: [
      { w: 'square', v: .08, n: 'a4:4 c5:4 b4:4 e4:4 | a4:4 c5:2 d5:2 e5:8 | f5:4 e5:4 d5:4 c5:4 | b4:4 g#4:4 e4:8 | a4:4 c5:4 b4:4 e4:4 | a4:4 c5:2 d5:2 e5:8 | f5:4 d5:4 b4:4 g#4:4 | a4:16' },
      { w: 'triangle', v: .22, n: 'a2:8 e3:8 | a2:8 e3:8 | d3:8 a2:8 | e3:8 e2:8 | a2:8 e3:8 | a2:8 c3:8 | d3:8 e3:8 | a2:16' },
    ] },
    battle: { bpm: 160, tracks: [
      { w: 'square', v: .09, n: 'a4:2 a4:2 e5:2 a4:2 d5:2 a4:2 c5:2 b4:2 | a4:2 a4:2 e5:2 a4:2 f5:4 e5:4 | a4:2 a4:2 e5:2 a4:2 d5:2 a4:2 c5:2 b4:2 | c5:4 b4:4 g#4:4 e4:4 | f5:4 e5:2 d5:2 c5:4 a4:4 | d5:4 c5:2 b4:2 a4:4 f4:4 | e5:4 d5:2 c5:2 b4:4 c5:4 | b4:8 e5:8' },
      { w: 'triangle', v: .22, n: arp(['a2', 'a2', 'a2', 'e2', 'f2', 'd2', 'e2', 'e2']) },
    ] },
    boss: { bpm: 150, tracks: [
      { w: 'square', v: .09, n: 'e5:2 e5:2 d#5:2 e5:2 g5:4 e5:4 | d5:2 d5:2 c#5:2 d5:2 f5:4 d5:4 | c5:2 c5:2 b4:2 c5:2 e5:4 c5:4 | b4:4 c5:4 d5:4 d#5:4 | e5:2 e5:2 d#5:2 e5:2 b5:4 g5:4 | a5:4 g5:2 f5:2 e5:4 d5:4 | c5:4 a4:4 b4:4 d#5:4 | e5:16' },
      { w: 'triangle', v: .24, n: arp(['e2', 'd2', 'c2', 'b1', 'e2', 'a1', 'f2', 'e2']) },
    ] },
    mystery: { bpm: 72, tracks: [
      { w: 'square', v: .07, n: 'e5:6 d5:2 c5:8 | b4:6 a4:2 g#4:8 | a4:4 c5:4 e5:4 a5:4 | g#5:12 r:4 | f5:6 e5:2 d5:8 | c5:6 b4:2 a4:8 | b4:4 c5:4 d5:4 b4:4 | a4:12 r:4' },
      { w: 'triangle', v: .22, n: 'a2:16 | e2:16 | a2:16 | e2:16 | d3:16 | a2:16 | e2:16 | a2:16' },
    ] },
    castle: { bpm: 110, tracks: [
      { w: 'square', v: .08, n: 'd5:4 a4:4 d5:4 f5:4 | e5:4 c#5:4 a4:8 | d5:4 f5:4 a5:4 g5:2 f5:2 | e5:12 r:4 | bb4:4 d5:4 f5:4 bb5:4 | a5:4 g5:4 f5:4 e5:4 | d5:4 c#5:4 e5:4 a4:4 | d5:12 r:4' },
      { w: 'triangle', v: .22, n: arp(['d2', 'a1', 'd2', 'a1', 'bb1', 'f2', 'a1', 'd2']) },
    ] },
    ending: { bpm: 96, tracks: [
      { w: 'square', v: .09, n: 'c5:4 e5:4 g5:6 e5:2 | f5:4 a5:4 g5:8 | e5:4 g5:4 c6:6 b5:2 | a5:4 f5:4 g5:8 | a5:4 g5:4 f5:4 e5:4 | d5:4 e5:4 f5:8 | e5:4 d5:4 c5:4 b4:4 | c5:16' },
      { w: 'triangle', v: .22, n: arp(['c3', 'f2', 'c3', 'f2', 'f2', 'g2', 'g2', 'c3']) },
    ] },
  };
  const JINGLES = {
    win: { bpm: 140, n: 'c5:2 e5:2 g5:2 c6:6 a5:2 b5:2 c6:12' },
    levelup: { bpm: 160, n: 'c5:2 e5:2 g5:2 c6:2 g5:2 c6:8' },
    inn: { bpm: 100, n: 'c5:4 e5:4 g5:4 e5:4 f5:4 d5:4 c5:8' },
    item: { bpm: 150, n: 'g5:2 a5:2 b5:2 d6:8' },
    gameover: { bpm: 80, n: 'a4:6 g#4:6 g4:6 f#4:12' },
    join: { bpm: 130, n: 'e5:2 g5:2 c6:4 e5:2 g5:2 c6:4 d6:8' },
  };

  function ensure() {
    if (ac) return true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ac.destination);
      return true;
    } catch (e) { ac = null; return false; }
  }
  function tone(f, t, dur, wave, vol, dest) {
    if (!f) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = wave; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, t + Math.max(0.01, dur * 0.7));
    g.gain.linearRampToValueAtTime(0, t + dur * 0.95);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur);
  }

  let songGain = null;
  function stopSong() {
    if (timer) { clearInterval(timer); timer = null; }
    if (songGain) {
      const g = songGain;
      try { g.gain.setValueAtTime(g.gain.value, ac.currentTime); g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.05); } catch (e) {}
      setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 200);
      songGain = null;
    }
  }
  function startSong(name) {
    const song = SONGS[name];
    if (!song || !ac) return;
    songGain = ac.createGain(); songGain.gain.value = 1; songGain.connect(master);
    const myGain = songGain;
    const unit = 60 / song.bpm / 4;
    const tracks = song.tracks.map(tr => ({ ...tr, notes: parse(tr.n), i: 0, t: ac.currentTime + 0.06 }));
    const tick = () => {
      if (!ac || songGain !== myGain) return;
      const horizon = ac.currentTime + 0.25;
      for (const tr of tracks) {
        while (tr.t < horizon) {
          const nt = tr.notes[tr.i];
          tone(nt.f, tr.t, nt.d * unit, tr.w, tr.v, myGain);
          tr.t += nt.d * unit;
          tr.i = (tr.i + 1) % tr.notes.length;
        }
      }
    };
    tick();
    timer = setInterval(tick, 60);
  }

  function bgm(name) {
    if (name === current) return;
    current = name;
    if (!ensure()) return;
    if (jingleTimer) return; // ジングル終了後に current を再生
    stopSong();
    if (name) startSong(name);
  }
  function jingle(name) {
    const j = JINGLES[name];
    if (!j || !ensure()) return Promise.resolve();
    stopSong();
    const unit = 60 / j.bpm / 4;
    let t = ac.currentTime + 0.03;
    for (const nt of parse(j.n)) { tone(nt.f, t, nt.d * unit, 'square', 0.12); tone(nt.f / 2, t, nt.d * unit, 'triangle', 0.18); t += nt.d * unit; }
    const ms = (t - ac.currentTime) * 1000 + 150;
    if (jingleTimer) clearTimeout(jingleTimer);
    return new Promise(res => {
      jingleTimer = setTimeout(() => {
        jingleTimer = null;
        if (current) startSong(current);
        res();
      }, ms);
    });
  }

  function noise(t, dur, vol, hp) {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = ac.createBufferSource(); s.buffer = b;
    const g = ac.createGain(); g.gain.value = vol;
    const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = hp || 900;
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }
  function sweep(t, f0, f1, dur, wave, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
  }
  function sfx(name) {
    if (!ensure()) return;
    const t = ac.currentTime + 0.005;
    switch (name) {
      case 'cursor': tone(1320, t, 0.04, 'square', 0.06); break;
      case 'ok': tone(880, t, 0.05, 'square', 0.07); tone(1320, t + 0.05, 0.06, 'square', 0.07); break;
      case 'cancel': tone(660, t, 0.05, 'square', 0.06); tone(440, t + 0.05, 0.06, 'square', 0.06); break;
      case 'bump': tone(110, t, 0.06, 'square', 0.08); break;
      case 'hit': noise(t, 0.12, 0.35); tone(140, t, 0.08, 'square', 0.1); break;
      case 'crit': noise(t, 0.25, 0.45); sweep(t, 900, 120, 0.25, 'square', 0.1); break;
      case 'hurt': noise(t, 0.18, 0.4); sweep(t, 300, 60, 0.18, 'square', 0.1); break;
      case 'miss': sweep(t, 600, 1200, 0.1, 'triangle', 0.08); break;
      case 'magic': sweep(t, 200, 1600, 0.3, 'sawtooth', 0.05); noise(t + 0.1, 0.2, 0.15, 2000); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.06, 0.08, 'triangle', 0.14)); break;
      case 'door': noise(t, 0.08, 0.2, 400); tone(220, t, 0.06, 'square', 0.06); break;
      case 'run': [880, 660, 440, 330].forEach((f, i) => tone(f, t + i * 0.05, 0.05, 'square', 0.06)); break;
      case 'stomp': sweep(t, 90, 30, 0.35, 'sine', 0.5); noise(t, 0.3, 0.5, 0); break;
      case 'break': noise(t, 0.4, 0.6, 600); sweep(t, 400, 50, 0.4, 'square', 0.12); break;
      case 'cry': sweep(t, 700, 380, 0.5, 'triangle', 0.12); sweep(t + 0.5, 650, 300, 0.6, 'triangle', 0.12); break;
      case 'flash': sweep(t, 2000, 4000, 0.2, 'square', 0.05); tone(3000, t + 0.15, 0.2, 'triangle', 0.08); break;
      case 'appear': [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.05, 0.07, 'square', 0.06)); break;
      case 'poison': sweep(t, 300, 200, 0.15, 'sawtooth', 0.06); break;
      case 'chest': tone(523, t, 0.06, 'square', 0.08); tone(784, t + 0.07, 0.1, 'square', 0.08); break;
      case 'die': sweep(t, 500, 80, 0.4, 'square', 0.08); break;
    }
  }
  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.6;
  }
  function unlock() {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume();
    if (current && !timer && !jingleTimer) startSong(current);
  }
  return { bgm, jingle, sfx, setMuted, unlock, get muted() { return muted; }, get current() { return current; } };
})();
