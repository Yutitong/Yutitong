// ===== ゲームデータ：仲間・わざ・どうぐ・そうび・モンスター =====

// 累計経験値テーブル
function expForLevel(L) { return L <= 1 ? 0 : Math.floor(10 * Math.pow(L - 1, 2.4)); }
const MAX_LV = 30;

// 仲間：Lv1 の基礎値 + 1レベルごとの成長
const CHARS = {
  hero: {
    name: 'ツルピカ丸', title: '豆腐屋の主人', sprite: 'hero',
    base: { hp: 30, mp: 6, atk: 9, def: 5, agi: 5, int: 3 },
    grow: { hp: 9, mp: 2, atk: 2.7, def: 2.2, agi: 1.6, int: 1 },
    learn: [[3, 'tofu_throw'], [5, 'flash'], [8, 'cart_attack'], [11, 'power_up'], [15, 'pole_crash'], [19, 'namida_roar']],
  },
  kinu: {
    name: 'キヌ', title: '湯もみ娘', sprite: 'kinu',
    base: { hp: 22, mp: 14, atk: 6, def: 4, agi: 8, int: 8 },
    grow: { hp: 6.5, mp: 4, atk: 1.8, def: 1.7, agi: 2, int: 2.6 },
    learn: [[1, 'yumomi'], [1, 'atsuyu'], [7, 'nemuri'], [9, 'futtou'], [12, 'yumomi_mai'], [14, 'ikikaeri'], [18, 'dai_futtou']],
  },
  rakki: {
    name: 'ラッキアーノ', title: '激レアモンスター', sprite: 'rakki',
    base: { hp: 25, mp: 10, atk: 8, def: 6, agi: 12, int: 5 },
    grow: { hp: 7, mp: 3, atk: 2.3, def: 2, agi: 2.4, int: 1.8 },
    learn: [[1, 'lucky_punch'], [1, 'odori'], [10, 'kane'], [12, 'omamori'], [15, 'daikichi'], [18, 'lucky7']],
  },
};

// わざ
// target: enemy / enemies / ally / party / self / deadAlly / none
const SKILLS = {
  tofu_throw: { name: 'とうふなげ', mp: 2, target: 'enemy', kind: 'phys', power: 1.5, msg: '{u}は とうふを おもいきり なげつけた！', desc: '敵1体に 1.5倍の打撃' },
  flash: { name: 'ツルピカフラッシュ', mp: 3, target: 'enemies', kind: 'status', status: 'blind', rate: 0.75, msg: '{u}の あたまが まばゆく ひかった！', desc: '敵全体の 目をくらませる' },
  cart_attack: { name: 'リヤカーアタック', mp: 6, target: 'enemies', kind: 'phys', power: 0.9, msg: '{u}は リヤカーで なぎはらった！', desc: '敵全体に 打撃' },
  power_up: { name: 'ちからため', mp: 4, target: 'self', kind: 'buff', buff: 'atk', msg: '{u}は ぐっと ちからを ためた！', desc: '自分の攻撃力を 上げる' },
  pole_crash: { name: 'でんちゅうクラッシュ', mp: 10, target: 'enemy', kind: 'phys', power: 2.6, msg: '{u}の でんちゅうクラッシュ！', desc: '敵1体に 2.6倍の大打撃' },
  namida_roar: { name: 'なみだのおたけび', mp: 16, target: 'party', kind: 'roar', msg: '{u}は なみだを ながして さけんだ！', desc: '味方全体の 攻防を上げ 回復' },

  yumomi: { name: 'ゆもみ', mp: 3, target: 'ally', kind: 'heal', power: 30, scale: 1.0, msg: '{u}は ゆもみいたで あたたかい湯を かけた！', desc: '味方1人の HPを回復' },
  atsuyu: { name: 'あつゆ', mp: 3, target: 'enemy', kind: 'magic', power: 14, scale: 0.8, msg: '{u}は あつゆを あびせた！', desc: '敵1体に 熱湯' },
  nemuri: { name: 'ゆけむり', mp: 5, target: 'enemies', kind: 'status', status: 'sleep', rate: 0.6, msg: '{u}は やさしい ゆけむりを まいた！', desc: '敵全体を 眠らせる' },
  futtou: { name: 'ふっとう', mp: 8, target: 'enemies', kind: 'magic', power: 22, scale: 0.7, msg: '{u}は 湯を ふっとうさせた！', desc: '敵全体に 熱湯' },
  yumomi_mai: { name: 'ゆもみのまい', mp: 10, target: 'party', kind: 'heal', power: 45, scale: 0.9, msg: '{u}は ゆもみのまいを おどった！', desc: '味方全体の HPを回復' },
  ikikaeri: { name: 'いきかえりのゆ', mp: 15, target: 'deadAlly', kind: 'revive', msg: '{u}は いきかえりのゆを そそいだ！', desc: '倒れた味方を 生き返らせる' },
  dai_futtou: { name: 'だいふっとう', mp: 16, target: 'enemies', kind: 'magic', power: 60, scale: 1.0, msg: '{u}の だいふっとう！ 湯が うずをまく！', desc: '敵全体に 大熱湯' },

  lucky_punch: { name: 'ラッキーパンチ', mp: 2, target: 'enemy', kind: 'phys', power: 'lucky', msg: '{u}の ラッキーパンチ！', desc: '威力は 運しだい' },
  odori: { name: 'ふしぎなおどり', mp: 4, target: 'none', kind: 'odori', msg: '{u}は ふしぎなおどりを おどった！', desc: '何が起きるか わからない' },
  kane: { name: 'しあわせのかね', mp: 5, target: 'party', kind: 'buff', buff: 'def', msg: '{u}は しあわせのかねを ならした！', desc: '味方全体の 守備力を上げる' },
  omamori: { name: 'おまもり', mp: 3, target: 'ally', kind: 'cure', msg: '{u}は おまもりを かざした！', desc: '状態異常を治し 少し回復' },
  daikichi: { name: 'だいきち', mp: 14, target: 'party', kind: 'heal', power: 110, scale: 0.5, msg: '{u}の だいきち！ 福が まいこんだ！', desc: '味方全体を 大回復' },
  lucky7: { name: 'ラッキーセブン', mp: 12, target: 'none', kind: 'lucky7', msg: '{u}の ラッキーセブン！', desc: 'ランダムに 7回攻撃' },
};

