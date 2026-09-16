#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""テクノ⚡ビンゴ — ロゴ SVG の生成器（client/public/logo.svg を作り直すときだけ使う）

お手本＝管理者から届いた `taitoru.jpg`（ピクセルアートのタイトル画面）。
v06b で「画像の貼り付け」をやめ、同じ意匠を **純粋な SVG** で描き直した。

なぜ文字を「アウトライン（パス）」にするか
  会場に通信が無くてもロゴが崩れないようにするため。Web フォントを読む方式だと、
  落ちてこなければ別のフォントで出てしまう。文字の形をパスに変換して焼き込めば
  **実行時にフォントが要らず**、どの端末でも必ず同じ形で出る。

フォント: Dela Gothic One / SIL Open Font License 1.1（© 2020 Dela Gothic Project Authors）
  OFL はアウトライン化して作品に埋め込むことを許諾している。
  ロゴに要る 5 文字（テクノビンゴ）ぶんの形しか含めない。

使い方:
    pip install fonttools
    python scripts/make_logo.py        # client/public/logo.svg を書き出す
"""
import io
import os
import re
import urllib.request

FONT_CSS = "https://fonts.googleapis.com/css2?family=Dela+Gothic+One"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "client", "public", "logo.svg")
CACHE = os.path.join(HERE, "_dela.ttf")           # 一時ファイル（.gitignore 済み）

LEFT, RIGHT = "テクノ", "ビンゴ"
FS = 172.0          # 1 文字の設計サイズ
TRACK = -6.0        # 字間（お手本どおり詰める）
BOLT_ADV = 74.0     # ⚡ のぶんの送り
STEPS = 10          # 押し出しの段数
DX, DY = 2.3, 3.3   # 1 段あたりのずらし（右下へ）


def fetch_font():
    if os.path.exists(CACHE) and os.path.getsize(CACHE) > 100000:
        return CACHE
    css = urllib.request.urlopen(FONT_CSS).read().decode("utf-8")
    m = re.search(r"url\((https://[^)]+\.ttf)\)", css)
    if not m:
        raise SystemExit("TTF の URL を取れなかった。ネットワークを確認すること。")
    data = urllib.request.urlopen(m.group(1)).read()
    with open(CACHE, "wb") as fp:
        fp.write(data)
    return CACHE


def outline(path_font):
    """「テクノ」「ビンゴ」をパスの d 文字列にする。戻り値＝(d, 全体幅, ⚡の位置)"""
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.misc.transform import Transform

    f = TTFont(path_font)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    upem, hmtx = f["head"].unitsPerEm, f["hmtx"]
    k = FS / upem
    pen_x, parts = 0.0, []

    def emit(ch):
        nonlocal pen_x
        gname = cmap.get(ord(ch))
        if gname is None:
            raise SystemExit("フォントに %r の字が無い" % ch)
        spen = SVGPathPen(gs)
        gs[gname].draw(TransformPen(spen, Transform(k, 0, 0, -k, pen_x, 0)))  # y を反転
        parts.append(spen.getCommands())
        pen_x += hmtx[gname][0] * k + TRACK

    for ch in LEFT:
        emit(ch)
    bolt_x = pen_x + 6
    pen_x += BOLT_ADV
    for ch in RIGHT:
        emit(ch)
    return " ".join(p for p in parts if p), pen_x - TRACK, bolt_x


def lerp_hex(a, b, t):
    A = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    B = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(A[i] + (B[i] - A[i]) * t) for i in range(3))


def spaceship(x, y, px, rot):
    """ピクセル調の小さな宇宙船（お手本の右上のもの）。1 マス px 四方の rect の集合。"""
    ROWS = [
        "   WW   ",
        "  WWWW  ",
        "  WBBW  ",
        "  WBBW  ",
        "  WWWW  ",
        " WWWWWW ",
        " WWWWWW ",
        "RWWWWWWR",
        "RWWWWWWR",
        "R WWWW R",
        "   FF   ",
        "  FYYF  ",
        "  FYYF  ",
        "   FF   ",
    ]
    COL = {"W": "#e9eef8", "B": "#39b7ff", "R": "#e8461c", "F": "#ff8a1f", "Y": "#ffd84d"}
    out = []
    for r, row in enumerate(ROWS):
        c0 = 0
        while c0 < len(row):
            ch = row[c0]
            if ch == " ":
                c0 += 1
                continue
            c1 = c0
            while c1 + 1 < len(row) and row[c1 + 1] == ch:
                c1 += 1
            out.append('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>'
                       % (c0 * px, r * px, (c1 - c0 + 1) * px, px, COL[ch]))
            c0 = c1 + 1
    body = "\n      ".join(out)
    return ('    <g transform="translate(%g %g) rotate(%g)" shape-rendering="crispEdges">\n'
            '      %s\n    </g>' % (x, y, rot, body))


def stars(items):
    out = []
    for (x, y, r, op) in items:
        a = r * 0.17
        d = ("M %g %g L %g %g L %g %g L %g %g L %g %g L %g %g L %g %g L %g %g Z"
             % (x, y - r, x + a, y - a, x + r, y, x + a, y + a,
                x, y + r, x - a, y + a, x - r, y, x - a, y - a))
        out.append('<path d="%s" fill="#ffe36b" opacity="%g"/>' % (d, op))
    return "\n      ".join(out)


def neon_grid(w, y0, y1):
    """遠近の付いたネオングリッド（紫・薄め）。文字の下に敷く。"""
    vp_x, vp_y = w / 2.0, y0 - 150          # 消失点
    lines = []
    # 横線（下へ行くほど間隔が広がる）
    n = 7
    for i in range(1, n + 1):
        t = (i / float(n)) ** 1.9
        y = y0 + (y1 - y0) * t
        lines.append('<line x1="%g" y1="%g" x2="%g" y2="%g"/>' % (-w * 0.1, y, w * 1.1, y))
    # 縦線（消失点へ収束）
    m = 9
    for j in range(m + 1):
        x = -w * 0.15 + (w * 1.3) * (j / float(m))
        lines.append('<line x1="%g" y1="%g" x2="%g" y2="%g"/>' % (vp_x, vp_y, x, y1))
    return "\n      ".join(lines)


def build(d, total_w, bolt_x):
    pad_x, pad_top = 46, 132
    pad_bot = 74
    vb_w = total_w + pad_x * 2
    vb_h = FS + pad_top + pad_bot
    base_y = pad_top + FS * 0.78                 # ベースライン

    # 押し出しの側面（遠い段ほど暗い紺）。遠い方から描く。
    sides = "\n".join(
        '      <use href="#tb-g" transform="translate(%g %g)" fill="%s"/>'
        % (DX * i, DY * i, lerp_hex("#1d3fa6", "#0b1f5c", (i - 1) / float(STEPS - 1)))
        for i in range(STEPS, 0, -1)
    )
    far_x, far_y = DX * STEPS, DY * STEPS

    bolt = "M 54 0 L 12 60 L 36 60 L 24 112 L 78 44 L 50 44 Z"
    grid_y0 = base_y + FS * 0.06
    grid_y1 = vb_h - 6

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:.0f} {vb_h:.0f}"
     width="{vb_w:.0f}" height="{vb_h:.0f}" role="img" aria-label="テクノ⚡ビンゴ">
  <title>テクノ⚡ビンゴ</title>
  <!-- お手本 taitoru.jpg を SVG で描き直したもの。外部参照なし・フォント不要。
       文字の形は Dela Gothic One（SIL OFL 1.1）をアウトライン化して埋め込んでいる。 -->
  <defs>
    <linearGradient id="tb-face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe36b"/>
      <stop offset="46%" stop-color="#ffc247"/>
      <stop offset="62%" stop-color="#ff9f1c"/>
      <stop offset="100%" stop-color="#e8461c"/>
    </linearGradient>
    <linearGradient id="tb-bolt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fffbe0"/>
      <stop offset="45%" stop-color="#ffe14d"/>
      <stop offset="100%" stop-color="#ffab00"/>
    </linearGradient>
    <linearGradient id="tb-shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".92"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <path id="tb-g" d="{d}"/>
    <clipPath id="tb-clip"><use href="#tb-g"/></clipPath>
  </defs>

  <!-- ① 背景：ネオングリッド（紫・薄め。ページの紺に乗せる＝背景は透過） -->
  <g stroke="#b040ff" stroke-width="2" opacity=".35" fill="none" shape-rendering="crispEdges">
      {neon_grid(vb_w, grid_y0, grid_y1)}
  </g>

  <!-- ② 星のきらめきと宇宙船（文字の後ろ） -->
  <g shape-rendering="crispEdges">
      {stars([(80, 60, 34, .95), (vb_w - 92, 48, 40, .95), (vb_w - 210, 104, 18, .8), (262, 96, 20, .85), (vb_w * 0.40, 36, 14, .7)])}
  </g>
{spaceship(vb_w * 0.655, 2, 7.0, 34)}

  <!-- ③ 文字：奥の縁取り → 押し出しの側面 → 面 → ハイライト -->
  <g transform="translate({pad_x} {base_y:.1f})">
      <use href="#tb-g" transform="translate({far_x:.1f} {far_y:.1f})"
           fill="none" stroke="#050b28" stroke-width="26" stroke-linejoin="round"/>
      <use href="#tb-g" fill="none" stroke="#050b28" stroke-width="26" stroke-linejoin="round"/>
      <g shape-rendering="crispEdges">
{sides}
      </g>
      <use href="#tb-g" fill="none" stroke="#0d1b4c" stroke-width="9" stroke-linejoin="round"/>
      <use href="#tb-g" fill="url(#tb-face)"/>
      <g clip-path="url(#tb-clip)">
        <rect x="-60" y="-{FS*0.80:.0f}" width="{vb_w}" height="{FS*0.26:.0f}" fill="url(#tb-shine)"/>
      </g>

      <!-- ④ ⚡（お手本の意匠に合わせて小さめ・黄） -->
      <g transform="translate({bolt_x:.1f} -{FS*0.86:.0f}) rotate(-8 45 56) scale({FS*0.0093:.4f})">
        <path d="{bolt}" fill="none" stroke="#050b28" stroke-width="26" stroke-linejoin="round"/>
        <path d="{bolt}" fill="url(#tb-bolt)"/>
      </g>
  </g>
</svg>
"""


def main():
    d, total_w, bolt_x = outline(fetch_font())
    svg = build(d, total_w, bolt_x)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fp:
        fp.write(svg)
    print("書き出し:", OUT)
    print("サイズ: %.1f KB / path 数: %d" % (len(svg.encode("utf-8")) / 1024.0, svg.count("<path")))


if __name__ == "__main__":
    main()
