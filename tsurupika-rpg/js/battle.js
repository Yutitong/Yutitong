// ===== バトル：ターン制コマンドバトル =====
const Battle = (() => {
  let enemies = [], party = [], lines = [], bg = 'field', opts = {};
  let waitT = 0, waitRes = null, cursorEnemy = -1, turn = 0, escaped = false;

  // ---- バトラー共通アクセサ ----
  const hp = b => (b.isParty ? b.c.hp : b.hp);
  const setHp = (b, v) => { if (b.isParty) b.c.hp = v; else b.hp = v; };
  const maxH = b => (b.isParty ? maxHp(b.c) : b.maxHp);
  const alive = b => hp(b) > 0 && !b.gone;
  const st = b => (b.isParty ? b.c.status : b.status);
  const atk = b => (b.isParty ? stat(b.c, 'atk') : b.atk) * (b.buffs.atk ? 1.5 : 1);
  const def = b => (b.isParty ? stat(b.c, 'def') : b.def) * (b.buffs.def ? 1.5 : 1) * (b.buffs.defDown ? 0.6 : 1);
  const agi = b => (b.isParty ? stat(b.c, 'agi') : b.agi) * (b.buffs.agi ? 1.5 : 1);
  const int = b => (b.isParty ? stat(b.c, 'int') : (b.int || 0));
  const nm = b => b.name;
  const liveEnemies = () => enemies.filter(alive);
  const liveParty = () => party.filter(alive);

  // ---- メッセージ ----
  function log(s) {
    for (const l of wrapText(s, W - 76, 18)) lines.push(l);
    while (lines.length > 4) lines.shift();
  }
  function pause(frames = 40) { return new Promise(r => { waitT = frames; waitRes = r; }); }
  async function bsay(s, frames = 40) { log(s); await pause(frames); }
  function clear() { lines = []; }

  // ---- 敵の生成 ----
  function makeEnemies(group) {
    const counts = {}, seen = {};
    group.forEach(k => (counts[k] = (counts[k] || 0) + 1));
    return group.map(k => {
      const d = ENEMIES[k];
      seen[k] = (seen[k] || 0) + 1;
      const suffix = counts[k] > 1 ? 'ABCD'[seen[k] - 1] : '';
      return {
        isEnemy: true, key: k, d, name: d.name + suffix, hp: d.hp, maxHp: d.hp, atk: d.atk, def: d.def, agi: d.agi, int: d.int || 0,
        status: {}, buffs: {}, flash: 0, alpha: 1, scale: d.scale || 4, scriptI: 0, gone: false,
      };
    });
  }
  function layout() {
    const total = enemies.reduce((s, e) => s + 16 * e.scale, 0) + (enemies.length - 1) * 16;
    let x = W / 2 - total / 2;
    for (const e of enemies) { e.w = 16 * e.scale; e.x = x; e.y = 300 - e.w; x += e.w + 16; }
  }

  // ---- 描画 ----
  const BG = {
    field: ['#7ab8f0', '#cfe8f8', '#4fa63f', '#3f8e33'],
    mountain: ['#8aa0c0', '#d8d0c0', '#7a6a5a', '#5a4a3a'],
    hill: ['#90c8f0', '#e8f0d0', '#6cb84a', '#5aa23c'],
    sento: ['#b8d8e8', '#e8f4f8', '#dce8ee', '#a8c0cc'],
    night: ['#14183a', '#3a3a6a', '#2a4a3a', '#1a3a2a'],
    worldend: ['#0a0818', '#2a2050', '#3a3448', '#2a2436'],
    cave: ['#1a1428', '#3a3050', '#4a4458', '#3a3448'],
    swamp: ['#5a4a7a', '#a890b8', '#5a3a6a', '#4a2a5a'],
    castle: ['#1a1028', '#3a2048', '#4a3a5a', '#3a2a4a'],
  };
  function drawScene() {
    const [ox, oy] = FX.offset();
    bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H);
    const c = BG[bg] || BG.field;
    const x0 = 16 + ox, y0 = 132 + oy, w = W - 32, h = 176;
    const g = bctx.createLinearGradient(0, y0, 0, y0 + h * 0.62);
    g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    bctx.fillStyle = g; bctx.fillRect(x0, y0, w, h * 0.62);
    bctx.fillStyle = c[2]; bctx.fillRect(x0, y0 + h * 0.62, w, h * 0.38);
    bctx.fillStyle = c[3];
    for (let i = 0; i < 12; i++) bctx.fillRect(x0 + ((i * 53) % w), y0 + h * 0.66 + ((i * 17) % 50), 18, 3);
    if (bg === 'worldend' || bg === 'night') {
      bctx.fillStyle = '#fff';
      for (let i = 0; i < 24; i++) bctx.fillRect(x0 + ((i * 97) % w), y0 + ((i * 41) % (h * 0.55)), 2, 2);
    }
    for (const e of enemies) {
      if (e.alpha <= 0) continue;
      if (e.flash > 0 && Math.floor(e.flash / 3) % 2 === 0) continue;
      const img = Sprites.enemy(e.d.shape, e.d.pal, e.d.boss && Math.floor(frameCount / 30) % 2 ? 1 : 0);
      bctx.globalAlpha = e.alpha;
      const bob = e.status.sleep ? 0 : Math.round(Math.sin(frameCount / 14 + e.x) * 2);
      bctx.drawImage(img, Math.round(e.x + ox), Math.round(e.y + oy + bob), e.w, e.w);
      bctx.globalAlpha = 1;
    }
  }
  function drawUI() {
    drawPartyBoxes(12);
    drawBox(16, H - 124, W - 32, 112);
    lines.forEach((l, i) => text(l, 38, H - 106 + i * 23, '#f4f2ea', 18));
    if (cursorEnemy >= 0 && enemies[cursorEnemy]) {
      const e = enemies[cursorEnemy];
      if (Math.floor(frameCount / 10) % 2 === 0) text('▼', e.x + e.w / 2 - 9, Math.max(130, e.y - 24), '#f8e060', 20);
      setFont(16);
      text(e.name, W / 2, 140, '#f8e060', 16, 'center');
    }
  }

  const BattleScene = {
    update() {
      for (const e of enemies) {
        if (e.flash > 0) e.flash--;
        if ((e.hp <= 0 || e.gone) && e.alpha > 0) e.alpha = Math.max(0, e.alpha - 0.06);
      }
      if (waitRes) {
        waitT--;
        if (waitT <= 0 || (Input.pressed('ok') && waitT < 30)) { const r = waitRes; waitRes = null; r(); }
      }
    },
    draw: drawScene,
    drawUI,
  };

  // ---- 目標選択 ----
  function pickEnemy() {
    return new Promise(res => {
      const live = () => enemies.map((e, i) => i).filter(i => alive(enemies[i]));
      let li = live();
      cursorEnemy = li[0];
      const win = {
        draw() {},
        update() {
          li = live();
          let k = li.indexOf(cursorEnemy);
          if (Input.repeat('left') || Input.repeat('up')) { k = (k - 1 + li.length) % li.length; cursorEnemy = li[k]; sfx('cursor'); }
          else if (Input.repeat('right') || Input.repeat('down')) { k = (k + 1) % li.length; cursorEnemy = li[k]; sfx('cursor'); }
          else if (Input.pressed('ok')) { sfx('ok'); UI.remove(win); const r = cursorEnemy; cursorEnemy = -1; res(enemies[r]); }
          else if (Input.pressed('cancel')) { sfx('cancel'); UI.remove(win); cursorEnemy = -1; res(null); }
        },
      };
      UI.push(win);
    });
  }
  async function pickAlly(filter) {
    const items = party.map(b => ({ label: nm(b), disabled: !filter(b) }));
    const r = await choose(items, { x: 280, y: 132, w: 200, cancel: true, title: 'だれに？' });
    return r < 0 ? null : party[r];
  }

  // ---- コマンド入力 ----
  async function inputCommands() {
    const acts = [];
    const members = party.filter(b => alive(b) && !st(b).sleep);
    let i = 0;
    while (i < members.length) {
      const b = members[i];
      clear();
      const cmdItems = ['たたかう', 'わざ', 'どうぐ', 'ぼうぎょ', i === 0 ? 'にげる' : { label: 'にげる', disabled: true }];
      const cw = { x: 16, y: H - 152, w: 260, cols: 2, rowH: 28, size: 18, cancel: i > 0, title: nm(b), keep: true };
      const c = await choose(cmdItems, cw);
      if (c < 0) { i--; acts.pop(); continue; }
      let act = null;
      if (c === 0) {
        const t = await pickEnemy();
        if (t) act = { actor: b, type: 'attack', target: t };
      } else if (c === 1) {
        const list = knownSkills(b.c);
        if (!list.length) { UI.remove(cw.win); await bsay(`${nm(b)}は まだ わざを おぼえていない。`, 30); continue; }
        const sw = { x: 196, y: H - 12 - Math.min(5, list.length) * 30 - 56, w: 300, cancel: true, maxRows: 5, rowH: 30, size: 18, title: `MP ${b.c.mp}`, keep: true };
        const s = await choose(list.map(k => ({ label: SKILLS[k].name, right: String(SKILLS[k].mp), disabled: SKILLS[k].mp > b.c.mp })), sw);
        if (s >= 0) {
          const sk = SKILLS[list[s]];
          let target = null, ok = true;
          if (sk.target === 'enemy') { target = await pickEnemy(); ok = !!target; }
          else if (sk.target === 'ally') { target = await pickAlly(x => alive(x)); ok = !!target; }
          else if (sk.target === 'deadAlly') { target = await pickAlly(x => !alive(x)); ok = !!target; }
          if (ok) act = { actor: b, type: 'skill', skill: list[s], target };
        }
        UI.remove(sw.win);
      } else if (c === 2) {
        const list = invList().filter(k => !ITEMS[k].key);
        if (!list.length) { UI.remove(cw.win); await bsay('どうぐを なにも もっていない。', 30); continue; }
        const iw = { x: 196, y: H - 12 - Math.min(5, list.length) * 30 - 56, w: 300, cancel: true, maxRows: 5, rowH: 30, size: 18, title: 'どうぐ', keep: true };
        const s = await choose(list.map(k => ({ label: ITEMS[k].name, right: '×' + G.inv[k] })), iw);
        if (s >= 0) {
          const it = ITEMS[list[s]];
          let target = null, ok = true;
          if (it.target === 'ally') { target = await pickAlly(x => alive(x)); ok = !!target; }
          else if (it.target === 'deadAlly') { target = await pickAlly(x => !alive(x)); ok = !!target; }
          if (ok) act = { actor: b, type: 'item', item: list[s], target };
        }
        UI.remove(iw.win);
      } else if (c === 3) act = { actor: b, type: 'defend' };
      else if (c === 4) { UI.remove(cw.win); return [{ actor: b, type: 'flee' }]; }
      UI.remove(cw.win);
      if (act) { acts.push(act); i++; }
    }
    // ねむっている仲間も 目覚め判定のために行動順に入れる
    for (const b of party) if (alive(b) && st(b).sleep) acts.push({ actor: b, type: 'sleep' });
    return acts;
  }

  // ---- ダメージ ----
  function physDamage(a, t, mult = 1) {
    const crit = Math.random() < (a.isParty ? 1 / 24 : 1 / 48);
    let dmg;
    if (crit) dmg = atk(a) * mult * (0.95 + Math.random() * 0.1);
    else {
      dmg = (atk(a) * mult - def(t) / 2) * (0.85 + Math.random() * 0.3);
      if (dmg < 1) dmg = Math.random() < 0.5 ? 0 : 1;
    }
    if (t.defending) dmg /= 2;
    return { dmg: Math.floor(dmg), crit };
  }
  function missed(a, t) {
    if (st(a).blind && Math.random() < 0.5) return true;
    if (t.isEnemy && t.d.evade) return Math.random() < t.d.evade;
    const ev = clamp((agi(t) - agi(a)) / 300, 0, 0.1) + 0.02;
    return Math.random() < ev;
  }
  async function hit(t, dmg, crit) {
    if (t.isEnemy) { t.flash = 18; sfx(crit ? 'crit' : 'hit'); }
    else { shake(12, crit ? 8 : 4); sfx('hurt'); }
    setHp(t, Math.max(0, hp(t) - dmg));
    if (t.isEnemy) await bsay(`${nm(t)}に ${dmg}の ダメージ！`, 30);
    else await bsay(`${nm(t)}は ${dmg}の ダメージを うけた！`, 30);
    if (st(t).sleep && dmg > 0 && Math.random() < 0.5) { delete st(t).sleep; await bsay(`${nm(t)}は めを さました！`, 24); }
    await checkDeath(t);
  }
  async function checkDeath(t) {
    if (hp(t) > 0) return;
    if (t.isEnemy) { sfx('die'); await bsay(`${nm(t)}を たおした！`, 30); }
    else { t.c.status = {}; t.buffs = {}; sfx('die'); await bsay(`${nm(t)}は たおれてしまった…`, 36); }
  }
  async function physAttack(a, t, mult = 1) {
    if (!alive(t)) return;
    if (missed(a, t)) { sfx('miss'); await bsay(t.isEnemy ? `${nm(t)}は ひらりと みをかわした！` : `${nm(t)}は すばやく みをかわした！`, 30); return; }
    const { dmg, crit } = physDamage(a, t, mult);
    if (crit) await bsay(a.isParty ? 'かいしんの いちげき！' : 'つうこんの いちげき！', 24);
    if (dmg === 0) { sfx('miss'); await bsay(`ミス！ ${nm(t)}に ダメージを あたえられない！`, 30); return; }
    await hit(t, dmg, crit);
  }
  async function magicHit(t, dmg) {
    if (!alive(t)) return;
    if (t.defending) dmg = Math.floor(dmg / 2);
    if (!t.isEnemy && t.buffs.def) dmg = Math.floor(dmg * 0.8);
    await hit(t, Math.max(1, Math.floor(dmg)), false);
  }
  async function inflict(t, status, rate) {
    if (!alive(t)) return;
    if (t.isEnemy && t.d.boss) rate *= 0.25;
    if (st(t)[status] || Math.random() > rate) { await bsay(`${nm(t)}には きかなかった！`, 26); return; }
    st(t)[status] = status === 'sleep' ? rand(1, 3) : true;
    const m = { sleep: 'ねむってしまった！', blind: 'めが くらんだ！', poison: 'どくに おかされた！' }[status];
    if (status === 'poison') sfx('poison');
    await bsay(`${nm(t)}は ${m}`, 30);
  }

  // ---- 行動の実行 ----
  async function doAction(act) {
    const a = act.actor;
    if (!alive(a)) return;
    if (st(a).sleep) {
      if (st(a).sleep-- <= 1 && Math.random() < 0.6) { delete st(a).sleep; await bsay(`${nm(a)}は めを さました！`, 30); }
      else await bsay(`${nm(a)}は ねむっている。`, 30);
      return;
    }
    clear();
    if (a.isEnemy) return enemyAct(a, act);
    const retarget = t => (t && alive(t) ? t : pick(liveEnemies()));
    switch (act.type) {
      case 'attack': {
        const t = retarget(act.target);
        if (!t) return;
        await bsay(`${nm(a)}の こうげき！`, 20);
        await physAttack(a, t);
        break;
      }
      case 'defend': await bsay(`${nm(a)}は みを まもっている。`, 30); break;
      case 'item': {
        const it = ITEMS[act.item];
        if (!G.inv[act.item]) { await bsay(`しかし ${it.name}は もう なかった！`, 30); break; }
        removeItem(act.item);
        await bsay(`${nm(a)}は ${it.name}を つかった！`, 24);
        const res = useItemOn(act.item, act.target ? act.target.c : null);
        if (res) { sfx('heal'); await bsay(res, 36); } else await bsay('しかし こうかが なかった。', 30);
        break;
      }
      case 'skill': await useSkill(a, act); break;
    }
  }
  async function useSkill(a, act) {
    const sk = SKILLS[act.skill];
    if (a.c.mp < sk.mp) { await bsay(`${nm(a)}は ${sk.name}を つかおうとした！\nしかし MPが たりない！`, 36); return; }
    a.c.mp -= sk.mp;
    await bsay(sk.msg.replace('{u}', nm(a)), 26);
    const targets = sk.target === 'enemies' ? liveEnemies() : [];
    switch (sk.kind) {
      case 'phys':
        if (sk.power === 'lucky') {
          const t = act.target && alive(act.target) ? act.target : pick(liveEnemies());
          const m = pick([0, 0.5, 1, 1, 1.5, 2, 3]);
          if (m === 0) { sfx('miss'); await bsay('しかし パンチは からぶりした！', 30); return; }
          if (m >= 2) await bsay('ラッキー！ いいところに はいった！', 24);
          await physAttack(a, t, m);
        } else if (sk.target === 'enemies') { sfx('hit'); for (const t of targets) await physAttack(a, t, sk.power); }
        else await physAttack(a, act.target && alive(act.target) ? act.target : pick(liveEnemies()), sk.power);
        break;
      case 'magic': {
        sfx('magic');
        const ts = sk.target === 'enemies' ? targets : [act.target && alive(act.target) ? act.target : pick(liveEnemies())];
        for (const t of ts) await magicHit(t, (sk.power + int(a) * sk.scale) * (0.9 + Math.random() * 0.2));
        break;
      }
      case 'status': {
        if (act.skill === 'flash') { flash('#ffffff', 0.9); sfx('flash'); } else sfx('magic');
        for (const t of targets) await inflict(t, sk.status, sk.rate);
        break;
      }
      case 'buff': {
        const ts = sk.target === 'self' ? [a] : liveParty();
        sfx('heal');
        for (const t of ts) { t.buffs[sk.buff] = true; await bsay(`${nm(t)}の ${sk.buff === 'atk' ? 'こうげき' : 'しゅび'}りょくが あがった！`, 24); }
        break;
      }
      case 'heal': {
        sfx('heal');
        const ts = sk.target === 'party' ? liveParty() : [act.target];
        for (const t of ts) if (alive(t)) await bsay(`${nm(t)}の HPが ${applyHeal(t.c, skillHealAmount(a.c, sk))} かいふくした！`, 24);
        break;
      }
      case 'cure': {
        const t = act.target;
        if (!alive(t)) break;
        sfx('heal'); t.c.status = {}; applyHeal(t.c, 20);
        await bsay(`${nm(t)}の からだが かるくなった！`, 30);
        break;
      }
      case 'revive': {
        const t = act.target;
        if (alive(t)) { await bsay('しかし なにも おこらなかった。', 30); break; }
        sfx('heal'); t.c.hp = Math.floor(maxHp(t.c) / 2); t.c.status = {};
        await bsay(`${nm(t)}は いきかえった！`, 36);
        break;
      }
      case 'roar': {
        sfx('heal'); shake(20, 5);
        for (const t of liveParty()) { t.buffs.atk = true; t.buffs.def = true; applyHeal(t.c, Math.floor(maxHp(t.c) * 0.3)); }
        await bsay('みんなの こころが ひとつになった！\nこうげきと しゅびが あがった！', 40);
        break;
      }
      case 'odori': {
        const r = rand(0, 4);
        if (r === 0) { sfx('heal'); for (const t of liveParty()) applyHeal(t.c, rand(30, 50) + int(a)); await bsay('しあわせな きもちに なった！\nみんなの HPが かいふくした！', 36); }
        else if (r === 1) { sfx('magic'); for (const t of liveEnemies()) await inflict(t, 'sleep', 0.5); }
        else if (r === 2) { sfx('magic'); await bsay('ほしが ふりそそいだ！', 20); for (const t of liveEnemies()) await magicHit(t, 30 + int(a) * 1.2); }
        else if (r === 3) { sfx('magic'); for (const t of liveEnemies()) t.buffs.defDown = true; await bsay('てきの しゅびりょくが さがった！', 36); }
        else await bsay('…しかし なにも おこらなかった。', 30);
        break;
      }
      case 'lucky7': {
        for (let i = 0; i < 7; i++) { const t = pick(liveEnemies()); if (!t) break; await physAttack(a, t, 0.6); }
        break;
      }
    }
  }
  async function enemyAct(e, act) {
    const targets = liveParty();
    if (!targets.length) return;
    // 狙われやすさ：先頭ほど狙われやすい
    const pickTarget = () => { const r = Math.random(); const t = targets[r < 0.45 ? 0 : (r < 0.75 ? 1 : 2)] || pick(targets); return alive(t) ? t : pick(targets); };
    const name = act.skill;
    if (name === 'attack') { await bsay(`${nm(e)}の こうげき！`, 20); await physAttack(e, pickTarget()); return; }
    const s = ESKILLS[name];
    await bsay(s.msg.replace('{u}', nm(e)), 30);
    switch (s.kind) {
      case 'phys': {
        const t = pickTarget();
        await physAttack(e, t, s.power);
        if (s.status && alive(t) && Math.random() < s.rate && !st(t)[s.status]) { st(t)[s.status] = true; sfx('poison'); await bsay(`${nm(t)}は どくに おかされた！`, 30); }
        break;
      }
      case 'magic': {
        sfx('magic');
        const ts = s.target === 'all' ? liveParty() : [pickTarget()];
        for (const t of ts) {
          await magicHit(t, rand(s.power[0], s.power[1]));
          if (s.status && alive(t) && Math.random() < s.rate && !st(t)[s.status]) { st(t)[s.status] = true; await bsay(`${nm(t)}は めが くらんだ！`, 26); }
        }
        break;
      }
      case 'status': await inflict(pickTarget(), s.status, s.rate); break;
      case 'selfbuff': e.buffs[s.buff] = true; sfx('magic'); await bsay(`${nm(e)}の しゅびりょくが あがった！`, 30); break;
      case 'healself': { const n = Math.floor(e.maxHp * s.power); e.hp = Math.min(e.maxHp, e.hp + n); sfx('heal'); await bsay(`${nm(e)}の キズが ${n} ふさがった！`, 30); break; }
      case 'nothing': await pause(30); break;
      case 'flee': sfx('run'); e.gone = true; await pause(20); break;
    }
  }
  function enemyChoose(e) {
    if (e.d.script) { const s = e.d.script[Math.min(e.scriptI++, e.d.script.length - 1)]; return s; }
    const acts = e.d.acts || [['attack', 1]];
    const total = acts.reduce((s, a) => s + a[1], 0);
    let r = Math.random() * total;
    for (const [n, w] of acts) { if ((r -= w) < 0) return n; }
    return 'attack';
  }

  // ---- 本体 ----
  async function run(group, o = {}) {
    opts = o;
    bg = o.bg || 'field';
    enemies = makeEnemies(group);
    party = G.party.map(c => ({ isParty: true, c, name: charName(c), buffs: {}, defending: false }));
    layout();
    lines = []; turn = 0; escaped = false;
    const prevBgm = Audio8.current;
    const prevScene = Scene.cur;
    // 突入演出
    sfx('appear');
    for (let i = 0; i < 6; i++) { flash('#ffffff', 0.8); await wait(5); }
    await fadeOut(10);
    Scene.set(BattleScene);
    Audio8.bgm(o.bgm || (enemies.some(e => e.d.boss) ? 'boss' : 'battle'));
    await fadeIn(10);
    if (o.intro) await bsay(o.intro, 50);
    else if (enemies.length === 1) await bsay(`${enemies[0].name}が あらわれた！`, 40);
    else await bsay('まものの むれが あらわれた！', 40);

    let result = null;
    while (!result) {
      turn++;
      for (const b of party) b.defending = false;
      let acts = await inputCommands();
      if (acts.length === 1 && acts[0].type === 'flee') {
        clear();
        await bsay(`${nm(party[0])}たちは にげだした！`, 24);
        const pa = liveParty().reduce((s, b) => s + agi(b), 0) / liveParty().length;
        const ea = liveEnemies().reduce((s, b) => s + agi(b), 0) / liveEnemies().length;
        const chance = clamp(0.5 + (pa - ea) / 60, 0.25, 0.9);
        if (o.noEscape || enemies.some(e => e.d.boss)) await bsay('しかし にげられない！', 36);
        else if (Math.random() < chance) { sfx('run'); await pause(20); result = 'flee'; break; }
        else await bsay('しかし まわりこまれてしまった！', 36);
        acts = [];
      }
      for (const a of acts) if (a.type === 'defend') a.actor.defending = true;
      for (const e of liveEnemies()) {
        const n = e.d.actions || 1;
        for (let i = 0; i < n; i++) acts.push({ actor: e, skill: enemyChoose(e) });
      }
      const order = acts.map(a => ({ a, k: agi(a.actor) * (0.55 + Math.random() * 0.45) + (a.type === 'defend' ? 999 : 0) })).sort((x, y) => y.k - x.k);
      for (const { a } of order) {
        await doAction(a);
        if (!liveEnemies().length) break;
        if (!liveParty().length) break;
      }
      // ターン終了
      for (const b of liveParty()) if (st(b).poison) {
        const d = Math.max(1, Math.floor(maxH(b) / 12));
        setHp(b, Math.max(0, hp(b) - d));
        sfx('poison'); clear();
        await bsay(`${nm(b)}は どくで ${d}の ダメージ！`, 30);
        await checkDeath(b);
      }
      if (o.onTurnEnd) await o.onTurnEnd({ enemies, party, bsay, turn, clear });
      if (enemies.every(e => e.gone) && !enemies.some(e => e.hp <= 0)) { await pause(20); result = 'escaped'; break; }
      if (!liveEnemies().length) result = 'win';
      else if (!liveParty().length) result = 'lose';
    }

    if (result === 'win') {
      const exp = enemies.reduce((s, e) => s + (e.gone ? 0 : e.d.exp), 0);
      const gold = enemies.reduce((s, e) => s + (e.gone ? 0 : e.d.gold), 0);
      clear();
      Audio8.bgm(null);
      Audio8.jingle('win');
      await bsay(enemies.length > 1 ? 'まものたちを やっつけた！' : `${enemies[0].d.name}を やっつけた！`, 40);
      if (exp) await bsay(`それぞれ ${exp}ポイントの けいけんちを かくとく！`, 40);
      if (gold) { G.gold += gold; await bsay(`${gold}円を てにいれた！`, 40); }
      for (const e of enemies) if (e.d.drop && Math.random() < e.d.drop[1]) { addItem(e.d.drop[0]); await bsay(`${e.d.name}は ${ITEMS[e.d.drop[0]].name}を おとしていった！`, 40); }
      for (const b of party) {
        const msgs = gainExp(b.c, exp);
        if (msgs.length) { await Audio8.jingle('levelup'); for (const m of msgs) await bsay(m, 46); }
      }
      await pause(20);
    }
    if (result === 'lose') {
      Audio8.bgm(null);
      await Audio8.jingle('gameover');
      await bsay(`${charName(G.party[0])}たちは ちからつきた…`, 80);
    }
    // 後片付け
    for (const c of G.party) { delete c.status.sleep; delete c.status.blind; }
    clear();
    await fadeOut(14);
    Scene.set(prevScene);
    if (result === 'lose' && !o.canLose) { await gameOver(); return result; }
    if (prevBgm) Audio8.bgm(prevBgm);
    await fadeIn(14);
    return result;
  }

  async function gameOver() {
    for (const c of G.party) { c.hp = maxHp(c); c.mp = maxMp(c); c.status = {}; }
    G.gold = Math.floor(G.gold / 2);
    const inn = G.lastInn;
    G.x = inn.x; G.y = inn.y;
    MapScene.load(inn.map);
    Scene.set(MapScene);
    await wait(20);
    await fadeIn(30);
    await say('……はっ！\nどうやら きを うしなっていたらしい。', 'もちがねが はんぶんに なってしまった…');
  }

  return { run, debug: () => ({ enemies: enemies.map(e => e.name + ':' + e.hp + (e.gone ? ':gone' : '')), party: party.map(b => nm(b) + ':' + hp(b)), lines: lines.slice() }) };
})();
