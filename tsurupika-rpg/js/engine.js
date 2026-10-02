// ===== エンジン：描画・入力・ウィンドウ・パーティ・マップ =====
const W = 512, H = 448, TS = 32;
const FONT = '"DotGothic16", "MS Gothic", "Osaka-Mono", monospace';
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const buf = document.createElement('canvas'); buf.width = W; buf.height = H;
const bctx = buf.getContext('2d');
bctx.imageSmoothingEnabled = false;
let SCALE = 1;
let frameCount = 0;

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(256, Math.round((r.width || W) * dpr));
  if (canvas.width !== w) { canvas.width = w; canvas.height = Math.round(w * H / W); }
  SCALE = canvas.width / W;
}

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sfx = n => Audio8.sfx(n);

// ---------- 入力 ----------
const Input = (() => {
  const down = {}, pressed = {}, held = {};
  const KEYMAP = {
    ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    z: 'ok', Z: 'ok', Enter: 'ok', ' ': 'ok', x: 'cancel', X: 'cancel', Escape: 'cancel', Backspace: 'cancel', c: 'menu', C: 'menu',
  };
  function press(a) { if (!down[a]) { pressed[a] = true; held[a] = 0; } down[a] = true; }
  function release(a) { down[a] = false; }
  window.addEventListener('keydown', e => {
    const a = KEYMAP[e.key];
    if (a) { e.preventDefault(); if (!e.repeat) press(a); Audio8.unlock(); }
    else if (e.key === 'm' || e.key === 'M') { if (typeof toggleMute === 'function') toggleMute(); }
  });
  window.addEventListener('keyup', e => { const a = KEYMAP[e.key]; if (a) release(a); });
  window.addEventListener('blur', () => { for (const k in down) down[k] = false; });
  return {
    isDown: a => !!down[a],
    pressed: a => !!pressed[a],
    repeat: a => !!pressed[a] || (!!down[a] && held[a] > 18 && held[a] % 5 === 0),
    tick() { for (const k in down) if (down[k]) held[k]++; for (const k in pressed) delete pressed[k]; },
    clear() { for (const k in pressed) delete pressed[k]; },
    press, release,
  };
})();

// ---------- テキスト・ウィンドウ描画 ----------
function setFont(size = 20) { ctx.font = `${size}px ${FONT}`; ctx.textBaseline = 'top'; }
function drawBox(x, y, w, h, opts = {}) {
  ctx.fillStyle = opts.bg || '#07071a';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.strokeStyle = opts.border || '#f4f2ea';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + 4, y + 4, w - 8, h - 8, 4); else ctx.rect(x + 4, y + 4, w - 8, h - 8);
  ctx.stroke();
}
function text(s, x, y, color = '#f4f2ea', size = 20, align = 'left') {
  setFont(size);
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
}
const NO_LINE_START = '。、！？」』）…ー〜!?,.';
function wrapText(str, maxW, size = 20) {
  setFont(size);
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const ch of para) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line && !NO_LINE_START.includes(ch)) { out.push(line); line = ch; }
      else line = t;
    }
    out.push(line);
  }
  return out;
}
function cursor(x, y) {
  if (Math.floor(frameCount / 16) % 2 === 0 || UI.activeBlink === false) text('▶', x, y, '#f4f2ea', 18);
}

// ---------- UI スタック ----------
const UI = {
  stack: [],
  push(w) { this.stack.push(w); return w; },
  remove(w) { const i = this.stack.indexOf(w); if (i >= 0) this.stack.splice(i, 1); },
  top() { for (let i = this.stack.length - 1; i >= 0; i--) if (!this.stack[i].inactive) return this.stack[i]; return null; },
  busy() { return this.stack.some(w => !w.inactive && w.modal !== false); },
  update() { const t = this.top(); if (t && t.update) t.update(); },
  draw() { for (const w of this.stack) w.draw(); },
};

class InfoWin {
  constructor(drawFn) { this.drawFn = drawFn; this.inactive = true; this.modal = false; }
  draw() { this.drawFn(); }
}

// メッセージウィンドウ
class MsgWin {
  constructor(str, opts, resolve) {
    this.opts = opts; this.resolve = resolve;
    this.x = 16; this.w = W - 32; this.h = 128;
    this.y = opts.top ? 12 : H - this.h - 12;
    const lines = [];
    String(str).split('\f').forEach((p, i) => {
      const ls = wrapText(p, this.w - 44, 20);
      for (let j = 0; j < ls.length; j += 3) lines.push(ls.slice(j, j + 3));
    });
    this.pages = lines; this.page = 0; this.shown = 0;
    this.len = this.pages[0].join('').length;
  }
  update() {
    if (this.shown < this.len) {
      this.shown += Input.isDown('ok') ? 3 : 1;
      if (Input.pressed('ok') || Input.pressed('cancel')) this.shown = this.len;
      return;
    }
    if (this.opts.keepOpen) { this.done(); return; }
    if (Input.pressed('ok') || Input.pressed('cancel')) {
      if (this.page < this.pages.length - 1) {
        this.page++; this.shown = 0; this.len = this.pages[this.page].join('').length; sfx('cursor');
      } else this.done();
    }
  }
  done() { if (!this.opts.keepOpen) UI.remove(this); else this.inactive = true; this.resolve(this); }
  draw() {
    drawBox(this.x, this.y, this.w, this.h);
    let left = Math.floor(this.shown);
    this.pages[this.page].forEach((ln, i) => {
      const s = ln.slice(0, Math.max(0, left));
      left -= ln.length;
      text(s, this.x + 22, this.y + 20 + i * 32, '#f4f2ea', 20);
    });
    if (this.shown >= this.len && !this.inactive && Math.floor(frameCount / 20) % 2 === 0)
      text('▼', this.x + this.w / 2 - 8, this.y + this.h - 26, '#f4f2ea', 16);
  }
}
function say(...pages) { return new Promise(res => UI.push(new MsgWin(pages.join('\f'), {}, res))); }
function sayKeep(str) { return new Promise(res => UI.push(new MsgWin(str, { keepOpen: true }, res))); }

