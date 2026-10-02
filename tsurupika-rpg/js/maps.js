// ===== マップ定義 =====
// 凡例: . 草  , 花  = 道  T 木  M 岩山  ~ 水  # 石壁  W 板壁  R 瓦屋根  Q 赤屋根  D 扉  d 鍵扉  N のれん
//       f 板床  t タイル  b 湯船  c カウンター  L ロッカー  Y 豆腐水槽  y 本棚  v ふとん  p 電信柱  B 倒れた電柱
//       S 砂  h 丘  E 果て  w 毒沼  C 洞窟床  X 洞窟壁  x 岩  K 城床  k 城壁  r じゅうたん  J 玉座  U たいまつ
//       A 入口  V 村  & 城  O 泡の壁  _ 階段

const isNight = () => F.sento && !F.awake;
const igyoTime = () => F.sento && !F.final;
const normalTime = () => !F.sento || F.final;

const MAPS = {
  // ---------------- 絹ごし町 ----------------
  town: {
    name: '絹ごし町', showName: true,
    bgm: () => (igyoTime() ? 'mystery' : (F.final ? 'ending' : 'town')),
    tiles: [
      'TTTTTTTTTTTT==TTTTTTTTTT~~TT',
      'T,..........==..........~~,T',
      'T.RRRRR.....==...RRRRRRR~~.T',
      'T.RRRRR..,..==...RRRRRRR~~.T',
      'T.WWdWW.....==...WWWNWWW~~.T',
      'T...=.......==......=...~~.T',
      'T...====================~~.T',
      'T.......p...==....p.....~~.T',
      'T.RRRRRRR...==...RRRRR..~~.T',
      'T.RRRRRRR...==...RRRRR..~~.T',
      'T.WWWNWWW...==...WWdWW..~~.T',
      'T....=......==.....=...p~~.T',
      'T....==================.~~.T',
      'T...........==..........~~.T',
      'T.QQQQ..QQQQ==..FFFFFFF.~~.T',
      'T.QQQQ..QQQQ==..F,,,,,F.~~.T',
      'T.WdWW..WWdW==..F,,,,,F.~~.T',
      'T..=......=.==..FFF.FFF.~~.T',
      'T..===========..........~~.T',
      'T.......,...............~~.T',
      'T.......................~~.T',
      'TTTTTTTTTTTTTTTTTTTTTTTT~~TT',
    ],
    mods: () => (F.bridge ? [{ x: 23, y: 11, t: '=' }, { x: 24, y: 11, t: 'B' }, { x: 25, y: 11, t: 'B' }] : []),
    tint: () => (isNight() ? 'rgba(12,14,60,0.45)' : null),
    warps: [
      { x: 12, y: 0, to: 'field1', tx: 11, ty: 18, dir: 'up', cond: () => F.sento },
      { x: 13, y: 0, to: 'field1', tx: 11, ty: 18, dir: 'up', cond: () => F.sento },
      { x: 5, y: 10, to: 'shop_in', tx: 5, ty: 6, dir: 'up' },
      { x: 20, y: 4, to: 'sento_in', tx: 6, ty: 9, dir: 'up' },
      { x: 26, y: 11, to: 'field2', tx: 1, ty: 15, dir: 'right', cond: () => F.bridge },
    ],
    events: [
      { type: 'step', x: 12, y: 1, cond: () => !F.sento, run: () => Story.notYet() },
      { type: 'step', x: 13, y: 1, cond: () => !F.sento, run: () => Story.notYet() },
      { type: 'check', x: 23, y: 11, cond: () => !F.bridge, run: () => Story.pole() },
      { type: 'check', x: 8, y: 7, run: () => say('でんしんばしらだ。') },
      { type: 'check', x: 18, y: 7, run: () => say('でんしんばしらだ。') },
    ],
    npcs: [
      { id: 'cart', x: 7, y: 11, spr: 'cart', still: true, talk: () => Story.cart() },
      { id: 'w1', x: 8, y: 13, spr: 'woman', wander: true, when: normalTime,
        talk: () => (F.final ? say('ツルピカ丸さん！ なんだか ながい ゆめを みていた きがするわ。') : say('あら ツルピカ丸さん。きょうも おつかれさま。\nまんぷく湯で ゆっくり してらっしゃいな。')) },
      { id: 'k1', x: 15, y: 5, spr: 'kid', wander: true, when: normalTime,
        talk: () => (F.final ? say('きょじんの きょうだいが 町に きてるんだぜ！\nでっかいなあ！') : say('まんぷく湯の ゆけむり、さいきん やけに こいんだって！\nなにか いるのかな？')) },
      { id: 'e1', x: 6, y: 19, spr: 'elder', wander: true, when: normalTime,
        talk: () => say('せかいの はてには なきむしの きょじんが すむという。\nむかしばなしじゃよ。ほっほっ。') },
      { id: 'm1', x: 20, y: 13, spr: 'man', wander: true, when: normalTime,
        talk: () => (F.final ? say('あれ？ でんしんばしらが おれてるぞ。\nだれが やったんだ？') : say('でんしんばしらって じょうぶだよなあ。\nなにが あっても たおれやしないさ。')) },
      { id: 'i1', x: 8, y: 13, spr: 'igyo1', wander: true, when: igyoTime, talk: () => say('ポコ… ポコポコ…') },
      { id: 'i2', x: 15, y: 5, spr: 'igyo2', wander: true, when: igyoTime, talk: () => say('ヌルリ… ヌルル…') },
      { id: 'i3', x: 6, y: 19, spr: 'igyo4', wander: true, when: igyoTime, talk: () => say('ウゴゴ… トーフ… ウゴ…') },
      { id: 'i4', x: 20, y: 13, spr: 'igyo3', wander: true, when: igyoTime, talk: () => say('……。\n（じっと こちらを みている）') },
      { id: 'mata', x: 14, y: 18, spr: 'matanini', size: 3, still: true, when: () => F.final, talk: () => say('マタニーニ「ツルピカマル、トウフ、ウマイ！」') },
      { id: 'waki', x: 18, y: 18, spr: 'wakinini', size: 3, still: true, when: () => F.final, talk: () => say('ワキニーニ「ないたら すっきりした。\nあのときは すまなかったな。」') },
    ],
  },

  // ---------------- 豆腐屋 ----------------
  shop_in: {
    name: 'とうふ屋 ツルピカ堂', bgm: () => (igyoTime() ? 'mystery' : 'town'),
    tiles: [
      'WWWWWWWWWWWW',
      'WYYYfffffyyW',
      'WffffffffffW',
      'WccccffffffW',
      'WffffffffffW',
      'WfffffffffvW',
      'WfffffffffvW',
      'WWWWWNWWWWWW',
    ],
    tint: () => (isNight() ? 'rgba(12,14,60,0.35)' : null),
    warps: [{ x: 5, y: 7, to: 'town', tx: 5, ty: 11, dir: 'down' }],
    events: [
      { type: 'check', x: 9, y: 1, run: () => Story.book() },
      { type: 'check', x: 10, y: 1, run: () => Story.book() },
      { type: 'check', x: 1, y: 1, run: () => say('すずしげな みずの なかに とうふが しずんでいる。') },
      { type: 'check', x: 2, y: 1, run: () => say('すずしげな みずの なかに とうふが しずんでいる。') },
      { type: 'check', x: 3, y: 1, run: () => say('すずしげな みずの なかに とうふが しずんでいる。') },
      { type: 'check', x: 1, y: 3, run: () => Story.register() },
      { type: 'check', x: 2, y: 3, run: () => Story.register() },
      { type: 'check', x: 3, y: 3, run: () => Story.register() },
      { type: 'check', x: 4, y: 3, run: () => Story.register() },
      { type: 'check', x: 10, y: 5, run: () => Story.homeBed() },
      { type: 'check', x: 10, y: 6, run: () => Story.homeBed() },
    ],
    npcs: [
      { id: 'oba', x: 7, y: 4, spr: 'woman', when: () => !F.sento,
        talk: () => say('ツルピカ丸さん、きょうも おいしい とうふを ありがとね。', 'あんた かおいろが わるいよ。\nたまには まんぷく湯で ゆっくり しておいで。') },
    ],
  },

  // ---------------- 銭湯 まんぷく湯 ----------------
  sento_in: {
    name: '銭湯 まんぷく湯', bgm: () => (igyoTime() ? 'mystery' : 'town'),
    tiles: [
      'WWWWWWWWWWWWWW',
      'WttttttttttttW',
      'WtbbbbbbbbbbtW',
      'WtbbbbbbbbbbtW',
      'WttttttttttttW',
      'WWWWWWttWWWWWW',
      'WLLLffffffLLLW',
      'WffffffffffffW',
      'WffffffffffffW',
      'WffffffffffffW',
      'WWWWWWNWWWWWWW',
    ],
    warps: [{ x: 6, y: 10, to: 'town', tx: 20, ty: 5, dir: 'down' }],
    events: [
      { type: 'step', x: 6, y: 4, cond: () => !F.sento, run: () => Story.sento() },
      { type: 'step', x: 7, y: 4, cond: () => !F.sento, run: () => Story.sento() },
      { type: 'check', x: 1, y: 6, run: () => Story.locker() },
      { type: 'check', x: 2, y: 6, run: () => Story.locker() },
      { type: 'check', x: 3, y: 6, run: () => Story.locker() },
      { type: 'check', x: 10, y: 6, run: () => Story.locker() },
      { type: 'check', x: 11, y: 6, run: () => Story.locker() },
      { type: 'check', x: 12, y: 6, run: () => Story.locker() },
    ],
    overlay: (c, cx, cy) => {
      const thick = F.steam ? 0.5 : 0.18;
      for (let i = 0; i < 9; i++) {
        const t = frameCount / 90 + i * 1.7;
        const x = ((i * 61 + frameCount * 0.3) % (14 * TS)) - cx;
        const y = 1.2 * TS + Math.sin(t) * 18 + (i % 3) * 30 - cy;
        c.fillStyle = `rgba(255,255,255,${thick})`;
        c.beginPath(); c.ellipse(x, y, 46, 18, 0, 0, Math.PI * 2); c.fill();
      }
    },
    npcs: [
      { id: 'bandai', x: 2, y: 8, spr: 'bandai', when: normalTime,
        talk: () => say('いらっしゃい。\n…きょうは やけに ゆけむりが こいねえ。') },
      { id: 'c1', x: 3, y: 1, spr: 'man', when: normalTime, talk: () => say('ふぃ〜 いい ゆだ。\nしごとの つかれが とけていくよ。') },
      { id: 'c2', x: 10, y: 1, spr: 'elder', when: normalTime, talk: () => say('ゆけむりで まえが みえんわい。') },
      { id: 'ib', x: 2, y: 8, spr: 'igyo5', when: igyoTime, talk: () => say('ポヨ… イラッシャ… ポヨ…') },
      { id: 'i1', x: 3, y: 1, spr: 'igyo1', when: igyoTime, talk: () => say('ブクブク… ブク…') },
      { id: 'i2', x: 10, y: 1, spr: 'igyo3', when: igyoTime, talk: () => say('ユ… ユゲ… ユゲゲ…') },
      { id: 'rk', x: 7, y: 3, spr: 'rakki', bob: true, when: () => F.rakkiShow },
      { id: 'kinuE', x: 9, y: 4, spr: 'kinu', when: () => F.final && partyHas('kinu'), talk: () => say('キヌ「ここの おゆ、いい おゆね！」') },
      { id: 'rkE', x: 5, y: 3, spr: 'rakki', bob: true, when: () => F.final, talk: () => say('ラッキアーノ「キュ～♪」') },
    ],
  },

  // ---------------- 町の北の平原 ----------------
  field1: {
    name: 'きぬごし平原', showName: true, bgm: () => (isNight() ? 'mystery' : 'field'),
    enc: 'field1', battleBg: () => (isNight() ? 'night' : 'field'),
    tiles: [
      'MMMMMMMMMMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMAMMMMMMMMMMMM',
      'MMMMMMMMM..=..MMMMMMMMMM',
      'MMMMMMM....=....MMMMMMMM',
      'TTTT.......=.......TTTTT',
      'TT.........=.........TTT',
      'T....,.....=....T......T',
      'T..TT......=...TTT.....T',
      'T..TT.....==.........,.T',
      'T.........=......TT....T',
      'T...,.....=......TT....T',
      'T.........==...........T',
      'TT.........=.....,....TT',
      'TTT....TT..=..........TT',
      'T......TT..=.....TT....T',
      'T..........=.....TT....T',
      'T....,.....=...........T',
      'TT.........=..........TT',
      'TTT........=.........TTT',
      'TTTTTTTTTTT=TTTTTTTTTTTT',
    ],
    tint: () => (isNight() ? 'rgba(12,14,60,0.38)' : null),
    warps: [
      { x: 11, y: 19, to: 'town', tx: 12, ty: 1, dir: 'down' },
      { x: 11, y: 1, to: 'yugeyama', tx: 10, ty: 22, dir: 'up' },
    ],
    chests: [{ id: 'c1', x: 21, y: 8, item: 'tofu', n: 2 }, { id: 'c2', x: 2, y: 16, gold: 20 }],
    npcs: [],
  },

  // ---------------- ゆげ山 ----------------
  yugeyama: {
    name: 'ゆげ山', showName: true, bgm: 'dungeon',
    enc: 'yama', battleBg: () => (isNight() ? 'night' : 'mountain'),
    tiles: [
      'MMMMMMMMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMAMMMMMM',
      'MMMMMMMMMMMMMM.=.MMMMM',
      'MM...MMMMMMMMM.=..MMMM',
      'MM.x.MMMM.....==..MMMM',
      'MM...MMMM.MMMM....MMMM',
      'MM=MMMMMM.MMMMMMM.MMMM',
      'MM====....MMMMMMM.MMMM',
      'MMMMM=MMMMMMMM....MMMM',
      'MMMMM=MMMMMMMM.MMMMMMM',
      'MMM..=...MMMMM.MMMMMMM',
      'MMM.QQQ..MMMMM.....MMM',
      'MMM.WdW.......===..MMM',
      'MMM.....=MMMM..=MMMMMM',
      'MMMMMMMM=MMMM..=MMMMMM',
      'MMMMMMMM=MMMMMM=MMMMMM',
      'MM......=......=....MM',
      'MM.MMMMMMMMMMMMMMMM.MM',
      'MM.M...........M....MM',
      'MM.M.MMMMMMMMM.M..MMMM',
      'MM...........M....MMMM',
      'MMMMMM.MMMMM.MMMMMMMMM',
      'MMMMMM.......MMMMMMMMM',
      'MMMMMMMMMMAMMMMMMMMMMM',
    ],
    tint: () => (isNight() ? 'rgba(12,14,60,0.38)' : null),
    warps: [
      { x: 10, y: 23, to: 'field1', tx: 11, ty: 2, dir: 'down' },
      { x: 15, y: 1, to: 'hill', tx: 11, ty: 16, dir: 'up' },
    ],
    chests: [
      { id: 'c1', x: 2, y: 3, equip: 'monohoshi' },
      { id: 'c2', x: 16, y: 19, equip: 'dotera' },
      { id: 'c3', x: 17, y: 20, item: 'tofu', n: 3 },
    ],
    npcs: [{ id: 'hermit', x: 3, y: 12, spr: 'hermit', talk: () => Story.hermit() }],
  },

  // ---------------- まめ丘 ----------------
  hill: {
    name: 'まめ丘', showName: true, bgm: () => (isNight() ? 'mystery' : 'field'),
    enc: 'hill', battleBg: () => (isNight() ? 'night' : 'hill'),
    tiles: [
      'TTTTTTTTTTT=TTTTTTTTTTTT',
      'TT.h.hh....=...hh.h...TT',
      'T.hhh..h...=..h....hh..T',
      'T..h.....hh=hh.....h...T',
      'T.....h....=....h......T',
      'T..hh.....h=h......hh..T',
      'Th..h.....=.....h..hh..T',
      'T......h..=.......h....T',
      'T..hh.....=..hh........T',
      'T....h....==.....h..h..T',
      'T.h........=...h.......T',
      'T...hh.....=.....hhh...T',
      'T.h....h...=.h.........T',
      'T.....h....=......h.h..T',
      'Th..h......=...h.......T',
      'T....hh....=.......hh..T',
      'TT.........=..........TT',
      'TTTTTTTTTTT=TTTTTTTTTTTT',
    ],
    tint: () => (isNight() ? 'rgba(12,14,60,0.38)' : null),
    warps: [
      { x: 11, y: 17, to: 'yugeyama', tx: 15, ty: 2, dir: 'down' },
      { x: 11, y: 0, to: 'worldend', tx: 8, ty: 12, dir: 'up' },
    ],
    chests: [{ id: 'c1', x: 21, y: 12, gold: 40 }, { id: 'c2', x: 3, y: 4, item: 'tofu', n: 2 }],
    npcs: [],
  },

  // ---------------- 世界の果て ----------------
  worldend: {
    name: '世界の果て', showName: true, bgm: () => (F.awake ? 'field' : 'mystery'),
    tiles: [
      'EEEEEEEEEEEEEEEEEE',
      'EEEEEEEEEEEEEEEEEE',
      'EEEEESSSSSSSSEEEEE',
      'EEEESSSSSSSSSSEEEE',
      'EEESSSSSSSSSSSSEEE',
      'EEESSSSSSSSSSSSEEE',
      'EEESSSSSSSSSSSSEEE',
      'EEEESSSSSSSSSSEEEE',
      'EEEEESSSSSSSSEEEEE',
      'EEEEEESSSSSSEEEEEE',
      'EEEEEEESSSSEEEEEEE',
      'EEEEEEESSSSEEEEEEE',
      'EEEEEEESSSSEEEEEEE',
      'EEEEEEESSSSEEEEEEE',
    ],
    outside: 'E',
    warps: [
      { x: 8, y: 13, to: 'hill', tx: 11, ty: 1, dir: 'down' },
      { x: 9, y: 13, to: 'hill', tx: 11, ty: 1, dir: 'down' },
    ],
    events: [5, 6, 7, 8, 9, 10, 11, 12].map(x => ({ type: 'step', x, y: 8, cond: () => !F.awake, run: () => Story.matanini() })),
    npcs: [
      { id: 'mata', x: 7, y: 3, spr: 'matanini', size: 3, still: true,
        talk: () => say('マタニーニは にこにこ している。', 'マタニーニ「ニイチャン… ゲンキ カナ…」'),
        overlay: (c, x, y, s) => {
          if (!F.crying) return;
          c.fillStyle = '#7ac8ff';
          for (let i = 0; i < 6; i++) {
            const k = (frameCount * 2 + i * 13) % 40;
            c.fillRect(x + s * 0.22 - i % 2 * 30, y + s * 0.3 + k, 6, 9);
            c.fillRect(x + s * 0.72 + i % 2 * 30, y + s * 0.3 + k, 6, 9);
          }
        } },
    ],
  },

  // ---------------- ニガリ平原 ----------------
  field2: {
    name: 'ニガリ平原', showName: true, bgm: 'field',
    enc: x => (x <= 15 ? (!F.kinu && x <= 8 ? null : 'field2w') : 'field2e'),
    battleBg: () => (MapScene.tile(G.x, G.y) === 'w' ? 'swamp' : 'field'),
    tiles: [
      'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMAMMMMMMMMMwwwwwwwwwwwwMM',
      'MMMM....MMM.=.MMMMMMMwwwwww&wwwwwwMM',
      'MM.......T..=..TTMMMwwwwwwwwwwwwwwMM',
      'M..T........=..TT.....wwwwwwwwwwwwMM',
      'M...........=..TT......wwwwwwwwwwwMM',
      'M....,......=..MM.......wwwwwwwwwwMM',
      'M...........=..MM..T.....,.wwwwwwwMM',
      'M....V=======..MM.............wwwwMM',
      'M...........=..MM...T.........,..wMM',
      'MT..........=..MM.................MM',
      'M...TT......=..MM....TT...........MM',
      'M...TT......=====...........T.....MM',
      'M...........=..MM.....,.......~~..MM',
      'M.....,.....=..MM.......T....~~~..MM',
      '=============..MM.....TT.....~~...MM',
      'M...........=..MM...........~~....MM',
      'M..TT.......=..MM..........~~.....MM',
      'M..TT.......=..MM.......V.........MM',
      'M...........=..MM...,.............MM',
      'M.....,.....=..MM.................MM',
      'MTT.........=..MMTT..........TT...MM',
      'MMMTT.......=.MMMMMM.........TTT..MM',
      'MMMMMM......=MMMMMMMM.......TTTTMMMM',
      'MMMMMMMM....=MMMMMMMMMMMMMMMMMMMMMMM',
      'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
    ],
    mods: () => (F.cave_boss ? [] : [{ x: 15, y: 12, t: 'O' }, { x: 16, y: 12, t: 'O' }]),
    warps: [
      { x: 0, y: 15, to: 'town', tx: 26, ty: 11, dir: 'left' },
      { x: 5, y: 8, to: 'okara', tx: 12, ty: 14, dir: 'up' },
      { x: 12, y: 1, to: 'cave', tx: 11, ty: 20, dir: 'up' },
      { x: 24, y: 18, to: 'aburaage', tx: 12, ty: 16, dir: 'up' },
      { x: 27, y: 2, to: 'castle', tx: 11, ty: 24, dir: 'up', cond: () => F.barrier },
    ],
    events: [
      { type: 'step', x: 27, y: 2, cond: () => !F.barrier, run: () => Story.castleGate() },
      { type: 'check', x: 15, y: 12, cond: () => !F.cave_boss, run: () => Story.foam() },
      { type: 'check', x: 16, y: 12, cond: () => !F.cave_boss, run: () => Story.foam() },
    ],
    chests: [{ id: 'c1', x: 12, y: 24, gold: 150 }, { id: 'c2', x: 33, y: 20, item: 'momen', n: 2 }],
    npcs: [],
  },

  // ---------------- おから村 ----------------
  okara: {
    name: 'おから村', showName: true, bgm: 'town',
    tiles: [
      'TTTTTTTTTTTTTTTTTTTTTT',
      'T....................T',
      'T.QQQQ....RRRRR..QQQ.T',
      'T.QQQQ....RRRRR..QQQ.T',
      'T.WWNW....WWNWW..WdW.T',
      'T...=.......=........T',
      'T...=========........T',
      'T.......,...=....,...T',
      'T..FFFF.....=..QQQQ..T',
      'T..F,,F.....=..QQQQ..T',
      'T..F,,F.....=..WdWW..T',
      'T..FF.F.....=........T',
      'T...........=.....,..T',
      'T....,......=........T',
      'T...........=........T',
      'TTTTTTTTTTTT=TTTTTTTTT',
    ],
    warps: [{ x: 12, y: 15, to: 'field2', tx: 5, ty: 9, dir: 'down' }],
    events: [
      { type: 'step', x: 4, y: 4, run: () => Story.counter(() => inn(10, 'おから村の やどや')) },
      { type: 'step', x: 12, y: 4, run: () => Story.counter(() => shop(['tofu', 'momen', 'tonyu', 'okara', 'hocho', 'happi', 'yumoita', 'yukata'], 'よろずや へ ようこそ！ なにを おもとめで？')) },
    ],
    npcs: [
      { id: 'elder', x: 18, y: 5, spr: 'elder', talk: () => Story.okaraElder() },
      { id: 'kinu', x: 17, y: 11, spr: 'kinu', when: () => !F.kinu, talk: () => Story.kinu() },
      { id: 'gp', x: 19, y: 12, spr: 'igyo1', wander: true, when: () => !F.final, talk: () => say('ムニャ… キヌ… ムニャ…') },
      { id: 'w', x: 9, y: 12, spr: 'woman', wander: true,
        talk: () => say('さいきん ひがしの ほらあなから へんな ゆけむりが ふきだしているの。', 'あれを すった ひとは みんな すがたが かわって しまって…') },
      { id: 'kid', x: 7, y: 7, spr: 'kid', wander: true, talk: () => (F.kinu ? say('キヌねえちゃんを たのんだぜ！') : say('キヌねえちゃんは この むらで いちばんの ゆもみむすめ なんだぜ！')) },
      { id: 'i', x: 6, y: 13, spr: 'igyo5', wander: true, talk: () => say('ポヨ… ポヨヨ…') },
    ],
  },

  // ---------------- ゆけむり洞窟 ----------------
  cave: {
    name: 'ゆけむり洞窟', showName: true, bgm: 'dungeon',
    enc: 'cave', battleBg: 'cave',
    tiles: [
      'XXXXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXCCCCCCXXXXXXXXX',
      'XXXXXXXXXCCCCCCXXXXXXXXX',
      'XXXXXXXXXCCCCCCXXXXXXXXX',
      'XXXXXXXXXXXCCXXXXXXXXXXX',
      'XCCCCCXXXXXCCXXXXCCCCCXX',
      'XCxCCCCCCCCCCCCCCCCCxCXX',
      'XCCCCCXXXXXXXXXXXCCCCCXX',
      'XXXCXXXXXXXXXXXXXXXCXXXX',
      'XXXCXXXCCCCCCCCXXXXCXXXX',
      'XXXCCCCCxCCCCCCXXXXCXXXX',
      'XXXXXXXCCCCCCxCCCCCCXXXX',
      'XXXXXXXCCCXXXXXXXXXXXXXX',
      'XCCCCCCCCCXXXXCCCCCCCXXX',
      'XCXXXXXXXXXXXXCXXXXXCXXX',
      'XCXXCCCCCCCCCCCXXCCCCXXX',
      'XCCCCXXXXXXXXXXXXCXXXXXX',
      'XXXXXXXXXCCCCCCCCCXXXXXX',
      'XXXXXXXXXCXXXXXXXXXXXXXX',
      'XXXXXXXXXCCCCXXXXXXXXXXX',
      'XXXXXXXXXXXCCXXXXXXXXXXX',
      'XXXXXXXXXXX_XXXXXXXXXXXX',
    ],
    overlay: (c, cx, cy) => {
      for (let i = 0; i < 6; i++) {
        const x = ((i * 113 + frameCount * 0.25) % (24 * TS)) - cx;
        const y = ((i * 157) % (22 * TS)) - cy + Math.sin(frameCount / 60 + i) * 12;
        c.fillStyle = 'rgba(230,230,255,0.10)';
        c.beginPath(); c.ellipse(x, y, 80, 30, 0, 0, Math.PI * 2); c.fill();
      }
    },
    warps: [{ x: 11, y: 21, to: 'field2', tx: 12, ty: 2, dir: 'down' }],
    events: [9, 10, 11, 12, 13, 14].map(x => ({ type: 'step', x, y: 3, cond: () => !F.cave_boss, run: () => Story.caveBoss() })),
    chests: [
      { id: 'c1', x: 1, y: 5, item: 'tonyu', n: 2 },
      { id: 'c2', x: 21, y: 5, gold: 200 },
      { id: 'c3', x: 9, y: 12, item: 'momen', n: 3 },
      { id: 'c4', x: 14, y: 9, gold: 120 },
    ],
    npcs: [
      { id: 'boss', x: 11, y: 1, spr: 'boss_bubble', size: 2, bob: true, when: () => !F.cave_boss },
      { id: 'rk', x: 9, y: 1, spr: 'rakki', bob: true, when: () => !F.rakki,
        talk: () => say('ラッキアーノ「キュ～…」'),
        overlay: (c, x, y, s) => {
          if (F.cave_boss) return;
          c.fillStyle = '#5a5468';
          for (let i = 0; i < 5; i++) c.fillRect(x + 2 + i * 7, y - 2, 3, s + 2);
          c.fillRect(x, y - 2, s, 3); c.fillRect(x, y + s - 2, s, 3);
        } },
    ],
  },

  // ---------------- あぶらあげシティ ----------------
  aburaage: {
    name: 'あぶらあげシティ', showName: true, bgm: 'town',
    tiles: [
      '########################',
      '#......................#',
      '#.QQQQQ...RRRRR..QQQQ..#',
      '#.QQQQQ...RRRRR..QQQQ..#',
      '#.WWNWW...WWNWW..WWdW..#',
      '#...=.......=..........#',
      '#...=========..........#',
      '#...........=....p.....#',
      '#..RRRR.....=...RRRRR..#',
      '#..RRRR.....=...RRRRR..#',
      '#..WdWW.....=...WWNWW..#',
      '#...........=.....=....#',
      '#...p.......=======....#',
      '#...........=..........#',
      '#..,....,...=.....,....#',
      '#...........=..........#',
      '#...........=..........#',
      '############=###########',
    ],
    warps: [{ x: 12, y: 17, to: 'field2', tx: 24, ty: 19, dir: 'down' }],
    events: [
      { type: 'step', x: 4, y: 4, run: () => Story.counter(() => inn(30, 'あぶらあげホテル')) },
      { type: 'step', x: 12, y: 4, run: () => Story.counter(() => shop(['momen', 'atsuage', 'tonyu', 'okara', 'yunohana', 'fruit', 'coffee', 'nigari_sword', 'atsuage_armor', 'hinoki', 'tenugui', 'suzu', 'ribbon'], 'あぶらあげ百貨店へ ようこそ！')) },
      { type: 'step', x: 18, y: 10, run: () => Story.counter(() => Story.scholar()) },
      { type: 'check', x: 17, y: 7, run: () => say('でんしんばしらだ。\n…いまの ツルピカ丸なら かんたんに おれそうだ。') },
      { type: 'check', x: 4, y: 12, run: () => say('でんしんばしらだ。') },
    ],
    npcs: [
      { id: 'm', x: 7, y: 13, spr: 'man', wander: true, talk: () => say('ひがしの どくぬまを あるくと からだに どくだよ。\nきを つけな。') },
      { id: 'w', x: 15, y: 6, spr: 'woman', wander: true, talk: () => say('ワキニーニは もとは やさしい きょじん だったって はなしよ。', 'いつから あんなふうに なっちゃったのかしら。') },
      { id: 'mer', x: 9, y: 5, spr: 'merchant', wander: true, talk: () => say('あぶらあげシティ めいぶつ フルーツぎゅうにゅう！\nふろあがりに さいこうだよ。') },
      { id: 'i1', x: 18, y: 14, spr: 'igyo4', wander: true, when: () => !F.final, talk: () => say('ウゴ… アブラ… アゲ…') },
      { id: 'i2', x: 5, y: 15, spr: 'igyo2', wander: true, when: () => !F.final, talk: () => say('ヌル… ヌルル…') },
      { id: 'g', x: 20, y: 5, spr: 'man', talk: () => say('この まちの ひとも はんぶんは すがたが かわっちまった。', 'でも どうしてかな。\nない ている こどもだけは ぶじ だったんだ。') },
    ],
  },

  // ---------------- ワキニーニの城 ----------------
  castle: {
    name: 'ワキニーニの城', showName: true, bgm: 'castle',
    enc: 'castle', battleBg: 'castle',
    tiles: [
      'kkkkkkkkkkkkkkkkkkkkkk',
      'kkkkkUkkkkkkkkkkUkkkkk',
      'kkkkkKKKKKKJKKKKKkkkkk',
      'kkkkkKKKKKKrKKKKKkkkkk',
      'kkkkkKKKKKKrKKKKKkkkkk',
      'kkkkkKKKKKKrKKKKKkkkkk',
      'kkkkkKKKKKKrKKKKKkkkkk',
      'kkkkkKKKKKKrKKKKKkkkkk',
      'kkkkkkkkkkkrkkkkkkkkkk',
      'kkkkkkkkkkKrKkkkkkkkkk',
      'kkkkkkkkkkKrKkkkkkkkkk',
      'kKKKKKKKKKKrKKKKKKKKKk',
      'kKkkkkkkkkkrkkkkkkkkKk',
      'kKkKKKKKKkkrkkKKKKKkKk',
      'kKkKkkkkKkkrkkKkkkKkKk',
      'kKKKkKKKKkkrkkKKKKkKKk',
      'kkkkkKkkkkkrkkkkkkkKkk',
      'kkkkkUkkkkkrkkkkkUkkkk',
      'kKKKKKKKKKKrKKKKKKKKKk',
      'kKkkkkkkkkkrkkkkkkkkKk',
      'kKkKKKKKkkkrkkkKKKKkKk',
      'kKKKkkkKkkkrkkkKkkKKKk',
      'kkkkkkkKkkkrkkkKkkkkkk',
      'kkkkkkkkkkKrKkkkkkkkkk',
      'kkkkkkkkkkKrKkkkkkkkkk',
      'kkkkkkkkkkk_kkkkkkkkkk',
    ],
    warps: [{ x: 11, y: 25, to: 'field2', tx: 27, ty: 3, dir: 'down' }],
    events: [
      { type: 'step', x: 11, y: 10, cond: () => !F.warden, run: () => Story.warden() },
      { type: 'step', x: 11, y: 7, cond: () => !F.final, run: () => Story.finalBoss() },
    ],
    onEnter: () => Story.castleEnter(),
    chests: [
      { id: 'c1', x: 5, y: 16, equip: 'denchu' },
      { id: 'c2', x: 19, y: 16, equip: 'hagoromo' },
      { id: 'c3', x: 7, y: 22, item: 'atsuage', n: 2 },
      { id: 'c4', x: 15, y: 22, equip: 'koban' },
    ],
    npcs: [
      { id: 'warden', x: 11, y: 9, spr: 'warden', when: () => !F.warden },
      { id: 'waki', x: 10, y: 3, spr: 'wakinini', size: 3, still: true, when: () => !F.final },
    ],
  },
};
