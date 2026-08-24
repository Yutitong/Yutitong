"""ゲーム全体で共有する定数。

画面は「低解像度で描いてから拡大」する方式にしている。
これがレトロゲームのカクカクしたドット感を出す一番の近道。
"""

# --- 画面まわり -------------------------------------------------
TILE = 16                       # マップ1マスのドット数
VIEW_TILES_X = 20               # 画面に映るマス数（横）
VIEW_TILES_Y = 15               # 画面に映るマス数（縦）
LOGICAL_W = TILE * VIEW_TILES_X  # 320
LOGICAL_H = TILE * VIEW_TILES_Y  # 240
SCALE = 3                        # 拡大率
WINDOW_W = LOGICAL_W * SCALE     # 960
WINDOW_H = LOGICAL_H * SCALE     # 720
FPS = 60
TITLE = "ドット・クエスト"

WALK_FRAMES = 8                 # 1マス歩くのにかけるフレーム数（小さいほど速い）

# --- 色 ---------------------------------------------------------
BLACK = (16, 16, 24)
WHITE = (248, 248, 248)
GRAY = (140, 140, 150)
DARKGRAY = (60, 60, 72)
RED = (216, 64, 64)
GREEN = (88, 200, 96)
BLUE = (72, 112, 224)
YELLOW = (248, 216, 88)
CYAN = (120, 216, 232)

# --- セーブ -----------------------------------------------------
# どこから 起動しても おなじ場所に セーブされるように 絶対パスにする
import os
SAVE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "savedata.json")
