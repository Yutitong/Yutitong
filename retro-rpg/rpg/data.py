"""ゲームバランスのデータをまとめた場所。

数字をいじるとゲームの手ごたえが変わる。
まずはここを触ってみるのがおすすめ。
"""

# --- レベルごとの のうりょく ------------------------------------
# exp = そのレベルに あがるのに 必要な 累計けいけんち
LEVELS = [
    {"lv": 1,  "exp": 0,    "hp": 20,  "mp": 6,  "atk": 8,  "df": 6,  "spd": 6},
    {"lv": 2,  "exp": 8,    "hp": 26,  "mp": 8,  "atk": 10, "df": 8,  "spd": 7},
    {"lv": 3,  "exp": 22,   "hp": 32,  "mp": 12, "atk": 13, "df": 10, "spd": 8},
    {"lv": 4,  "exp": 45,   "hp": 40,  "mp": 16, "atk": 16, "df": 12, "spd": 10},
    {"lv": 5,  "exp": 80,   "hp": 48,  "mp": 20, "atk": 20, "df": 15, "spd": 12},
    {"lv": 6,  "exp": 140,  "hp": 58,  "mp": 24, "atk": 24, "df": 18, "spd": 14},
    {"lv": 7,  "exp": 220,  "hp": 68,  "mp": 30, "atk": 29, "df": 21, "spd": 16},
    {"lv": 8,  "exp": 330,  "hp": 80,  "mp": 36, "atk": 34, "df": 25, "spd": 18},
    {"lv": 9,  "exp": 480,  "hp": 92,  "mp": 42, "atk": 40, "df": 29, "spd": 20},
    {"lv": 10, "exp": 680,  "hp": 106, "mp": 50, "atk": 46, "df": 33, "spd": 23},
    {"lv": 11, "exp": 950,  "hp": 120, "mp": 58, "atk": 53, "df": 38, "spd": 26},
    {"lv": 12, "exp": 1300, "hp": 136, "mp": 66, "atk": 60, "df": 43, "spd": 29},
]
MAX_LEVEL = LEVELS[-1]["lv"]

# --- じゅもん ---------------------------------------------------
SPELLS = {
    "ファイア":   {"mp": 3,  "kind": "damage", "power": (10, 16),  "level": 3,
                 "desc": "てきに ほのおの ダメージ"},
    "ヒール":     {"mp": 4,  "kind": "heal",   "power": (26, 34),  "level": 4,
                 "desc": "HPを かいふくする"},
    "いなずま":   {"mp": 8,  "kind": "damage", "power": (28, 40),  "level": 7,
                 "desc": "てきに かみなりの ダメージ"},
    "だいヒール": {"mp": 14, "kind": "heal",   "power": (85, 120), "level": 10,
                 "desc": "HPを おおきく かいふくする"},
}


def spells_for_level(level):
    return [name for name, s in SPELLS.items() if s["level"] <= level]


def newly_learned(level):
    return [name for name, s in SPELLS.items() if s["level"] == level]


# --- どうぐ -----------------------------------------------------
ITEMS = {
    "やくそう":       {"price": 8,   "kind": "heal",   "power": (28, 36), "battle": True,
                    "desc": "HPを 30ほど かいふく"},
    "まほうのみず":   {"price": 26,  "kind": "mp",     "power": (14, 20), "battle": True,
                    "desc": "MPを 15ほど かいふく"},
    "キメラのつばさ": {"price": 25,  "kind": "warp",   "power": (0, 0),   "battle": False,
                    "desc": "むらへ もどる"},
    "ちからのたね":   {"price": 120, "kind": "atk_up", "power": (1, 3),   "battle": False,
                    "desc": "こうげきりょくが あがる"},
}
SHOP_STOCK = ["やくそう", "まほうのみず", "キメラのつばさ", "ちからのたね"]
INN_PRICE = 10

# --- モンスター -------------------------------------------------
# skills: (なまえ, しゅるい, いりょく, かくりつ%)
MONSTERS = {
    "slime": {"name": "スライム", "sprite": "slime",
              "hp": 9,  "atk": 8,  "df": 4,  "spd": 4,  "exp": 2,  "gold": 3, "skills": []},
    "rat":   {"name": "おおねずみ", "sprite": "rat",
              "hp": 14, "atk": 11, "df": 6,  "spd": 9,  "exp": 4,  "gold": 6, "skills": []},
    "goblin": {"name": "ゴブリン", "sprite": "goblin",
               "hp": 24, "atk": 15, "df": 10, "spd": 6,  "exp": 9,  "gold": 13,
               "skills": [("つよい こうげき", "strong", 0, 25)]},
    "mage":  {"name": "まどうし", "sprite": "mage",
              "hp": 20, "atk": 12, "df": 8,  "spd": 11, "exp": 13, "gold": 22,
              "skills": [("ファイア", "magic", 14, 40)]},
    "darklord": {"name": "まおう", "sprite": "darklord",
                 "hp": 110, "atk": 36, "df": 22, "spd": 14, "exp": 250, "gold": 400,
                 "skills": [("こおりの いぶき", "magic", 26, 30),
                            ("やみの いちげき", "strong", 0, 25)]},
}


# --- ダメージ計算 -----------------------------------------------
def attack_damage(atk, dfn, rnd):
    """つうじょう こうげきの ダメージ。ドラクエ風の かんたんな しき。"""
    base = atk / 2.0 - dfn / 4.0
    if base < 1:
        # ぼうぎょが かたいと ほとんど とおらない
        return rnd.choice([0, 1, 1])
    return max(1, int(base * rnd.uniform(0.86, 1.14) + 0.5))


def critical_damage(atk, rnd):
    """かいしんの いちげき。ぼうぎょを むしする。"""
    return max(1, int(atk / 1.6 * rnd.uniform(0.9, 1.15) + 0.5))


def magic_damage(power, rnd):
    return max(1, int(power * rnd.uniform(0.85, 1.15) + 0.5))


def is_critical(rnd):
    return rnd.randrange(32) == 0


def flee_success(player_spd, enemy_spd, rnd):
    chance = 0.45 + 0.4 * player_spd / max(1, player_spd + enemy_spd)
    return rnd.random() < min(0.92, chance)
