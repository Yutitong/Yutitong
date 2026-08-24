"""マップの地形タイル。1マス16x16ドットをその場で描く。

マップデータの1文字が、ここで定義した1種類のタイルに対応する。
"""
import pygame
from .config import TILE

# --- タイルの記号 -----------------------------------------------
GRASS = "."
TALL = ","          # くさむら（敵が出る）
FLOWER = "F"
ROAD = "_"
SAND = "S"
WATER = "~"
BRIDGE = "="
TREE = "T"
MOUNT = "^"
WALL = "B"          # 家のかべ
ROOF = "R"
DOOR = "D"
WINDOW = "W"
CAVE = "C"          # どうくつの床（敵が出る）
ROCK = "X"          # どうくつのかべ
STONE = "#"         # 石だたみ
FLOOR = "-"         # 屋内の床

# 通れないタイル
SOLID = set([WATER, TREE, MOUNT, WALL, ROOF, WINDOW, ROCK, STONE])
# 敵が出るタイル
ENCOUNTER = set([TALL, CAVE])

_C = {
    "grass": (72, 152, 72), "grass_d": (56, 124, 56), "grass_l": (104, 184, 96),
    "tall": (44, 108, 52), "tall_d": (30, 84, 40),
    "road": (200, 176, 128), "road_d": (176, 148, 100),
    "sand": (224, 208, 152), "sand_d": (200, 180, 120),
    "water": (56, 96, 200), "water_l": (96, 152, 232), "water_d": (32, 64, 160),
    "wood": (152, 104, 56), "wood_d": (104, 68, 36),
    "leaf": (40, 112, 56), "leaf_d": (24, 80, 40), "leaf_l": (72, 152, 72),
    "rockg": (136, 136, 144), "rockg_d": (96, 96, 108), "rockg_l": (176, 176, 184),
    "brick": (216, 192, 152), "brick_d": (168, 144, 112),
    "roof": (200, 72, 64), "roof_d": (152, 48, 48),
    "glass": (120, 200, 232),
    "cave": (72, 64, 80), "cave_d": (52, 46, 60), "cave_l": (96, 88, 104),
    "rock": (40, 34, 48), "rock_l": (64, 56, 72),
    "black": (16, 16, 24),
}


def _base(color):
    s = pygame.Surface((TILE, TILE))
    s.fill(color)
    return s


def _dots(surf, color, points):
    for x, y in points:
        surf.set_at((x, y), color)


def _grass(frame):
    s = _base(_C["grass"])
    _dots(s, _C["grass_d"], [(2, 3), (3, 3), (10, 2), (11, 2), (6, 9), (7, 9), (13, 12), (14, 12)])
    _dots(s, _C["grass_l"], [(5, 6), (12, 7), (1, 11), (9, 14)])
    return s


def _tall(frame):
    s = _base(_C["tall"])
    for x in (2, 7, 12):
        for y in (10, 11, 12, 13):
            s.set_at((x, y), _C["tall_d"])
        s.set_at((x, 9), _C["grass_l"])
    for x in (4, 9, 14):
        for y in (4, 5, 6, 7):
            s.set_at((x, y), _C["tall_d"])
        s.set_at((x, 3), _C["grass_l"])
    return s


def _flower(frame):
    s = _grass(frame)
    for (x, y), col in (((3, 4), (248, 216, 88)), ((11, 9), (232, 120, 176)), ((7, 12), (248, 248, 248))):
        _dots(s, col, [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)])
    return s


def _road(frame):
    s = _base(_C["road"])
    _dots(s, _C["road_d"], [(1, 2), (5, 5), (9, 3), (13, 8), (3, 11), (11, 13), (7, 9), (14, 1)])
    return s


def _stone(frame):
    s = _base(_C["rockg"])
    for y in (0, 8):
        pygame.draw.line(s, _C["rockg_d"], (0, y), (15, y))
    for x, y in ((8, 0), (0, 8), (15, 8)):
        pygame.draw.line(s, _C["rockg_d"], (x, y), (x, y + 7))
    _dots(s, _C["rockg_l"], [(3, 3), (11, 4), (5, 12), (12, 12)])
    return s


def _floor(frame):
    s = _base(_C["wood"])
    for y in (0, 5, 10, 15):
        pygame.draw.line(s, _C["wood_d"], (0, y), (15, y))
    return s


def _sand(frame):
    s = _base(_C["sand"])
    _dots(s, _C["sand_d"], [(2, 2), (6, 5), (11, 3), (14, 9), (4, 12), (9, 13)])
    return s


