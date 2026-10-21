# s2s-animated-deck — working notes / change log

Copious change log for this standalone animated-sermon-deck project. Reverse
chronological, newest at top. This is the human-facing record of *why* things are
the way they are so a future session can pick up cleanly.

---

## 2026-10-21 — Runtime verification + asset-linkage fix + mood rebuild

### What was wrong (carried from the prior session)
- Generated decks referenced paths that didn't exist or weren't needed:
  - `assets/runtime.js` — the html-ppt **presenter-window app** (expects `btn-prev`,
    `btn-next`, presenter cards, BroadcastChannel). It **throws when loaded standalone**.
  - `assets/animations/fx-runtime.js` — **didn't exist at all**.
  - `assets/animations/animations.css` and `moods/<mood>.css` — paths pointed at a
    layout (`assets/animations/...`, `moods/...`) that the repo didn't actually have
    (assets were flat; moods were accidentally nested under `moods/moods/`).
- `player.js` did exist and *should* have run, but had never been confirmed to boot
  cleanly in a browser.

### Verified / fixed this session
1. **Player boot, lifecycle, whoosh — all confirmed via headless Chrome (CDP).**
   `scripts/verify-player.mjs` drives the *real* generated deck and asserts:
   - zero JS errors on boot,
   - slide 1 lands `.is-active` and its `data-anim` elements carry `anim-*`,
   - `player.js` exposes `window.__s2sGo` (the programmatic choke-point),
   - on next → outgoing slide gets `.is-exit-left` (whoosh-out fires),
   - after `--t-out` the active swap happens, exit classes clear, entry anim
     retriggers on the new slide, and the progress bar advances,
   - an **ArrowLeft keydown** round-trips back to slide 1,
   - zero JS errors across the whole navigation.
   **Result: 12/12 checks pass.** Full script: `node scripts/verify-player.mjs`.
   `scripts/shots.mjs` renders mood PNGs to `dist/shots/`.

2. **Real bug found: mood timing was being clobbered by cascade order.**
   `calm.css` (loaded before `player.css`) set `--t-in:1000ms` / `--t-out:900ms`, but
   `player.css` renders LAST and re-declared `:root { --t-in:680ms; --t-out:620ms }`,
   so the mood's timing (and its per-role `@media`/rule overrides) never won.
   **Fixed by loading the mood stylesheet AFTER `player.css`** in `build_deck`, so the
   mood layer is the intended theme-override layer. The computed `--t-in`/`--t-out`
   now read `1000/900` for calm as designed.

3. **`player.js` now reads timing from the CSS variables, not hardcoded defaults.**
   Previously `T_IN`/`T_OUT` came from `#player-options` `data-t-in`/`data-t-out`
   (empty → 680/620 defaults) — out of sync with the mood CSS. Now it reads
   `getComputedStyle` `--t-in`/`--t-out`, falling back to the data-* hints. So the
   JS lifecycle (swaps, anim-clear timing) matches the CSS animation durations.

4. **Asset linkage normalized** (`src/generate.py`):
   - Generator now produces **self-contained** `dist/<mood>/` folders and copies only
     what the custom player needs: `assets/base.css` (tokens), `assets/fonts.css`,
     `assets/animations/animations.css` (entry vocab), `player.css`, `player.js`,
     and `<mood>.css`.
   - **`runtime.js` and `fx-runtime.js` are gone** — both third-party scripts are
     dropped. The custom player supersedes them (kenburns ambient is pure CSS in
     `player.css`; there is no `data-fx` usage). Verified the deck loads with zero
     JS errors without them.
   - The stale flat `assets/` copies and the nested `moods/moods/` were removed; the
     generator reads straight from `third_party/html-ppt/` and `moods/`.

5. **Mood files rebuilt (calm / high-energy / editorial).**
   ⚠️ *Change-log note:* while flattening `moods/moods/` the `moods/` tree was
   accidentally deleted before moving files out. `calm.css` was recoverable from an
   earlier full read; `high-energy.css` and `editorial.css` were reconstructed from
   their intact design headers + the `player.css` variable contract. The rebuilds
   honor the same design directions (deep-ink + vivid accent + punchy timing for
   high-energy; near-white serif magazine look + flat hold for editorial). If the
   user's intended mood specific differed, it should be re-tuned from this snapshot.
   All three regenerate cleanly and the harness passes for `calm`.

6. `docs/` (was empty) hosts this file; `README.md` added at repo root.

### Decisions locked in
- Animated deck work stays **separate** from the `.pro` generation repo (confirmed
  `git status --short` on the generation repo is empty — untouched).
- Deck reads the **source sermon document** (md/docx) via the self-contained
  classifiers, not the generated `.pro`.
- Whoosh-out is genuinely custom; `player.js` `go()`/`__s2sGo` is the choke-point.
- Third-party html-ppt is used only for tokens + entry-animation vocabulary; its
  presenter runtime is not used at all.

---

## Earlier (prior session) — foundation built
- Repo scaffolded: `src/classify.py` (self-contained reimplementation of the scene +
  element heuristics from the `.pro` pipeline's `deck.py`), `src/generate.py`, custom
  `player.css`/`player.js`, three moods, `third_party/html-ppt/` (with LICENSE),
  `examples/sermon.md`.
- Classification confirmed working: 5 correctly-classified scenes for
  `examples/sermon.md` ("How to Love God"), incl. `manifest:`/`abode:` term definitions.
- First Netlify-style headless render showed the `.player`/`.brand`/`.progress-bar` shell.

---

## Next steps / open items
- Review the rebuilt `high-energy` / `editorial` mood visuals against intent
  (`node scripts/shots.mjs` → `dist/shots/` PNGs).
- `git init`, first commit, and push to GitHub (remote name TBD with user — suggested
  `s2s-animated-deck`).
- (Possible) wire the deck to a real `.docx` source and a real USB clicker for a
  live sanity pass.