// どうぐ
const ITEMS = {
  tofu: { name: 'とうふ', price: 8, kind: 'heal', power: 30, target: 'ally', desc: 'HPを 30 回復' },
  momen: { name: 'もめんどうふ', price: 40, kind: 'heal', power: 90, target: 'ally', desc: 'HPを 90 回復' },
  atsuage: { name: 'あつあげ', price: 150, kind: 'heal', power: 250, target: 'ally', desc: 'HPを 250 回復' },
  tonyu: { name: 'とうにゅう', price: 60, kind: 'mp', power: 25, target: 'ally', desc: 'MPを 25 回復' },
  okara: { name: 'おから', price: 12, kind: 'cure', target: 'ally', desc: 'どく・めくらましを治す' },
  yunohana: { name: 'ゆのはな', price: 200, kind: 'revive', target: 'deadAlly', desc: '倒れた味方を 生き返らせる' },
  coffee: { name: 'コーヒーぎゅうにゅう', price: 500, kind: 'full', target: 'ally', desc: 'HPとMPを 全回復' },
  fruit: { name: 'フルーツぎゅうにゅう', price: 300, kind: 'healAll', power: 150, target: 'party', desc: '味方全員の HPを150回復' },
  tear: { name: 'マタニーニのなみだ', key: true, desc: '巨人の大きな なみだ。ほんのり あたたかい' },
};

// そうび（who: 装備できる仲間）
const EQUIPS = {
  none_w: { name: 'すで', slot: 'weapon', atk: 0 },
  none_a: { name: 'はだか', slot: 'armor', def: 0 },
  shigotogi: { name: 'しごとぎ', slot: 'armor', who: 'hero', def: 2, price: 0 },
  monohoshi: { name: 'ものほしざお', slot: 'weapon', who: 'hero', atk: 6, price: 0 },
  dotera: { name: 'やまおとこのどてら', slot: 'armor', who: 'hero', def: 5, price: 0 },
  hocho: { name: 'とうふぼうちょう', slot: 'weapon', who: 'hero', atk: 14, price: 220 },
  happi: { name: 'はっぴ', slot: 'armor', who: 'hero', def: 8, price: 150 },
  nigari_sword: { name: 'にがりのたいけん', slot: 'weapon', who: 'hero', atk: 28, price: 650 },
  atsuage_armor: { name: 'あつあげよろい', slot: 'armor', who: 'hero', def: 18, price: 560 },
  denchu: { name: 'でんちゅうこんぼう', slot: 'weapon', who: 'hero', atk: 40, price: 0 },
  yumoita: { name: 'ゆもみいた', slot: 'weapon', who: 'kinu', atk: 8, price: 180 },
  yukata: { name: 'ゆかた', slot: 'armor', who: 'kinu', def: 6, price: 120 },
  hinoki: { name: 'ひのきおけのつえ', slot: 'weapon', who: 'kinu', atk: 16, price: 420 },
  tenugui: { name: 'てぬぐいローブ', slot: 'armor', who: 'kinu', def: 12, price: 380 },
  hagoromo: { name: 'ゆけむりのはごろも', slot: 'armor', who: 'kinu', def: 22, price: 0 },
  clover: { name: 'クローバーのかんむり', slot: 'armor', who: 'rakki', def: 6, price: 0 },
  suzu: { name: 'よつばのすず', slot: 'weapon', who: 'rakki', atk: 14, price: 360 },
  ribbon: { name: 'まねきのリボン', slot: 'armor', who: 'rakki', def: 12, price: 360 },
  koban: { name: 'おおばんこばん', slot: 'weapon', who: 'rakki', atk: 26, price: 0 },
};

