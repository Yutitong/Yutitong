// ===== タイトル・エンディング・メインループ =====

function newState() {
  const hero = makeChar('hero', 1);
  hero.fatigue = true;
  hero.armor = 'shigotogi';
  return {
    map: 'shop_in', x: 5, y: 4, dir: 'down', flags: {}, party: [hero], inv: {}, gold: 0, chests: {},
    steps: 0, enc: 16, lastInn: { map: 'shop_in', x: 9, y: 5 }, playFrames: 0, noSave: false,
  };
}
function normalizeState(s) {
  const d = newState();
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.noSave = false;
  return s;
}

async function startNew() {
  await fadeOut(30);
  G = newState();
  MapScene.load('shop_in');
  Scene.set(MapScene);
  await Story.opening();
}
async function startContinue(save) {
  await fadeOut(30);
  G = normalizeState(save);
  MapScene.load(G.map);
  Scene.set(MapScene);
  await wait(10);
  await fadeIn(30);
}

// ---------- タイトル ----------
const TitleScene = {
  state: 'press', t: 0,
  update() {
    this.t++;
    if (this.state === 'press' && (Input.pressed('ok') || Input.pressed('menu'))) {
      Audio8.unlock();
      Audio8.bgm('title');
      sfx('ok');
      this.state = 'menu';
      Script.run(titleMenu);
    }
  },
  draw() {
    const g = bctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e0a24'); g.addColorStop(0.6, '#2a1e4a'); g.addColorStop(1, '#4a2e3a');
    bctx.fillStyle = g; bctx.fillRect(0, 0, W, H);
    bctx.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      if ((i + Math.floor(this.t / 20)) % 7 === 0) continue;
      bctx.fillRect((i * 131) % W, (i * 71) % 230, 2, 2);
    }
    // 巨人のシルエット
    bctx.globalAlpha = 0.55;
    bctx.drawImage(Sprites.get('matanini'), 300, 70, 208, 208);
    bctx.globalAlpha = 1;
    // ゆけむり
    for (let i = 0; i < 7; i++) {
      const x = ((i * 97 + this.t * 0.4) % (W + 160)) - 80;
      bctx.fillStyle = 'rgba(255,255,255,0.10)';
      bctx.beginPath(); bctx.ellipse(x, 300 + Math.sin(this.t / 50 + i) * 10 + (i % 3) * 18, 90, 22, 0, 0, Math.PI * 2); bctx.fill();
    }
    // 地面と主人公
    bctx.fillStyle = '#2a2436'; bctx.fillRect(0, 330, W, H - 330);
    bctx.drawImage(Sprites.get('hero', Math.floor(this.t / 20) % 2), 96, 234, 96, 96);
    bctx.drawImage(Sprites.get('cart'), 186, 266, 64, 64);
  },
  drawUI() {
    ctx.save();
    setFont(40);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a2a1a'; ctx.fillText('ツルピカ丸の大冒険', W / 2 + 3, 46 + 3);
    ctx.fillStyle = '#f8d878'; ctx.fillText('ツルピカ丸の大冒険', W / 2, 46);
    ctx.restore();
    text('〜 なみだの きょじん きょうだい 〜', W / 2, 104, '#e8e0f0', 18, 'center');
    if (this.state === 'press' && Math.floor(this.t / 30) % 2 === 0)
      text('PRESS START（Z / Enter / タップ）', W / 2, 372, '#f4f2ea', 18, 'center');
  },
};
async function titleMenu() {
  const save = loadSave();
  const r = await choose([{ label: 'はじめから' }, { label: 'つづきから', disabled: !save }], { x: W / 2 - 110, y: 350, w: 220, cancel: false, initial: save ? 1 : 0 });
  if (r === 0) await startNew();
  else await startContinue(save);
}