// 選択ウィンドウ
class ChoiceWin {
  constructor(items, opts, resolve) {
    this.items = items.map(it => (typeof it === 'string' ? { label: it } : it));
    this.opts = opts; this.resolve = resolve;
    this.cols = opts.cols || 1;
    this.rowH = opts.rowH || 32;
    this.maxRows = opts.maxRows || 8;
    this.i = clamp(opts.initial || 0, 0, Math.max(0, this.items.length - 1));
    this.scroll = 0;
    setFont(opts.size || 20);
    const widest = Math.max(80, ...this.items.map(it => ctx.measureText(it.label).width + (it.right ? ctx.measureText(it.right).width + 24 : 0)));
    this.w = opts.w || Math.min(W - 32, widest * this.cols + 56 + (this.cols - 1) * 20);
    const rows = Math.min(this.maxRows, Math.ceil(this.items.length / this.cols));
    this.h = opts.h || rows * this.rowH + 30 + (opts.title ? 26 : 0);
    this.x = opts.x !== undefined ? opts.x : W - this.w - 16;
    this.y = opts.y !== undefined ? opts.y : H - this.h - 150;
    if (opts.onMove) opts.onMove(this.i);
  }
  move(d) {
    const n = this.items.length;
    if (!n) return;
    let j = this.i + d;
    if (j < 0) j = this.cols > 1 && d === -1 ? this.i : (d === -this.cols ? this.i : n - 1);
    if (j >= n) j = this.cols > 1 && d === 1 ? this.i : (d === this.cols ? this.i : 0);
    if (j !== this.i) { this.i = j; sfx('cursor'); if (this.opts.onMove) this.opts.onMove(this.i); }
    const row = Math.floor(this.i / this.cols);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + this.maxRows) this.scroll = row - this.maxRows + 1;
  }
  update() {
    if (Input.repeat('up')) this.move(-this.cols);
    else if (Input.repeat('down')) this.move(this.cols);
    else if (this.cols > 1 && Input.repeat('left')) this.move(-1);
    else if (this.cols > 1 && Input.repeat('right')) this.move(1);
    else if (Input.pressed('ok')) {
      const it = this.items[this.i];
      if (!it || it.disabled) { sfx('bump'); return; }
      sfx('ok'); this.finish(this.i);
    } else if (Input.pressed('cancel') && this.opts.cancel !== false) { sfx('cancel'); this.finish(-1); }
  }
  finish(v) {
    if (this.opts.keep && v >= 0) this.inactive = true; else UI.remove(this);
    this.resolve(v);
  }
  draw() {
    drawBox(this.x, this.y, this.w, this.h);
    let oy = this.y + 16;
    if (this.opts.title) { text(this.opts.title, this.x + 20, oy, '#c8c0a0', 16); oy += 26; }
    const colW = (this.w - 40) / this.cols;
    const size = this.opts.size || 20;
    for (let k = 0; k < this.items.length; k++) {
      const row = Math.floor(k / this.cols) - this.scroll, col = k % this.cols;
      if (row < 0 || row >= this.maxRows) continue;
      const it = this.items[k];
      const ix = this.x + 36 + col * colW, iy = oy + row * this.rowH;
      text(it.label, ix, iy, it.disabled ? '#77728a' : (it.color || '#f4f2ea'), size);
      if (it.right) text(it.right, this.x + 20 + (col + 1) * colW - 6, iy, it.disabled ? '#77728a' : '#f4f2ea', size, 'right');
      if (k === this.i) {
        if (this.inactive) text('▶', ix - 22, iy, '#a8a4b8', 18);
        else cursor(ix - 22, iy + (size - 18) / 2);
      }
    }
    const totalRows = Math.ceil(this.items.length / this.cols);
    if (totalRows > this.maxRows) {
      if (this.scroll > 0) text('▲', this.x + this.w - 26, this.y + 10, '#f4f2ea', 12);
      if (this.scroll + this.maxRows < totalRows) text('▼', this.x + this.w - 26, this.y + this.h - 22, '#f4f2ea', 12);
    }
  }
}
function choose(items, opts = {}) {
  return new Promise(res => { const w = new ChoiceWin(items, opts, res); opts.win = w; UI.push(w); });
}
async function ask(question, items = ['はい', 'いいえ']) {
  const m = await sayKeep(question);
  const r = await choose(items, { x: W - 160 - 16, y: H - 140 - 12 - (items.length * 32 + 30) - 4, w: 160, cancel: true });
  UI.remove(m);
  return r;
}