// 敵のわざ
const ESKILLS = {
  tackle: { msg: '{u}の とげとげタックル！', kind: 'phys', power: 1.4 },
  bite: { msg: '{u}は かみついた！', kind: 'phys', power: 1.0, status: 'poison', rate: 0.4 },
  hot: { msg: '{u}は あつゆを はきかけた！', kind: 'magic', power: [7, 11], target: 'one' },
  song: { msg: '{u}は ねむりのうたを うたった！', kind: 'status', status: 'sleep', rate: 0.3, target: 'one' },
  blind: { msg: '{u}は 湯けむりで まどわした！', kind: 'status', status: 'blind', rate: 0.5, target: 'one' },
  bitter: { msg: '{u}は にがい いきを はいた！', kind: 'magic', power: [10, 14], target: 'all' },
  bubble: { msg: '{u}は あわを ふきつけた！', kind: 'magic', power: [20, 26], target: 'all' },
  bubble_big: { msg: '{u}の あわあわブレス！', kind: 'magic', power: [24, 32], target: 'all' },
  foam_armor: { msg: '{u}は あわのよろいを まとった！', kind: 'selfbuff', buff: 'def' },
  press: { msg: '{u}は のしかかった！', kind: 'phys', power: 1.5 },
  oil: { msg: '{u}は あつい あぶらを はねとばした！', kind: 'magic', power: [32, 40], target: 'all' },
  smell: { msg: '{u}は ぶきみな においを ただよわせた！', kind: 'magic', power: [36, 46], target: 'all', status: 'blind', rate: 0.25 },
  deo: { msg: '{u}は こおりつく いきを はいた！', kind: 'magic', power: [46, 58], target: 'all' },
  steam: { msg: '{u}は あつい ゆげを ふきだした！', kind: 'magic', power: [42, 54], target: 'all' },
  waki_wind: { msg: '{u}は うでを ふりあげた！ わきかぜが ふきあれる！', kind: 'magic', power: [42, 54], target: 'all', status: 'blind', rate: 0.3 },
  heat: { msg: '{u}の ねっぷう！', kind: 'magic', power: [50, 62], target: 'all' },
  glare: { msg: '{u}の ひとにらみ！', kind: 'status', status: 'sleep', rate: 0.4, target: 'one' },
  smash: { msg: '{u}は おおきく ふりかぶった！', kind: 'phys', power: 1.8 },
  heal_self: { msg: '{u}は ゆけむりを すいこんだ！', kind: 'healself', power: 0.08 },
  dance: { msg: '{u}は ふしぎなおどりを おどった！\nあたりが きらきらと ひかる…', kind: 'nothing' },
  flee: { msg: '{u}は にげだした！', kind: 'flee' },
};

