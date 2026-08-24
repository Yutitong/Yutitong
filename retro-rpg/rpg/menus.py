"""フィールドで ひらく メニュー、どうぐや、やどや。

どれも「モーダル」として FieldScene の うえに かぶせて うごく。
done が True に なったら 閉じる。
"""
import random
import pygame

from . import data, ui, sfx, party
from .config import WINDOW_W, WINDOW_H, WHITE, YELLOW, RED, SAVE_FILE

CONFIRM = (pygame.K_z, pygame.K_RETURN, pygame.K_SPACE)
CANCEL = (pygame.K_x, pygame.K_ESCAPE, pygame.K_BACKSPACE)


class Modal:
    def __init__(self, field):
        self.field = field
        self.hero = field.hero
        self.done = False
        self.msg = ui.Message()
        self.menu = None
        self._after = None
        self.rnd = random.Random()

    # メッセージを 見せてから つぎの しょり へ
    def say(self, *texts, then=None):
        self.msg.push(*texts)
        self._after = then

    def close(self):
        self.done = True

    def update(self):
        self.msg.update()
        if not self.msg.active and self._after is not None:
            cb, self._after = self._after, None
            cb()

    def handle_key(self, key):
        if self.msg.active:
            if key in CONFIRM + CANCEL:
                self.msg.advance()
            return
        self.on_key(key)

    def on_key(self, key):
        if self.menu is None:
            return
        if key == pygame.K_UP:
            self.menu.move(0, -1)
        elif key == pygame.K_DOWN:
            self.menu.move(0, 1)
        elif key in CONFIRM:
            sfx.play("ok")
            self.on_select()
        elif key in CANCEL:
            sfx.play("cancel")
            self.on_cancel()

    def on_select(self):
        pass

    def on_cancel(self):
        self.close()

    def draw(self, screen):
        if self.menu is not None and not self.msg.active:
            self.menu.draw(screen)
        self.msg.draw(screen)


# ---------------------------------------------------------------------
class FieldMenu(Modal):
    ITEMS = ["つよさ", "どうぐ", "じゅもん", "セーブ", "とじる"]

    def __init__(self, field):
        Modal.__init__(self, field)
        self.state = "main"
        self.menu = ui.Menu(self.ITEMS, 24, 24, width=260)

    # --- 表示 ---
    def draw(self, screen):
        if self.state == "status" and not self.msg.active:
            self._draw_status(screen)
            return
        Modal.draw(self, screen)

    def _draw_status(self, screen):
        h = self.hero
        rect = pygame.Rect(24, 24, 620, 460)
        ui.draw_window(screen, rect)
        x, y = rect.x + 32, rect.y + 24
        ui.text(screen, h.name, x, y)
        rows = [("レベル", str(h.level)),
                ("HP", "%d / %d" % (h.hp, h.maxhp)),
                ("MP", "%d / %d" % (h.mp, h.maxmp)),
                ("こうげきりょく", str(h.atk)),
                ("しゅびりょく", str(h.df)),
                ("すばやさ", str(h.spd)),
                ("ゴールド", "%d G" % h.gold)]
        nxt = h.next_exp
        rows.append(("つぎのレベルまで", "%d" % nxt if nxt is not None else "さいこうレベル"))
        for i, (label, value) in enumerate(rows):
            yy = y + 50 + i * 44
            ui.text(screen, label, x, yy)
            ui.text_right(screen, value, rect.right - 32, yy)

    # --- 操作 ---
    def on_key(self, key):
        if self.state == "status":
            if key in CONFIRM + CANCEL:
                sfx.play("cancel")
                self._back_to_main()
            return
        Modal.on_key(self, key)

    def _back_to_main(self):
        self.state = "main"
        self.menu = ui.Menu(self.ITEMS, 24, 24, width=260)

    def on_cancel(self):
        if self.state == "main":
            self.close()
        else:
            self._back_to_main()

    def on_select(self):
        if self.state == "main":
            choice = self.menu.selected
            if choice == "つよさ":
                self.state = "status"
                self.menu = None
            elif choice == "どうぐ":
                self._open_items()
            elif choice == "じゅもん":
                self._open_spells()
            elif choice == "セーブ":
                party.save(self.hero, SAVE_FILE)
                self.menu = None
                self.say("ぼうけんの しょに きろく しました。", then=self._back_to_main)
            else:
                self.close()
        elif self.state == "items":
            self._use_item()
        elif self.state == "spells":
            self._use_spell()

    def _open_items(self):
        entries = self.hero.item_list()
        if not entries:
            self.menu = None
            self.say("なにも もっていない。", then=self._back_to_main)
            return
        self._item_names = [n for n, _ in entries]
        self.state = "items"
        self.menu = ui.Menu(["%s ×%d" % (n, c) for n, c in entries], 24, 24,
                            width=420, title="どうぐ")

    def _use_item(self):
        name = self._item_names[self.menu.index]
        item = data.ITEMS[name]
        kind = item["kind"]
        self.menu = None
        if kind == "heal":
            if self.hero.hp >= self.hero.maxhp:
                self.say("HPは まんたんだ。", then=self._back_to_main)
                return
            got = self.hero.heal(self.rnd.randint(*item["power"]))
            self.hero.remove_item(name)
            sfx.play("heal")
            self.say("%s を つかった！\nHPが %d かいふくした。" % (name, got), then=self._back_to_main)
        elif kind == "mp":
            if self.hero.mp >= self.hero.maxmp:
                self.say("MPは まんたんだ。", then=self._back_to_main)
                return
            got = self.hero.restore_mp(self.rnd.randint(*item["power"]))
            self.hero.remove_item(name)
            sfx.play("heal")
            self.say("%s を つかった！\nMPが %d かいふくした。" % (name, got), then=self._back_to_main)
        elif kind == "atk_up":
            up = self.rnd.randint(*item["power"])
            self.hero.atk_bonus += up
            self.hero.remove_item(name)
            sfx.play("levelup")
            self.say("%s を たべた！\nこうげきりょくが %d あがった！" % (name, up), then=self._back_to_main)
        elif kind == "warp":
            if self.field.map_key == "village":
                self.say("ここは むらの なかだ。", then=self._back_to_main)
                return
            self.hero.remove_item(name)
            sfx.play("ok")
            self.say("%s を つかった！\nむらへ もどってきた。" % name, then=self._warp_home)

    def _warp_home(self):
        self.hero.x, self.hero.y = 11, 10
        self.hero.dir = "down"
        self.field.load_map("village")
        self.field.game.fade_in()
        self.close()

    def _open_spells(self):
        spells = self.hero.spells
        if not spells:
            self.menu = None
            self.say("じゅもんを おぼえていない。", then=self._back_to_main)
            return
        self.state = "spells"
        self.menu = ui.Menu(["%s  %dMP" % (s, data.SPELLS[s]["mp"]) for s in spells],
                            24, 24, width=420, title="じゅもん")

    def _use_spell(self):
        name = self.hero.spells[self.menu.index]
        spell = data.SPELLS[name]
        self.menu = None
        if spell["kind"] != "heal":
            self.say("ここでは つかえない。", then=self._back_to_main)
            return
        if self.hero.mp < spell["mp"]:
            self.say("MPが たりない。", then=self._back_to_main)
            return
        if self.hero.hp >= self.hero.maxhp:
            self.say("HPは まんたんだ。", then=self._back_to_main)
            return
        self.hero.mp -= spell["mp"]
        got = self.hero.heal(self.rnd.randint(*spell["power"]))
        sfx.play("heal")
        self.say("%s を となえた！\nHPが %d かいふくした。" % (name, got), then=self._back_to_main)