// ---------- 演出 ----------
const FX = {
  fade: 0, fadeTarget: 0, fadeSpeed: 0.05, fadeRes: null,
  shake: 0, shakeMag: 0, flash: 0, flashColor: '#fff',
  rain: 0,
  update() {
    if (this.fade !== this.fadeTarget) {
      const d = this.fadeTarget - this.fade;
      this.fade += Math.sign(d) * Math.min(Math.abs(d), this.fadeSpeed);
      if (this.fade === this.fadeTarget && this.fadeRes) { const r = this.fadeRes; this.fadeRes = null; r(); }
    }
    if (this.shake > 0) this.shake--;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.06);
  },
  offset() { return this.shake > 0 ? [rand(-this.shakeMag, this.shakeMag), rand(-this.shakeMag, this.shakeMag)] : [0, 0]; },
};
function fadeOut(frames = 20) { return new Promise(r => { FX.fadeTarget = 1; FX.fadeSpeed = 1 / frames; FX.fadeRes = r; if (FX.fade === 1) { FX.fadeRes = null; r(); } }); }
function fadeIn(frames = 20) { return new Promise(r => { FX.fadeTarget = 0; FX.fadeSpeed = 1 / frames; FX.fadeRes = r; if (FX.fade === 0) { FX.fadeRes = null; r(); } }); }
function shake(frames = 20, mag = 6) { FX.shake = frames; FX.shakeMag = mag; }
function flash(color = '#fff', a = 1) { FX.flash = a; FX.flashColor = color; }
const waiters = [];
function wait(frames) { return new Promise(r => waiters.push({ t: frames, r })); }
function updateWaiters() {
  for (let i = waiters.length - 1; i >= 0; i--) if (--waiters[i].t <= 0) { const w = waiters.splice(i, 1)[0]; w.r(); }
}

// ---------- スクリプト ----------
const Script = {
  running: 0,
  async run(fn) {
    this.running++;
    try { await fn(); } catch (e) { console.error(e); }
    finally { this.running--; }
  },
};

// ---------- ゲーム状態・パーティ ----------
let G = null;
const F = new Proxy({}, { get: (_, k) => (G ? G.flags[k] : undefined), set: (_, k, v) => { G.flags[k] = v; return true; } });

function makeChar(id, lv = 1) {
  const c = { id, lv, exp: expForLevel(lv), weapon: 'none_w', armor: 'none_a', status: {}, fatigue: false };
  c.hp = maxHp(c); c.mp = maxMp(c);
  return c;
}
function baseStat(c, k) { const d = CHARS[c.id]; return Math.floor(d.base[k] + d.grow[k] * (c.lv - 1)); }
function maxHp(c) { return baseStat(c, 'hp'); }
function maxMp(c) { return baseStat(c, 'mp'); }
function stat(c, k) {
  let v = baseStat(c, k);
  if (k === 'atk') v += EQUIPS[c.weapon].atk || 0;
  if (k === 'def') v += EQUIPS[c.armor].def || 0;
  if (c.fatigue && (k === 'atk' || k === 'def' || k === 'agi')) v = Math.floor(v * 0.6);
  return v;
}
function charName(c) { return CHARS[c.id].name; }
function knownSkills(c) { return CHARS[c.id].learn.filter(([lv]) => lv <= c.lv).map(([, s]) => s); }
function gainExp(c, n) {
  const msgs = [];
  if (c.hp <= 0) return msgs;
  c.exp += n;
  while (c.lv < MAX_LV && c.exp >= expForLevel(c.lv + 1)) {
    const oh = maxHp(c), om = maxMp(c);
    c.lv++;
    c.hp += maxHp(c) - oh; c.mp += maxMp(c) - om;
    msgs.push(`${charName(c)}は レベル${c.lv}に あがった！`);
    for (const [lv, s] of CHARS[c.id].learn) if (lv === c.lv) msgs.push(`${charName(c)}は ${SKILLS[s].name}を おぼえた！`);
  }
  return msgs;
}
function partyAlive() { return G.party.filter(c => c.hp > 0); }
function partyHas(id) { return G.party.some(c => c.id === id); }
function member(id) { return G.party.find(c => c.id === id); }
function healParty() { for (const c of G.party) { c.hp = maxHp(c); c.mp = maxMp(c); c.status = {}; } }
function addItem(id, n = 1) { G.inv[id] = Math.min(99, (G.inv[id] || 0) + n); }
function removeItem(id, n = 1) { G.inv[id] = (G.inv[id] || 0) - n; if (G.inv[id] <= 0) delete G.inv[id]; }
function invList() { return Object.keys(ITEMS).filter(k => G.inv[k] > 0); }
function heroSprite() {
  const h = G.party[0];
  return h.armor === 'none_a' ? 'hero_naked' : 'hero';
}

