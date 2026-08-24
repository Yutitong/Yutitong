"""ゲーム本体。シーン（がめん）を つみかさねて 管理する。

いちばん うえの シーンだけが うごき、えを かく。
たたかいは フィールドの うえに つみ、おわったら とりのぞく。
"""
import pygame

from . import fonts, sfx, ui
from .config import WINDOW_W, WINDOW_H, FPS, TITLE, BLACK


class Game:
    def __init__(self, headless=False):
        pygame.init()
        sfx.init()
        flags = 0
        self.screen = pygame.display.set_mode((WINDOW_W, WINDOW_H), flags)
        pygame.display.set_caption(TITLE)
        self.clock = pygame.time.Clock()
        self.scenes = []
        self.running = True
        self.fade = 0
        self.fade_max = 1
        self.headless = headless

    # --- シーン ---
    @property
    def top(self):
        return self.scenes[-1]

    def push(self, scene):
        self.scenes.append(scene)

    def pop(self):
        if len(self.scenes) > 1:
            self.scenes.pop()

    def replace(self, scene):
        if self.scenes:
            self.scenes[-1] = scene
        else:
            self.scenes.append(scene)

    # --- 画面の 暗転 ---
    def fade_in(self, frames=24):
        self.fade = frames
        self.fade_max = frames

    def fade_out_in(self, frames=36):
        self.fade_in(frames)

    # --- ループ ---
    def handle_events(self):
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_F4 and (event.mod & pygame.KMOD_ALT):
                    self.running = False
                else:
                    self.top.handle_key(event.key)

    def step(self):
        self.top.update()
        if self.fade > 0:
            self.fade -= 1

    def render(self):
        self.top.draw(self.screen)
        if self.fade > 0:
            layer = pygame.Surface((WINDOW_W, WINDOW_H))
            layer.fill((0, 0, 0))
            layer.set_alpha(int(255 * self.fade / self.fade_max))
            self.screen.blit(layer, (0, 0))

    def run(self):
        while self.running:
            self.handle_events()
            self.step()
            self.render()
            pygame.display.flip()
            self.clock.tick(FPS)
        pygame.quit()
