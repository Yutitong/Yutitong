// ===== ストーリー：イベントスクリプト =====

// 章タイトル表示
function chapter(num, title) {
  return new Promise(res => {
    let t = 0;
    const win = {
      draw() {
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = Math.min(1, t / 30);
        text(num, W / 2, H / 2 - 44, '#e8b84a', 20, 'center');
        text(title, W / 2, H / 2 - 4, '#f4f2ea', 30, 'center');
        ctx.globalAlpha = 1;
      },
      update() {
        t++;
        if (t > 200 || (t > 40 && Input.pressed('ok'))) { UI.remove(win); res(); }
      },
    };
    UI.push(win);
  });
}
async function joinParty(id, armor, weapon) {
  const c = makeChar(id, Math.max(1, G.party[0].lv));
  if (armor) c.armor = armor;
  if (weapon) c.weapon = weapon;
  G.party.push(c);
  Audio8.jingle('join');
  await say(`${CHARS[id].name}が なかまに くわわった！`);
}

const Story = {
  // ---------- 序章 ----------
  async opening() {
    FX.fade = 1; FX.fadeTarget = 1;
    Audio8.bgm('town');
    await wait(30);
    await say('ここは 絹ごし町。\nちいさな とうふ屋『ツルピカ堂』の あさは はやい。');
    await say('主人の ツルピカ丸は きょうも あさから ばんまで\nあくせく はたらいた。');
    await fadeIn(40);
    await say('ツルピカ丸「ふう… きょうも よく はたらいた。\nかたが ばきばきだ…」');
    await say('ツルピカ丸は しごとの つかれで ちからが でない。\n（メニューの「つよさ」で ようすが わかる）');
    await say('ツルピカ丸「しごとの つかれを とりに、\n銭湯に いくとしよう。」', '（銭湯 まんぷく湯は 町の 北東に ある）');
    G.lastInn = { map: 'shop_in', x: 9, y: 5 };
  },
  async notYet() {
    await say('ツルピカ丸「いや、まずは まんぷく湯で ひとっぷろ だ。」');
    await MapScene.walk('d');
  },
  async book() {
    await say('『きょじん きょうだいの でんせつ』という えほんだ。');
    if (await ask('よんでみますか？') !== 0) return;
    await say('せかいの はてに すむ なきむしの きょじん マタニーニ。', 'その あには ワキニーニ。\nワキニーニは ふしぎな ゆけむりを あやつり、\nひとの すがたを かえてしまうという……');
    await say('ツルピカ丸「こどもの ころ よく よんでもらったっけ。」');
    F.readBook = true;
  },
  async register() {
    if (!F.sento) return say('きょうの うりあげだ。\nあしたの しいれに つかう だいじな おかねだ。');
    if (!F.awake) return say('ツルピカ丸「レジどころじゃない！\nとにかく にげなくては！」');
    if (!F.money) {
      F.money = true;
      G.gold += 300; addItem('tofu', 5);
      Audio8.jingle('item');
      return say('レジに 300円 のこっていた。\nたびの しきんに しよう。', 'みせの とうふを 5ちょう もっていくことにした。');
    }
    return say('レジは からっぽだ。');
  },
  async homeBed() {
    if (await ask('ふとんだ。やすみますか？') !== 0) return;
    await rest();
    G.lastInn = { map: 'shop_in', x: 9, y: 5 };
    await say('ぐっすり ねむって げんきに なった！');
  },
  async locker() {
    if (!F.sento) return say('だれかの ロッカーだ。');
    if (F.locker) return say('からっぽの ロッカーだ。');
    F.locker = true;
    sfx('chest');
    await say('ロッカーの なかに ツルピカ丸の しごとぎが のこっていた！');
    await equipFound('shigotogi');
  },

  // ---------- 銭湯の事件 ----------
  async sento() {
    G.noSave = true;
    await say('ふう… ゆけむりが こくて まえが よく みえない。');
    F.steam = true;
    await wait(30);
    flash('#ffffff', 0.7); sfx('flash');
    F.rakkiShow = true; MapScene.refresh();
    await say('ゆぶねの なかで なにかが キラキラ ひかっている！');
    await say('ツルピカ丸「あれは… まさか！\nげきレア モンスター『ラッキアーノ』！？」', 'ツルピカ丸「みられたら いいことが あるっていう、あの…！」');
    await Battle.run(['rakkiano'], { bg: 'sento', noEscape: true, canLose: true, bgm: 'boss', intro: 'げきレアモンスター ラッキアーノが あらわれた！' });
    F.rakkiShow = false; MapScene.refresh();
    await say('ラッキアーノが きえると、\nゆけむりが いっきに こくなった……');
    Audio8.bgm(null);
    for (let i = 0; i < 3; i++) { flash('#ffffff', 1); await wait(12); }
    await fadeOut(40);
    F.sento = true;
    MapScene.refresh();
    await wait(30);
    await say('………', '……ゆけむりが はれていく。');
    Audio8.bgm('mystery');
    await fadeIn(60);
    await say('ツルピカ丸の まわりには——');
    shake(30, 5);
    await say('いぎょうの ものしか いなかったのだ！');
    await say('「ポコ…？」\n「ブクブク… ブク…」');
    await say('ツルピカ丸「な、な、なんだ これはーっ！？」');
    await say('ツルピカ丸は じんせい さいだいの ききに みまわれた！');
    await say('ツルピカ丸は おののいて、\nはだかの まま そとへ とびだした！');
    sfx('run');
    G.party[0].armor = 'none_a';
    await fadeOut(20);
    G.x = 20; G.y = 5; G.dir = 'down';
    MapScene.load('town');
    await fadeIn(20);
    await chapter('第1章', 'はだかの だっしゅつ');
    await say('ツルピカ丸「町の みんなまで…！\nどうなってるんだ！？」');
    await say('ツルピカ丸「とにかく ここから にげるんだ！」', '（町の 北から そとへ でられる）');
    G.noSave = false;
  },

  // ---------- ゆげ山の仙人 ----------
  async hermit() {
    if (!F.hermitMet) {
      F.hermitMet = true;
      await say('せんにん「おや、こんな よふけに はだかで やまのぼりかね。\nなにか わけが ありそうじゃな。」');
      await say('ツルピカ丸は これまでの ことを はなした。');
      await say('せんにん「ふうむ… ゆけむりで ひとの すがたが かわる、とな。」', 'せんにん「この さきの まめ丘を こえれば、せかいの はてじゃ。\nそこには ふしぎな きょじんが いると いうが…」');
      addItem('tofu', 3);
      Audio8.jingle('item');
      await say('せんにん「ほれ、やまの とうふじゃ。もっていきなされ。」\nとうふ×3 を もらった！');
    }
    if (await ask('せんにん「すこし やすんで いくかね？」') === 0) {
      await rest();
      G.lastInn = { map: 'yugeyama', x: 3, y: 13 };
      await say('せんにん「ほっほっ。げんきに なったようじゃな。」');
    } else await say('せんにん「むりは するでないぞ。」');
  },

  // ---------- 世界の果て：マタニーニ ----------
  async matanini() {
    G.noSave = true;
    Audio8.bgm(null);
    await wait(20);
    sfx('stomp'); shake(16, 4);
    await say('ズシン……');
    sfx('stomp'); shake(16, 6);
    await say('ズシン……！');
    await say('その めが みたのは、\nなぞの きょじん『マタニーニ』だった。');
    await say('ツルピカ丸「お、おれの じもとは\nどうなっちまったんだ……」');
    await say('ツルピカ丸は にげた！');
    sfx('run');
    await MapScene.walk('dd');
    await wait(20);
    await say('すると——');
    F.crying = true;
    sfx('cry');
    await say('マタニーニ「うわ～ん！！」');
    for (let i = 0; i < 4; i++) { sfx('stomp'); shake(14, 10); await wait(14); }
    await say('ドシドシ！ ドシドシ！', 'マタニーニは あしぶみして、おおなきした。');
    await say('それに おどろき、\nツルピカ丸も とうとう なきだしてしまった。');
    const r = await ask('ツルピカ丸は……', ['なく', 'こらえる']);
    if (r !== 0) await say('ツルピカ丸は こらえようとした。\n…しかし なみだが とまらない！');
    sfx('cry');
    await say('ツルピカ丸「うっ… うう… うわ～ん！！」');
    await wait(30);
    flash('#ffffff', 1);
    await say('すると、あら ふしぎ！');
    const hero = G.party[0];
    hero.fatigue = false;
    hero.hp = maxHp(hero); hero.mp = maxMp(hero);
    await Audio8.jingle('levelup');
    await say('ツルピカ丸の しごとの つかれが ふきとんだ！', '（こうげき・しゅび・すばやさが ほんらいの ちからに もどった！）');
    F.crying = false;
    await say('マタニーニは なきやんで、\nすっきりした かおを している。');
    addItem('tear');
    Audio8.jingle('item');
    await say('マタニーニの おおきな なみだが ひとつぶ\nころころと ころがってきた。', 'ツルピカ丸は マタニーニのなみだ を てにいれた！');
    await say('マタニーニ「……オマエ、イイヤツ。」', 'マタニーニ「オクッテク。」');
    await fadeOut(40);
    for (let i = 0; i < 3; i++) { sfx('stomp'); await wait(30); }
    await say('マタニーニは ツルピカ丸を てのひらに のせると、\nひとまたぎで 山を こえ、丘を こえ——');
    F.awake = true;
    G.x = 6; G.y = 12; G.dir = 'up';
    MapScene.load('town');
    G.lastInn = { map: 'shop_in', x: 9, y: 5 };
    await wait(20);
    await fadeIn(60);
    await say('あさに なっていた。\nきが つくと ツルピカ丸は 絹ごし町に もどっていた。');
    await say('ツルピカ丸「ゆめ…じゃ ないよな。」', '（みせの まえに とうふの リヤカーが ある）');
    G.noSave = false;
  },

  // ---------- リヤカーと電信柱 ----------
  async cart() {
    if (!F.sento) return say('あしたの しこみに つかう リヤカーだ。');
    if (!F.awake) return say('とうふの リヤカーだ。\nいまは おもくて ひっぱる きにも なれない…');
    if (F.cart) return say('とうふの リヤカーだ。\nいまなら かたてで もちあげられそうだ。');
    await say('ツルピカ丸は とうふの リヤカーを ひっぱった。');
    sfx('ok');
    await say('すると——');
    shake(10, 3);
    await say('うぉ！ こんなにも かるい！', 'まるで とうふ いっちょうを もっている みたいだ。');
    await say('ツルピカ丸「からだじゅうに ちからが みなぎってくる…！」');
    F.cart = true;
  },
  async pole() {
    if (!F.cart) return say('でんしんばしらだ。\nどっしりと たっている。');
    await say('みなぎる パワーで\nでんしんばしらを かるく つついてみた。');
    sfx('break'); shake(30, 9); flash('#ffffff', 0.6);
    await say('バキッ！！');
    F.bridge = true;
    MapScene.refresh();
    sfx('stomp'); shake(20, 6);
    await say('でんしんばしらは ポッキリ おれて、\nかわの むこうぎしへ たおれた。');
    await say('ツルピカ丸「…………。」');
    await wait(30);
    await say('ツルピカ丸は その とき、\nマタニーニの なぞの あに、\nワキニーニの ことを おもいだした。');
    await say('（ふしぎな ゆけむりで\nひとの すがたを かえてしまう きょじん…）', '（町の みんなが ああ なったのは、\nきっと ワキニーニの しわざだ！）');
    await say('ツルピカ丸は ワキニーニを たおすべく、\nあらたな ちへと むかうのだった。');
    await chapter('第2章', 'ニガリ地方へ');
    await say('（たおれた でんしんばしらが はしに なった。\nひがしの かわを わたって すすもう）');
  },

  // ---------- 店のカウンター（のれんに入ると会話→一歩さがる）----------
  async counter(fn) {
    await fn();
    await MapScene.walk('d');
  },

  // ---------- おから村 ----------
  async okaraElder() {
    await say('むらおさ「わしは この むらの むらおさじゃ。」', 'むらおさ「ひがしの『ゆけむり洞窟』から ぶきみな ゆけむりが ふいておる。\nどうくつは ワキニーニの しろへ つづく ちかの ゆみゃくと つながっておるらしい。」');
    if (!F.kinu) await say('むらおさ「ゆの ことなら キヌに きくと よい。\nみなみの いえの まえに おるはずじゃ。」');
    else if (!F.cave_boss) await say('むらおさ「どうくつは むらを でて きた。\nやまの なかに いりぐちが あるぞ。」');
    else await say('むらおさ「ゆみゃくの あわが きえたそうじゃな。\nありがとう、ありがとう…」');
  },
  async kinu() {
    await say('キヌ「あなた… すがたが かわっていないのね！」');
    await say('キヌ「わたしは キヌ。この むらの ゆもみむすめよ。」', 'キヌ「おじいちゃんが ゆけむりで\nあんな すがたに されて しまったの。」');
    await say('ツルピカ丸は これまでの ことを はなした。');
    await say('キヌ「きょじんの ワキニーニ… やっぱり そうなのね。」', 'キヌ「ゆけむり洞窟の おくに なにかが いるはず。\nわたしも つれていって！ ゆの ことなら まかせて。」');
    await joinParty('kinu', 'yukata');
    F.kinu = true;
    MapScene.refresh();
    await say('キヌ「ゆけむり洞窟は むらを でて、北の やまの なかよ。」');
  },
  async foam() {
    await say('あわの かべが みちを ふさいでいる。\nさわると ぷるんと はじかれた。');
    if (F.kinu) await say('キヌ「この あわ… ゆけむり洞窟の ほうから\nながれてきてるみたい。」');
  },

  // ---------- ゆけむり洞窟のボス ----------
  async caveBoss() {
    G.noSave = true;
    Audio8.bgm(null);
    await say('どうくつの おくに おおきな あわの かたまりが いる！');
    await say('アワダマだいおう「ゴボボ… ワキニーニさまの\nゆけむりを じゃまするものは ゆるさん！」');
    await say('ラッキアーノ「キュ～！」\n（おりの なかに とじこめられている！）');
    if (F.kinu) await say('キヌ「あれは… ラッキアーノ！？」');
    const r = await Battle.run(['awadama_king'], { bg: 'cave', noEscape: true });
    G.noSave = false;
    if (r !== 'win') return;
    F.cave_boss = true;
    MapScene.refresh();
    await say('アワダマだいおうは はじけて きえた。');
    await say('ツルピカ丸は おりを あけた。');
    await say('ラッキアーノ「キュッキュー！」');
    if (F.kinu) {
      await say('キヌ「…ふむふむ。」', 'キヌ「『あの よる、ゆけむりから あなたを まもるために\nおどったんだ』って いってるわ。」');
      await say('ツルピカ丸「あの ふしぎな おどりは…\nそういう ことだったのか！」', 'ツルピカ丸「だから おれだけ すがたが かわらなかったんだな。」');
    }
    await say('ラッキアーノ「キュイ！」');
    await joinParty('rakki', 'clover');
    F.rakki = true;
    MapScene.refresh();
    await say('キヌ「ゆみゃくの あわが きえたわ。\nこれで ニガリ平原の ひがしへ いけるはず。」', 'キヌ「ひがしの あぶらあげシティで\nワキニーニの しろの ことを きいてみましょう。」');
    await chapter('第3章', 'なみだの きょうだい');
  },

  // ---------- あぶらあげシティの学者 ----------
  async scholar() {
    if (F.scholar) return say('がくしゃ「ワキニーニの しろは ほくとうの どくぬまの おくじゃ。\nマタニーニの なみだを わすれるでないぞ。」');
    await say('がくしゃ「ほう… すがたの かわらぬ たびびととは めずらしい。」');
    await say('がくしゃ「ワキニーニの しろは ほくとうの どくぬまの おくに ある。\nだが しろは ぶあつい ゆけむりの かべに まもられておる。」');
    await say('がくしゃ「でんせつに よれば… その ゆけむりは\n『おとうと マタニーニの なみだ』で しか はらえぬ という。」');
    await say('ツルピカ丸「マタニーニの なみだなら…\nここに ある！」');
    await say('がくしゃ「なんと！ それなら しろへ はいれるはずじゃ。」', 'がくしゃ「ワキニーニは もとは やさしい きょじん だったそうな。\nなにが かれを かえて しまったのか…」');
    F.scholar = true;
  },

  // ---------- ワキニーニの城 ----------
  async castleGate() {
    await say('ぶあつい ゆけむりの かべが しろを つつんでいる…');
    if (!G.inv.tear) { await say('ちかづく ことが できない。'); await MapScene.walk('d'); return; }
    flash('#a8e0ff', 0.8); sfx('magic');
    await say('マタニーニのなみだが あたたかく ひかりだした！');
    flash('#ffffff', 1); sfx('flash');
    await say('ゆけむりの かべが すうっと きえていく……');
    F.barrier = true;
    await warpTo('castle', 11, 24, 'up');
  },
  async castleEnter() {
    if (F.castleIn) return;
    F.castleIn = true;
    if (partyHas('kinu')) await say('キヌ「すごい ゆけむり… みんな きを つけて！」');
    if (partyHas('rakki')) await say('ラッキアーノ「キュ…！」');
  },
  async warden() {
    G.noSave = true;
    await say('ゆげのばんにん「ここから さきは ワキニーニさまの おへや。\nとおすわけには いかん！」');
    const r = await Battle.run(['warden'], { bg: 'castle', noEscape: true });
    G.noSave = false;
    if (r !== 'win') return;
    F.warden = true;
    MapScene.refresh();
    await say('ゆげのばんにんは ゆげと なって きえた。');
  },
  async finalBoss() {
    G.noSave = true;
    Audio8.bgm(null);
    await wait(20);
    await say('ワキニーニ「……よく きたな、ちいさき ものよ。」');
    await say('ツルピカ丸「おまえが ワキニーニか！\n町の みんなを もとに もどせ！」');
    await say('ワキニーニ「おれは つかれたのだ。\nきょうだいで ずっと せかいの はてを まもってきた。\nだが だれも おれの つかれなど きにしない…」');
    await say('ワキニーニ「たまりに たまった この むなしさが\nゆけむりと なって あふれだすのだ。\nもう だれにも とめられぬ！」');
    if (partyHas('kinu')) await say('キヌ「くるわ！」');
    let assisted = false;
    const r = await Battle.run(['wakinini'], {
      bg: 'castle', noEscape: true, bgm: 'boss', intro: 'ワキニーニが おそいかかってきた！',
      async onTurnEnd({ enemies, party, bsay, clear }) {
        const w = enemies[0];
        if (assisted || w.hp <= 0 || w.hp > w.maxHp * 0.45) return;
        assisted = true;
        clear();
        sfx('stomp'); shake(20, 8);
        await bsay('ズシン… ズシン…！', 40);
        await bsay('マタニーニ「にいちゃーん！！」', 50);
        sfx('stomp'); shake(24, 10);
        await bsay('マタニーニが しろの かべを またいで あらわれた！', 50);
        clear();
        sfx('cry');
        await bsay('マタニーニ「にいちゃん、もう やめて！\nうわ～ん！！」', 60);
        w.buffs.defDown = true; w.buffs.atk = false;
        await bsay('ワキニーニの こころが ゆらいだ！\nワキニーニの しゅびりょくが さがった！', 50);
        clear();
        for (const b of party) { b.c.hp = b.c.hp > 0 ? maxHp(b.c) : Math.floor(maxHp(b.c) / 2); b.c.status = {}; }
        sfx('heal');
        await bsay('マタニーニの なみだが ふりそそぎ、\nみんなの きずが いえた！', 50);
      },
    });
    if (r !== 'win') { G.noSave = false; return; }
    await Story.ending();
  },

  // ---------- エンディング ----------
  async ending() {
    Audio8.bgm('mystery');
    await say('ワキニーニ「ぐ… ぐぐ……」');
    sfx('stomp'); shake(20, 6);
    await say('マタニーニ「にいちゃん……」');
    await say('ワキニーニ「……マタニーニ。\nおまえ、また ないて いるのか。」');
    await say('マタニーニ「にいちゃんも なけば いいんだ。\nないたら つかれが ふきとぶんだよ。」', 'マタニーニ「……この ひとが おしえて くれたんだ。」');
    await say('ツルピカ丸「……ああ。おれも おもいきり ないたら、\nすっかり からだが かるく なったよ。」');
    await say('ワキニーニ「…………」');
    await wait(40);
    sfx('cry');
    await say('ワキニーニ「う… うう… うわ～ん！！」');
    for (let i = 0; i < 4; i++) { sfx('stomp'); shake(14, 10); await wait(14); }
    F.rain = true;
    await say('ふたりの きょじんの なみだが あめと なって、\nせかいじゅうに ふりそそいだ——');
    await fadeOut(80);
    F.final = true; F.rain = false;
    healParty();
    G.x = 12; G.y = 13; G.dir = 'up';
    MapScene.load('town');
    Audio8.bgm('ending');
    await wait(30);
    await say('なみだの あめが ゆけむりを あらいながすと、\nひとびとは もとの すがたに もどっていった。');
    await fadeIn(60);
    await say('絹ごし町に いつもの あさが もどってきた。');
    await say('ツルピカ丸は きょうも あくせく はたらいている。\nけれど もう つかれは ためこまない。', 'つかれた ときは おもいきり なけばいい。\nそれを しっている からだ。');
    await say('そして しごとの あとは——');
    await fadeOut(40);
    G.x = 6; G.y = 7; G.dir = 'up';
    MapScene.load('sento_in');
    await wait(20);
    await fadeIn(40);
    await say('まんぷく湯で ひとっぷろ。');
    await say('ツルピカ丸「ふぃ〜… いい ゆだ。」');
    if (partyHas('kinu')) await say('キヌ「ここの おゆ、いい おゆね！\nゆもみ しがいが あるわ。」');
    if (partyHas('rakki')) await say('ラッキアーノ「キュ～♪」');
    await wait(40);
    await fadeOut(80);
    G.cleared = true;
    Scene.set(EndScene);
    await fadeIn(60);
  },
};
