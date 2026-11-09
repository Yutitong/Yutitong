"""
Pixel Evolution — AI の「美的判断」による自然選択の実験

32x32 (既定) のピクセル画像を、7色のランダムな状態から始めて進化させる。
毎世代:
  1. 鋳型（親）をそのままコピーしたウィンドウと、
     鋳型から 10 ピクセル（既定）だけランダムに色を変えたウィンドウを用意する
  2. 2つのウィンドウとお題を Claude に見せ、どちらがお題に「沿っている」かを選ばせる
  3. 選ばれた方を次の世代の鋳型にする
これを繰り返し、画面に何か consistent なものが現れるかを観察する。

使い方:
  python evolve.py "海" --generations 200
  python evolve.py "顔" --judge random     # 対照実験（ランダム選択 = 中立的浮動）
  python evolve.py --resume runs/20261109-120000_海   # 続きから
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

# --------------------------------------------------------------------------
# 7色パレット
# --------------------------------------------------------------------------
PALETTE = np.array(
    [
        (0, 0, 0),        # 0 黒
        (255, 255, 255),  # 1 白
        (230, 0, 0),      # 2 赤
        (0, 200, 0),      # 3 緑
        (0, 60, 255),     # 4 青
        (255, 230, 0),    # 5 黄
        (0, 230, 230),    # 6 シアン
    ],
    dtype=np.uint8,
)
COLOR_NAMES = ["black", "white", "red", "green", "blue", "yellow", "cyan"]
N_COLORS = len(PALETTE)

DEFAULT_MODEL = "claude-opus-5-5"


# --------------------------------------------------------------------------
# グリッド操作
# --------------------------------------------------------------------------
def random_grid(size: int, rng: np.random.Generator) -> np.ndarray:
    return rng.integers(0, N_COLORS, size=(size, size), dtype=np.uint8)


def mutate(grid: np.ndarray, n_pixels: int, rng: np.random.Generator) -> np.ndarray:
    """鋳型をコピーし、ランダムな n_pixels 個のピクセルを「今と違う」ランダムな色に変える。"""
    child = grid.copy()
    flat = child.reshape(-1)
    idx = rng.choice(flat.size, size=n_pixels, replace=False)
    for i in idx:
        new = rng.integers(0, N_COLORS - 1)
        if new >= flat[i]:
            new += 1  # 必ず別の色にする → ちょうど n_pixels 個が変わる
        flat[i] = new
    return child


def render(grid: np.ndarray, scale: int) -> Image.Image:
    img = Image.fromarray(PALETTE[grid])
    return img.resize((grid.shape[1] * scale, grid.shape[0] * scale), Image.NEAREST)


def png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.standard_b64encode(buf.getvalue()).decode("ascii")


# --------------------------------------------------------------------------
# 判定者 (Judge)
# --------------------------------------------------------------------------
SYSTEM_PROMPT = """\
You are the selector in an evolution experiment.
You will see two pixel images, "Window A" and "Window B". Each is a square grid
where every pixel is one of 7 colors (black, white, red, green, blue, yellow, cyan).
The two windows are almost identical: they differ in only a handful of pixels.

You will be given a theme (a concept, word, or prompt — possibly in Japanese).
Choose the window that fits the theme better — the one that looks, feels, or
evokes the theme even slightly more. Look carefully at where the two differ.
Even if both look like noise and the difference is tiny, you must commit to one.

