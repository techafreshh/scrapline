# Scrapline UI prompt pack

Generation prompts for every screen, panel, HUD module and control in the game, written
for Google's image models (**AI Studio / Gemini "Nano Banana"** for stills; **Flow** if you
want motion — add `static frame, no camera motion` and treat the first frame as the still).

The pack is split by surface so you can regenerate one area without re-reading everything:

| File | Covers | IDs |
|---|---|---|
| [01-chrome.md](./01-chrome.md) | The control library: panels, buttons, chips, bars, sliders, inputs, rows | `CH-*` |
| [02-hud.md](./02-hud.md) | Everything visible mid-match | `HU-*` |
| [03-menu.md](./03-menu.md) | Menu screen, wordmark, arena carousel, hero art | `ME-*` |
| [04-screens.md](./04-screens.md) | Setup, settings, how-to, challenges, locker, end screen, loading | `SC-*` |
| [05-icons.md](./05-icons.md) | Weapons, pickups, UI glyphs, challenge + cosmetic icons | `IC-*` |
| [06-sheets.md](./06-sheets.md) | Master cut-out sheets and the export spec | `SH-*` |
| [07-cookbook.md](./07-cookbook.md) | Reusable modifiers, per-platform syntax, failure modes and fixes | — |

Every prompt has a stable ID. Reference it in an issue or a commit (`UI: CH-03 hover state`,
`assets: ME-02 wordmark v2`) so we can always get back to the prompt that produced a file.

---

## 1. Two output lanes — don't mix them

Generators are good at one of these and bad at the other. The pack asks for both, separately.

**Lane A — mockups (`Mockup`).** One 16:9 picture per screen, showing composition, hierarchy
and mood. This is art direction. It is *not* sliced into the game. It tells us where things
sit, how much the panel should breathe, and what the screen should feel like at a glance.
Agent-built UI can be checked against these.

**Lane B — cut-outs (`Cut-out`).** One isolated object per prompt (or a labelled sheet of
them) on a flat chroma background, no text, no shadow, no perspective. These become real
assets: PNG → atlas → CSS `border-image` / `background-image` at `image-rendering: pixelated`.

> Rule of thumb: if you want the picture *in the game*, it's a cut-out. If you want to argue
> about the picture, it's a mockup.

**Never** try to generate a finished screen and slice panels out of it. Panel edges land on
arbitrary pixel boundaries, perspective creeps in, and the background bleeds into the
transparent region. Screen mockup once, components once, assemble in code.

---

## 2. The three locks

Three constraints make or break AI pixel UI. Each prompt in this pack already ends with the
lock line it needs, but here they are in full if you're writing your own.

### Palette lock

```
Palette locked to these twelve colours only — #0b0f1a ink, #16213a plate, #2a3550 steel,
#4a5a7f edge, #00E5FF cyan, #a5f3fc pale cyan, #FF6B35 orange, #eab308 gold, #a3e635 lime,
#ef4444 red, #e8ecf4 text, #8a94a8 muted. No other hues, no tints outside this set.
```

`#4a5a7f` (`--color-edge`) is a proposed addition — the current token file has no mid-steel
highlight, and pixel bevels need one. If it ships, add it to
`packages/client/public/tokens.css` first; that file is the single source of truth and the
static scans in the test suite treat raw colours in stylesheets as a failure.

### Pixel lock

```
Strict pixel grid: every logical pixel is a hard-edged square block (8 image pixels wide at
1024x1024). No anti-aliasing, no sub-pixel edges, no blur, no smooth gradients — shade with
1-bit dithering only. Straight orthographic front view, no perspective, no 3/4 angle.
```

### Asset lock (cut-outs only)

```
No text, no letters, no numbers, no logos, no watermark, no signature. The object sits fully
inside the frame with at least 32px margin on a flat solid #FF00FF background. No cast shadow
on the background, no glow spilling onto the background. One clean 1px #0b0f1a outline around
the object so the alpha cut is unambiguous.
```

Why `#FF00FF`: nothing in the palette is magenta, so the key is lossless and can be removed
with a tolerance of ~24 without eating the artwork.

### Mockup lock (screens only)

```
16:9 game UI mockup at 1920x1080. Do not render readable words — use abstract placeholder
text bars of the right weight and length instead. No browser chrome, no device frame, no
watermark. Pixel-art styling applied consistently: same pixel scale as the game world.
```

Placeholder text is the single biggest quality difference in mockups. The moment the model
starts spelling, it produces mangled letterforms that pull the eye and make an otherwise good
composition look broken.

---

## 3. Which model, which settings