// モンスター
// shape: Sprites のテンプレート / pal: 色 / acts: [行動, 重み]
const ENEMIES = {
  // 第1章
  yuge_slime: { name: 'ユゲスライム', shape: 'slime', pal: { y: '#9ad0f0', Y: '#5a9ac8' }, hp: 7, atk: 5, def: 2, agi: 3, exp: 3, gold: 3, drop: ['tofu', 0.1] },
  awaawa: { name: 'アワアワ', shape: 'bubble', pal: { y: '#c8ecfa', w: '#ffffff' }, hp: 5, atk: 4, def: 0, agi: 8, exp: 2, gold: 2 },
  okebat: { name: 'オケバット', shape: 'bat', pal: { y: '#d89a5a', Y: '#a86a32', w: '#5a4a6a' }, hp: 9, atk: 6, def: 2, agi: 7, exp: 4, gold: 5 },
  igaguri: { name: 'イガグリン', shape: 'spiky', pal: { y: '#a8783a', Y: '#6a4a1e' }, hp: 14, atk: 9, def: 6, agi: 3, exp: 6, gold: 7, acts: [['attack', 3], ['tackle', 1]] },
  yamanezumi: { name: 'ヤマネズミ', shape: 'rodent', pal: { y: '#a8a0a0', Y: '#6a6464', p: '#f0a0b0' }, hp: 11, atk: 8, def: 3, agi: 10, exp: 5, gold: 5, acts: [['attack', 3], ['bite', 1]] },
  atsuyu_slime: { name: 'アツユスライム', shape: 'slime', pal: { y: '#f08a6a', Y: '#c0503a' }, hp: 16, atk: 10, def: 4, agi: 4, exp: 7, gold: 8, acts: [['attack', 2], ['hot', 1]], drop: ['tofu', 0.15] },
  koroishi: { name: 'コロコロイシ', shape: 'spiky', pal: { y: '#9a9aa8', Y: '#5a5a68' }, hp: 20, atk: 12, def: 12, agi: 2, exp: 10, gold: 9, acts: [['attack', 3], ['tackle', 1]] },
  karasu: { name: 'ノハラガラス', shape: 'bat', pal: { y: '#3a3a4a', Y: '#20202a', w: '#2a2a3a', k: '#f0d040' }, hp: 16, atk: 11, def: 5, agi: 14, exp: 9, gold: 10 },
  mamedanuki: { name: 'マメダヌキ', shape: 'rodent', pal: { y: '#a8723a', Y: '#6a4a24', p: '#3a2a1e' }, hp: 20, atk: 11, def: 6, agi: 8, exp: 9, gold: 12, acts: [['attack', 4], ['song', 1]], drop: ['tofu', 0.2] },
  // 第2章
  daizuman: { name: 'ダイズマン', shape: 'bean', pal: { y: '#e8d08a', Y: '#b89a52' }, hp: 46, atk: 23, def: 14, agi: 8, exp: 24, gold: 20, drop: ['momen', 0.08] },
  natto: { name: 'ナットウヘビ', shape: 'snake', pal: { y: '#a8803a', Y: '#6a4a1e', r: '#e04040' }, hp: 40, atk: 21, def: 10, agi: 14, exp: 22, gold: 18, acts: [['attack', 2], ['bite', 1]], drop: ['okara', 0.15] },
  nigari: { name: 'ニガリスピリット', shape: 'ghost', pal: { w: '#c8e8f0' }, hp: 36, atk: 18, def: 8, agi: 16, exp: 22, gold: 18, acts: [['attack', 2], ['bitter', 1]] },
  awadama: { name: 'アワダマ', shape: 'bubble', pal: { y: '#8ac8f0', w: '#e0f4ff' }, hp: 72, atk: 35, def: 16, agi: 15, exp: 38, gold: 32, acts: [['attack', 3], ['bubble', 1]] },
  yukemuri: { name: 'ユケムリゴースト', shape: 'ghost', pal: { w: '#e8e4f0', k: '#5a4a8a' }, hp: 64, atk: 33, def: 12, agi: 18, exp: 40, gold: 30, acts: [['attack', 3], ['blind', 1]], drop: ['tonyu', 0.08] },
  sekken: { name: 'セッケンゴーレム', shape: 'golem', pal: { w: '#f8f4e8', y: '#f0b8c8', Y: '#c8889a' }, hp: 120, atk: 40, def: 28, agi: 5, exp: 54, gold: 42, acts: [['attack', 3], ['press', 1]] },
  awadama_king: { name: 'アワダマだいおう', shape: 'bubble', pal: { y: '#5aa0e0', w: '#ffffff', k: '#1a1018' }, hp: 560, atk: 46, def: 24, agi: 14, exp: 500, gold: 400, boss: true, scale: 9, acts: [['attack', 3], ['bubble_big', 2], ['press', 2], ['foam_armor', 1]] },
  // 第3章
  aburagen: { name: 'アブラーゲン', shape: 'igyo', pal: { w: '#f0c858', W: '#c89030', k: '#141018' }, hp: 105, atk: 52, def: 26, agi: 18, exp: 60, gold: 50, acts: [['attack', 3], ['oil', 1]], drop: ['momen', 0.1] },
  kouya: { name: 'コウヤナイト', shape: 'bean', pal: { y: '#d8c8a8', Y: '#9a8a6a', k: '#5a1a1a' }, hp: 130, atk: 57, def: 34, agi: 14, exp: 70, gold: 56, acts: [['attack', 3], ['smash', 1]] },
  dorodanuki: { name: 'ドロダヌキ', shape: 'rodent', pal: { y: '#7a5a8a', Y: '#4a3a5a', p: '#2a1a2a' }, hp: 100, atk: 54, def: 22, agi: 22, exp: 62, gold: 54, acts: [['attack', 3], ['song', 1]], drop: ['okara', 0.2] },
  wakiguard: { name: 'ワキガード', shape: 'bean', pal: { y: '#9a6ac8', Y: '#5a3a8a' }, hp: 170, atk: 70, def: 40, agi: 22, exp: 110, gold: 80, acts: [['attack', 3], ['smash', 1]] },
  asedaku: { name: 'アセダクスライム', shape: 'slime', pal: { y: '#d8e870', Y: '#9aa83a' }, hp: 150, atk: 66, def: 30, agi: 20, exp: 100, gold: 72, acts: [['attack', 2], ['bite', 1]], drop: ['atsuage', 0.06] },
  nioi: { name: 'ニオイゴースト', shape: 'ghost', pal: { w: '#a8d890', k: '#2a4a1a' }, hp: 150, atk: 64, def: 32, agi: 28, exp: 105, gold: 76, acts: [['attack', 2], ['smell', 1]] },
  deodragon: { name: 'デオドラゴン', shape: 'snake', pal: { y: '#a8d8f0', Y: '#5a8ab0', r: '#3a6ad0' }, hp: 230, atk: 78, def: 44, agi: 24, exp: 150, gold: 110, scale: 6, acts: [['attack', 2], ['deo', 1]], drop: ['tonyu', 0.12] },
  warden: { name: 'ゆげのばんにん', shape: 'golem', pal: { w: '#c8c4d8', y: '#7a6a9a', Y: '#4a3a6a' }, hp: 1450, atk: 78, def: 46, agi: 20, exp: 2000, gold: 1000, boss: true, scale: 9, actions: 2, acts: [['attack', 3], ['steam', 2], ['press', 1], ['heal_self', 1]] },
  wakinini: { name: 'ワキニーニ', shape: 'giant', pal: Sprites.PALS.wakinini, hp: 2300, atk: 86, def: 52, agi: 32, exp: 0, gold: 0, boss: true, scale: 10, actions: 2, acts: [['attack', 3], ['waki_wind', 2], ['heat', 1], ['glare', 1], ['smash', 2]] },
  // 特殊
  rakkiano: { name: 'ラッキアーノ', shape: 'rakki', pal: Sprites.PALS.rakki, hp: 999, atk: 0, def: 999, agi: 99, exp: 0, gold: 0, evade: 1, scale: 6, script: ['dance', 'flee'] },
};

