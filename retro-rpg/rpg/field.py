"""マップを あるく がめん。

・じゃりじゃり動かず、1マスずつ すべるように 動く（マス目移動）
・くさむらを あるくと ランダムエンカウント
・NPCに はなしかける、出入口で マップ移動
"""
import random
import pygame

from . import maps, tiles, sprites, ui, sfx, data
from .battle import BattleScene
from .config import (TILE, LOGICAL_W, LOGICAL_H, WINDOW_W, WINDOW_H,
                     WALK_FRAMES, WHITE, YELLOW)

DIRS = {
    pygame.K_UP: ("up", 0, -1),
    pygame.K_DOWN: ("down", 0, 1),
    pygame.K_LEFT: ("left", -1, 0),
    pygame.K_RIGHT: ("right", 1, 0),
}


class FieldScene:
    def __init__(self, game, hero):
        self.game = game
        self.hero = hero
        self.rnd = random.Random()
        self.msg = ui.Message()
        self.modal = None            # メニューや お店
        self.world = pygame.Surface((LOGICAL_W, LOGICAL_H))
        self.move_dx = self.move_dy = 0
        self.move_t = 0
        self.anim = 0
        self.anim_t = 0
        self.steps = 0
        self.water_t = 0
        self.after_message = None
        self.load_map(hero.map)

    # ------------------------------------------------------------------
    def load_map(self, key):
        self.map_key = key
        self.mapdata = maps.get_map(key)
        self.hero.map = key
        rows = self.mapdata["rows"]
        self.map_w, self.map_h = len(rows[0]), len(rows)
        self.layers = [self._render_map(f) for f in (0, 1)]
        self.npcs = [dict(n) for n in self.mapdata["npcs"]]
        if key == "cave" and self.hero.has_flag("cleared"):
            self.npcs = [n for n in self.npcs if n["kind"] != "boss"]

    def _render_map(self, frame):
        surf = pygame.Surface((self.map_w * TILE, self.map_h * TILE))
        for y, row in enumerate(self.mapdata["rows"]):
            for x, ch in enumerate(row):
                surf.blit(tiles.get(ch, frame), (x * TILE, y * TILE))
        return surf

    # ------------------------------------------------------------------
    def _tile(self, x, y):
        return maps.tile_at(self.mapdata, x, y)

    def _npc_at(self, x, y):
        for n in self.npcs:
            if n["x"] == x and n["y"] == y:
                return n
        return None

    def _walkable(self, x, y):
        if not (0 <= x < self.map_w and 0 <= y < self.map_h):
            return False
        if tiles.is_solid(self._tile(x, y)):
            return False
        return self._npc_at(x, y) is None

    @property
    def busy(self):
        return self.msg.active or self.modal is not None

    # ------------------------------------------------------------------
    # 入力
    # ------------------------------------------------------------------
    def handle_key(self, key):
        if self.modal is not None:
            self.modal.handle_key(key)
            if self.modal.done:
                self.modal = None
            return
        if self.msg.active:
            if key in (pygame.K_z, pygame.K_RETURN, pygame.K_SPACE,
                       pygame.K_x, pygame.K_ESCAPE, pygame.K_BACKSPACE):
                self.msg.advance()
            return
        if key in (pygame.K_z, pygame.K_RETURN, pygame.K_SPACE):
            self._talk()
        elif key in (pygame.K_x, pygame.K_ESCAPE):
            from .menus import FieldMenu
            sfx.play("ok")
            self.modal = FieldMenu(self)

    def update(self):
        self.msg.update()
        self.water_t = (self.water_t + 1) % 60
        if self.modal is not None:
            self.modal.update()
            if self.modal.done:
                self.modal = None
            return
        if self.msg.active:
            return
        if self.after_message:
            cb, self.after_message = self.after_message, None
            cb()
            return
        self._update_walk()

    def _update_walk(self):
        if self.move_t > 0:
            self.move_t -= 1
            self.anim_t += 1
            if self.anim_t >= 6:
                self.anim_t = 0
                self.anim = (self.anim + 1) % 4
            if self.move_t == 0:
                self.hero.x += self.move_dx
                self.hero.y += self.move_dy
                self.move_dx = self.move_dy = 0
                self._on_step()
            return

        keys = pygame.key.get_pressed()
        for key, (name, dx, dy) in DIRS.items():
            if keys[key]:
                self.hero.dir = name
                if self._walkable(self.hero.x + dx, self.hero.y + dy):
                    self.move_dx, self.move_dy = dx, dy
                    self.move_t = WALK_FRAMES
                else:
                    self.anim = 0
                break
        else:
            self.anim = 0

    # ------------------------------------------------------------------
    def _on_step(self):
        pos = (self.hero.x, self.hero.y)
        portal = self.mapdata["portals"].get(pos)
        if portal:
            key, tx, ty = portal
            self.hero.x, self.hero.y = tx, ty
            self.load_map(key)
            self.game.fade_in()
            self.msg.clear()
            self.msg.push(maps.get_map(key)["name"])
            return
        enc = self.mapdata["encounter"]
        if enc and tiles.is_encounter(self._tile(*pos)):
            self.steps += 1
            if self.steps >= 4 and self.rnd.randrange(enc["rate"]) == 0:
                self.steps = 0
                self._start_battle(self._pick_monster(enc["table"]))

    def _pick_monster(self, table):
        total = sum(w for _, w in table)
        r = self.rnd.randrange(total)
        for key, w in table:
            r -= w
            if r < 0:
                return key
        return table[0][0]

    def _start_battle(self, key, boss=False):
        scene = BattleScene(self.game, self.hero, key, boss=boss,
                            on_end=self._end_battle, dark=(self.map_key == "cave"))
        self._boss_battle = boss
        self.game.push(scene)

    def _end_battle(self, result):
        self.game.pop()
        if result == "lose":
            from .scenes import GameOverScene
            self.game.push(GameOverScene(self.game, self.hero, self))
        elif result == "win" and getattr(self, "_boss_battle", False):
            self.hero.set_flag("cleared")
            self.npcs = [n for n in self.npcs if n["kind"] != "boss"]
            self.msg.push("まおうは ひかりの なかに きえた……",
                          "せかいに へいわが もどった！")
            self.after_message = self._show_ending
        self._boss_battle = False

    def _show_ending(self):
        from .scenes import EndingScene
        self.game.push(EndingScene(self.game, self.hero))

    # ------------------------------------------------------------------
    # はなしかける
    # ------------------------------------------------------------------
    def _talk(self):
        _, dx, dy = next(v for v in DIRS.values() if v[0] == self.hero.dir)
        npc = self._npc_at(self.hero.x + dx, self.hero.y + dy)
        if npc is None:
            return
        npc["dir"] = {"up": "down", "down": "up", "left": "right", "right": "left"}[self.hero.dir]
        kind = npc["kind"]

        if kind == "shop":
            from .menus import Shop
            self.msg.push(*npc["lines"])
            self.after_message = lambda: setattr(self, "modal", Shop(self))
        elif kind == "inn":
            from .menus import Inn
            self.after_message = lambda: setattr(self, "modal", Inn(self))
            self.msg.push("やどやへ ようこそ。\nひとばん %d ゴールドですが とまりますか？" % data.INN_PRICE)
        elif kind == "boss":
            self.msg.push(*npc["lines"])
            self.after_message = lambda: self._start_battle("darklord", boss=True)
        elif kind == "elder":
            if self.hero.has_flag("cleared"):
                self.msg.push(*npc["lines_cleared"])
            elif self.hero.has_flag("quest"):
                self.msg.push(*npc["lines_after"])
            else:
                self.hero.set_flag("quest")
                self.msg.push(*npc["lines"])
        else:
            if self.hero.has_flag("cleared") and "lines_cleared" in npc:
                self.msg.push(*npc["lines_cleared"])
            else:
                self.msg.push(*npc["lines"])

    # ------------------------------------------------------------------
    # 描画
    # ------------------------------------------------------------------
    def _hero_pixel(self):
        px = self.hero.x * TILE
        py = self.hero.y * TILE
        if self.move_t:
            done = (WALK_FRAMES - self.move_t) / WALK_FRAMES
            px += int(self.move_dx * TILE * done)
            py += int(self.move_dy * TILE * done)
        return px, py

    def _camera(self):
        px, py = self._hero_pixel()
        cam_x = px + TILE // 2 - LOGICAL_W // 2
        cam_y = py + TILE // 2 - LOGICAL_H // 2
        max_x = self.map_w * TILE - LOGICAL_W
        max_y = self.map_h * TILE - LOGICAL_H
        cam_x = 0 if max_x < 0 else max(0, min(cam_x, max_x))
        cam_y = 0 if max_y < 0 else max(0, min(cam_y, max_y))
        return cam_x, cam_y

    def draw(self, screen):
        cam_x, cam_y = self._camera()
        self.world.fill((0, 0, 0))
        layer = self.layers[0 if self.water_t < 30 else 1]
        self.world.blit(layer, (-cam_x, -cam_y))

        for npc in self.npcs:
            frames = sprites.actor(npc["sprite"])[npc["dir"]]
            self.world.blit(frames[0], (npc["x"] * TILE - cam_x, npc["y"] * TILE - cam_y))

        px, py = self._hero_pixel()
        frames = sprites.actor("hero")[self.hero.dir]
        self.world.blit(frames[self.anim], (px - cam_x, py - cam_y))

        screen.blit(pygame.transform.scale(self.world, (WINDOW_W, WINDOW_H)), (0, 0))
        self.msg.draw(screen)
        if self.modal is not None:
            self.modal.draw(screen)
