"""ドット絵データと、そこから pygame の画像を作る処理。

絵は「文字の並び」で持っている。1文字 = 1ドット。
'.' は透明。あとは PALETTE の色に対応する。
自分で描き換えたいときは、この文字を書き換えるだけでいい。
"""
import pygame

# ---------------------------------------------------------------
# 人間キャラ（主人公・村人みんな共通の型紙）
# ---------------------------------------------------------------
ACTOR_DOWN = [
    "................",
    "................",
    "....oooooooo....",
    "...ohhhhhhhho...",
    "...ohhhhhhhho...",
    "...osssssssso...",
    "...ossossosso...",
    "...osssssssso...",
    "..obbbbbbbbbbo..",
    "..obbbbbbbbbbo..",
    "..obbyyyyyybbo..",
    ".osbbbbbbbbbbso.",
    "...obbbbbbbbo...",
    "...odddoodddo...",
    "...odddoodddo...",
    "....ooo..ooo....",
]

ACTOR_UP = [
    "................",
    "................",
    "....oooooooo....",
    "...ohhhhhhhho...",
    "...ohhhhhhhho...",
    "...ohhhhhhhho...",
    "...ohhhhhhhho...",
    "...ohhhhhhhho...",
    "..obbbbbbbbbbo..",
    "..obbbbbbbbbbo..",
    "..obbyyyyyybbo..",
    ".osbbbbbbbbbbso.",
    "...obbbbbbbbo...",
    "...odddoodddo...",
    "...odddoodddo...",
    "....ooo..ooo....",
]

ACTOR_RIGHT = [
    "................",
    "................",
    "....oooooooo....",
    "...ohhhhhhhho...",
    "...ohhhhhhsso...",
    "...ohhhhsosso...",
    "...ohhhssssso...",
    "...ohhhssssso...",
    "..obbbbbbbbbbo..",
    "..obbbbbbbbbbo..",
    "..obbyyyyyybbo..",
    "..obbbbbbbbbso..",
    "...obbbbbbbbo...",
    "...oddddddddo...",
    "...oddddddddo...",
    "....ooooooo.....",
]

# 人ごとの色ちがい。b/d が服、h が髪。
PALETTES = {
    "hero":      {"o": (24, 20, 37),  "s": (255, 205, 160), "h": (120, 70, 40),
                  "b": (72, 112, 224), "d": (40, 60, 140),  "y": (248, 216, 88)},
    "villager":  {"o": (24, 20, 37),  "s": (255, 205, 160), "h": (90, 60, 40),
                  "b": (96, 176, 96),  "d": (60, 110, 60),  "y": (200, 170, 100)},
    "woman":     {"o": (24, 20, 37),  "s": (255, 214, 176), "h": (200, 120, 60),
                  "b": (224, 128, 176), "d": (160, 80, 120), "y": (248, 216, 88)},
    "elder":     {"o": (24, 20, 37),  "s": (240, 200, 168), "h": (220, 220, 228),
                  "b": (150, 120, 200), "d": (100, 80, 150), "y": (248, 216, 88)},
    "merchant":  {"o": (24, 20, 37),  "s": (255, 205, 160), "h": (60, 50, 40),
                  "b": (232, 176, 64), "d": (168, 112, 32), "y": (255, 240, 200)},
    "soldier":   {"o": (24, 20, 37),  "s": (255, 205, 160), "h": (70, 70, 80),
                  "b": (176, 184, 200), "d": (110, 118, 136), "y": (216, 64, 64)},
    "king":      {"o": (24, 20, 37),  "s": (255, 205, 160), "h": (230, 200, 120),
                  "b": (200, 64, 96), "d": (140, 40, 70),   "y": (248, 216, 88)},
}

