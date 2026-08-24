"""日本語が出せるフォントを探して読み込む。

環境によって入っているフォントが違うので、候補を順に試す。
アンチエイリアスは常に切る（= ドット絵らしいカリッとした文字になる）。
"""
import os
import pygame

# 上から順に試す。Unifont / IPAゴシックはドット感が強くてレトロ向き。
_PATH_CANDIDATES = [
    "/usr/share/fonts/opentype/unifont/unifont_jp.otf",
    "/usr/share/fonts/opentype/unifont/unifont.otf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
    "C:/Windows/Fonts/YuGothM.ttc",
    "C:/Windows/Fonts/meiryo.ttc",
]
_NAME_CANDIDATES = [
    "unifont", "ipagothic", "notosanscjkjp", "notosansjp",
    "msgothic", "yugothic", "meiryo", "hiraginosans", "hiraginokakugothicpron",
]

_cache = {}
_font_path = None
_warned = False


def _supports_japanese(font):
    """ひらがな・カタカナ・漢字のグリフを持っているか確認する。"""
    try:
        return all(m is not None for m in font.metrics("あアヲ漢▼"))
    except Exception:
        return False


def _find_font_path():
    global _font_path
    if _font_path is not None:
        return _font_path
    for path in _PATH_CANDIDATES:
        if os.path.exists(path):
            try:
                if _supports_japanese(pygame.font.Font(path, 24)):
                    _font_path = path
                    return _font_path
            except Exception:
                continue
    for name in _NAME_CANDIDATES:
        path = pygame.font.match_font(name)
        if path:
            try:
                if _supports_japanese(pygame.font.Font(path, 24)):
                    _font_path = path
                    return _font_path
            except Exception:
                continue
    _font_path = ""   # 見つからなかった（空文字 = pygame の既定フォント）
    return _font_path


def get_font(size):
    """指定サイズのフォントを返す（同じサイズは使い回す）。"""
    global _warned
    if size in _cache:
        return _cache[size]
    path = _find_font_path()
    if path:
        font = pygame.font.Font(path, size)
    else:
        if not _warned:
            print("[警告] 日本語フォントが見つかりませんでした。文字が □ になります。")
            _warned = True
        font = pygame.font.Font(None, size)
    _cache[size] = font
    return font


def render(text, size, color):
    """アンチエイリアスなしで文字を描く。"""
    return get_font(size).render(text, False, color)