| Need | Use | Notes |
|---|---|---|
| Still mockup | Gemini image / AI Studio ("Nano Banana") | Best at following layout instructions and keeping a palette. Attach an existing screenshot as a reference and say *"restyle this layout"* — far more reliable than describing it cold. |
| Still cut-out | Same | Ask for 1:1. Regenerate 4 times and keep the best; pixel-perfect output is a lottery, not a dial. |
| Motion (menu loop, flame) | Flow | Prompt the still you want, add `static frame, no camera motion`, export the first frame. Don't ship Flow video in the game — we render real-time. |
| Logo lettering | Any, then fix by hand | Short all-caps words are the one case where AI text is worth attempting. Budget 6–10 tries, or set it in Orbitron 700 and skip the lottery. |

**Aspect ratios:** components `1:1`; screens `16:9`; arena cards `16:9`; locker thumbnails
`1:1`. State in words (`square`, `widescreen 16:9`) — Google's tools don't take `--ar`.

**Iteration discipline:** change one variable per regeneration. Save the prompt text and the
seed/URL alongside the accepted file in the PR description, not in the repo.

---

## 4. From image to shipped asset

The client is DOM + CSS over a PixiJS canvas. Chrome is drawn with CSS backgrounds pointing at
atlas frames (see `packages/client/src/ui/chrome.ts`); in-world art comes from Pixi atlases.

1. **Key and trim.** Remove `#FF00FF` with tolerance ≤ 24, then trim to the object's bounding
   box. Leave no stray magenta on edge pixels — one bad pixel becomes a pink dot at 8× zoom.
2. **Measure the pixel pitch.** Zoom to 800%. If one logical pixel is *n* image pixels wide,
   downscale by exactly *n* using nearest-neighbour. Never use bilinear. If the pitch is
   inconsistent (7–9 px), discard the generation and re-roll; retouching per-pixel is slower
   than regenerating.
3. **Quantise** to the twelve-colour palette, PNG-8, no alpha gradient on the cut edge.
4. **Pad to the spec size** in the prompt (`128x128`, `64x64`, `32x32` logical). Padding, not
   scaling. The 9-slice border width must be an exact integer or the corners will smear.
5. **Drop in** under `packages/client/assets/atlas/ui/<name>.png`, add a dot-name entry to
   `packages/client/assets/atlas/manifest.json`
   (`"ui.panel": {"file": "ui/panel.png", "atlas": "ui.json", "w": 128, "h": 128}`), and add the
   frame box (`x`, `y`, `w`, `h`) to `packages/client/assets/atlas/ui.json` — the manifest maps
   names to files and sizes, the per-family atlas carries the coordinates. If the piece replaces
   a chrome key, update `CHROME_FILES` in `packages/client/src/ui/chrome.ts`, which a sync test
   pins to the manifest's `file` fields.
6. **Budget.** `tools/build-atlas.js` hard-fails over **6 MB** total assets. Quantised 16-colour
   PNGs are a few KB; if a file is over ~40 KB you're shipping a photograph.
7. **Verify.** `node scripts/verify-ui.js` captures the eight PRD views at 1920×1080 and
   1280×720 and asserts no full-screen tiling, title visible, no standings bleed, hover styles
   present, fps floor and bundle size. Regenerate the captures into `captures/` and compare
   against the same-named mockup.

---

## 5. Acceptance checklist

Before an asset is "done":

- [ ] Reads clearly at 1× — squint test at 128 px wide, not zoomed in.
- [ ] No text anywhere in a cut-out. Text is HTML, set in Orbitron 700 / body sans.
- [ ] Bevel is asymmetric: light on top-left, dark on bottom-right. Flat-symmetric bevels read
      as plastic, not metal.
- [ ] Outer stroke is exactly 1 logical px of `#0b0f1a` and survives the chroma cut.
- [ ] 9-slice corners are rotational, not mirrored — mirrored corners produce a visible seam at
      the top-right.
- [ ] Centre region of a frame is flat and tile-safe (no rivets, no noise).
- [ ] States are light-only differences: idle → hover → pressed → disabled change the bevel and
      glow, never the silhouette. A button that changes shape on hover looks like a bug.
- [ ] Palette-quantised, PNG-8, alpha either 0 or 255 on the edge — no semi-transparent fringe.
- [ ] Prompt ID and model recorded in the PR.

---

## 6. Coverage map

Current surfaces, their prompts, and the DOM/atlas hooks they feed. Use this to see what's
already covered before adding a new prompt.