Respond with JSON only: {"choice": "A" or "B", "reason": "<one or two sentences>"}.
Write the reason in the same language as the theme."""

CHOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "choice": {"type": "string", "enum": ["A", "B"]},
        "reason": {"type": "string"},
    },
    "required": ["choice", "reason"],
    "additionalProperties": False,
}


class Verdict:
    def __init__(self, choice: str | None, reason: str = "", thinking: str = "",
                 status: str = "ok", usage: dict | None = None):
        self.choice = choice      # "A" / "B" / None (判定できなかった)
        self.reason = reason
        self.thinking = thinking  # Claude の思考の要約
        self.status = status      # ok / refusal / parse_error / max_tokens
        self.usage = usage or {}


class RandomJudge:
    """対照実験用: コイン投げで選ぶ（選択圧なし = 中立的浮動）。"""

    name = "random"

    def __init__(self, rng: np.random.Generator):
        self.rng = rng

    def judge(self, theme: str, img_a: Image.Image, img_b: Image.Image) -> Verdict:
        return Verdict("A" if self.rng.random() < 0.5 else "B", reason="(random)")


class ClaudeJudge:
    """Claude API に2枚の画像を見せて選ばせる。"""

    def __init__(self, model: str, effort: str):
        import anthropic  # API を使うときだけ必要

        self.anthropic = anthropic
        self.client = anthropic.Anthropic(max_retries=6)
        self.model = model
        self.effort = effort
        self.name = f"claude:{model}"

    def judge(self, theme: str, img_a: Image.Image, img_b: Image.Image) -> Verdict:
        content = [
            {"type": "text", "text": "Window A:"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                         "data": png_b64(img_a)}},
            {"type": "text", "text": "Window B:"},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                         "data": png_b64(img_b)}},
            {"type": "text", "text": f"Theme: {theme}\n\nWhich window fits the theme better?"},
        ]
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive", "display": "summarized"},
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": CHOICE_SCHEMA},
            },
            # 安全分類器が誤って拒否した場合、サーバー側で推奨モデルに自動で再実行させる
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": content}],
        )

        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "model": response.model,
        }
        thinking = "\n".join(
            b.thinking for b in response.content if b.type == "thinking" and b.thinking
        )

        if response.stop_reason == "refusal":
            return Verdict(None, status="refusal", thinking=thinking, usage=usage)
        if response.stop_reason == "max_tokens":
            return Verdict(None, status="max_tokens", thinking=thinking, usage=usage)

        text = "".join(b.text for b in response.content if b.type == "text")
        try:
            data = json.loads(text)
            choice = data["choice"]
            if choice not in ("A", "B"):
                raise ValueError(choice)
            return Verdict(choice, data.get("reason", ""), thinking, usage=usage)
        except (json.JSONDecodeError, KeyError, ValueError):
            return Verdict(None, reason=text, thinking=thinking,
                           status="parse_error", usage=usage)


# --------------------------------------------------------------------------
# 出力
# --------------------------------------------------------------------------
def save_live_view(path: Path, parent: np.ndarray, mutant: np.ndarray,
                   chose_mutant: bool | None, scale: int) -> None:
    """親(左)と変異体(右)を並べ、選ばれた方を緑枠で囲んだ画像を保存する。"""
    a, b = render(parent, scale), render(mutant, scale)
    pad, gap = 8, 24
    w, h = a.width, a.height
    canvas = Image.new("RGB", (w * 2 + gap + pad * 2, h + pad * 2), (40, 40, 40))
    canvas.paste(a, (pad, pad))
    canvas.paste(b, (pad + w + gap, pad))
    draw = ImageDraw.Draw(canvas)
    # 変異ピクセルの位置を赤い点で示す（この表示は人間用。Claude には見せない）
    diff = np.argwhere(parent != mutant)
    for y, x in diff:
        x0 = pad + w + gap + x * scale
        y0 = pad + y * scale
        draw.rectangle((x0 - 2, y0 - 2, x0 + scale + 1, y0 + scale + 1),
                       outline=(255, 0, 255), width=2)
    if chose_mutant is not None:
        x0 = pad + (w + gap if chose_mutant else 0)
        draw.rectangle((x0 - 5, pad - 5, x0 + w + 4, pad + h + 4),
                       outline=(0, 255, 120), width=4)
    canvas.save(path)


def save_timeline(run_dir: Path, scale: int = 4, cols: int = 10) -> None:
    snaps = sorted((run_dir / "snapshots").glob("gen_*.png"))
    if not snaps:
        return
    # 多すぎる場合は均等に間引く
    if len(snaps) > 60:
        idx = np.linspace(0, len(snaps) - 1, 60).round().astype(int)
        snaps = [snaps[i] for i in idx]
    imgs = [Image.open(p).convert("RGB") for p in snaps]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + 4) + 4, rows * (h + 4) + 4), (40, 40, 40))
    for i, im in enumerate(imgs):
        sheet.paste(im, (4 + (i % cols) * (w + 4), 4 + (i // cols) * (h + 4)))
    sheet.save(run_dir / "timeline.png")

    frames = [im.resize((w * 2, h * 2), Image.NEAREST) for im in
              [Image.open(p).convert("RGB") for p in sorted((run_dir / "snapshots").glob("gen_*.png"))]]
    frames[0].save(run_dir / "evolution.gif", save_all=True, append_images=frames[1:],
                   duration=120, loop=0)


def slugify(text: str) -> str:
    s = re.sub(r"[\\/:*?\"<>|\s]+", "_", text.strip())
    return s[:40] or "untitled"


# --------------------------------------------------------------------------
# 状態の保存 / 復元
# --------------------------------------------------------------------------
def save_state(run_dir: Path, gen: int, parent: np.ndarray, initial: np.ndarray,
               rng: np.random.Generator, stats: dict) -> None:
    np.savez(run_dir / "state.npz", parent=parent, initial=initial)
    (run_dir / "state.json").write_text(json.dumps(
        {"generation": gen, "rng_state": rng.bit_generator.state, "stats": stats},
        ensure_ascii=False, indent=2))


def load_state(run_dir: Path):
    arr = np.load(run_dir / "state.npz")
    meta = json.loads((run_dir / "state.json").read_text())
    rng = np.random.default_rng()
    rng.bit_generator.state = meta["rng_state"]
    return meta["generation"], arr["parent"], arr["initial"], rng, meta["stats"]


# --------------------------------------------------------------------------
# メインループ
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description="AI による自然選択でピクセル画像を進化させる")
    ap.add_argument("theme", nargs="?", help="お題（概念）。例: 海, 顔, 怒り, 'a cat'")
    ap.add_argument("-g", "--generations", type=int, default=100, help="今回回す世代数 (既定 100)")
    ap.add_argument("--size", type=int, default=32, help="グリッドの一辺 (既定 32)")
    ap.add_argument("--mutations", type=int, default=10, help="1世代で変えるピクセル数 (既定 10)")
    ap.add_argument("--scale", type=int, default=16, help="Claude に見せる画像の拡大率 (既定 16 → 512px)")
    ap.add_argument("--judge", choices=["claude", "random"], default="claude")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"],
                    help="Claude の思考の深さ (既定 medium)")
    ap.add_argument("--seed", type=int, default=None, help="乱数シード（初期画像と変異を再現）")
    ap.add_argument("--snapshot-every", type=int, default=5, help="何世代ごとに鋳型を保存するか")
    ap.add_argument("--runs-dir", default="runs")
    ap.add_argument("--resume", metavar="RUN_DIR", help="途中から再開する実行ディレクトリ")
    args = ap.parse_args()

    # ---- 準備 ------------------------------------------------------------
    if args.resume:
        run_dir = Path(args.resume)
        config = json.loads((run_dir / "config.json").read_text())
        start_gen, parent, initial, rng, stats = load_state(run_dir)
        print(f"再開: {run_dir}  (第 {start_gen} 世代から)")
    else:
        if not args.theme:
            ap.error("お題を指定してください（例: python evolve.py 海）")
        config = {
            "theme": args.theme, "size": args.size, "mutations": args.mutations,
            "scale": args.scale, "judge": args.judge, "model": args.model,
            "effort": args.effort, "seed": args.seed,
            "palette": COLOR_NAMES, "created": datetime.now().isoformat(timespec="seconds"),
        }
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir = Path(args.runs_dir) / f"{stamp}_{slugify(args.theme)}"
        (run_dir / "snapshots").mkdir(parents=True)
        (run_dir / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2))
        rng = np.random.default_rng(args.seed)
        parent = random_grid(config["size"], rng)
        initial = parent.copy()
        start_gen = 0
        stats = {"mutant_chosen": 0, "parent_chosen": 0, "undecided": 0,
                 "shown_left_chosen": 0, "input_tokens": 0, "output_tokens": 0}
        render(parent, 4).save(run_dir / "snapshots" / "gen_00000.png")
        print(f"新しい実行: {run_dir}")

    theme, scale, n_mut = config["theme"], config["scale"], config["mutations"]
    judge = (RandomJudge(np.random.default_rng()) if config["judge"] == "random"
             else ClaudeJudge(config["model"], config["effort"]))
    print(f"お題: {theme} | {config['size']}x{config['size']} | 変異 {n_mut}px/世代 | 判定: {judge.name}\n")

    log_path = run_dir / "log.jsonl"
    gen = start_gen
    try:
        for gen in range(start_gen + 1, start_gen + args.generations + 1):
            old_parent = parent
            mutant = mutate(parent, n_mut, rng)

            # 位置バイアスを避けるため、変異体を A/B どちらに置くかを毎回ランダムにする
            mutant_is_a = bool(rng.random() < 0.5)
            grid_a, grid_b = (mutant, parent) if mutant_is_a else (parent, mutant)

            t0 = time.time()
            verdict = judge.judge(theme, render(grid_a, scale), render(grid_b, scale))
            dt = time.time() - t0

            if verdict.choice is None:
                chose_mutant = None
                stats["undecided"] += 1          # 判定できなければ親を残す
            else:
                chose_mutant = (verdict.choice == "A") == mutant_is_a
                if verdict.choice == "A":
                    stats["shown_left_chosen"] += 1
                if chose_mutant:
                    parent = mutant
                    stats["mutant_chosen"] += 1
                else:
                    stats["parent_chosen"] += 1
            stats["input_tokens"] += verdict.usage.get("input_tokens", 0)
            stats["output_tokens"] += verdict.usage.get("output_tokens", 0)

            changed = int((parent != initial).sum())
            entry = {
                "generation": gen, "choice": verdict.choice, "mutant_was": "A" if mutant_is_a else "B",
                "chose_mutant": chose_mutant, "status": verdict.status,
                "reason": verdict.reason, "thinking": verdict.thinking,
                "pixels_changed_from_initial": changed, "seconds": round(dt, 2),
                "usage": verdict.usage,
            }
            with log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

            save_live_view(run_dir / "live.png", old_parent, mutant, chose_mutant, 8)
            if gen % args.snapshot_every == 0:
                render(parent, 4).save(run_dir / "snapshots" / f"gen_{gen:05d}.png")
            save_state(run_dir, gen, parent, initial, rng, stats)

            mark = {True: "変異体を採用", False: "親を維持", None: f"判定なし({verdict.status})"}[chose_mutant]
            print(f"[{gen:5d}] {verdict.choice or '-'} → {mark:10s} | 初期から{changed:4d}px変化 | "
                  f"{dt:4.1f}s | {verdict.reason[:80]}")
    except KeyboardInterrupt:
        print("\n中断しました。--resume で続きから再開できます。")
    finally:
        render(parent, 4).save(run_dir / "snapshots" / f"gen_{gen:05d}.png")
        render(parent, 16).save(run_dir / "current.png")
        save_timeline(run_dir)

    decided = stats["mutant_chosen"] + stats["parent_chosen"]
    print("\n==== まとめ ====")
    print(f"実行ディレクトリ : {run_dir}")
    if decided:
        print(f"変異体を採用     : {stats['mutant_chosen']}/{decided} "
              f"({100 * stats['mutant_chosen'] / decided:.0f}%)")
        print(f"A(先に見せた方) : {stats['shown_left_chosen']}/{decided} "
              f"({100 * stats['shown_left_chosen'] / decided:.0f}%)  ← 50% から大きくずれていれば位置バイアス")
    if stats["undecided"]:
        print(f"判定なし         : {stats['undecided']}")
    if stats["input_tokens"]:
        print(f"トークン         : 入力 {stats['input_tokens']:,} / 出力 {stats['output_tokens']:,}")
    print("current.png / timeline.png / evolution.gif / log.jsonl を見てください。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
