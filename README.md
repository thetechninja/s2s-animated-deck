# s2s-animated-deck

Animated sermon decks — a **custom HTML player** (no .pro, no ProPresenter dependency)
that reads the *same source sermon document* the `.pro` pipeline reads and renders it
as a self-contained, clicker-driven animated slide deck.

This is a **separate project** from the sermon `.pro` generation pipeline. It lives in
its own repo and never imports from that codebase. The `.pro` generation repo is left
untouched.

---

## What it does

- Reads a sermon **source document** (Markdown or `.docx`) and classifies it into semantic
  "scenes" → one animated slide each:
  - `verse` / `ref` (KJV), `bullet`, heading (`Lifework Assignment:` / `Expected Behavior:`),
    and `term: definition` notes (highlighted).
- The classifier (`src/classify.py`) is a **self-contained reimplementation** of the scene
  heuristics used by the `.pro` pipeline's `deck.py`, so it never imports from the
  generation repo.
- `src/generate.py` turns the classified scenes into a **self-contained animated HTML deck**
  in a chosen **mood**.

### The custom player
`player.js` + `player.css` are the custom runtime (fully ours). It owns the slide lifecycle,
navigation, and the **whoosh-out** exit transitions that stock OpenDesign/html-ppt does not
have. It reuses the MIT html-ppt `data-anim` entry-animation vocabulary and design tokens,
but the exit choreography is genuinely custom.

Navigation is clicker-friendly:
| Input | Action |
|---|---|
| `→` / `Space` / `Page Down` / `Enter` | next |
| `←` / `Page Up` / `Backspace` | prev |
| `Home` / `End` | first / last |
| `F` / `F11` | fullscreen |
| touch-swipe L/R | next / prev |

A USB presentation clicker emits arrow keys, so it works today.

---

## Quick start

```bash
# build a calm deck from a sermon markdown source
.venv/bin/python -m src.generate \
  --source examples/sermon.md \
  --mood calm \
  -o dist/calm/index.html

# open it
open dist/calm/index.html
```

Moods: `calm`, `high-energy`, `editorial`. Each `dist/<mood>/` folder is fully
self-contained (HTML + CSS + JS + assets) and can be dropped on a static host
(e.g. Netlify) as-is.

---

## Repo layout

```
src/classify.py        classification of a sermon source into scenes/elements
src/generate.py        scene -> animated HTML deck (self-contained output)
player.css             custom deck chrome + whoosh-out transitions + ambient hold
player.js              custom runtime: lifecycle, nav, whoosh choke-point (__s2sGo)
moods/*.css            three visual/timing directions (override player.css vars)
third_party/html-ppt/  MIT-licensed html-ppt runtime (tokens + entry animations + LICENSE)
scripts/verify-player.mjs   headless-Chrome CDP test for the player lifecycle
scripts/shots.mjs           render PNGs of the deck for visual review
examples/sermon.md     sample sermon source for testing
dist/<mood>/           generated self-contained decks
```

---

## How a slide animates

On activation a slide's elements reveal **one-by-one** using html-ppt `data-anim`
(`anim-fade-up` / `anim-rise-in` / `anim-fade-down`), each with a small `--anim-delay`
stagger so a scene "builds". While active, the slide holds with a subtle **ambient**
motion (`kenburns` scale for calm / high-energy; the editorial mood holds still). On
nav, the outgoing slide plays a directional **whoosh-out** (`.is-exit-left` / `.is-exit-right`),
the active class swaps after `--t-out`, and the incoming slide re-triggers its entries.

Timing is CSS-variable driven per mood (`--t-in`, `--t-out`, `--ease-*`, `--ambient-dur`),
and `player.js` reads those same CSS variables so the JS lifecycle matches the CSS
animation durations exactly.

## Tests

```bash
# boots the generated deck in headless Chrome and asserts the full lifecycle:
# zero JS errors, .is-active on slide 1, entry anim-* classes, whoosh-out,
# active-swap, exit-clear, progress bar, ArrowLeft round-trip.
node scripts/verify-player.mjs dist/calm/index.html
```

---

## License

The custom player/generator/classifier are this project's own work. The `third_party/html-ppt`
runtime is included under its MIT license (see `third_party/html-ppt/LICENSE`).