// どうぐ・わざ（フィールドとバトル共通の効果）
function applyHeal(c, amount) { const before = c.hp; c.hp = Math.min(maxHp(c), c.hp + amount); return c.hp - before; }
function useItemOn(id, target) {
  const it = ITEMS[id];
  const nm = target ? charName(target) : '';
  switch (it.kind) {
    case 'heal': if (target.hp <= 0) return null; return `${nm}の HPが ${applyHeal(target, it.power)} かいふくした！`;
    case 'mp': if (target.hp <= 0) return null; { const b = target.mp; target.mp = Math.min(maxMp(target), target.mp + it.power); return `${nm}の MPが ${target.mp - b} かいふくした！`; }
    case 'cure': if (target.hp <= 0) return null; delete target.status.poison; delete target.status.blind; return `${nm}の からだが かるくなった！`;
    case 'revive': if (target.hp > 0) return null; target.hp = Math.floor(maxHp(target) / 2); target.status = {}; return `${nm}は いきかえった！`;
    case 'full': if (target.hp <= 0) return null; target.hp = maxHp(target); target.mp = maxMp(target); return `${nm}は げんきいっぱいに なった！`;
    case 'healAll': for (const c of partyAlive()) applyHeal(c, it.power); return 'みんなの HPが かいふくした！';
  }
  return null;
}
function skillHealAmount(user, sk) { return Math.floor((sk.power + stat(user, 'int') * sk.scale) * (0.9 + Math.random() * 0.2)); }

