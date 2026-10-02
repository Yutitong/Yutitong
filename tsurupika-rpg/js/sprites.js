// ===== ドット絵：16x16 の文字列ビットマップと手続きタイル =====
const Sprites = (() => {
  const cache = {};

  // --- 人型テンプレート ---
  const HERO = [
    '......oooo......',
    '....oosshhoo....',
    '...osssssshho...',
    '...osssssssso...',
    '..oSseesseesSo..',
    '...ossssmmssso..',
    '....ossssssoo...',
    '...obbwwwwwbbo..',
    '..obbbwbbbwbbbo.',
    '..obbbwbbbwbbbo.',
    '.osobbbbbbbbboso',
    '..oobbbbbbbbboo.',
    '...okkkkkkkkko..',
    '...okkko.okkko..',
    '...okkko.okkko..',
    '..oggggo.oggggo.',
  ];
  const MAN = [
    '.....oooooo.....',
    '....ohhhhhhho...',
    '...ohhhhhhhhho..',
    '...ohsssssshho..',
    '..oSseesseesSo..',
    '...ossssmmssso..',
    '....ossssssoo...',
    '...occcwwwccco..',
    '..occccwwwcccco.',
    '..occccccccccco.',
    '.osocccccccccoso',
    '..oocccccccccoo.',
    '...odddddddddo..',
    '...odddo.odddo..',
    '...odddo.odddo..',
    '..oggggo.oggggo.',
  ];
  const WOMAN = [
    '.....oooooo.....',
    '....ohhhhhhho...',
    '...ohhhhhhhhho..',
    '...ohsssssshho..',
    '..hSseesseesSh..',
    '..hossssmmssoh..',
    '..hhossssssohh..',
    '...occcwwwccco..',
    '..occccwwwcccco.',
    '..occccccccccco.',
    '.osocccccccccoso',
    '..oocccccccccoo.',
    '..oddddddddddo..',
    '..oddddddddddo..',
    '...ossso.ossso..',
    '..oggggo.oggggo.',
  ];
  const RAKKI = [
    '......g..g......',
    '.....gGggGg.....',
    '......gGGg......',
    '.......gg.......',
    '.....oooooo.....',
    '...ooyyyyyyoo...',
    '..oyyyyyyyyyyo..',
    '..oyywwyyywwyo..',
    '.oyyywkyyywkyyo.',
    '.oyyywkyyywkyyo.',
    '.oyppyyymyyyppo.',
    '.oyyyyyyyyyyyyo.',
    '..oyyyyyyyyyyo..',
    '...ooyyyyyyoo...',
    '....oYo..oYo....',
    '................',
  ];
  const IGYO_A = [
    '................',
    '.....oooooo.....',
    '....oppppppo....',
    '...oppwwwwppo...',
    '...opwwkkwwpo...',
    '...opwwkkwwpo...',
    '...oppwwwwppo...',
    '...oppppppppo...',
    '..opPppppppPpo..',
    '..oppppmmppppo..',
    '..opppppppppPo..',
    '.oppppppppppppo.',
    '.opPopPpoPpoPpo.',
    '.op.opp.op.opo..',
    '..o..o...o..o...',
    '................',
  ];
  const IGYO_B = [
    '...o........o...',
    '....o......o....',
    '..oooooooooooo..',
    '..owwwwwwwwwwo..',
    '..owkwwkwwkwwo..',
    '..owwwwwwwwwwo..',
    '..owwkwwwwkwwo..',
    '..owwwwmmwwwwo..',
    '..owwwwwwwwwwo..',
    '..oWWWWWWWWWWo..',
    '..oooooooooooo..',
    '...o..o..o..o...',
    '...o..o..o..o...',
    '..oo.oo.oo.oo...',
    '................',
    '................',
  ];
  const GIANT = [
    '....oooooooo....',
    '...osssssssso...',
    '..osssssssssso..',
    '..osKKssssKKso..',
    '..oswkssssswkso.',
    '..osssssssssso..',
    '..ossssmmmssso..',
    '...osssssssso...',
    '.ooossssssssooo.',
    'osssssssssssssso',
    'ososssssssssssos',
    'ososssssssssssos',
    'oo.orrrrrrrro.oo',
    '...orrrrrrrro...',
    '...osssoossso...',
    '..ossssooosssso.',
  ];
  // --- 敵テンプレート ---
  const SLIME = [
    '................', '................', '................', '................', '................',
    '......oooo......',
    '.....oyyyyo.....',
    '....oyywyyyo....',
    '...oyywwyyyyo...',
    '..oyyyyyyyyyyo..',
    '..oyykyyyykyyo..',
    '.oyyykyyyykyyyo.',
    '.oyyyyymmyyyyyo.',
    '.oYyyyyyyyyyyYo.',
    '..oYYYYYYYYYYo..',
    '...oooooooooo...',
  ];
  const BUBBLE = [
    '................',
    '..ooo......ooo..',
    '.owyyo....owyyo.',
    '.oyyyo....oyyyo.',
    '..ooo..oooo.ooo.',
    '......owwyyo....',
    '.....owyyyyyo...',
    '....owyyyyyyyo..',
    '....oyykyyykyo..',
    '....oyyyyyyyyo..',
    '....oyyymmyyyo..',
    '....oyyyyyyyyo..',
    '.....oyyyyyyo...',
    '......oooooo....',
    '................',
    '................',
  ];
  const BAT = [
    '................',
    '................',
    'oo....oooo....oo',
    'owo..oyyyyo..owo',
    'owwooyyyyyyoowwo',
    'owwwoykyykyowwwo',
    '.owwoyyyyyyowwo.',
    '..owoyymmyyowo..',
    '...ooYYYYYYoo...',
    '.....oyyyyo.....',
    '.....oYYYYo.....',
    '......oooo......',
    '................', '................', '................', '................',
  ];
  const SPIKY = [
    '................',
    '.....o..o..o....',
    '..o..oyoyoyo.o..',
    '...ooyyyyyyyoo..',
    '.oo.oyyyyyyyo.oo',
    '...oyyyyyyyyyo..',
    '.ooyywkyyywkyyoo',
    '...oyyyyyyyyyo..',
    '.ooyyyymmmyyyoo.',
    '...oYyyyyyyyYo..',
    '..o.oYYYYYYYo.o.',
    '....o.ooooo.o...',
    '................', '................', '................', '................',
  ];
  const RODENT = [
    '................',
    '................',
    '...oo.....oo....',
    '..oyyo...oyyo...',
    '..oypyoooypyo...',
    '...oyyyyyyyo....',
    '..oyykyyykyyo...',
    '..oyyyyyyyyyo...',
    '..oyyyywkyyyo...',
    '...oyyyyyyyo....',
    '..oyyyyyyyyyo..o',
    '.oyyyyyyyyyyyoyo',
    '.oyyyyyyyyyyyoo.',
    '..oYYoYYYYoYYo..',
    '...oo.oooo.oo...',
    '................',
  ];
  const BEAN = [
    '................',
    '.....oooooo.....',
    '....oyyyyyyo....',
    '...oyywyyyyyo...',
    '...oyyyyyyyyo...',
    '...oykkyykkyo...',
    '...oyyyyyyyyo...',
    '..ooyyymmyyyoo..',
    '.oyoyyyyyyyyoyo.',
    '.oyoyyyyyyyyoyo.',
    '..ooYyyyyyyYoo..',
    '....oYYYYYYo....',
    '....oyo..oyo....',
    '....oyo..oyo....',
    '...oyyo..oyyo...',
    '...oooo..oooo...',
  ];
  const SNAKE = [
    '................',
    '.......oooo.....',
    '......oyyyyo....',
    '.....oykyykyo...',
    '.....oyyyyyyo...',
    '......oyrryo....',
    '......oyyyo.....',
    '.......oyyo.....',
    '......oyyo......',
    '.....oyyo..oo...',
    '....oyyo..oyyo..',
    '...oyyyooyyyyo..',
    '...oyyyyyyyyo...',
    '....oYYYYYYo....',
    '.....oooooo.....',
    '................',
  ];
  const GHOST = [
    '................',
    '......oooo......',
    '....oowwwwoo....',
    '...owwwwwwwwo...',
    '..owwwwwwwwwwo..',
    '..owkkwwwkkwwo..',
    '..owkkwwwkkwwo..',
    '..owwwwwwwwwwo..',
    '.owwwwwkkwwwwwo.',
    'owwwwwwkkwwwwwwo',
    'owwwwwwwwwwwwwwo',
    '.owwwwwwwwwwwwo.',
    '..owwwwwwwwwwwo.',
    '..owwowwwowwwo..',
    '...oo.ooo.ooo...',
    '................',
  ];
  const GOLEM = [
    '................',
    '....oooooooo....',
    '...owwwwwwwwo...',
    '...owkwwwwkwo...',
    '...owwwwwwwwo...',
    '.oooowwmmwwoooo.',
    'oyyyoooooooooyyo',
    'oyyyyyyyyyyyyyyo',
    'oyyoyyyyyyyyoyyo',
    'oyyoyyywwyyyoyyo',
    'oooYyyyyyyyyYooo',
    '...oyyyyyyyyo...',
    '..oyyyo..oyyyo..',
    '..oyyyo..oyyyo..',
    '.oYYYYo..oYYYYo.',
    '.oooooo..oooooo.',
  ];
  const CHEST = [
    '................', '................', '................',
    '..oooooooooooo..',
    '.obbbbbbbbbbbbo.',
    '.obyyyyyyyyyybo.',
    '.obbbbbbbbbbbbo.',
    '.oooooyyyyooooo.',
    '.obbbbbykybbbbo.',
    '.obbbbbbbbbbbbo.',
    '.obyyyyyyyyyybo.',
    '.obbbbbbbbbbbbo.',
    '.oooooooooooooo.',
    '................', '................', '................',
  ];
  const CHEST_OPEN = [
    '................', '................', '................',
    '..oooooooooooo..',
    '.obbbbbbbbbbbbo.',
    '.oooooooooooooo.',
    '.okkkkkkkkkkkko.',
    '.oooooooooooooo.',
    '.obbbbbbbbbbbbo.',
    '.obbbbbbbbbbbbo.',
    '.obyyyyyyyyyybo.',
    '.obbbbbbbbbbbbo.',
    '.oooooooooooooo.',
    '................', '................', '................',
  ];
  const CART = [
    '................', '................', '................', '................', '................', '................',
    'oooooooooooooo..',
    'owwwwwwwwwwwwo..',
    'obbbbbbbbbbbbooo',
    'obbbbbbbbbbbbo.o',
    'oooooooooooooo.o',
    '..ooo.....ooo...',
    '.okkko...okkko..',
    '.okwko...okwko..',
    '.okkko...okkko..',
    '..ooo.....ooo...',
  ];

  // 色パレット
  const BASE = { o: '#1a1018', k: '#20202a', w: '#f4f2ea', e: '#141018', m: '#8a3030' };
  const SKIN = { s: '#f2b98c', S: '#c98a62', h: '#ffffff' };
  const PALS = {
    hero: { ...BASE, ...SKIN, b: '#2f56b0', w: '#f4f2ea', k: '#2a2438', g: '#7a4a24' },
    man: { ...BASE, ...SKIN, h: '#3a2a1e', c: '#4f8a46', d: '#3a3a52', g: '#5a3a1e' },
    elder: { ...BASE, ...SKIN, h: '#e8e8e8', c: '#7a5aa0', d: '#4a3a5a', g: '#5a3a1e' },
    merchant: { ...BASE, ...SKIN, h: '#2a1e18', c: '#b0702c', d: '#4a3a2a', g: '#3a2a1e' },
    woman: { ...BASE, ...SKIN, h: '#4a2a1a', c: '#c0506a', d: '#7a3048', g: '#4a2a1a' },
    bandai: { ...BASE, ...SKIN, h: '#9a9aa0', c: '#3a6a9a', d: '#2a4a6a', g: '#4a2a1a' },
    kinu: { ...BASE, ...SKIN, h: '#1e1a22', c: '#e8e0f0', d: '#5070c0', g: '#7a4a24', r: '#d03838' },
    kid: { ...BASE, ...SKIN, h: '#1e1a22', c: '#d8a030', d: '#2a4a8a', g: '#4a2a1a' },
    hermit: { ...BASE, ...SKIN, h: '#d8d8d8', c: '#8a7a5a', d: '#5a4a3a', g: '#3a2a1e' },
    scholar: { ...BASE, ...SKIN, h: '#5a4a6a', c: '#30305a', d: '#20203a', g: '#20203a' },
    guard: { ...BASE, ...SKIN, s: '#c8a0d8', S: '#9a70b0', h: '#4a2a5a', c: '#5a2a6a', d: '#2a1a3a', g: '#1a101a' },
    rakki: { ...BASE, y: '#ffd84a', Y: '#d89a20', g: '#3ab04a', G: '#7ae07a', p: '#ff9ab0', k: '#141018' },
    igyoP: { ...BASE, p: '#9a5ac8', P: '#6a3a98' },
    igyoG: { ...BASE, p: '#5ab07a', P: '#3a7a52' },
    igyoO: { ...BASE, p: '#e08a3a', P: '#a85a20' },
    tofuW: { ...BASE, w: '#f4f2ea', W: '#c8c4b8', k: '#141018' },
    tofuY: { ...BASE, w: '#f0c858', W: '#c89030', k: '#141018' },
    tofuP: { ...BASE, w: '#f0b0c8', W: '#c07a98', k: '#141018' },
    matanini: { ...BASE, s: '#8ccf9a', K: '#2a5a3a', w: '#ffffff', k: '#141018', r: '#d04040', m: '#3a1a1a' },
    wakinini: { ...BASE, s: '#a888d8', K: '#2a1a4a', w: '#ffee88', k: '#141018', r: '#202028', m: '#3a1a1a' },
    chest: { ...BASE, b: '#a0602a', y: '#f0c040', k: '#2a1a10' },
    cart: { ...BASE, w: '#f8f8f0', b: '#8a5a2a', k: '#303030' },
    bossBubble: { ...BASE, y: '#5aa0e0', w: '#ffffff', k: '#1a1018' },
    wardenP: { ...BASE, w: '#c8c4d8', y: '#7a6a9a', Y: '#4a3a6a', k: '#1a1018' },
  };

  function make(rows, pal) {
    const c = document.createElement('canvas');
    c.width = rows[0].length; c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((r, y) => {
      for (let i = 0; i < r.length; i++) {
        const ch = r[i];
        if (ch === '.' || ch === ' ') continue;
        x.fillStyle = pal[ch] || '#ff00ff';
        x.fillRect(i, y, 1, 1);
      }
    });
    return c;
  }
  // 歩行2コマ目：下4行を左右反転し1px持ち上げる
  function walkFrame(rows) {
    const n = rows.length;
    const out = rows.map((r, i) => (i >= n - 4 ? r.split('').reverse().join('') : r));
    return out.slice(1).concat(['.'.repeat(rows[0].length)]);
  }
  function replaceRows(rows, map) { return rows.map((r, i) => (map[i] !== undefined ? map[i] : r)); }
  function recolor(rows, fromRow, toRow, mapping) {
    return rows.map((r, i) => (i >= fromRow && i <= toRow ? r.split('').map(c => mapping[c] || c).join('') : r));
  }

  const HERO_NAKED = recolor(recolor(recolor(HERO, 7, 11, { b: 's', w: 's' }), 12, 12, { k: 'w' }), 13, 15, { k: 's', g: 's' });
  const KINU = replaceRows(WOMAN, { 2: '...orrrrrrrrro..' });

  const DEF = {
    hero: [HERO, 'hero'], hero_naked: [HERO_NAKED, 'hero'],
    man: [MAN, 'man'], elder: [MAN, 'elder'], merchant: [MAN, 'merchant'], kid: [MAN, 'kid'],
    woman: [WOMAN, 'woman'], bandai: [WOMAN, 'bandai'], kinu: [KINU, 'kinu'],
    hermit: [MAN, 'hermit'], scholar: [MAN, 'scholar'], guard: [MAN, 'guard'],
    rakki: [RAKKI, 'rakki'],
    igyo1: [IGYO_A, 'igyoP'], igyo2: [IGYO_A, 'igyoG'], igyo3: [IGYO_A, 'igyoO'],
    igyo4: [IGYO_B, 'tofuW'], igyo5: [IGYO_B, 'tofuP'],
    matanini: [GIANT, 'matanini'], wakinini: [GIANT, 'wakinini'],
    chest: [CHEST, 'chest'], chest_open: [CHEST_OPEN, 'chest'], cart: [CART, 'cart'],
    boss_bubble: [BUBBLE, 'bossBubble'], warden: [GOLEM, 'wardenP'],
  };
  const ENEMY_SHAPES = { slime: SLIME, bubble: BUBBLE, bat: BAT, spiky: SPIKY, rodent: RODENT, bean: BEAN, snake: SNAKE, ghost: GHOST, golem: GOLEM, igyo: IGYO_B, giant: GIANT, rakki: RAKKI };

  function get(name, frame = 0) {
    const key = name + ':' + frame;
    if (cache[key]) return cache[key];
    const d = DEF[name];
    if (!d) return null;
    const rows = frame ? walkFrame(d[0]) : d[0];
    return (cache[key] = make(rows, PALS[d[1]]));
  }
  function enemy(shape, pal, frame = 0) {
    const key = 'E:' + shape + ':' + JSON.stringify(pal) + ':' + frame;
    if (cache[key]) return cache[key];
    const rows = ENEMY_SHAPES[shape];
    return (cache[key] = make(frame ? walkFrame(rows) : rows, { ...BASE, ...pal }));
  }

  // ===== タイル（16x16 を手続きで描画）=====
  function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }
  function px(x, c, X, Y, w = 1, h = 1) { x.fillStyle = c; x.fillRect(X, Y, w, h); }
  function speckle(x, base, dots, seed, n = 14) {
    px(x, base, 0, 0, 16, 16);
    const r = rng(seed);
    for (let i = 0; i < n; i++) px(x, dots[i % dots.length], Math.floor(r() * 16), Math.floor(r() * 16));
  }
  const TILE_PAINT = {
    '.': x => { speckle(x, '#4fa63f', ['#3f8e33', '#62b84e'], 11, 18); px(x, '#3f8e33', 3, 4, 1, 2); px(x, '#3f8e33', 11, 10, 1, 2); },
    ',': x => { TILE_PAINT['.'](x); px(x, '#f6e05a', 3, 3, 2, 2); px(x, '#f08aa0', 11, 6, 2, 2); px(x, '#ffffff', 6, 11, 2, 2); px(x, '#f6e05a', 12, 13, 1, 1); },
    '=': x => { speckle(x, '#c9a46a', ['#b38e56', '#d8b67e'], 7, 16); },
    'S': x => { speckle(x, '#e2cf96', ['#cdb87c', '#efe0ae'], 5, 16); },
    'h': x => { speckle(x, '#6cb84a', ['#5aa23c', '#86cc62'], 13, 16); px(x, '#5aa23c', 2, 10, 12, 1); px(x, '#86cc62', 4, 9, 8, 1); },
    'T': x => {
      TILE_PAINT['.'](x);
      px(x, '#6a4a2a', 7, 11, 2, 5);
      px(x, '#1e5a2a', 2, 2, 12, 9); px(x, '#1e5a2a', 4, 0, 8, 12);
      px(x, '#2e7a3a', 3, 3, 9, 6); px(x, '#3e9a4a', 5, 2, 4, 3); px(x, '#3e9a4a', 4, 5, 2, 2);
    },
    'M': x => {
      speckle(x, '#7a6a5a', ['#6a5a4a', '#8a7a6a'], 3, 10);
      px(x, '#5a4a3a', 0, 13, 16, 3); px(x, '#9a8a7a', 3, 3, 4, 2); px(x, '#9a8a7a', 9, 7, 4, 2);
      px(x, '#4a3a2a', 0, 0, 16, 1); px(x, '#4a3a2a', 0, 0, 1, 16);
    },
    '~': (x, f) => {
      px(x, '#2f6ad0', 0, 0, 16, 16);
      const o = f ? 4 : 0;
      px(x, '#7aaaf0', (2 + o) % 16, 4, 5, 1); px(x, '#7aaaf0', (9 + o) % 16, 10, 5, 1); px(x, '#4a86e0', (6 + o) % 16, 14, 4, 1);
    },
    '#': x => {
      px(x, '#8a8a92', 0, 0, 16, 16);
      px(x, '#5a5a62', 0, 7, 16, 1); px(x, '#5a5a62', 0, 15, 16, 1); px(x, '#5a5a62', 7, 0, 1, 7); px(x, '#5a5a62', 3, 8, 1, 7); px(x, '#5a5a62', 12, 8, 1, 7);
      px(x, '#a8a8b0', 1, 1, 5, 1); px(x, '#a8a8b0', 9, 1, 5, 1);
    },
    'W': x => {
      px(x, '#9a6a3a', 0, 0, 16, 16);
      for (let i = 0; i < 16; i += 4) px(x, '#7a4e26', 0, i, 16, 1);
      px(x, '#b8844a', 0, 1, 16, 1);
    },
    'R': x => {
      px(x, '#4a5a72', 0, 0, 16, 16);
      for (let i = 0; i < 16; i += 4) { px(x, '#33405a', 0, i + 3, 16, 1); px(x, '#6a7a92', 0, i, 16, 1); }
      for (let i = 0; i < 16; i += 4) px(x, '#33405a', i, 0, 1, 16);
    },
    'Q': x => {
      px(x, '#a8443a', 0, 0, 16, 16);
      for (let i = 0; i < 16; i += 4) { px(x, '#7a2e26', 0, i + 3, 16, 1); px(x, '#c8645a', 0, i, 16, 1); }
    },
    'D': x => { px(x, '#9a6a3a', 0, 0, 16, 16); px(x, '#4a2e16', 3, 2, 10, 14); px(x, '#6a4224', 4, 3, 8, 13); px(x, '#e8c050', 10, 9, 1, 2); },
    'd': x => { TILE_PAINT['D'](x); },
    'N': x => {
      px(x, '#9a6a3a', 0, 0, 16, 16); px(x, '#2a1a10', 2, 0, 12, 16);
      px(x, '#2a4aa0', 2, 0, 12, 9); px(x, '#2a1a10', 7, 2, 2, 7); px(x, '#f4f2ea', 4, 3, 2, 2); px(x, '#f4f2ea', 10, 3, 2, 2);
    },
    'f': x => { px(x, '#c8945a', 0, 0, 16, 16); for (let i = 0; i < 16; i += 4) px(x, '#a8743e', 0, i, 16, 1); px(x, '#a8743e', 8, 0, 1, 4); px(x, '#a8743e', 3, 4, 1, 4); px(x, '#a8743e', 11, 8, 1, 4); px(x, '#a8743e', 6, 12, 1, 4); },
    't': x => { px(x, '#dce8ee', 0, 0, 16, 16); px(x, '#a8c0cc', 0, 7, 16, 1); px(x, '#a8c0cc', 7, 0, 1, 16); px(x, '#a8c0cc', 0, 15, 16, 1); px(x, '#a8c0cc', 15, 0, 1, 16); },
    'b': (x, f) => {
      px(x, '#6ac0e0', 0, 0, 16, 16);
      const o = f ? 3 : 0;
      px(x, '#a8e0f0', (2 + o) % 16, 5, 4, 1); px(x, '#a8e0f0', (10 + o) % 16, 11, 4, 1);
      px(x, 'rgba(255,255,255,.55)', (5 + o) % 16, 1, 2, 2); px(x, 'rgba(255,255,255,.55)', (12 + o) % 16, 7, 2, 2);
    },
    'c': x => { px(x, '#6a4224', 0, 0, 16, 16); px(x, '#8a5a34', 0, 0, 16, 4); px(x, '#4a2e16', 0, 15, 16, 1); },
    'L': x => { px(x, '#b07a44', 0, 0, 16, 16); px(x, '#7a4e26', 0, 7, 16, 1); px(x, '#7a4e26', 7, 0, 1, 16); px(x, '#e8c050', 5, 3, 1, 1); px(x, '#e8c050', 13, 3, 1, 1); px(x, '#e8c050', 5, 11, 1, 1); px(x, '#e8c050', 13, 11, 1, 1); },
    'Y': x => { px(x, '#7a8a9a', 0, 0, 16, 16); px(x, '#4a5a6a', 0, 0, 16, 2); px(x, '#a8d8f0', 1, 3, 14, 11); px(x, '#f8f8f0', 3, 6, 4, 3); px(x, '#f8f8f0', 9, 8, 4, 3); },
    'y': x => { px(x, '#6a4224', 0, 0, 16, 16); const cs = ['#c84a3a', '#3a6ac8', '#4aa84a', '#d8b040']; for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) px(x, cs[(i + r) % 4], 2 + i * 2, 2 + r * 7, 1, 5); px(x, '#4a2e16', 0, 7, 16, 1); },
    'p': x => {
      TILE_PAINT['='](x);
      px(x, '#5a4a3a', 7, 0, 3, 16); px(x, '#7a6a5a', 7, 0, 1, 16);
      px(x, '#4a3a2a', 3, 2, 10, 2); px(x, '#d8d8d8', 3, 1, 1, 1); px(x, '#d8d8d8', 12, 1, 1, 1);
      px(x, '#e8c050', 6, 9, 5, 3); px(x, '#1a1018', 7, 10, 3, 1);
    },
    'B': (x, f) => {
      TILE_PAINT['~'](x, f);
      px(x, '#5a4a3a', 0, 5, 16, 6); px(x, '#7a6a5a', 0, 5, 16, 1); px(x, '#3a2a1a', 0, 10, 16, 1);
    },
    'n': (x, f) => {
      TILE_PAINT['~'](x, f);
      px(x, '#a8743e', 0, 2, 16, 12); for (let i = 0; i < 16; i += 3) px(x, '#7a4e26', i, 2, 1, 12); px(x, '#5a3a1e', 0, 2, 16, 1); px(x, '#5a3a1e', 0, 13, 16, 1);
    },
    'w': (x, f) => { speckle(x, '#5a3a6a', ['#6a4a7a', '#4a2a5a'], 17, 18); px(x, '#8a6aa0', f ? 4 : 9, f ? 9 : 4, 2, 2); },
    'C': x => { speckle(x, '#4a4458', ['#3a3448', '#5a5468'], 23, 14); },
    'X': x => {
      px(x, '#2a2436', 0, 0, 16, 16); px(x, '#3a3448', 1, 1, 6, 5); px(x, '#3a3448', 8, 7, 7, 6); px(x, '#4a4458', 2, 1, 3, 1); px(x, '#4a4458', 9, 7, 3, 1);
    },
    'K': x => { px(x, '#4a3a5a', 0, 0, 16, 16); px(x, '#3a2a4a', 0, 7, 16, 1); px(x, '#3a2a4a', 7, 0, 1, 7); px(x, '#3a2a4a', 0, 15, 16, 1); px(x, '#3a2a4a', 12, 8, 1, 7); px(x, '#5a4a6a', 1, 1, 4, 1); },
    'k': x => {
      px(x, '#2a1a3a', 0, 0, 16, 16);
      px(x, '#4a2a5a', 0, 0, 16, 1); px(x, '#1a1028', 0, 7, 16, 1); px(x, '#1a1028', 0, 15, 16, 1); px(x, '#1a1028', 5, 0, 1, 7); px(x, '#1a1028', 11, 8, 1, 7);
    },
    'r': x => { px(x, '#9a2a3a', 0, 0, 16, 16); px(x, '#d8b040', 1, 0, 1, 16); px(x, '#d8b040', 14, 0, 1, 16); px(x, '#7a1a2a', 4, 4, 8, 8); px(x, '#b03a4a', 6, 6, 4, 4); },
    'E': (x, f) => {
      px(x, '#0a0818', 0, 0, 16, 16);
      const r = rng(f ? 99 : 41);
      for (let i = 0; i < 5; i++) px(x, ['#ffffff', '#a8a8f8', '#f8e8a8'][i % 3], Math.floor(r() * 16), Math.floor(r() * 16));
    },
    'F': x => { TILE_PAINT['.'](x); px(x, '#c8945a', 0, 4, 16, 2); px(x, '#c8945a', 0, 10, 16, 2); px(x, '#8a5a2a', 2, 2, 2, 12); px(x, '#8a5a2a', 12, 2, 2, 12); },
    '_': x => { px(x, '#3a3448', 0, 0, 16, 16); for (let i = 0; i < 4; i++) { px(x, '#8a849a', 0, i * 4, 16, 2); px(x, '#5a5468', 0, i * 4 + 2, 16, 1); } },
    'g': (x, f) => {
      px(x, '#c8c4d8', 0, 0, 16, 16);
      const o = f ? 2 : 0;
      px(x, '#f0eef8', 1 + o, 2, 7, 4); px(x, '#f0eef8', 8 - o, 9, 7, 4); px(x, '#a8a4b8', 3, 13, 8, 1);
    },
    'O': (x, f) => {
      px(x, '#9ad8f0', 0, 0, 16, 16);
      const circ = (cx, cy, r) => { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) px(x, '#e0f6ff', cx + xx, cy + yy); };
      circ(4, 4, 3); circ(11, 6, 4); circ(6, 12, 3); px(x, '#ffffff', f ? 3 : 10, f ? 3 : 4, 2, 1);
    },
    'v': x => { px(x, '#c8945a', 0, 0, 16, 16); px(x, '#f4f2ea', 1, 1, 14, 14); px(x, '#c84a5a', 1, 6, 14, 9); px(x, '#a83a4a', 1, 6, 14, 1); },
    'J': x => { px(x, '#4a3a5a', 0, 0, 16, 16); px(x, '#d8b040', 2, 1, 12, 14); px(x, '#9a2a3a', 4, 3, 8, 8); px(x, '#a88a2a', 2, 13, 12, 2); },
    'U': (x, f) => { TILE_PAINT['k'](x); px(x, '#6a4a2a', 7, 7, 2, 6); px(x, f ? '#f8d040' : '#f89030', 6, 3, 4, 4); px(x, '#fff0a0', 7, 4, 2, 2); },
    'A': x => { speckle(x, '#7a6a5a', ['#6a5a4a'], 3, 6); px(x, '#140c18', 3, 4, 10, 12); px(x, '#140c18', 5, 2, 6, 2); px(x, '#3a2a2a', 3, 4, 1, 12); },
    'V': x => {
      TILE_PAINT['.'](x);
      px(x, '#a8443a', 1, 3, 6, 3); px(x, '#c8945a', 1, 6, 6, 4); px(x, '#4a2e16', 3, 7, 2, 3);
      px(x, '#4a5a72', 8, 6, 7, 3); px(x, '#c8945a', 8, 9, 7, 5); px(x, '#4a2e16', 11, 10, 2, 4);
    },
    '&': x => {
      TILE_PAINT['w'](x);
      px(x, '#3a2a4a', 2, 4, 12, 12); px(x, '#3a2a4a', 1, 1, 3, 4); px(x, '#3a2a4a', 12, 1, 3, 4); px(x, '#3a2a4a', 6, 0, 4, 5);
      px(x, '#140c18', 6, 10, 4, 6); px(x, '#f8d040', 4, 7, 1, 1); px(x, '#f8d040', 11, 7, 1, 1);
    },
    'z': x => { TILE_PAINT['.'](x); px(x, '#6a4224', 7, 8, 2, 8); px(x, '#c8945a', 2, 2, 12, 7); px(x, '#6a4224', 2, 8, 12, 1); px(x, '#4a2e16', 4, 4, 8, 1); px(x, '#4a2e16', 4, 6, 6, 1); },
    'x': x => { TILE_PAINT['C'](x); px(x, '#6a5a7a', 3, 6, 10, 8); px(x, '#8a7a9a', 4, 6, 8, 2); },
    ' ': x => { px(x, '#000000', 0, 0, 16, 16); },
  };
  const tileCache = {};
  function tile(ch, f = 0) {
    const anim = '~bBnwEgOU'.includes(ch) ? f : 0;
    const key = ch + anim;
    if (tileCache[key]) return tileCache[key];
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d');
    (TILE_PAINT[ch] || TILE_PAINT[' '])(x, anim);
    return (tileCache[key] = c);
  }

  return { get, enemy, tile, PALS };
})();
