"""ファミコン風の効果音を、その場で矩形波から作る。

外部の音声ファイルを持たなくて済むし、
音が鳴らせない環境（サーバなど）では黙って無効になる。
"""
import math
import struct
import pygame

RATE = 22050
_sounds = {}
_enabled = False


def init():
    """ミキサーを起動して効果音を用意する。失敗しても落とさない。"""
    global _enabled
    try:
        pygame.mixer.pre_init(RATE, -16, 1, 256)
        pygame.mixer.init()
    except Exception:
        _enabled = False
        return
    _enabled = True
    _sounds["cursor"] = _tone([(880, 0.03)], vol=0.18)
    _sounds["ok"] = _tone([(1046, 0.04), (1568, 0.06)], vol=0.20)
    _sounds["cancel"] = _tone([(500, 0.05), (330, 0.06)], vol=0.18)
    _sounds["hit"] = _noise(0.10, vol=0.25)
    _sounds["enemy_hit"] = _noise(0.14, vol=0.30)
    _sounds["heal"] = _tone([(784, 0.05), (988, 0.05), (1318, 0.10)], vol=0.18)
    _sounds["encounter"] = _tone([(196, 0.06), (262, 0.06), (392, 0.06), (523, 0.12)], vol=0.22)
    _sounds["levelup"] = _tone([(523, 0.07), (659, 0.07), (784, 0.07), (1046, 0.18)], vol=0.22)
    _sounds["down"] = _tone([(392, 0.12), (330, 0.12), (262, 0.25)], vol=0.22)


def _to_sound(samples):
    data = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples)
    return pygame.mixer.Sound(buffer=data)


def _tone(notes, vol=0.2):
    """(周波数, 秒数) の並びを矩形波でつなげる。"""
    samples = []
    for freq, dur in notes:
        n = int(RATE * dur)
        period = RATE / freq
        for i in range(n):
            fade = 1.0 - (i / n) * 0.3          # 少しだけ減衰させる
            square = 1.0 if (i % period) < period / 2 else -1.0
            samples.append(square * vol * fade)
    return _to_sound(samples)


def _noise(dur, vol=0.25):
    """疑似乱数のノイズ = 打撃音。"""
    samples = []
    n = int(RATE * dur)
    state = 0x2468
    for i in range(n):
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        fade = 1.0 - i / n
        samples.append(((state >> 16 & 1) * 2 - 1) * vol * fade * fade)
    return _to_sound(samples)


def play(name):
    if _enabled and name in _sounds:
        try:
            _sounds[name].play()
        except Exception:
            pass
