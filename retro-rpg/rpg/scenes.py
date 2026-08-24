"""タイトル、ゲームオーバー、エンディング。"""
import os
import random
import pygame

from . import ui, sfx, party, sprites
from .config import (LOGICAL_W, LOGICAL_H, WINDOW_W, WINDOW_H, TITLE,
                     WHITE, YELLOW, RED, SAVE_FILE)

CONFIRM = (pygame.K_z, pygame.K_RETURN, pygame.K_SPACE)
CANCEL = (pygame.K_x, pygame.K_ESCAPE, pygame.K_BACKSPACE)


class TitleScene:
    def __init__(self, game):
        self.game = game
        self.world = pygame.Surface((LOGICAL_W, LOGICAL_H))
        self.t = 0
        items = ["はじめから"]
        if party.has_save(SAVE_FILE):
            items.insert(0, "つづきから")
        self.items = items
        self.menu = ui.Menu(items, WINDOW_W // 2 - 150, 470, width=300)
        self._draw_background()

    def _draw_background(self):
        w = self.world
        for y in range(LOGICAL_H):
            t = y / LOGICAL_H
            w.fill((int(12 + 30 * t), int(10 + 24 * t), int(40 + 60 * t)),
                   pygame.Rect(0, y, LOGICAL_W, 1))
        rnd = random.Random(3)
        for _ in range(70):
            x, y = rnd.randrange(LOGICAL_W), rnd.randrange(140)
            w.set_at((x, y), (248, 248, 216) if rnd.random() < 0.7 else (176, 176, 216))
        pygame.draw.circle(w, (240, 240, 200), (262, 40), 12)
        pygame.draw.circle(w, (int(12 + 6), int(10 + 5), int(40 + 12)), (256, 36), 12)
        for base, color in ((196, (28, 24, 48)), (210, (20, 18, 36))):
            pts = [(0, LOGICAL_H)]
            x = 0
            rnd2 = random.Random(base)
            while x < LOGICAL_W:
                pts.append((x, base - rnd2.randrange(0, 26)))
                x += rnd2.randrange(18, 40)
            pts.append((LOGICAL_W, LOGICAL_H))
            pygame.draw.polygon(w, color, pts)
        w.blit(pygame.transform.scale(sprites.actor("hero")["down"][0], (28, 28)), (44, 172))

    def handle_key(self, key):
        if key == pygame.K_UP:
            self.menu.move(0, -1)
        elif key == pygame.K_DOWN:
            self.menu.move(0, 1)
        elif key in CONFIRM:
            sfx.play("ok")
            self._start(self.menu.selected)

    def _start(self, choice):
        from .field import FieldScene
        if choice == "つづきから":
            try:
                hero = party.load(SAVE_FILE)
            except Exception:
                hero = party.Hero()
        else:
            hero = party.Hero()
        self.game.replace(FieldScene(self.game, hero))
        self.game.fade_in()

    def update(self):
        self.t += 1

    def draw(self, screen):
        screen.blit(pygame.transform.scale(self.world, (WINDOW_W, WINDOW_H)), (0, 0))
        img = ui.fonts.render(TITLE, ui.FONT_L, YELLOW)
        shadow = ui.fonts.render(TITLE, ui.FONT_L, (80, 40, 20))
        x = WINDOW_W // 2 - img.get_width() // 2
        screen.blit(shadow, (x + 5, 165))
        screen.blit(img, (x, 160))
        ui.text(screen, "- レトロRPG -", WINDOW_W // 2 - 90, 250, size=ui.FONT_S)
        self.menu.draw(screen)
        if self.t % 60 < 40:
            ui.text(screen, "Zキー で けってい", WINDOW_W // 2 - 130, WINDOW_H - 90, size=ui.FONT_S)


class GameOverScene:
    """しんだとき。むらで めをさまし、ゴールドが はんぶんに なる。"""

    def __init__(self, game, hero, field):
        self.game = game
        self.hero = hero
        self.field = field
        self.msg = ui.Message()
        self.t = 0
        lost = hero.gold - hero.gold // 2
        hero.gold //= 2
        self.msg.push("……",
                      "あなたは しんでしまった。",
                      "きが つくと むらの ベッドの うえだった。\n%d ゴールドを おとしてしまった……" % lost)
        self.msg.on_finish = self._revive

    def _revive(self):
        self.hero.full_heal()
        self.hero.x, self.hero.y = 11, 10
        self.hero.dir = "down"
        self.field.load_map("village")
        self.game.pop()
        self.game.fade_in()

    def handle_key(self, key):
        if key in CONFIRM + CANCEL:
            self.msg.advance()

    def update(self):
        self.t += 1
        self.msg.update()

    def draw(self, screen):
        screen.fill((0, 0, 0))
        self.msg.draw(screen)


class EndingScene:
    def __init__(self, game, hero):
        self.game = game
        self.hero = hero
        self.t = 0
        self.msg = ui.Message()
        self.msg.push("まおうは たおされ、\nくにには ひかりが もどった。",
                      "ゆうしゃ %s の ぼうけんは\nこうして まくを とじた。" % hero.name,
                      "レベル %d ／ %d ゴールド\nクリア おめでとう！" % (hero.level, hero.gold))
        self.msg.on_finish = self._to_title

    def _to_title(self):
        self.game.pop()
        self.game.replace(TitleScene(self.game))
        self.game.fade_in()

    def handle_key(self, key):
        if key in CONFIRM + CANCEL:
            self.msg.advance()

    def update(self):
        self.t += 1
        self.msg.update()

    def draw(self, screen):
        screen.fill((0, 0, 0))
        for i in range(80):
            rnd = random.Random(i)
            x = rnd.randrange(WINDOW_W)
            y = (rnd.randrange(WINDOW_H) + self.t // 3) % WINDOW_H
            screen.set_at((x, y), (200, 200, 160))
        img = ui.fonts.render("おわり", ui.FONT_L, YELLOW)
        screen.blit(img, (WINDOW_W // 2 - img.get_width() // 2, 150))
        self.msg.draw(screen)