// ---------- マップ ----------
const WALK = new Set('.,=ShDNftBnwCKr_AV&'.split(''));
const NO_ENC = new Set('DN_AV&Bn'.split(''));
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const MapScene = {
  def: null, npcs: [], mods: {}, anim: null, bumpCd: 0, nameT: 0,
  load(id) {
    this.def = MAPS[id];
    G.map = id;
    this.refresh();
    this.anim = null;
    this.nameT = this.def.showName ? 150 : 0;
    if (this.def.bgm) Audio8.bgm(typeof this.def.bgm === 'function' ? this.def.bgm() : this.def.bgm);
  },
  refresh() {
    const d = this.def;
    this.mods = {};
    if (d.mods) for (const m of d.mods()) this.mods[m.x + ',' + m.y] = m.t;
    const old = {};
    for (const n of this.npcs) old[n.def.id] = n;
    this.npcs = (d.npcs || []).filter(n => !n.when || n.when()).map(n => {
      const o = old[n.id];
      if (o && o.def === n && this.npcs.length) return o;
      return { def: n, x: n.x, y: n.y, hx: n.x, hy: n.y, anim: null, t: rand(30, 120) };
    });
  },
  tile(x, y) {
    const d = this.def;
    if (x < 0 || y < 0 || y >= d.tiles.length || x >= d.tiles[0].length) return d.outside || ' ';
    const m = this.mods[x + ',' + y];
    return m !== undefined ? m : d.tiles[y][x];
  },
  npcAt(x, y) {
    return this.npcs.find(n => {
      const s = n.def.size || 1;
      return x >= n.x && x < n.x + s && y >= n.y && y < n.y + s;
    });
  },
  chestAt(x, y) { return (this.def.chests || []).find(c => c.x === x && c.y === y); },
  passable(x, y, forNpc) {
    if (!WALK.has(this.tile(x, y))) return false;
    if (this.npcAt(x, y)) return false;
    if (this.chestAt(x, y)) return false;
    if (forNpc && x === G.x && y === G.y) return false;
    return true;
  },
  update() {
    if (this.nameT > 0) this.nameT--;
    if (this.bumpCd > 0) this.bumpCd--;
    // NPC 移動
    for (const n of this.npcs) {
      if (n.anim) { n.anim.t++; if (n.anim.t >= 12) n.anim = null; continue; }
      if (!n.def.wander || Script.running || UI.busy()) continue;
      if (--n.t > 0) continue;
      n.t = rand(60, 160);
      const [dx, dy] = DIRS[pick(Object.keys(DIRS))];
      const nx = n.x + dx, ny = n.y + dy;
      if (Math.abs(nx - n.hx) > 2 || Math.abs(ny - n.hy) > 2) continue;
      n.x = -999; // 自分自身を一時的に除外
      const ok = this.passable(nx, ny, true);
      n.x = nx - dx;
      if (ok) { n.anim = { fx: n.x, fy: n.y, t: 0 }; n.x = nx; n.y = ny; }
    }
    // プレイヤー
    if (this.anim) {
      this.anim.t++;
      if (this.anim.t >= 8) { const a = this.anim; this.anim = null; if (!a.noStep) this.onStep(); }
      else return;
    }
    if (Script.running || UI.busy() || FX.fade > 0) return;
    if (Input.pressed('cancel') || Input.pressed('menu')) { Script.run(fieldMenu); return; }
    if (Input.pressed('ok')) { this.check(); return; }
    for (const dir of ['up', 'down', 'left', 'right']) {
      if (Input.isDown(dir)) { this.tryMove(dir); break; }
    }
  },
  tryMove(dir) {
    G.dir = dir;
    const [dx, dy] = DIRS[dir];
    const nx = G.x + dx, ny = G.y + dy;
    if (this.passable(nx, ny)) {
      this.anim = { fx: G.x, fy: G.y, t: 0 };
      G.x = nx; G.y = ny;
    } else if (this.bumpCd <= 0) { sfx('bump'); this.bumpCd = 14; }
  },
  async walk(dirs, speedFrames = 8) {
    for (const ch of dirs) {
      const dir = { u: 'up', d: 'down', l: 'left', r: 'right' }[ch];
      G.dir = dir;
      const [dx, dy] = DIRS[dir];
      this.anim = { fx: G.x, fy: G.y, t: 0, noStep: true };
      G.x += dx; G.y += dy;
      await wait(8);
      this.anim = null;
    }
  },
  onStep() {
    G.steps++;
    const d = this.def;
    // どく
    let poisoned = false;
    for (const c of partyAlive()) if (c.status.poison) { c.hp = Math.max(1, c.hp - 1); poisoned = true; }
    if (poisoned) { flash('#7a3a9a', 0.35); sfx('poison'); }
    // 毒沼
    if (this.tile(G.x, G.y) === 'w') {
      for (const c of partyAlive()) c.hp = Math.max(1, c.hp - 2);
      flash('#7a3a9a', 0.4); sfx('poison');
    }
    // ワープ
    const wp = (d.warps || []).find(w => w.x === G.x && w.y === G.y && (!w.cond || w.cond()));
    if (wp) { Script.run(() => warpTo(wp.to, wp.tx, wp.ty, wp.dir)); return; }
    // イベント
    const ev = (d.events || []).find(e => e.type === 'step' && e.x === G.x && e.y === G.y && (!e.cond || e.cond()));
    if (ev) { Script.run(ev.run); return; }
    // エンカウント
    const encKey = typeof d.enc === 'function' ? d.enc(G.x, G.y) : d.enc;
    if (encKey && !NO_ENC.has(this.tile(G.x, G.y)) && !G.noEnc) {
      G.enc -= 1;
      if (G.enc <= 0) {
        G.enc = rand(12, 26);
        const group = pick(ENC[encKey]);
        const bg = typeof d.battleBg === 'function' ? d.battleBg() : (d.battleBg || 'field');
        Script.run(async () => { await Battle.run(group, { bg }); });
      }
    }
  },
  check() {
    const [dx, dy] = DIRS[G.dir];
    let fx = G.x + dx, fy = G.y + dy;
    if (this.tile(fx, fy) === 'c') { fx += dx; fy += dy; }
    const npc = this.npcAt(fx, fy);
    if (npc) { Script.run(() => talkTo(npc)); return; }
    const ch = this.chestAt(fx, fy);
    if (ch) { Script.run(() => openChest(ch)); return; }
    const ev = (this.def.events || []).find(e => e.type === 'check' && e.x === G.x + dx && e.y === G.y + dy && (!e.cond || e.cond()));
    if (ev) { Script.run(ev.run); return; }
    if (this.tile(G.x + dx, G.y + dy) === 'd') Script.run(() => say('とびらには かぎが かかっている。'));
  },
  camera() {
    const d = this.def;
    let px = G.x * TS, py = G.y * TS;
    if (this.anim) {
      const k = this.anim.t / 8;
      px = (this.anim.fx + (G.x - this.anim.fx) * k) * TS;
      py = (this.anim.fy + (G.y - this.anim.fy) * k) * TS;
    }
    const mw = d.tiles[0].length * TS, mh = d.tiles.length * TS;
    let cx = px + TS / 2 - W / 2, cy = py + TS / 2 - H / 2;
    cx = mw <= W ? (mw - W) / 2 : clamp(cx, 0, mw - W);
    cy = mh <= H ? (mh - H) / 2 : clamp(cy, 0, mh - H);
    return { cx: Math.round(cx), cy: Math.round(cy), px, py };
  },
  draw() {
    const d = this.def;
    const { cx, cy, px, py } = this.camera();
    const [ox, oy] = FX.offset();
    bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H);
    const af = Math.floor(frameCount / 30) % 2;
    const x0 = Math.floor(cx / TS) - 1, y0 = Math.floor(cy / TS) - 1;
    for (let y = y0; y <= y0 + 16; y++) for (let x = x0; x <= x0 + 18; x++) {
      const t = this.tile(x, y);
      bctx.drawImage(Sprites.tile(t, af), x * TS - cx + ox, y * TS - cy + oy, TS, TS);
    }
    for (const c of d.chests || []) {
      const opened = G.chests[G.map + ':' + c.id];
      bctx.drawImage(Sprites.get(opened ? 'chest_open' : 'chest'), c.x * TS - cx + ox, c.y * TS - cy + oy, TS, TS);
    }
    const walkF = Math.floor(frameCount / 16) % 2;
    const actors = this.npcs.map(n => {
      let nx = n.x * TS, ny = n.y * TS;
      if (n.anim) { const k = n.anim.t / 12; nx = (n.anim.fx + (n.x - n.anim.fx) * k) * TS; ny = (n.anim.fy + (n.y - n.anim.fy) * k) * TS; }
      return { spr: typeof n.def.spr === 'function' ? n.def.spr() : n.def.spr, x: nx, y: ny, size: n.def.size || 1, still: n.def.still, n };
    });
    if (!G.hidePlayer) actors.push({ spr: heroSprite(), x: px, y: py, size: 1, player: true });
    actors.sort((a, b) => (a.y + a.size * TS) - (b.y + b.size * TS));
    for (const a of actors) {
      const img = Sprites.get(a.spr, a.still ? 0 : walkF);
      if (!img) continue;
      const s = a.size * TS;
      let dy = 0;
      if (a.n && a.n.def.bob) dy = Math.round(Math.sin(frameCount / 10) * 2);
      bctx.drawImage(img, Math.round(a.x - cx + ox), Math.round(a.y - cy + oy + dy), s, s);
      if (a.n && a.n.def.overlay) a.n.def.overlay(bctx, a.x - cx + ox, a.y - cy + oy, s);
    }
    if (d.tint) { const t = d.tint(); if (t) { bctx.fillStyle = t; bctx.fillRect(0, 0, W, H); } }
    if (d.overlay) d.overlay(bctx, cx, cy);
  },
  drawUI() {
    if (this.nameT > 0) {
      ctx.globalAlpha = Math.min(1, this.nameT / 30);
      setFont(18);
      const w = ctx.measureText(this.def.name).width + 48;
      drawBox(16, 16, w, 50);
      text(this.def.name, 40, 31, '#f4f2ea', 18);
      ctx.globalAlpha = 1;
    }
  },
};

