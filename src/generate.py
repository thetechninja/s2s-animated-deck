#!/usr/bin/env python3
"""Generate an animated HTML deck from a classified sermon source document.

Usage:
    .venv/bin/python -m src.generate \
        --source path/to/sermon.md        # or .docx
        --mood calm                       # calm | high-energy | editorial
        -o dist/index.html

Model: each blank-line-separated SCENE becomes one animated slide. The scene's
ordered elements (verse, ref, bullet, note, definition) are revealed in sequence
on that slide via the html-ppt `data-anim` entry vocabulary, and the custom
player handles the whoosh-out on navigation between scenes.

Reuses the MIT html-ppt runtime (third_party/html-ppt) for tokens + entry
animations; the custom player (player.css/player.js) owns the whoosh-out.
"""

from __future__ import annotations

import argparse
import html as htmlmod
import os

from . import classify

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROOT = os.path.dirname(_HERE)

# Source files the generator copies into each self-contained deck output, keyed
# by the relative path (within the out dir) they should land at. Only what MY
# player actually needs: design tokens, entry-anim vocabulary, fonts, mood layer,
# and the custom player itself. The full html-ppt runtime.js (a presenter-window
# app that throws standalone) and its fx-runtime.js are NOT needed — the player
# supersedes them and the kenburns ambient is pure CSS in player.css.
_RUNTIME_COPY = [
    ("third_party/html-ppt/assets/base.css",                "assets/base.css"),
    ("third_party/html-ppt/assets/fonts.css",               "assets/fonts.css"),
    ("third_party/html-ppt/assets/animations/animations.css",  "assets/animations/animations.css"),
    ("player.js",                                           "player.js"),
    ("player.css",                                          "player.css"),
]


def escape(s: str) -> str:
    return htmlmod.escape(s, quote=False)


def render_elem(el: classify.Elem, mood: str, index: int) -> str:
    """Render one scene element to HTML, choosing an entry animation."""
    # entry animation by kind + mood
    if el.kind == "verse":
        anim = "rise-in" if mood != "calm" else "fade-up"
    elif el.kind == "bullet":
        anim = "rise-in" if mood == "high-energy" else "fade-up"
    elif el.kind == "heading":
        anim = "fade-down"
    else:  # note / definition
        anim = "rise-in" if mood == "high-energy" else "fade-up"

    # staggering: each element reveals with a small delay so a scene builds
    delay = "" if index == 0 else f' style="--anim-delay:{index * 140}ms"'

    if el.kind == "heading":
        return (f'<div class="note section-label" data-anim="{anim}"{delay}>'
                f'<span class="term-chip">{escape(el.label)}</span></div>')

    if el.term:
        # definition note: term highlighted, body italic
        body = el.text.split(":", 1)[1].strip() if ":" in el.text else el.text
        return (f'<div class="note" data-anim="{anim}"{delay}>'
                f'<span class="def-term">{escape(el.term)}:</span> '
                f'<span class="def">{escape(body)}</span></div>')

    if el.kind == "verse":
        # render verse + its ref together
        ref_html = (f'<div class="ref" data-anim="fade-up"{delay}>{escape(el.ref)}</div>'
                    if el.ref else "")
        return (f'<div class="verse" data-anim="{anim}"{delay}>{escape(el.text)}</div>'
                f'{ref_html}')

    if el.kind == "bullet":
        return (f'<div class="note" data-anim="{anim}"{delay}>{escape(el.text)}</div>')

    return f'<div class="note" data-anim="{anim}"{delay}>{escape(el.text)}</div>'


def build_slide(scene: classify.Scene, idx: int, total: int, mood: str) -> str:
    parts = []
    parts.append(f'<div class="eyebrow">Sermon &middot; {idx+1:02d}</div>')
    for i, el in enumerate(scene.elems):
        parts.append(render_elem(el, mood, i))
    inner = "\n".join(parts)
    ambient = ' data-ambient="kenburns"' if mood != "editorial" else ""
    return f'<section class="slide"{ambient}>\n{inner}\n</section>'


def build_deck(scenes, mood, brand="The Feast of the Lord"):
    slides_html = "\n".join(build_slide(s, i, len(scenes), mood)
                            for i, s in enumerate(scenes))
    # Self-contained portable deck: every referenced asset lives next to the
    # HTML. The MOOD layer loads LAST so its :root timing vars and per-role
    # overrides win the cascade over player.css's defaults.
    css_links = "\n".join([
        '<link rel="stylesheet" href="assets/base.css">',
        '<link rel="stylesheet" href="assets/animations/animations.css">',
        '<link rel="stylesheet" href="assets/fonts.css">',
        '<link rel="stylesheet" href="player.css">',
        f'<link rel="stylesheet" href="{mood}.css">',
    ])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(brand)} &middot; Animated</title>
{css_links}
</head>
<body>
<div id="player-options" data-t-out="" data-t-in=""></div>

<main class="player" id="player">
{slides_html}
</main>

<div class="progress-bar"><span id="bar-fill"></span></div>
<div class="brand">{escape(brand)} &nbsp;&middot;&nbsp; sermon2slides <span>/ animated</span></div>

<script src="player.js"></script>
</body>
</html>
"""


def copy_runtime(dest_dir: str) -> None:
    """Copy the player + shared assets into a self-contained deck folder."""
    import shutil

    for src_rel, dst_rel in _RUNTIME_COPY:
        src = os.path.join(_PROOT, src_rel)
        dst = os.path.join(dest_dir, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)


def copy_mood(mood: str, dest_dir: str) -> None:
    """Copy the mood stylesheet into the deck folder as <mood>.css."""
    import shutil

    src = os.path.join(_PROOT, "moods", f"{mood}.css")
    dst = os.path.join(dest_dir, f"{mood}.css")
    shutil.copy2(src, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", "-s", required=True,
                    help="path to sermon .md or .docx source document")
    ap.add_argument("--mood", default="calm",
                    choices=["calm", "high-energy", "editorial"])
    ap.add_argument("-o", "--out", default=os.path.join(_PROOT, "dist", "index.html"))
    ap.add_argument("--brand", default="The Feast of the Lord")
    ap.add_argument("--max-scenes", type=int, default=10)
    args = ap.parse_args()

    if args.source.lower().endswith(".docx"):
        scenes = classify.scenes_from_docx_classified(args.source)
    else:
        with open(args.source) as f:
            scenes = classify.scenes_from_text_classified(f.read())

    scenes = [s for s in scenes if not s.is_empty()][: args.max_scenes]
    if not scenes:
        raise SystemExit("No scenes classified from source.")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        f.write(build_deck(scenes, args.mood, args.brand))
    copy_mood(args.mood, os.path.dirname(args.out) or ".")
    copy_runtime(os.path.dirname(args.out) or ".")
    print(f"Wrote {len(scenes)}-scene animated deck [{args.mood}] -> {args.out}")
    print(f"Copied player + mood + shared assets into {os.path.dirname(args.out) or '.'}")
    for i, s in enumerate(scenes, 1):
        kinds = ", ".join(f"{e.kind}" for e in s.elems)
        first = s.elems[0].text[:46] if s.elems else ""
        print(f"  {i:02d}: [{kinds}] {first}")


if __name__ == "__main__":
    main()
