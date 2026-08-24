"""画面の みための かくにん用。各シーンを描いて PNG に保存する。"""
import os
import sys

os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("SDL_AUDIODRIVER", "dummy")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import pygame
from rpg.game import Game
from rpg.scenes import TitleScene
from rpg.field import FieldScene
from rpg.battle import BattleScene
from rpg.menus import FieldMenu, Shop
from rpg.party import Hero

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)


def shot(game, name, frames=1):
    for _ in range(frames):
        game.step()
        game.render()
    pygame.image.save(game.screen, os.path.join(OUT, name + ".png"))
    print("  ->", name)


game = Game()
game.push(TitleScene(game))
shot(game, "01_title", 30)

hero = Hero()
field = FieldScene(game, hero)
game.replace(field)
game.fade = 0
shot(game, "02_village", 5)

# 会話
hero.x, hero.y = 18, 14
hero.dir = "down"
field.hero.y = 14
hero.x, hero.y = 18, 14
field.hero.dir = "down"
hero.x, hero.y = 18, 16
hero.dir = "up"
field._talk()
shot(game, "03_talk", 40)

# 道具屋
field.msg.clear()
field.modal = Shop(field)
shot(game, "04_shop", 10)
field.modal = None

# メニュー（つよさ）
hero.gain_exp(300)
field.msg.clear()
menu = FieldMenu(field)
field.modal = menu
menu.on_select()
shot(game, "05_status", 10)
field.modal = None

# フィールド（くさむら）
hero.map = "field"
hero.x, hero.y = 20, 22
field.load_map("field")
field.msg.clear()
shot(game, "06_field", 5)

# たたかい
battle = BattleScene(game, hero, "goblin")
game.push(battle)
shot(game, "07_battle_intro", 40)
for _ in range(160):
    game.step()
game.render()
pygame.image.save(game.screen, os.path.join(OUT, "08_battle_command.png"))
print("  -> 08_battle_command")

# ボス（どうくつ）
game.pop()
hero.x, hero.y = 11, 12
field.load_map("cave")
field.msg.clear()
shot(game, "09_cave", 5)
boss = BattleScene(game, hero, "darklord", boss=True, dark=True)
game.push(boss)
shot(game, "10_boss", 40)
print("完了:", OUT)