async function warpTo(map, x, y, dir) {
  sfx('door');
  await fadeOut(12);
  G.x = x; G.y = y; if (dir) G.dir = dir;
  MapScene.load(map);
  Scene.set(MapScene);
  await wait(4);
  await fadeIn(12);
  if (MapScene.def.onEnter) await MapScene.def.onEnter();
}
async function teleport(map, x, y) { G.x = x; G.y = y; MapScene.load(map); Scene.set(MapScene); }

async function talkTo(npc) {
  const t = npc.def.talk;
  if (typeof t === 'function') await t(npc);
  else if (Array.isArray(t)) await say(...t);
  else if (t) await say(t);
}
async function openChest(c) {
  const key = G.map + ':' + c.id;
  if (G.chests[key]) { await say('からっぽだ。'); return; }
  G.chests[key] = true;
  sfx('chest');
  if (c.gold) { G.gold += c.gold; await say(`たからばこを あけた！\n${c.gold}円 を てにいれた！`); return; }
  if (c.item) { addItem(c.item, c.n || 1); Audio8.jingle('item'); await say(`たからばこを あけた！\n${ITEMS[c.item].name}${c.n > 1 ? '×' + c.n : ''} を てにいれた！`); return; }
  if (c.equip) {
    const e = EQUIPS[c.equip];
    Audio8.jingle('item');
    await say(`たからばこを あけた！\n${e.name} を てにいれた！`);
    await equipFound(c.equip);
  }
}
async function equipFound(eid) {
  const e = EQUIPS[eid];
  const who = member(e.who);
  if (!who) { G.gold += 50; await say(`しかし つかえる なかまが いない。\n${e.name}を 50円に かえた。`); return; }
  const cur = EQUIPS[who[e.slot]];
  const better = e.slot === 'weapon' ? (e.atk > (cur.atk || 0)) : (e.def > (cur.def || 0));
  if (better) { who[e.slot] = eid; await say(`${charName(who)}は ${e.name}を そうびした！`); }
  else await say(`いまの そうびの ほうが つよいので\nしまっておくことにした。`);
}

// ---------- フィールドメニュー ----------
function drawPartyBoxes(y = 12, x0 = 16) {
  const n = G.party.length, w = 156;
  G.party.forEach((c, i) => {
    const x = x0 + i * (w + 6);
    drawBox(x, y, w, 112);
    const col = c.hp <= 0 ? '#e05050' : (c.hp < maxHp(c) / 4 ? '#f0c040' : '#f4f2ea');
    text(charName(c), x + 16, y + 14, col, 17);
    text(`HP ${String(c.hp).padStart(4)}`, x + 16, y + 38, col, 17);
    text(`MP ${String(c.mp).padStart(4)}`, x + 16, y + 60, col, 17);
    let st = `Lv ${c.lv}`;
    if (c.hp <= 0) st += ' しに'; else if (c.status.poison) st += ' どく'; else if (c.fatigue) st += ' つかれ';
    text(st, x + 16, y + 82, col, 17);
  });
}
function drawGold(x = W - 176, y = H - 70) {
  drawBox(x, y, 160, 54);
  text(`${G.gold} 円`, x + 140, y + 17, '#f4f2ea', 18, 'right');
}
async function pickMember(opts = {}) {
  const items = G.party.map(c => ({ label: charName(c), disabled: opts.filter ? !opts.filter(c) : false }));
  const r = await choose(items, { x: opts.x ?? 200, y: opts.y ?? 140, w: 200, cancel: true, title: opts.title });
  return r < 0 ? null : G.party[r];
}

