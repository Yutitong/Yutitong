"""主人公のステータス・もちもの・セーブデータ。"""
import json
import os
import random
from . import data


class Hero:
    def __init__(self):
        self.name = "ゆうしゃ"
        self.level = 1
        self.exp = 0
        self.gold = 30
        self.atk_bonus = 0
        self.items = {"やくそう": 3}
        self.flags = []                  # "quest" / "cleared" など
        self.map = "village"
        self.x, self.y = 11, 10
        self.dir = "up"
        self.hp = self.maxhp
        self.mp = self.maxmp

    # --- のうりょく ---
    def _row(self):
        row = data.LEVELS[0]
        for r in data.LEVELS:
            if self.level >= r["lv"]:
                row = r
        return row

    @property
    def maxhp(self):
        return self._row()["hp"]

    @property
    def maxmp(self):
        return self._row()["mp"]

    @property
    def atk(self):
        return self._row()["atk"] + self.atk_bonus

    @property
    def df(self):
        return self._row()["df"]

    @property
    def spd(self):
        return self._row()["spd"]

    @property
    def spells(self):
        return data.spells_for_level(self.level)

    @property
    def next_exp(self):
        """つぎの レベルまで あと いくつ か。最大レベルなら None。"""
        for r in data.LEVELS:
            if r["lv"] == self.level + 1:
                return r["exp"] - self.exp
        return None

    @property
    def alive(self):
        return self.hp > 0

    # --- 変化 ---
    def heal(self, amount):
        before = self.hp
        self.hp = min(self.maxhp, self.hp + amount)
        return self.hp - before

    def restore_mp(self, amount):
        before = self.mp
        self.mp = min(self.maxmp, self.mp + amount)
        return self.mp - before

    def damage(self, amount):
        self.hp = max(0, self.hp - amount)
        return amount

    def full_heal(self):
        self.hp, self.mp = self.maxhp, self.maxmp

    def gain_exp(self, amount):
        """けいけんちを もらう。レベルアップしたら メッセージを 返す。"""
        self.exp += amount
        messages = []
        while self.level < data.MAX_LEVEL:
            nxt = next(r for r in data.LEVELS if r["lv"] == self.level + 1)
            if self.exp < nxt["exp"]:
                break
            before = (self.maxhp, self.maxmp, self.atk, self.df, self.spd)
            self.level += 1
            after = (self.maxhp, self.maxmp, self.atk, self.df, self.spd)
            self.hp += after[0] - before[0]
            self.mp += after[1] - before[1]
            messages.append("レベルが %d に あがった！" % self.level)
            messages.append("さいだいHP +%d  さいだいMP +%d\nこうげき +%d  しゅび +%d  すばやさ +%d"
                            % (after[0] - before[0], after[1] - before[1],
                               after[2] - before[2], after[3] - before[3], after[4] - before[4]))
            for spell in data.newly_learned(self.level):
                messages.append("じゅもん 「%s」を おぼえた！" % spell)
        return messages

    # --- もちもの ---
    def add_item(self, name, n=1):
        self.items[name] = self.items.get(name, 0) + n

    def remove_item(self, name, n=1):
        if self.items.get(name, 0) <= n:
            self.items.pop(name, None)
        else:
            self.items[name] -= n

    def item_list(self):
        return [(k, v) for k, v in self.items.items()]

    def has_flag(self, flag):
        return flag in self.flags

    def set_flag(self, flag):
        if flag not in self.flags:
            self.flags.append(flag)

    # --- セーブ ---
    def to_dict(self):
        return {k: getattr(self, k) for k in
                ("name", "level", "exp", "gold", "atk_bonus", "items", "flags",
                 "map", "x", "y", "dir", "hp", "mp")}

    @classmethod
    def from_dict(cls, d):
        hero = cls()
        for k, v in d.items():
            setattr(hero, k, v)
        return hero


def save(hero, path):
    with open(path, "w", encoding="utf-8") as fp:
        json.dump(hero.to_dict(), fp, ensure_ascii=False, indent=1)


def load(path):
    with open(path, encoding="utf-8") as fp:
        return Hero.from_dict(json.load(fp))


def has_save(path):
    return os.path.exists(path)