# ---------------------------------------------------------------------
class Shop(Modal):
    def __init__(self, field):
        Modal.__init__(self, field)
        self.stock = data.SHOP_STOCK
        self.menu = ui.Menu(["%s  %dG" % (n, data.ITEMS[n]["price"]) for n in self.stock] + ["やめる"],
                            24, WINDOW_H - 440, width=460, title="なにを かう？")

    def draw(self, screen):
        if not self.msg.active:
            rect = pygame.Rect(WINDOW_W - 300 - 24, 24, 300, 130)
            ui.draw_window(screen, rect)
            ui.text(screen, "%d G" % self.hero.gold, rect.x + 30, rect.y + 24, color=YELLOW)
            name = self.menu.selected
            if name != "やめる":
                key = self.stock[self.menu.index]
                ui.text(screen, data.ITEMS[key]["desc"], rect.x + 30, rect.y + 68, size=ui.FONT_S)
        Modal.draw(self, screen)

    def on_select(self):
        if self.menu.index >= len(self.stock):
            self.say("まいど ありがとう ございます。", then=self.close)
            self.menu = None
            return
        name = self.stock[self.menu.index]
        price = data.ITEMS[name]["price"]
        if self.hero.gold < price:
            self.say("ゴールドが たりないようだ。")
            return
        self.hero.gold -= price
        self.hero.add_item(name)
        sfx.play("ok")
        self.say("%s を てにいれた！" % name)

    def on_cancel(self):
        self.menu = None
        self.say("まいど ありがとう ございます。", then=self.close)


# ---------------------------------------------------------------------
class Inn(Modal):
    def __init__(self, field):
        Modal.__init__(self, field)
        self.menu = ui.Menu(["はい", "いいえ"], 24, WINDOW_H - 420, width=240)

    def on_select(self):
        if self.menu.selected == "いいえ":
            self.menu = None
            self.say("またの おこしを。", then=self.close)
            return
        if self.hero.gold < data.INN_PRICE:
            self.menu = None
            self.say("おや、ゴールドが たりないようですね……", then=self.close)
            return
        self.hero.gold -= data.INN_PRICE
        self.menu = None
        self.field.game.fade_out_in()
        self.hero.full_heal()
        sfx.play("levelup")
        self.say("おやすみなさいませ……", "HPと MPが ぜんかいした！", then=self.close)

    def on_cancel(self):
        self.menu = None
        self.say("またの おこしを。", then=self.close)