def _water(frame):
    s = _base(_C["water"])
    off = 0 if frame == 0 else 4
    for y in (3, 11):
        for x in range(0, 16, 8):
            pygame.draw.line(s, _C["water_l"], ((x + off) % 16, y), ((x + off + 3) % 16, y))
    _dots(s, _C["water_d"], [(1, 7), (9, 7), (5, 14), (13, 14)])
    return s


def _bridge(frame):
    """たてに ならべても つながるように、はしの ゆかは 上下いっぱいに 描く。"""
    s = _water(frame)
    pygame.draw.rect(s, _C["wood"], (1, 0, 14, 16))
    for x in (1, 14):
        pygame.draw.line(s, _C["wood_d"], (x, 0), (x, 15))
    for y in range(0, 16, 4):
        pygame.draw.line(s, _C["wood_d"], (2, y), (13, y))
    return s


def _tree(frame):
    s = _grass(frame)
    pygame.draw.rect(s, _C["wood"], (6, 10, 4, 6))
    pygame.draw.rect(s, _C["wood_d"], (6, 10, 1, 6))
    pygame.draw.circle(s, _C["leaf_d"], (8, 7), 7)
    pygame.draw.circle(s, _C["leaf"], (8, 7), 6)
    pygame.draw.circle(s, _C["leaf_l"], (6, 5), 2)
    return s


def _mount(frame):
    s = _base(_C["grass"])
    pygame.draw.polygon(s, _C["rockg_d"], [(0, 15), (8, 1), (15, 15)])
    pygame.draw.polygon(s, _C["rockg"], [(2, 15), (8, 3), (14, 15)])
    pygame.draw.polygon(s, _C["rockg_l"], [(8, 3), (11, 8), (5, 8)])
    return s


def _wall(frame):
    s = _base(_C["brick"])
    for y in (0, 5, 10, 15):
        pygame.draw.line(s, _C["brick_d"], (0, y), (15, y))
    for y, xs in ((0, (4, 12)), (5, (0, 8)), (10, (4, 12))):
        for x in xs:
            pygame.draw.line(s, _C["brick_d"], (x, y), (x, y + 4))
    return s


def _roof(frame):
    s = _base(_C["roof"])
    for y in (0, 5, 10, 15):
        pygame.draw.line(s, _C["roof_d"], (0, y), (15, y))
    for y, xs in ((0, (3, 9)), (5, (6, 12)), (10, (3, 9))):
        for x in xs:
            pygame.draw.line(s, _C["roof_d"], (x, y), (x, y + 4))
    return s


def _door(frame):
    s = _wall(frame)
    pygame.draw.rect(s, _C["wood_d"], (3, 3, 10, 13))
    pygame.draw.rect(s, _C["wood"], (4, 4, 8, 12))
    pygame.draw.line(s, _C["wood_d"], (8, 4), (8, 15))
    s.set_at((6, 10), (248, 216, 88))
    s.set_at((10, 10), (248, 216, 88))
    return s


def _window(frame):
    s = _wall(frame)
    pygame.draw.rect(s, _C["wood_d"], (3, 4, 10, 9))
    pygame.draw.rect(s, _C["glass"], (4, 5, 8, 7))
    pygame.draw.line(s, _C["wood_d"], (8, 5), (8, 11))
    pygame.draw.line(s, _C["wood_d"], (4, 8), (11, 8))
    return s


def _cave(frame):
    s = _base(_C["cave"])
    _dots(s, _C["cave_d"], [(3, 4), (4, 4), (10, 2), (12, 9), (6, 12), (7, 12), (1, 8)])
    _dots(s, _C["cave_l"], [(8, 6), (13, 13), (2, 14)])
    return s


def _rock(frame):
    s = _base(_C["rock"])
    for y in (0, 8):
        pygame.draw.line(s, _C["rock_l"], (0, y), (15, y))
    for x, y in ((5, 0), (11, 8)):
        pygame.draw.line(s, _C["rock_l"], (x, y), (x, y + 7))
    return s


_BUILDERS = {
    GRASS: _grass, TALL: _tall, FLOWER: _flower, ROAD: _road, SAND: _sand,
    WATER: _water, BRIDGE: _bridge, TREE: _tree, MOUNT: _mount, WALL: _wall,
    ROOF: _roof, DOOR: _door, WINDOW: _window, CAVE: _cave, ROCK: _rock,
    STONE: _stone, FLOOR: _floor,
}

_cache = {}


def get(ch, frame=0):
    """記号 → タイル画像。存在しない記号は草地あつかい。"""
    key = (ch, frame)
    if key not in _cache:
        builder = _BUILDERS.get(ch, _grass)
        _cache[key] = builder(frame)
    return _cache[key]


def is_solid(ch):
    return ch in SOLID


def is_encounter(ch):
    return ch in ENCOUNTER