# ---------------------------------------------------------------
# モンスター
# ---------------------------------------------------------------
ENEMY_ART = {
    "slime": ([
        "................",
        "................",
        "................",
        "......oooo......",
        ".....occcco.....",
        "....occcccco....",
        "...occcccccco...",
        "..occcccccccco..",
        "..occoccccocco..",
        "..occcccccccco..",
        "..occcccccccco..",
        ".occcccccccccco.",
        ".occcccwwwcccco.",
        "occccccccccccclo",
        "occccccccccccclo",
        ".oooooooooooooo.",
    ], {"o": (16, 24, 56), "c": (88, 152, 240), "w": (248, 248, 248), "l": (48, 96, 184)}),

    "rat": ([
        "................",
        "................",
        ".........oo.....",
        "........oggo....",
        "..oooo..oggo....",
        ".oggggoooggggo..",
        "oggwgggggggggo..",
        "ogggggggggggggo.",
        "oggggggggggggggo",
        ".oggggggggggggoo",
        ".oggggggggggggo.",
        "..oggggggggggo..",
        "..ogoogggooggo..",
        "...oo..ooo..oo..",
        "................",
        "................",
    ], {"o": (32, 26, 32), "g": (168, 160, 152), "w": (216, 64, 64)}),

    "goblin": ([
        "..o..........o..",
        ".ogo........ogo.",
        ".oggo......oggo.",
        ".oggoooooooggo..",
        "..ogggggggggo...",
        "..ogrgggggrgo...",
        "..ogggggggggo...",
        "..oggwwwwwggo...",
        "...oogggggoo....",
        "....obbbbbo.....",
        "..oobbbbbbboo...",
        ".ogobbbbbbbogo..",
        ".oggoobbbooggo..",
        "..oo.oggo.oo....",
        ".....oggo.......",
        "....oo..oo......",
    ], {"o": (20, 30, 20), "g": (120, 184, 88), "r": (216, 64, 64), "b": (140, 96, 64), "w": (240, 240, 216)}),

    "mage": ([
        "................",
        ".....oooooo.....",
        "....oppppppo..w.",
        "...oppppppppo.y.",
        "...oppppppppo.y.",
        "...opsssssspo.y.",
        "...opsrssrspo.y.",
        "...oppppppppo.y.",
        "..oppppppppppoy.",
        ".oppppppppppppo.",
        ".oppppppppppppo.",
        ".oppppwwwwppppo.",
        "oppppppppppppppo",
        "oppppppppppppppo",
        "oppppppppppppppo",
        ".oooooooooooooo.",
    ], {"o": (24, 16, 40), "p": (136, 88, 200), "s": (240, 200, 168),
        "r": (216, 64, 64), "w": (248, 232, 120), "y": (248, 216, 88)}),

    "darklord": ([
        ".o..........o...",
        ".oro.......oro..",
        ".orro.....orro..",
        "..orroooooorro..",
        "..okkkkkkkkkko..",
        "..okrkkkkkrkko..",
        "..okkkkkkkkkko..",
        "...okrrrrrrko...",
        "..ookkkkkkkkoo..",
        ".orokkkkkkkkoro.",
        "orrokkkkkkkkorro",
        "orrokkkkkkkkorro",
        ".rrookkkkkkoorr.",
        "..o..okkkko..o..",
        ".....okkkko.....",
        ".....oo..oo.....",
    ], {"o": (16, 8, 24), "k": (88, 56, 112), "r": (232, 56, 56)}),
}

# ---------------------------------------------------------------
# 組み立て
# ---------------------------------------------------------------


def _check(rows, name):
    """絵のサイズがそろっているか確認する（描き換えたときのミス防止）。"""
    w = len(rows[0])
    for i, row in enumerate(rows):
        if len(row) != w:
            raise ValueError("%s の %d 行目が %d 文字（%d 文字であるべき）: %r"
                             % (name, i, len(row), w, row))
    return w, len(rows)


def make_surface(rows, palette, name="sprite"):
    """文字の並び → 透明つきの Surface。"""
    w, h = _check(rows, name)
    surf = pygame.Surface((w, h), pygame.SRCALPHA)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            color = palette.get(ch)
            if color is None:
                raise ValueError("%s: 色が未定義の文字 %r" % (name, ch))
            surf.set_at((x, y), color)
    return surf


def _walk_variant(base, dx):
    """足だけ横にずらして歩きの絵を作る。"""
    w, h = base.get_size()
    surf = pygame.Surface((w, h), pygame.SRCALPHA)
    surf.blit(base, (0, 0), pygame.Rect(0, 0, w, h - 3))
    surf.blit(base, (dx, h - 3), pygame.Rect(0, h - 3, w, 3))
    return surf


def build_actor(palette_name):
    """4方向 × 4コマのアニメを作る。左向きは右向きの反転。"""
    pal = PALETTES[palette_name]
    down = make_surface(ACTOR_DOWN, pal, "actor_down")
    up = make_surface(ACTOR_UP, pal, "actor_up")
    right = make_surface(ACTOR_RIGHT, pal, "actor_right")
    left = pygame.transform.flip(right, True, False)
    frames = {}
    for name, base in (("down", down), ("up", up), ("right", right), ("left", left)):
        frames[name] = [base, _walk_variant(base, -1), base, _walk_variant(base, 1)]
    return frames


_actor_cache = {}
_enemy_cache = {}


def actor(palette_name):
    if palette_name not in _actor_cache:
        _actor_cache[palette_name] = build_actor(palette_name)
    return _actor_cache[palette_name]


def enemy(key):
    if key not in _enemy_cache:
        rows, pal = ENEMY_ART[key]
        _enemy_cache[key] = make_surface(rows, pal, key)
    return _enemy_cache[key]
