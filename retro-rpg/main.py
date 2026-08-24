#!/usr/bin/env python3
"""ドット・クエスト — レトロRPG

あそびかた:
    python main.py

    やじるしキー … あるく
    Z / Enter    … はなす・けってい
    X / Esc      … メニュー・キャンセル
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rpg.game import Game
from rpg.scenes import TitleScene


def main():
    game = Game()
    game.push(TitleScene(game))
    game.run()


if __name__ == "__main__":
    main()
