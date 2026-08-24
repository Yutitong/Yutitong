"""たたかいの がめん。

1対1のターン制。コマンドを えらぶ → すばやさ順に こうどう → くりかえし。
処理の ながれは ジェネレータ（yield）で 書いている。
yield したところで「メッセージを 読み終わるまで 待つ」という意味。
"""
import random
import pygame

from . import data, sprites, ui, sfx
from .config import (LOGICAL_W, LOGICAL_H, WINDOW_W, WINDOW_H, SCALE,
                     WHITE, BLACK, YELLOW, RED)

CMD_ATTACK = "たたかう"
CMD_SPELL = "じゅもん"
CMD_ITEM = "どうぐ"
CMD_FLEE = "にげる"


class Enemy:
    def __init__(self, key):
        d = data.MONSTERS[key]
        self.key = key
        self.name = d["name"]
        self.sprite = sprites.enemy(d["sprite"])
        self.maxhp = self.hp = d["hp"]
        self.atk, self.df, self.spd = d["atk"], d["df"], d["spd"]
        self.exp, self.gold = d["exp"], d["gold"]
        self.skills = d["skills"]

    @property
    def alive(self):
        return self.hp > 0


class BattleScene:
    def __init__(self, game, hero, monster_key, boss=False, on_end=None, dark=False):
        self.game = game
        self.hero = hero
        self.enemy = Enemy(monster_key)
        self.boss = boss
        self.dark = dark
        self.on_end = on_end
        self.rnd = random.Random()

        self.msg = ui.Message()
        self.msg.auto = True
        self.menu = None
        self.state = "intro"
        self.script = None
        self.result = None

        self.shake = 0
        self.flash = 0
        self.enemy_fade = 0
        self.world = pygame.Surface((LOGICAL_W, LOGICAL_H))

        sfx.play("encounter")
        self.msg.push("%s が あらわれた！" % self.enemy.name)

    # ------------------------------------------------------------------
    # コマンド
    # ------------------------------------------------------------------
    def _open_command(self):
        self.state = "command"
        self.menu = ui.Menu([CMD_ATTACK, CMD_SPELL, CMD_ITEM, CMD_FLEE],
                            24, WINDOW_H - 240, width=300)

    def _open_spell_menu(self):
        spells = self.hero.spells
        if not spells:
            self._say("じゅもんを おぼえていない！")
            return
        items = ["%s  %dMP" % (s, data.SPELLS[s]["mp"]) for s in spells]
        self.menu = ui.Menu(items, 24, WINDOW_H - 240 - 40 * len(items), title="じゅもん")
        self.state = "spell"

    def _open_item_menu(self):
        usable = [(n, c) for n, c in self.hero.item_list() if data.ITEMS[n]["battle"]]
        if not usable:
            self._say("つかえる どうぐが ない！")
            return
        items = ["%s ×%d" % (n, c) for n, c in usable]
        self._item_names = [n for n, _ in usable]
        self.menu = ui.Menu(items, 24, WINDOW_H - 240 - 40 * len(items), title="どうぐ")
        self.state = "item"

    def _say(self, *texts):
        """メッセージを 見せてから コマンドに もどる。"""
        self.menu = None
        self.msg.push(*texts)
        self.msg.on_finish = self._open_command
        self.state = "message"

    def _start(self, script):
        self.menu = None
        self.script = script
        self.state = "script"

    # ------------------------------------------------------------------
    # ターンの ながれ
    # ------------------------------------------------------------------
    def _turn(self, action, payload=None):
        player_first = (self.hero.spd + self.rnd.randrange(6)) >= (self.enemy.spd + self.rnd.randrange(6))
        order = ["player", "enemy"] if player_first else ["enemy", "player"]

        for who in order:
            if not self.enemy.alive or not self.hero.alive or self.result:
                break
            if who == "player":
                yield from self._player_turn(action, payload)
            else:
                yield from self._enemy_turn()

        if self.enemy.alive and self.hero.alive and not self.result:
            self._open_command()

    def _player_turn(self, action, payload):
        if action == CMD_ATTACK:
            self.msg.push("%s の こうげき！" % self.hero.name)
            yield
            if data.is_critical(self.rnd):
                dmg = data.critical_damage(self.hero.atk, self.rnd)
                self.msg.push("かいしんの いちげき！！\n%s に %d の ダメージ！" % (self.enemy.name, dmg))
            else:
                dmg = data.attack_damage(self.hero.atk, self.enemy.df, self.rnd)
                if dmg == 0:
                    self.msg.push("しかし ダメージを あたえられない！")
                else:
                    self.msg.push("%s に %d の ダメージ！" % (self.enemy.name, dmg))
            self._hit_enemy(dmg)
            yield

        elif action == CMD_SPELL:
            spell = data.SPELLS[payload]
            self.hero.mp -= spell["mp"]
            self.msg.push("%s は %s を となえた！" % (self.hero.name, payload))
            yield
            if spell["kind"] == "damage":
                dmg = data.magic_damage(self.rnd.randint(*spell["power"]), self.rnd)
                self.msg.push("%s に %d の ダメージ！" % (self.enemy.name, dmg))
                self._hit_enemy(dmg)
            else:
                healed = self.hero.heal(self.rnd.randint(*spell["power"]))
                sfx.play("heal")
                self.msg.push("%s の HPが %d かいふくした！" % (self.hero.name, healed))
            yield

        elif action == CMD_ITEM:
            item = data.ITEMS[payload]
            self.hero.remove_item(payload)
            self.msg.push("%s を つかった！" % payload)
            yield
            if item["kind"] == "heal":
                healed = self.hero.heal(self.rnd.randint(*item["power"]))
                sfx.play("heal")
                self.msg.push("HPが %d かいふくした！" % healed)
            elif item["kind"] == "mp":
                got = self.hero.restore_mp(self.rnd.randint(*item["power"]))
                sfx.play("heal")
                self.msg.push("MPが %d かいふくした！" % got)
            yield

        elif action == CMD_FLEE:
            if self.boss:
                self.msg.push("にげられない！")
                yield
            elif data.flee_success(self.hero.spd, self.enemy.spd, self.rnd):
                self.msg.push("%s は にげだした！" % self.hero.name)
                self.result = "flee"
                yield
                self._finish()
            else:
                self.msg.push("しかし まわりこまれて しまった！")
                yield

        if not self.enemy.alive:
            yield from self._victory()

    def _enemy_turn(self):
        skill = None
        for name, kind, power, chance in self.enemy.skills:
            if self.rnd.randrange(100) < chance:
                skill = (name, kind, power)
                break

        if skill is None:
            self.msg.push("%s の こうげき！" % self.enemy.name)
            yield
            dmg = data.attack_damage(self.enemy.atk, self.hero.df, self.rnd)
        elif skill[1] == "strong":
            self.msg.push("%s の %s！" % (self.enemy.name, skill[0]))
            yield
            dmg = int(data.attack_damage(self.enemy.atk, self.hero.df, self.rnd) * 1.6) + 1
        else:
            self.msg.push("%s は %s を となえた！" % (self.enemy.name, skill[0]))
            yield
            dmg = data.magic_damage(skill[2], self.rnd)

        if dmg <= 0:
            self.msg.push("しかし ダメージは なかった！")
        else:
            self.hero.damage(dmg)
            self._hit_player()
            self.msg.push("%s は %d の ダメージを うけた！" % (self.hero.name, dmg))
        yield

        if not self.hero.alive:
            sfx.play("down")
            self.msg.push("%s は しんでしまった……" % self.hero.name)
            self.result = "lose"
            yield
            self._finish()

    def _victory(self):
        sfx.play("ok")
        self.msg.push("%s を たおした！" % self.enemy.name)
        yield
        self.hero.gold += self.enemy.gold
        self.msg.push("けいけんち %d を かくとく！\n%d ゴールドを てにいれた！"
                      % (self.enemy.exp, self.enemy.gold))
        yield
        for line in self.hero.gain_exp(self.enemy.exp):
            sfx.play("levelup")
            self.msg.push(line)
            yield
        self.result = "win"
        self._finish()

    def _finish(self):
        self.state = "outro"

    def _leave(self):
        if self.on_end:
            self.on_end(self.result)

    # ------------------------------------------------------------------
    def _hit_enemy(self, dmg):
        if dmg > 0:
            sfx.play("enemy_hit")
            self.enemy.hp = max(0, self.enemy.hp - dmg)
            self.shake = 12

    def _hit_player(self):
        sfx.play("hit")
        self.flash = 8

    # ------------------------------------------------------------------
    # 入力
    # ------------------------------------------------------------------
    def handle_key(self, key):
        confirm = key in (pygame.K_z, pygame.K_RETURN, pygame.K_SPACE)
        cancel = key in (pygame.K_x, pygame.K_ESCAPE, pygame.K_BACKSPACE)

        if self.state in ("intro", "message", "script", "outro"):
            if confirm or cancel:
                self.msg.advance()
            return

        if self.menu is None:
            return
        if key == pygame.K_UP:
            self.menu.move(0, -1)
        elif key == pygame.K_DOWN:
            self.menu.move(0, 1)
        elif confirm:
            sfx.play("ok")
            self._choose()
        elif cancel and self.state in ("spell", "item"):
            sfx.play("cancel")
            self._open_command()

    def _choose(self):
        if self.state == "command":
            cmd = self.menu.selected
            if cmd == CMD_SPELL:
                self._open_spell_menu()
            elif cmd == CMD_ITEM:
                self._open_item_menu()
            else:
                self._start(self._turn(cmd))
        elif self.state == "spell":
            name = self.hero.spells[self.menu.index]
            if self.hero.mp < data.SPELLS[name]["mp"]:
                self._say("MPが たりない！")
            else:
                self._start(self._turn(CMD_SPELL, name))
        elif self.state == "item":
            name = self._item_names[self.menu.index]
            self._start(self._turn(CMD_ITEM, name))

    # ------------------------------------------------------------------
    def update(self):
        self.msg.update()
        self.shake = max(0, self.shake - 1)
        self.flash = max(0, self.flash - 1)
        if not self.enemy.alive and self.enemy_fade < 16:
            self.enemy_fade += 1

        if self.state == "intro" and not self.msg.active:
            self._open_command()
        elif self.state == "outro" and not self.msg.active:
            self.state = "done"
            self._leave()
        elif self.state == "script" and not self.msg.active:
            try:
                next(self.script)
            except StopIteration:
                self.script = None
                if self.state == "script":
                    self._open_command()

    # ------------------------------------------------------------------
    # 描画
    # ------------------------------------------------------------------
    def _draw_background(self):
        w = self.world
        if self.dark:
            top, bottom, ground = (24, 20, 40), (48, 40, 64), (56, 48, 64)
        else:
            top, bottom, ground = (28, 32, 72), (96, 88, 152), (72, 120, 64)
        for y in range(160):
            t = y / 160.0
            color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
            pygame.draw.line(w, color, (0, y), (LOGICAL_W, y))
        pygame.draw.rect(w, ground, (0, 160, LOGICAL_W, LOGICAL_H - 160))
        pygame.draw.line(w, tuple(min(255, c + 24) for c in ground), (0, 160), (LOGICAL_W, 160))

    def draw(self, screen):
        self._draw_background()

        scale = 7 if self.boss else 5
        size = self.enemy.sprite.get_width() * scale
        img = pygame.transform.scale(self.enemy.sprite, (size, size))
        if self.enemy_fade:
            img = img.copy()
            img.set_alpha(max(0, 255 - self.enemy_fade * 18))
        ox = self.rnd.randint(-2, 2) if self.shake else 0
        self.world.blit(img, (LOGICAL_W // 2 - size // 2 + ox, 158 - size))

        screen.blit(pygame.transform.scale(self.world, (WINDOW_W, WINDOW_H)), (0, 0))

        if self.flash:
            layer = pygame.Surface((WINDOW_W, WINDOW_H), pygame.SRCALPHA)
            layer.fill((216, 32, 32, 90))
            screen.blit(layer, (0, 0))

        self._draw_status(screen)
        if self.menu:
            self.menu.draw(screen)
        self.msg.draw(screen)

    def _draw_status(self, screen):
        rect = pygame.Rect(24, 24, 300, 250)
        ui.draw_window(screen, rect)
        x, y = rect.x + 26, rect.y + 20
        ui.text(screen, self.hero.name, x, y)
        ui.text(screen, "LV %d" % self.hero.level, x, y + 44)
        hp_color = RED if self.hero.hp <= self.hero.maxhp // 4 else WHITE
        ui.text(screen, "HP %d/%d" % (self.hero.hp, self.hero.maxhp), x, y + 88, color=hp_color)
        ui.text(screen, "MP %d/%d" % (self.hero.mp, self.hero.maxmp), x, y + 132)
        ui.text(screen, "%d G" % self.hero.gold, x, y + 176, color=YELLOW)