async function fieldMenu() {
  sfx('ok');
  const pw = UI.push(new InfoWin(() => drawPartyBoxes()));
  const gw = UI.push(new InfoWin(() => drawGold()));
  let idx = 0;
  for (;;) {
    const o = { x: W - 176, y: 136, w: 160, cancel: true, initial: idx, keep: true };
    idx = await choose(['どうぐ', 'わざ', 'つよさ', 'きろく', 'とじる'], o);
    if (idx < 0 || idx === 4) break;
    if (idx === 0) await menuItems();
    else if (idx === 1) await menuSkills();
    else if (idx === 2) await menuStatus();
    else if (idx === 3) await menuSave();
    UI.remove(o.win);
  }
  UI.remove(pw); UI.remove(gw);
}
async function menuItems() {
  let idx = 0;
  for (;;) {
    const list = invList();
    if (!list.length) { await say('どうぐを なにも もっていない。'); return; }
    let desc = '';
    const dw = UI.push(new InfoWin(() => { drawBox(16, H - 84, W - 200, 70); text(desc, 36, H - 60, '#f4f2ea', 16); }));
    const o = {
      x: 16, y: 136, w: 320, cancel: true, initial: idx, keep: true, maxRows: 6,
      onMove: i => { desc = ITEMS[list[i]].desc; },
    };
    idx = await choose(list.map(k => ({ label: ITEMS[k].name, right: ITEMS[k].key ? '' : '×' + G.inv[k] })), o);
    UI.remove(dw);
    if (idx < 0) return;
    const id = list[idx], it = ITEMS[id];
    if (it.key) { UI.remove(o.win); await say(`${it.name}\n${it.desc}`); continue; }
    let res = null;
    if (it.target === 'party') res = useItemOn(id, null);
    else {
      const t = await pickMember({ title: 'だれに つかう？', filter: c => (it.kind === 'revive' ? c.hp <= 0 : c.hp > 0) });
      if (!t) { UI.remove(o.win); continue; }
      res = useItemOn(id, t);
    }
    UI.remove(o.win);
    if (res) { removeItem(id); sfx('heal'); await say(`${it.name}を つかった。\n${res}`); }
    else await say('しかし こうかが なかった。');
  }
}
async function menuSkills() {
  const user = await pickMember({ title: 'だれの わざ？' });
  if (!user) return;
  const list = knownSkills(user);
  if (!list.length) { await say(`${charName(user)}は まだ わざを おぼえていない。`); return; }
  let idx = 0;
  for (;;) {
    let desc = '';
    const dw = UI.push(new InfoWin(() => { drawBox(16, H - 84, W - 200, 70); text(desc, 36, H - 60, '#f4f2ea', 16); }));
    const o = {
      x: 16, y: 136, w: 340, cancel: true, initial: idx, keep: true, maxRows: 7, title: `${charName(user)}  MP ${user.mp}`,
      onMove: i => { desc = SKILLS[list[i]].desc; },
    };
    idx = await choose(list.map(k => ({ label: SKILLS[k].name, right: String(SKILLS[k].mp), disabled: !['heal', 'cure', 'revive'].includes(SKILLS[k].kind) })), o);
    UI.remove(dw);
    if (idx < 0) return;
    const sk = SKILLS[list[idx]];
    if (user.mp < sk.mp) { UI.remove(o.win); await say('MPが たりない！'); continue; }
    if (user.hp <= 0) { UI.remove(o.win); await say(`${charName(user)}は たおれている。`); continue; }
    let msg = '';
    if (sk.target === 'party') {
      user.mp -= sk.mp;
      for (const c of partyAlive()) applyHeal(c, skillHealAmount(user, sk));
      msg = 'みんなの HPが かいふくした！';
    } else {
      const t = await pickMember({ title: 'だれに？', filter: c => (sk.kind === 'revive' ? c.hp <= 0 : c.hp > 0) });
      if (!t) { UI.remove(o.win); continue; }
      user.mp -= sk.mp;
      if (sk.kind === 'heal') msg = `${charName(t)}の HPが ${applyHeal(t, skillHealAmount(user, sk))} かいふくした！`;
      if (sk.kind === 'cure') { t.status = {}; applyHeal(t, 20); msg = `${charName(t)}の からだが かるくなった！`; }
      if (sk.kind === 'revive') { t.hp = Math.floor(maxHp(t) / 2); t.status = {}; msg = `${charName(t)}は いきかえった！`; }
    }
    UI.remove(o.win);
    sfx('heal');
    await say(`${charName(user)}は ${sk.name}を つかった！\n${msg}`);
  }
}
async function menuStatus() {
  const c = await pickMember({ title: 'だれの つよさ？' });
  if (!c) return;
  const next = c.lv < MAX_LV ? expForLevel(c.lv + 1) - c.exp : 0;
  const win = UI.push(new InfoWin(() => {
    const x = 40, y = 40;
    drawBox(x, y, W - 80, 340);
    const img = Sprites.get(CHARS[c.id].sprite === 'hero' && c.id === 'hero' ? heroSprite() : CHARS[c.id].sprite);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x + 28, y + 28, 64, 64);
    text(charName(c), x + 110, y + 30, '#f4f2ea', 22);
    text(CHARS[c.id].title, x + 110, y + 62, '#c8c0a0', 16);
    const rows = [
      ['レベル', c.lv], ['HP', `${c.hp} / ${maxHp(c)}`], ['MP', `${c.mp} / ${maxMp(c)}`],
      ['こうげき', stat(c, 'atk')], ['しゅび', stat(c, 'def')], ['すばやさ', stat(c, 'agi')], ['かしこさ', stat(c, 'int')],
      ['つぎのLvまで', next],
    ];
    rows.forEach(([k, v], i) => {
      text(k, x + 30, y + 110 + i * 26, '#c8c0a0', 17);
      text(String(v), x + 230, y + 110 + i * 26, '#f4f2ea', 17, 'right');
    });
    text('ぶき', x + 260, y + 110, '#c8c0a0', 16);
    text(EQUIPS[c.weapon].name, x + 260, y + 132, '#f4f2ea', 17);
    text('よろい', x + 260, y + 166, '#c8c0a0', 16);
    text(EQUIPS[c.armor].name, x + 260, y + 188, '#f4f2ea', 17);
    if (c.fatigue) { text('じょうたい', x + 260, y + 222, '#c8c0a0', 16); text('しごとの つかれ', x + 260, y + 244, '#f0a070', 17); text('(こうげき・しゅび・すばやさ↓)', x + 260, y + 268, '#f0a070', 12); }
  }));
  win.inactive = false; win.modal = true;
  await new Promise(res => { win.update = () => { if (Input.pressed('ok') || Input.pressed('cancel')) { sfx('cancel'); res(); } }; });
  UI.remove(win);
}
const SAVE_KEY = 'tsurupika_rpg_save_v1';
function serialize() { return JSON.stringify(G); }
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, serialize()); return true; } catch (e) { return false; }
}
function loadSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
async function menuSave() {
  if (G.noSave) { await say('いまは きろく できない。'); return; }
  if (saveGame()) { Audio8.jingle('item'); await say('ぼうけんのしょに きろくしました。'); }
  else await say('このブラウザでは きろくが できないようだ。\n（ストレージが むこうに なっています）');
}

