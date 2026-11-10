#!/usr/bin/env python3
"""Build a single-file, offline copy of the game.

Inlines the ruins BGM (as a data: URL) and a subset of the DotGothic16 font
(only the characters the game uses) so the resulting HTML runs on any PC by
double-clicking it, with no network and no companion files.

Usage:
  python3 build_offline.py <path/to/DotGothic16-Regular.ttf>

Requires: fonttools, brotli  (pip install fonttools brotli)
Font: DotGothic16 by Fontworks, SIL Open Font License 1.1
      https://github.com/google/fonts/tree/main/ofl/dotgothic16
"""
import base64
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent.parent
SRC = HERE / "index.html"
BGM = HERE / "ruins-bgm.mp3"
OUT = HERE / "dist" / "kaito-sandal-rpg.html"

FONT_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap">\n'
)
BGM_DECL = "const BGM_URL='ruins-bgm.mp3',"
FILE_GUARD = "if(location.protocol==='file:')throw new Error('local file');"


def subset_font(ttf: pathlib.Path, text: str) -> bytes:
    # Everything the game prints, plus full kana/ASCII/punctuation as a safety net.
    extra = "".join(chr(c) for r in [(0x20, 0x7F), (0x3000, 0x30FF), (0xFF01, 0xFF5F)] for c in range(*r))
    chars = "".join(sorted(set(text + extra)))
    with tempfile.TemporaryDirectory() as tmp:
        txt = pathlib.Path(tmp) / "chars.txt"
        out = pathlib.Path(tmp) / "font.woff2"
        txt.write_text(chars, encoding="utf-8")
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", str(ttf),
             f"--text-file={txt}", "--flavor=woff2", f"--output-file={out}",
             "--layout-features=*", "--no-hinting"],
            check=True,
        )
        return out.read_bytes()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    html = SRC.read_text(encoding="utf-8")
    for needle in (FONT_LINKS, BGM_DECL, FILE_GUARD):
        if html.count(needle) != 1:
            sys.exit(f"build_offline: expected exactly one match for {needle[:50]!r}")

    font = subset_font(pathlib.Path(sys.argv[1]), html)
    font_css = (
        '<style>@font-face{font-family:"DotGothic16";font-display:block;'
        'src:url(data:font/woff2;base64,' + base64.b64encode(font).decode() + ') format("woff2")}</style>\n'
    )
    bgm_url = "data:audio/mpeg;base64," + base64.b64encode(BGM.read_bytes()).decode()

    html = html.replace(FONT_LINKS, font_css)
    html = html.replace(BGM_DECL, f"const BGM_URL='{bgm_url}',")
    # A data: URL can be fetched even from a file:// page, so keep the beat-synced path.
    html = html.replace(FILE_GUARD, "if(location.protocol==='file:'&&!BGM_URL.startsWith('data:'))throw new Error('local file');")

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB; font {len(font) / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()
