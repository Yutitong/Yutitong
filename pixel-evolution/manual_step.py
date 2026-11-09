"""
手動判定モード: 1世代ずつ進める（API を使わず、人間や会話中の Claude が判定する）

  python manual_step.py new "顔" --seed 42        # 実行を作り、第1世代の比較画像 pair.png を書き出す
  python manual_step.py choose RUN_DIR A "理由"    # A か B を選ぶ → 記録し、次の世代の pair.png を書き出す
  python manual_step.py finish RUN_DIR             # current.png / timeline.png / evolution.gif を作る

乱数の使い方は evolve.py と同じ（毎世代: 変異 → A/B の配置）なので、同じシードなら
evolve.py --judge random の対照実験と、各世代の変異位置・配置がまったく同じになる。

判定する側は pair.png だけを見ること。live.png には変異位置の印が描かれているので、
選ぶ前に見ると公平な判定にならない。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from evolve import (COLOR_NAMES, mutate, random_grid, render, save_live_view,
                    save_timeline, slugify)

VIEW_PX = 384  # 判定用画像の一辺（グリッドの大きさに関わらず同じ表示サイズにする）


def save_pair(run_dir: Path, grid_a: np.ndarray, grid_b: np.ndarray, gen: int) -> Path:
    scale = max(1, VIEW_PX // grid_a.shape[0])
    a, b = render(grid_a, scale), render(grid_b, scale)
    pad, gap, top = 12, 32, 36
    canvas = Image.new("RGB", (a.width * 2 + gap + pad * 2, a.height + top + pad), (40, 40, 40))
    canvas.paste(a, (pad, top))
    canvas.paste(b, (pad + a.width + gap, top))
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, 10), f"A   (generation {gen})", fill=(255, 255, 255))
    draw.text((pad + a.width + gap, 10), "B", fill=(255, 255, 255))
    path = run_dir / "pair.png"
    canvas.save(path)
    # 横並びだと「右側」を選ぶ位置の偏りが出たため、1枚ずつ単独でも見られるようにする
    a.save(run_dir / "view_1.png")   # = A
    b.save(run_dir / "view_2.png")   # = B
    return path


def write_state(run_dir, gen, parent, initial, mutant, mutant_is_a, rng, stats):
    np.savez(run_dir / "state.npz", parent=parent, initial=initial, mutant=mutant)
    (run_dir / "state.json").write_text(json.dumps(
        {"generation": gen, "rng_state": rng.bit_generator.state, "stats": stats,
         "pending": {"generation": gen + 1, "mutant_is_a": mutant_is_a}},
        ensure_ascii=False, indent=2))


def prepare_next(run_dir, gen, parent, initial, rng, stats):
    """次の世代の変異体を作り、A/B に配置して pair.png を書き出す（evolve.py と同じ乱数の順序）。"""
    mutant = mutate(parent, CONFIG["mutations"], rng)
    mutant_is_a = bool(rng.random() < 0.5)
    grid_a, grid_b = (mutant, parent) if mutant_is_a else (parent, mutant)
    write_state(run_dir, gen, parent, initial, mutant, mutant_is_a, rng, stats)
    path = save_pair(run_dir, grid_a, grid_b, gen + 1)
    print(f"第 {gen + 1} 世代の比較画像: {path}")


CONFIG: dict = {}


def cmd_new(args):
    global CONFIG
    CONFIG = {
        "theme": args.theme, "size": args.size, "mutations": args.mutations,
        "judge": args.judge_name, "seed": args.seed, "palette": COLOR_NAMES,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = Path(args.runs_dir) / f"{stamp}_{slugify(args.theme)}_manual"
    (run_dir / "snapshots").mkdir(parents=True)
    (run_dir / "config.json").write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2))
    rng = np.random.default_rng(args.seed)
    parent = random_grid(args.size, rng)
    render(parent, 4).save(run_dir / "snapshots" / "gen_00000.png")
    stats = {"mutant_chosen": 0, "parent_chosen": 0, "undecided": 0, "shown_left_chosen": 0}
    print(f"新しい実行: {run_dir}")
    prepare_next(run_dir, 0, parent, parent.copy(), rng, stats)


def cmd_choose(args):
    global CONFIG
    run_dir = Path(args.run_dir)
    CONFIG = json.loads((run_dir / "config.json").read_text())
    arr = np.load(run_dir / "state.npz")
    meta = json.loads((run_dir / "state.json").read_text())
    rng = np.random.default_rng()
    rng.bit_generator.state = meta["rng_state"]
    parent, initial, mutant = arr["parent"], arr["initial"], arr["mutant"]
    stats, pending = meta["stats"], meta["pending"]
    gen, mutant_is_a = pending["generation"], pending["mutant_is_a"]

    choice = args.choice.upper()
    chose_mutant = (choice == "A") == mutant_is_a
    if choice == "A":
        stats["shown_left_chosen"] += 1
    old_parent = parent
    if chose_mutant:
        parent = mutant
        stats["mutant_chosen"] += 1
    else:
        stats["parent_chosen"] += 1

    changed = int((parent != initial).sum())
    entry = {"generation": gen, "choice": choice, "mutant_was": "A" if mutant_is_a else "B",
             "chose_mutant": chose_mutant, "status": "ok", "reason": args.reason,
             "thinking": "", "pixels_changed_from_initial": changed}
    with (run_dir / "log.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    save_live_view(run_dir / "live.png", old_parent, mutant, chose_mutant, 8)
    if gen % args.snapshot_every == 0:
        render(parent, 4).save(run_dir / "snapshots" / f"gen_{gen:05d}.png")
    print(f"[{gen:4d}] {choice} を記録")
    prepare_next(run_dir, gen, parent, initial, rng, stats)


def cmd_finish(args):
    run_dir = Path(args.run_dir)
    arr = np.load(run_dir / "state.npz")
    meta = json.loads((run_dir / "state.json").read_text())
    gen, stats = meta["generation"], meta["stats"]
    render(arr["parent"], 4).save(run_dir / "snapshots" / f"gen_{gen:05d}.png")
    render(arr["parent"], 16).save(run_dir / "current.png")
    save_timeline(run_dir)
    decided = stats["mutant_chosen"] + stats["parent_chosen"]
    print(f"世代数: {gen}")
    if decided:
        print(f"変異体を採用     : {stats['mutant_chosen']}/{decided} "
              f"({100 * stats['mutant_chosen'] / decided:.0f}%)")
        print(f"A(先に見せた方) : {stats['shown_left_chosen']}/{decided} "
              f"({100 * stats['shown_left_chosen'] / decided:.0f}%)")
    print(f"初期から変化したピクセル: {int((arr['parent'] != arr['initial']).sum())}")


def main() -> int:
    ap = argparse.ArgumentParser(description="手動判定で1世代ずつ進める")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new")
    p.add_argument("theme")
    p.add_argument("--size", type=int, default=32)
    p.add_argument("--mutations", type=int, default=10)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--judge-name", default="claude-in-session")
    p.add_argument("--runs-dir", default="runs")
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("choose")
    p.add_argument("run_dir")
    p.add_argument("choice", choices=["A", "B", "a", "b"])
    p.add_argument("reason", nargs="?", default="")
    p.add_argument("--snapshot-every", type=int, default=5)
    p.set_defaults(func=cmd_choose)

    p = sub.add_parser("finish")
    p.add_argument("run_dir")
    p.set_defaults(func=cmd_finish)

    args = ap.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
