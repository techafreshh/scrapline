# PRD v8 — UI art integration

## Problem

The UI works but looks like a stock kit: chrome is five 16×16 Kenney tiles stretched with
`background-image`, icons are ad-hoc SVGs, and the menu/HUD composition was hand-tuned rather
than designed. 66 UI images now exist in `docs/ui-prompts/results/` (see
`docs/ui-prompts/README.md`), generated from a prompt pack with stable IDs. None of it is in the
game.

This milestone turns those images into shipped assets and restyles every surface around them.

## Constraints

- **Reference images are inputs, not assets.** They are 1024px JPEGs on flat `#FF00FF`. They must
  be keyed, quantised to the twelve-colour palette, downscaled by a measured integer factor,
  cropped and padded before anything reaches `packages/client/assets/`.
- **6 MB build budget** enforced by `tools/build-atlas.js`. Sliced PNGs must be PNG-8 and small.
- **`tokens.css` is the single source of truth.** No raw hex in any stylesheet; `tests/tokens.test.js`
  scans for it. A new `--color-edge: #4a5a7f` is needed for bevels and must land in the token file
  before CSS uses it.
- **No text in art.** Names, scores, timers, ammo counts stay HTML.
- **`scripts/verify-ui.js` is the gate.** It captures eight views (menu, setup, how-to,
  challenges, locker, mid-match HUD, end screen, after-menu-return) and asserts no full-screen
  tiling, title visible, no standings bleed, hover styles present, fps floor, bundle size.
- **9-slice corners must be rotationally identical**, border widths a multiple of 4 px, and the
  centre must be flat (no rivets, no noise) or stretching smears.

## Work

### A1 · Slicer tool

`tools/slice-sheet.js` + `tools/slice-sheet.test.js`.

Input: `<ID>-v1.jpg` from `docs/ui-prompts/results/`. Output: 1× PNG-8 assets under
`packages/client/assets/atlas/ui/` plus manifest and atlas frame entries.

Stages, each independently testable on a synthetic fixture:

1. **Chroma key** `#FF00FF` with tolerance ≤ 24, then a 1 px alpha erode; alpha is 0 or 255.
2. **Pitch detection**: measure the run length of the dominant block size; refuse to slice when
   the pitch is inconsistent by more than 1 px.
3. **Integer downscale** by that pitch, nearest-neighbour.
4. **Quantise** to the twelve-colour palette (nearest in RGB), dithering off.
5. **Crop** to the object's bounding box, optionally by a named cell rectangle.
6. **Pad** to the requested logical size; never scale to fit.
7. **Emit** manifest entry (`{file, atlas, w, h}`) and atlas frame (`{file,x,y,w,h}`), and fail
   loudly if the total would exceed the 6 MB budget.

Acceptance: unit tests cover key/pitch/downscale/quantise/crop/pad on synthetic fixtures; the
tool is idempotent (running twice produces byte-identical output); a malformed input exits
non-zero with a message naming the stage.

### A2 · Chrome swap

Replace the five stretched tiles with sliced assets from `SH-01a` / `SH-01` / `CH-01`…`CH-18`:
panel, elevated panel, inset well, hazard panel, button (idle/hover/pressed/disabled/focus),
CTA, secondary, chip, bar track/fill, slider track/thumb, toggle, checkbox, field, scrollbar,
list row, tooltip, toast, keycap.

Acceptance: `CHROME_FILES` in `packages/client/src/ui/chrome.ts` points at the new files and the
sync test passes; every `.sl-btn`/`.sl-panel` renders the new art; no surface falls back to the
old tiles; `verify-ui.js` stays green.

### A3 · Menu

Wordmark from `ME-02` (transparent PNG, `image-rendering: pixelated`), menu backdrop per theme
from `ME-03`, arena cards from `ME-04`, carousel controls from `ME-05`, tip strip from `ME-06`,
profile row from `ME-07`. Layout follows `ME-01` (left panel, right carousel, tip strip).

Acceptance: menu at 1280×720 shows title fully (`top >= 0`), CTA above the fold, carousel with
three cards and a visible selected state; `verify-ui.js` menu + after-menu-return views pass.

### A4 · HUD

Restyle to the `HU-01` composition: status cluster (`HU-02`), health states (`HU-03`), fuel
(`HU-04`), ammo module (`HU-05`), grenade pips (`HU-06`), score/timer chip (`HU-07`), kill feed
rows (`HU-08`), crosshairs (`HU-09`), respawn card (`HU-10`), scope (`HU-11`), name tags
(`HU-12`), pad labels (`HU-13`), hit marker (`HU-14`), pickup toast (`HU-15`), jetpack flame
(`HU-16`).

Acceptance: all four HUD clusters use the new modules; health bar shows green/amber/red states
driven by the existing values; crosshair swaps per weapon; nothing overlaps the centre third;
`verify-ui.js` mid-match view passes with fps ≥ 30.

### A5 · Screens

Setup (`SC-02`), settings (`SC-03`), how-to (`SC-04`), challenges (`SC-05`), locker (`SC-06`),
end screen (`SC-07`), standings (`SC-08`), winner banner (`SC-09`), connecting (`SC-10`),
no-JS (`SC-11`), loading (`SC-01`).

Acceptance: every panel uses the same plate/head/body/footer skeleton; end screen shows winner,
five standings rows with the local player highlighted, and two actions; `verify-ui.js` captures
all four panel views plus the end screen.

### A6 · Icons

Weapons (`IC-01`, six variants plus a 16px silhouette set), pickups (`IC-02`), UI glyphs
(`IC-03`, 20 at 32px plus 16px), challenges (`IC-04`), cosmetics (`IC-05`), rank (`IC-06`),
status (`IC-07`), app icon (`IC-08`, 512 + 192 maskable).

Acceptance: ammo module and kill feed use the new weapon icons; every icon button uses a glyph
from the set; no mixed stroke weights visible in one row.

### A7 · Visual verification

Extend `scripts/verify-ui.js` with an art gate: assert the new atlas keys are present and
non-blank, capture the eight views, and diff each against its mockup in
`docs/ui-prompts/results/` (the `<ID>-v1.jpg` reference) for layout-region similarity — coarse (structural/
luminance), not pixel-exact.

Acceptance: the gate fails on a deliberately reverted chrome file and passes on the real set.

## Order

A1 blocks everything. A2 before A3/A4/A5. A6 is independent after A1. A7 last.

## Non-goals

- No online/multiplayer UI changes.
- No new gameplay.
- No animated art beyond the existing flame/particle systems.