// ---------- エンディング ----------
const EndScene = {
  t: 0,
  update() {
    this.t++;
    if (this.t > 120 && Input.pressed('ok')) {
      this.t = 0;
      Script.run(async () => {
        await fadeOut(40);
        G = null;
        TitleScene.state = 'press';
        Scene.set(TitleScene);
        Audio8.bgm(null);
        await fadeIn(30);
      });
    }
  },
  draw() {
    bctx.fillStyle = '#0a0818'; bctx.fillRect(0, 0, W, H);
    bctx.fillStyle = '#fff';
    for (let i = 0; i < 50; i++) bctx.fillRect((i * 131 + Math.floor(this.t / 4)) % W, (i * 71) % H, 2, 2);
    bctx.drawImage(Sprites.get('matanini'), 40, 250, 120, 120);
    bctx.drawImage(Sprites.get('wakinini'), 352, 250, 120, 120);
    bctx.drawImage(Sprites.get('hero', Math.floor(this.t / 20) % 2), 196, 306, 64, 64);
    if (G && partyHas('kinu')) bctx.drawImage(Sprites.get('kinu', Math.floor(this.t / 20) % 2), 252, 306, 64, 64);
    if (G && partyHas('rakki')) bctx.drawImage(Sprites.get('rakki'), 150, 318, 48, 48);
  },
  drawUI() {
    text('ツルピカ丸の大冒険', W / 2, 60, '#f8d878', 30, 'center');
    text('— おわり —', W / 2, 108, '#f4f2ea', 22, 'center');
    if (G) {
      const sec = Math.floor(G.playFrames / 60);
      const hm = `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;
      text(`ツルピカ丸 レベル ${G.party[0].lv}　　プレイじかん ${hm}`, W / 2, 162, '#c8c0a0', 17, 'center');
    }
    text('あそんでくれて ありがとう！', W / 2, 206, '#f4f2ea', 20, 'center');
    if (this.t > 120 && Math.floor(this.t / 30) % 2 === 0) text('Z / Enter で タイトルへ', W / 2, 400, '#a8a4b8', 16, 'center');
  },
};

// ---------- メインループ ----------
const STEP = 1000 / 60;
let lastT = performance.now(), acc = 0;
function step() {
  frameCount++;
  if (G) G.playFrames++;
  updateWaiters();
  FX.update();
  UI.update();
  if (Scene.cur) Scene.cur.update();
  Input.tick();
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (Scene.cur) Scene.cur.draw();
  if (F.rain && Scene.cur === MapScene) {
    bctx.strokeStyle = 'rgba(160,200,255,0.6)'; bctx.lineWidth = 2;
    bctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const x = (i * 53 + frameCount * 3) % W, y = (i * 97 + frameCount * 9) % H;
      bctx.moveTo(x, y); bctx.lineTo(x - 4, y + 14);
    }
    bctx.stroke();
  }
  ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (Scene.cur && Scene.cur.drawUI) Scene.cur.drawUI();
  if (FX.flash > 0) { ctx.globalAlpha = FX.flash; ctx.fillStyle = FX.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (FX.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${FX.fade})`; ctx.fillRect(0, 0, W, H); }
  UI.draw();
}
function loop(now) {
  acc += Math.min(100, now - lastT);
  lastT = now;
  while (acc >= STEP) { step(); acc -= STEP; }
  render();
  requestAnimationFrame(loop);
}

// ---------- 画面サイズ・音・タッチ ----------
function toggleMute() {
  Audio8.setMuted(!Audio8.muted);
  document.getElementById('mute').textContent = Audio8.muted ? '♪ 音 OFF' : '♪ 音 ON';
  try { localStorage.setItem('tsurupika_muted', Audio8.muted ? '1' : '0'); } catch (e) {}
}
function setupControls() {
  document.getElementById('mute').addEventListener('click', e => { Audio8.unlock(); toggleMute(); e.currentTarget.blur(); });
  try { if (localStorage.getItem('tsurupika_muted') === '1') toggleMute(); } catch (e) {}
  for (const b of document.querySelectorAll('[data-k]')) {
    const k = b.dataset.k;
    const on = e => { e.preventDefault(); Audio8.unlock(); b.classList.add('on'); Input.press(k); try { b.setPointerCapture(e.pointerId); } catch (_) {} };
    const off = e => { e.preventDefault(); b.classList.remove('on'); Input.release(k); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('lostpointercapture', off);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  canvas.addEventListener('pointerdown', () => {
    Audio8.unlock();
    if (Scene.cur === TitleScene && TitleScene.state === 'press') { Input.press('ok'); setTimeout(() => Input.release('ok'), 50); }
    if (Scene.cur === EndScene) { Input.press('ok'); setTimeout(() => Input.release('ok'), 50); }
  });
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(canvas);
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

// ---------- 起動 ----------
function boot(data) {
  setupControls();
  if (data && data.save) {
    try {
      G = normalizeState(JSON.parse(data.save));
      MapScene.load(G.map);
      Scene.set(MapScene);
    } catch (e) { G = null; Scene.set(TitleScene); }
  } else Scene.set(TitleScene);
  requestAnimationFrame(t => { lastT = t; requestAnimationFrame(loop); });
}
window.claude?.hot?.snapshot?.(() => (G && Scene.cur === MapScene && !Script.running ? { save: serialize() } : {}));
const fontReady = document.fonts && document.fonts.load
  ? Promise.race([document.fonts.load(`20px ${FONT}`), new Promise(r => setTimeout(r, 2500))]).catch(() => {})
  : Promise.resolve();
fontReady.then(() => {
  if (window.claude?.hot?.ready) window.claude.hot.ready(boot);
  else boot(window.claude?.hot?.data ?? {});
});

// テスト・デバッグ用
window.TSRPG = { get G() { return G; }, MapScene, Battle, Story, Scene, UI, Script, startNew };
