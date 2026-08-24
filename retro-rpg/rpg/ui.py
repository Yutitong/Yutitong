"""ウィンドウ・メッセージ・コマンド選択。

ドラクエ風の「黒地に白ワク」を基本にしている。
文字は拡大後の画面に直接描くので、マップより解像度が高い。
"""
import pygame
from . import fonts, sfx
from .config import WINDOW_W, WINDOW_H, WHITE, BLACK

FONT_M = 32          # ふつうの文字
FONT_S = 24          # ちいさい文字
FONT_L = 56          # タイトル
LINE_H = 42

MSG_H = 216
MSG_PAD = 28


def draw_window(surface, rect, alpha=None):
    """黒地＋白い二重ワクのウィンドウを描く。"""
    rect = pygame.Rect(rect)
    body = pygame.Surface(rect.size, pygame.SRCALPHA)
    body.fill((*BLACK, 255 if alpha is None else alpha))
    surface.blit(body, rect.topleft)
    pygame.draw.rect(surface, WHITE, rect, 5)
    pygame.draw.rect(surface, WHITE, rect.inflate(-16, -16), 2)


def text(surface, s, x, y, size=FONT_M, color=WHITE):
    surface.blit(fonts.render(s, size, color), (x, y))


def text_right(surface, s, right, y, size=FONT_M, color=WHITE):
    img = fonts.render(s, size, color)
    surface.blit(img, (right - img.get_width(), y))


def wrap(s, size, max_w):
    """指定はばで折り返した行のリストを返す。"""
    font = fonts.get_font(size)
    lines = []
    for raw in s.split("\n"):
        if raw == "":
            lines.append("")
            continue
        cur = ""
        for ch in raw:
            if font.size(cur + ch)[0] > max_w and cur:
                lines.append(cur)
                cur = ch
            else:
                cur += ch
        lines.append(cur)
    return lines


class Message:
    """1文字ずつ出てくるメッセージ窓。

    push() で文章を積み、update()/draw() を毎フレーム呼ぶ。
    active が False になったら読み終わり。
    """

    MAX_LINES = 4
    SPEED = 1.6          # 1フレームあたり何文字出すか

    def __init__(self, rect=None):
        self.rect = pygame.Rect(rect) if rect else pygame.Rect(
            24, WINDOW_H - MSG_H - 24, WINDOW_W - 48, MSG_H)
        self.pages = []
        self.lines = []
        self.shown = 0.0
        self.blink = 0
        self.on_finish = None
        self.auto = False          # True なら キーを押さなくても つぎに すすむ
        self.auto_delay = 30
        self._auto_wait = 0

    # --- 操作 ---
    def push(self, *texts):
        for t in texts:
            for chunk in self._paginate(t):
                self.pages.append(chunk)
        if self.lines == [] and self.pages:
            self._next_page()

    def clear(self):
        self.pages = []
        self.lines = []
        self.shown = 0.0

    def _paginate(self, t):
        inner_w = self.rect.w - MSG_PAD * 2
        all_lines = wrap(t, FONT_M, inner_w)
        return [all_lines[i:i + self.MAX_LINES] for i in range(0, len(all_lines), self.MAX_LINES)] or [[""]]

    def _next_page(self):
        self.lines = self.pages.pop(0)
        self.shown = 0.0

    @property
    def active(self):
        return bool(self.lines) or bool(self.pages)

    @property
    def finished_page(self):
        return self.shown >= self._total_chars()

    def _total_chars(self):
        return sum(len(l) for l in self.lines)

    def skip(self):
        self.shown = self._total_chars()

    def advance(self):
        """決定キーが押されたとき。全部出てなければ全部出す、出ていれば次へ。"""
        if not self.active:
            return False
        if not self.finished_page:
            self.skip()
            return True
        self._auto_wait = 0
        if self.pages:
            if not self.auto:
                sfx.play("cursor")
            self._next_page()
            return True
        self.lines = []
        if self.on_finish:
            cb, self.on_finish = self.on_finish, None
            cb()
        return True

    def update(self):
        if self.lines and not self.finished_page:
            self.shown += self.SPEED
        elif self.lines and self.auto:
            self._auto_wait += 1
            if self._auto_wait >= self.auto_delay:
                self._auto_wait = 0
                self.advance()
        self.blink = (self.blink + 1) % 60

    def draw(self, surface):
        if not self.lines:
            return
        draw_window(surface, self.rect)
        left = self.rect.x + MSG_PAD
        top = self.rect.y + MSG_PAD - 6
        budget = int(self.shown)
        for i, line in enumerate(self.lines):
            if budget <= 0:
                break
            text(surface, line[:budget], left, top + i * LINE_H)
            budget -= len(line)
        if self.finished_page and self.blink < 36:
            text(surface, "▼", self.rect.right - MSG_PAD - 32, self.rect.bottom - 46)


class Menu:
    """たてならび（または複数列）のコマンド選択。"""

    def __init__(self, items, x, y, width=None, columns=1, title=None, cancelable=True):
        self.items = list(items)
        self.index = 0
        self.columns = columns
        self.title = title
        self.cancelable = cancelable
        self.x, self.y = x, y
        self.width = width or self._auto_width()

    def _auto_width(self):
        font = fonts.get_font(FONT_M)
        w = max([font.size(str(i))[0] for i in self.items] + [0])
        if self.title:
            w = max(w, font.size(self.title)[0])
        return w * self.columns + 64 + 40 * self.columns

    @property
    def rows(self):
        return (len(self.items) + self.columns - 1) // self.columns

    @property
    def height(self):
        return self.rows * LINE_H + MSG_PAD * 2 - 8 + (LINE_H if self.title else 0)

    @property
    def rect(self):
        return pygame.Rect(self.x, self.y, self.width, self.height)

    @property
    def selected(self):
        return self.items[self.index] if self.items else None

    def move(self, dx, dy):
        if not self.items:
            return
        before = self.index
        if dy:
            self.index = (self.index + dy * self.columns) % len(self.items)
        if dx:
            self.index = (self.index + dx) % len(self.items)
        if self.index != before:
            sfx.play("cursor")

    def draw(self, surface):
        draw_window(surface, self.rect)
        left = self.x + MSG_PAD
        top = self.y + MSG_PAD - 6
        if self.title:
            text(surface, self.title, left + 34, top)
            top += LINE_H
        col_w = (self.width - MSG_PAD * 2) // self.columns
        for i, item in enumerate(self.items):
            cx = left + (i % self.columns) * col_w
            cy = top + (i // self.columns) * LINE_H
            if i == self.index:
                text(surface, "▶", cx, cy)
            text(surface, str(item), cx + 34, cy)