// ---------- 店・宿屋 ----------
async function shop(stock, greet = 'いらっしゃい！ なにを おもとめで？') {
  await say(greet);
  const gw = UI.push(new InfoWin(() => drawGold(W - 176, 16)));
  for (;;) {
    const r = await choose(['かう', 'うる', 'やめる'], { x: W - 176, y: 80, w: 160, cancel: true });
    if (r === 0) await shopBuy(stock);
    else if (r === 1) await shopSell();
    else break;
  }
  UI.remove(gw);
  await say('まいど ありがとうございました！');
}
async function shopBuy(stock) {
  let idx = 0;
  for (;;) {
    const list = stock.filter(k => ITEMS[k] || (EQUIPS[k] && partyHas(EQUIPS[k].who)));
    let desc = '';
    const dw = UI.push(new InfoWin(() => { drawBox(16, H - 104, W - 32, 90); wrapText(desc, W - 80, 16).forEach((l, i) => text(l, 36, H - 84 + i * 24, '#f4f2ea', 16)); }));
    const o = {
      x: 16, y: 16, w: 330, cancel: true, initial: idx, maxRows: 8, title: 'しなもの',
      onMove: i => {
        const k = list[i];
        if (ITEMS[k]) { desc = `${ITEMS[k].desc}（もっている数: ${G.inv[k] || 0}）`; return; }
        const e = EQUIPS[k], who = member(e.who), cur = EQUIPS[who[e.slot]];
        desc = e.slot === 'weapon'
          ? `${charName(who)}の ぶき　こうげき+${e.atk}（いま: ${cur.name} +${cur.atk || 0}）`
          : `${charName(who)}の よろい　しゅび+${e.def}（いま: ${cur.name} +${cur.def || 0}）`;
      },
    };
    idx = await choose(list.map(k => {
      const d = ITEMS[k] || EQUIPS[k];
      const owned = EQUIPS[k] && member(EQUIPS[k].who)[EQUIPS[k].slot] === k;
      return { label: d.name, right: owned ? 'そうび中' : d.price + '円', disabled: owned };
    }), o);
    UI.remove(dw);
    if (idx < 0) return;
    const k = list[idx];
    const price = (ITEMS[k] || EQUIPS[k]).price;
    if (G.gold < price) { await say('おかねが たりないようですね。'); continue; }
    if (ITEMS[k]) {
      if ((G.inv[k] || 0) >= 99) { await say('それいじょう もてません。'); continue; }
      G.gold -= price; addItem(k); sfx('chest');
      await say(`${ITEMS[k].name}を かった！`);
    } else {
      const e = EQUIPS[k], who = member(e.who), old = EQUIPS[who[e.slot]];
      G.gold -= price; who[e.slot] = k; sfx('chest');
      let m = `${charName(who)}は ${e.name}を そうびした！`;
      if (old.price) { const back = Math.floor(old.price / 2); G.gold += back; m += `\nふるい ${old.name}は ${back}円で ひきとった。`; }
      await say(m);
    }
  }
}
async function shopSell() {
  let idx = 0;
  for (;;) {
    const list = invList().filter(k => !ITEMS[k].key);
    if (!list.length) { await say('うれる ものが ないようですね。'); return; }
    const o = { x: 16, y: 16, w: 360, cancel: true, initial: idx, maxRows: 8, title: 'うる（はんがく）' };
    idx = await choose(list.map(k => ({ label: `${ITEMS[k].name} ×${G.inv[k]}`, right: Math.floor(ITEMS[k].price / 2) + '円' })), o);
    if (idx < 0) return;
    const k = list[idx];
    G.gold += Math.floor(ITEMS[k].price / 2); removeItem(k); sfx('chest');
    idx = Math.min(idx, invList().filter(j => !ITEMS[j].key).length - 1);
  }
}
async function inn(price, name = 'やどや') {
  const r = await ask(`${name}へ ようこそ。\nひとばん ${price}円ですが おとまりに なりますか？`);
  if (r !== 0) { await say('またの おこしを。'); return; }
  if (G.gold < price) { await say('おや、おかねが たりないようですね。'); return; }
  G.gold -= price;
  await rest();
  G.lastInn = { map: G.map, x: G.x, y: G.y };
  await say('おはようございます。\nいってらっしゃいませ。');
}
async function rest() {
  await fadeOut(30);
  healParty();
  await Audio8.jingle('inn');
  await fadeIn(30);
}

// ---------- シーン管理 ----------
const Scene = {
  cur: null,
  set(s) { this.cur = s; },
};