// エンカウント表
const ENC = {
  field1: [['yuge_slime'], ['yuge_slime', 'yuge_slime'], ['awaawa', 'awaawa'], ['awaawa'], ['okebat'], ['yuge_slime', 'okebat']],
  yama: [['igaguri'], ['yamanezumi', 'yamanezumi'], ['atsuyu_slime'], ['igaguri', 'yamanezumi'], ['atsuyu_slime', 'yuge_slime'], ['okebat', 'okebat']],
  hill: [['koroishi'], ['karasu', 'karasu'], ['mamedanuki'], ['mamedanuki', 'karasu'], ['koroishi', 'atsuyu_slime'], ['karasu', 'karasu', 'karasu']],
  field2w: [['daizuman'], ['natto', 'natto'], ['nigari', 'nigari'], ['daizuman', 'natto'], ['nigari', 'daizuman'], ['natto', 'natto', 'nigari']],
  cave: [['awadama', 'awadama'], ['yukemuri', 'yukemuri'], ['sekken'], ['awadama', 'yukemuri'], ['sekken', 'awadama'], ['yukemuri', 'yukemuri', 'awadama']],
  field2e: [['aburagen'], ['kouya'], ['dorodanuki', 'dorodanuki'], ['aburagen', 'dorodanuki'], ['kouya', 'aburagen'], ['dorodanuki', 'dorodanuki', 'aburagen']],
  castle: [['wakiguard'], ['asedaku', 'asedaku'], ['nioi', 'nioi'], ['deodragon'], ['wakiguard', 'nioi'], ['asedaku', 'asedaku', 'nioi']],
};