| Surface | DOM / atlas hook | Prompts |
|---|---|---|
| Shared panel frame | `.sl-panel`, `ui.panel` | CH-01, CH-02 |
| Buttons (all) | `.sl-btn`, `.menu-cta`, `.menu-secondary`, `ui.button`, `ui.button.hover` | CH-03 … CH-06 |
| Chips, badges | `#quick-play-chip`, `#profile-badge`, `.sl-chip` | CH-07 |
| Progress bars | `.hud-bar`, `#hud-hp`, `#hud-fuel`, `ui.bar` | CH-08 |
| Form controls | `#profile-name`, `#profile-palette`, `#volume`, `#music-volume` | CH-09 … CH-12 |
| List rows | `#end-standings`, `#locker-grid`, `#controls-table` | CH-14 |
| HUD status cluster | `#hud-status`, `hud-hp`, `hud-fuel`, `hud-grenades`, `hud-weapon`, `hud-ammo` | HU-02 … HU-06 |
| HUD top-centre | `#hud-center`, `#hud-score`, `#hud-timer` | HU-07 |
| Ammo module | `#ammo-module`, `#ammo-icon`, `ui.slot` | HU-05, IC-01 |
| Kill feed | `#killfeed` | HU-08 |
| Crosshair, hit feedback | `#crosshair` | HU-09, HU-14 |
| Respawn | `#respawn` | HU-10 |
| Name tags / pad labels | `#nametags`, `#padlabels` | HU-12, HU-13 |
| Toasts | `#toast` | HU-15 |
| Menu | `#menu`, `.menu-root` | ME-01 … ME-09 |
| Arena carousel | `#map-carousel` | ME-04, ME-05 |
| Setup | `#setup` | SC-02 |
| Settings | `#settings` | SC-03 |
| How to play | `#howto`, `#controls-table` | SC-04 |
| Challenges | `#challenges`, `#challenges-panel` | SC-05 |
| Locker | `#locker`, `#locker-grid`, `#locker-preview` | SC-06 |
| End screen | `#end-screen`, `#end-standings`, `#end-winner` | SC-07 … SC-09 |
| Loading | `#loading`, `#loading-bar` | SC-01 |
| Online / error | `#toast`, connection states | SC-10 |
| No-JS fallback | `#noscript` | SC-11 |
| Weapon icons | `assets/weapon-*.svg` | IC-01 |
| Pickups | `atlas/pads.json` | IC-02 |
| UI glyphs | `assets/icons/*` | IC-03 |

`scripts/verify-ui.js` checks these eight views, so at minimum every screen in that list must
have a matching mockup: menu, setup, how-to, challenges, locker, mid-match HUD, end screen,
after-menu-return.

---

## 7. Non-goals

- **No icon fonts.** Everything is an image frame or inline SVG.
- **No smooth gradients or glass blur.** Dithering and hard bevels only; the renderer is
  pixel-scaled and blurs turn to mush.
- **No text baked into art.** Names, scores, timers and ammo counts are live data.
- **No separate visual language for the UI.** The chrome is the same pixel scale and palette as
  the arenas; if a panel looks like a different game, it's wrong.

## 8. Surfaces not in this pack (yet)

Deliberately excluded because they don't exist in the client today. If one ships, it inherits
the chrome set rather than getting a new prompt:

| Surface | Status |
|---|---|
| Team lobby / roster picker | server has rooms and a roster, no UI |
| Spectator HUD | no spectate mode |
| Tutorial / onboarding step cards | tips strip only (ME-06) |
| Rank progression screen | profile level exists, no dedicated screen |
| Store / battle pass | no monetisation, and not planned |
| Pause menu | there is no pause; the match runs to 25 points or 5 minutes |

## 9. Start here

If you're going to generate exactly three images: **SH-01** (chrome sheet), **IC-01** (weapon
icons), **HU-01** (HUD mockup). Those cover the majority of the pixels a player looks at, and the
chrome sheet becomes the style reference for every later prompt.

---

## 10. Generated results

Every prompt in this pack has been run through Google Flow (Nano Banana 2.1) and the output
filed in [`results/`](./results/), named `<ID>-v1.jpg`.

| Group | Files | Notes |
|---|---|---|
| Chrome | `CH-01` … `CH-18` | 18 pieces; `CH-01` and `CH-02` carry the panel/bevel grammar for the rest |
| HUD | `HU-01` … `HU-16` | `HU-01` is the composition reference; the rest are modules and feedback sprites |
| Menu | `ME-01` … `ME-09` | `ME-02` is the wordmark — the one asset with lettering |
| Screens | `SC-01` … `SC-11` | setup, settings, how-to, challenges, locker, end screen, loading, error |
| Icons | `IC-01` … `IC-08` | weapons, pickups, 20 glyphs, challenges, cosmetics, rank, app icon |
| Sheets | `SH-01`, `SH-02`, `SH-04` | full chrome and HUD sheets, plus the state-strip pattern |

Five hand-run early files carry descriptive names instead of IDs — `SH-01a-chrome`,
`IC-01-weapons`, `HU-01-hud`, `ME-01-menu`, `SC-07-end-screen`. They are alternates, not stale
copies: the ID-named versions were generated later and differ.

Two caveats when using them:

- **Stock images are JPEG** (Flow exports no PNG and no alpha), so the chroma key and quantise
  step in §4 is mandatory, not optional.
- **Mockups contain invented text** and, in some cases, invented backdrops (a stadium behind the
  settings panel, for instance). Treat `SC-*`, `ME-*` and `HU-01` as composition references;
  only the cut-out sheets are meant to be sliced.


