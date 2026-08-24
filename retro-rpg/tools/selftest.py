"""画面なしで じっさいに あそんで、こわれていないか たしかめる。

    python tools/selftest.py

キー入力を にせもので おきかえて、
むら → そうげん → どうくつ → まおう戦 → エンディング まで 通す。
"""
import os
import sys

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import pygame
from rpg.config import WALK_FRAMES, SAVE_FILE
from rpg.game import Game
from rpg.scenes import TitleScene, GameOverScene, EndingScene
from rpg.field import FieldScene
from rpg.battle import BattleScene
from rpg import party

FAILED = []


def check(label, cond):
    print(("  OK   " if cond else "  NG   ") + label)
    if not cond:
        FAILED.append(label)


class FakeKeys:
    held = set()

    def __getitem__(self, key):
        return key in self.held


keys = FakeKeys()
pygame.key.get_pressed = lambda: keys


def walk(game, key, tiles):
    keys.held = {key}
    for _ in range(tiles * (WALK_FRAMES + 2) + 10):
        game.step()
        if not isinstance(game.top, FieldScene):
            break
    keys.held = set()
    for _ in range(4):
        game.step()


def fight(game, limit=4000):
    """たたかいが おわるまで まわす。コマンドが 出たら Zキーを おす。"""
    for _ in range(limit):
        top = game.top
        if not isinstance(top, BattleScene):
            return True
        game.step()
        if isinstance(game.top, BattleScene) and game.top.menu is not None:
            game.top.handle_key(pygame.K_z)
    return False


print("== セルフテスト ==")
game = Game()
game.push(TitleScene(game))
for _ in range(5):
    game.step()
game.top.handle_key(pygame.K_z)          # 「はじめから」
check("タイトルから ゲームが はじまる", isinstance(game.top, FieldScene))

field = game.top
hero = field.hero
check("はじまりは むら", field.map_key == "village")

# --- むらの きたの もんから そとへ ---
hero.x, hero.y = 11, 3
walk(game, pygame.K_UP, 5)
check("むら → そうげん へ 出られる", field.map_key == "field")

# --- はなしかけ ---
field.msg.clear()
hero.x, hero.y, hero.dir = 11, 6, "up"
field.load_map("village")
hero.x, hero.y, hero.dir = 18, 16, "up"
field._talk()
check("ちょうろうと はなせる", field.msg.active)
for _ in range(600):
    game.step()
    if field.msg.active:
        field.handle_key(pygame.K_z)
check("クエストの フラグが たつ", hero.has_flag("quest"))

# --- どうぐや ---
field.msg.clear()
hero.gold = 200
hero.x, hero.y, hero.dir = 4, 7, "up"
field._talk()
for _ in range(300):
    game.step()
    if field.msg.active:
        field.handle_key(pygame.K_z)
    if field.modal is not None:
        break
check("どうぐやが ひらく", field.modal is not None)
before = hero.items.get("やくそう", 0)
field.modal.handle_key(pygame.K_z)       # やくそう を かう
for _ in range(200):
    game.step()
check("やくそうが かえる", hero.items.get("やくそう", 0) == before + 1 and hero.gold == 192)
field.modal = None
field.msg.clear()

# --- やどや ---
hero.hp = 1
hero.x, hero.y, hero.dir = 18, 7, "up"
field._talk()
for _ in range(300):
    game.step()
    if field.msg.active:
        field.handle_key(pygame.K_z)
    if field.modal is not None:
        break
field.modal.handle_key(pygame.K_z)       # 「はい」
for _ in range(300):
    game.step()
check("やどやで かいふくする", hero.hp == hero.maxhp)
field.modal = None
field.msg.clear()

# --- ふつうの たたかい ---
exp_before = hero.exp
field._start_battle("slime")
check("たたかいが はじまる", isinstance(game.top, BattleScene))
check("たたかいが おわる", fight(game))
check("けいけんちが ふえる", hero.exp > exp_before)
check("フィールドに もどる", isinstance(game.top, FieldScene))

# --- レベルアップ ---
msgs = hero.gain_exp(700)
check("レベルアップの メッセージが 出る", any("レベルが" in m for m in msgs))
check("じゅもんを おぼえる", "ヒール" in hero.spells)

# --- セーブ と ロード ---
party.save(hero, SAVE_FILE)
loaded = party.load(SAVE_FILE)
check("セーブ/ロードが できる",
      loaded.level == hero.level and loaded.gold == hero.gold and loaded.flags == hero.flags)
os.remove(SAVE_FILE)

# --- まけたとき ---
hero.hp = 1
field._start_battle("darklord", boss=True)
fight(game)
check("しぬと ゲームオーバー", isinstance(game.top, GameOverScene))
for _ in range(600):
    game.step()
    if isinstance(game.top, GameOverScene):
        game.top.handle_key(pygame.K_z)
check("むらで ふっかつする", isinstance(game.top, FieldScene) and hero.hp == hero.maxhp
      and field.map_key == "village")

# --- ボスを たおす ---
hero.gain_exp(5000)
hero.atk_bonus = 60
hero.full_heal()
hero.x, hero.y, hero.dir = 11, 4, "up"
field.load_map("cave")
field.msg.clear()
field._talk()
for _ in range(600):
    game.step()
    if isinstance(game.top, BattleScene):
        break
    if field.msg.active:
        field.handle_key(pygame.K_z)
check("まおうと たたかいに なる", isinstance(game.top, BattleScene))
fight(game)
check("まおうを たおした", hero.has_flag("cleared"))
for _ in range(900):
    game.step()
    if isinstance(game.top, EndingScene):
        break
    if isinstance(game.top, FieldScene) and game.top.msg.active:
        game.top.handle_key(pygame.K_z)
check("エンディングに なる", isinstance(game.top, EndingScene))
for _ in range(900):
    game.step()
    if isinstance(game.top, TitleScene):
        break
    game.top.handle_key(pygame.K_z)
check("タイトルに もどる", isinstance(game.top, TitleScene))

print("== けっか ==")
if FAILED:
    print("しっぱい %d けん: %s" % (len(FAILED), ", ".join(FAILED)))
    sys.exit(1)
print("すべて OK")
