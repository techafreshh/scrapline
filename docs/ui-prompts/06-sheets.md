# 06 · Master sheets — the cut-out lane

Every component in chapters 01–05 can be generated individually. In practice you want the whole
family in **one image**: the model then holds stroke weight, bevel depth and palette constant
across pieces, which is the thing it does worst across separate generations.

A sheet is not a mockup. It is a **specimen tray**: every object isolated, evenly spaced, on
chroma, with nothing overlapping and nothing cropped.

---

## The grid contract

Put this at the top of every sheet prompt, before the contents:

```text
Generate a specimen sheet, not a scene. Arrange every object in a strict grid on a flat solid
#FF00FF background. Each object is centred in its own cell, fully inside the cell with at least
20 pixels of margin on every side, and never touches a neighbour. No overlaps, no drop shadows
on the background, no glow spilling onto the background, no labels, no dividers, no frame around
the sheet.
```

Then state the grid explicitly — column count, row count, cell size, gutter — and list every
cell in reading order. Models follow a numbered list far more reliably than an enumerated
sentence.

**Why chroma and not transparency:** asking for a transparent PNG produces either a
checkerboard pattern painted into the pixels or a semi-transparent fringe. Keying `#FF00FF`
yourself is deterministic and can be re-run when a model updates.

---

### SH-01 · Chrome sheet — every panel, button and control
**Use:** the whole of chapter 01 in one generation. Best used as a **style lock**: keep it as the
reference image for all later component prompts.
**Lane:** `Cut-out` · 6×4 grid · 1024×1536 logical.

```text
Generate a specimen sheet, not a scene. Arrange every object in a strict grid on a flat solid
#FF00FF background. Each object is centred in its own cell, fully inside the cell with at least
20 pixels of margin on every side, and never touches a neighbour. No overlaps, no drop shadows
on the background, no glow spilling onto the background, no labels, no dividers, no frame around
the sheet.

Pixel art game UI chrome components, six columns by four rows, 170-pixel cells with 16-pixel
gutters, every piece sharing one construction: 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550
frame, 1-pixel #4a5a7f highlight on the top and left, 1-pixel #0a0e18 shadow on the bottom and
right, flat dithered #16213a surface, 3-pixel #00E5FF accent rails, 2x2 rivets inset from
corners. Row one: a large empty nine-slice panel; an elevated panel variant with a cyan inner
line; a recessed inset well; a hazard-striped panel; a wide empty button; a wide empty secondary
button with a left cyan tab. Row two: a primary call-to-action button with a dithered cyan face;
an empty button in a pressed bevel state; an empty button in a disabled state; a square icon
button frame; a chip with a cyan nub; a chip with a gold nub. Row three: a horizontal progress
track; a solid fill block; a horizontal slider track; a slider thumb; a toggle in the off
position; a toggle in the on position. Row four: an empty text field; a dropdown plate with a
chevron cavity; a small checkbox; a vertical scrollbar track with thumb; an empty tooltip bubble
with a tail; an empty toast strip with a status block. All empty, no text, no icons, no numbers.
Chunky 32-bit era pixel art at 8x pixel pitch, orthographic front view.
No text or lettering, strict pixel grid with hard edges, no anti-aliasing, no blur, no
gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635
#ef4444 #e8ecf4 #8a94a8 only.
```

**Very likely:** some pieces will be missing or merged. Don't fight it — extract the dozen that
worked, then generate the missing ones in a second pass **with the first sheet attached as a
reference image** and the instruction `match the exact construction, stroke weight and palette
of the reference`.

---

### SH-02 · HUD sheet — all in-match modules
**Lane:** `Cut-out` · 4×3 grid · 1280×960.

```text
Generate a specimen sheet, not a scene. Arrange every object in a strict grid on a flat solid
#FF00FF background. Each object is centred in its own cell, fully inside the cell with at least
20 pixels of margin on every side, and never touches a neighbour. No overlaps, no drop shadows
on the background, no glow spilling onto the background, no labels, no dividers.

Pixel art game HUD modules, four columns by three rows, 300-pixel cells with 24-pixel gutters.
Every piece shares one construction: 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550 frame, 50
percent checkerboard dither of #0b0f1a over #16213a interior, 3-pixel #00E5FF accent rail, empty
interiors. Row one: a status cluster plate with slots for two bars; a health bar track; a fuel
bar track with a hatched empty portion; a score-and-timer chip with a centre divider. Row two: a
weapon module plate with a square icon well and five pip sockets; a kill-feed row plate with a
36-pixel icon well; a compact name tag plate with a caret; a pickup label plate. Row three: a
respawn card with hazard bands and a circular countdown well; a scope overlay mask with a hard
circular lens cut-out and cyan ranging ticks; a damage vignette frame — a rectangular border
that fades to transparent toward the centre in a hard 1-bit dither; a pickup toast plate with an
icon well. All empty, no text, no icons, no numbers, no crosshairs.
Chunky 32-bit era pixel art at 8x pixel pitch, orthographic front view.
No text or lettering, strict pixel grid with hard edges, no anti-aliasing, no blur, no
gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635
#ef4444 #e8ecf4 #8a94a8 only.
```

---

### SH-03 · Icon sheets — the four families
Four separate generations, not one. Mixing weapons with UI glyphs in one prompt always produces
inconsistent stroke weight.

| Sheet | Grid | Cells | Prompt base |
|---|---|---|---|
| Weapons | 6×1 | 64×64 | IC-01 |
| Pickups | 4×1 | 64×64 | IC-02 |
| UI glyphs | 5×4 | 64×64 | IC-03 |
| Challenges | 4×2 | 64×64 | IC-04 |

All four use `32-pixel icons centred in 64-pixel cells with 16-pixel gutters, identical 2-pixel
stroke weight across the whole sheet, no fills outside the palette`. Attach SH-01 as the style
reference — the glyph sheet should look like it was cut from the same plate as the chrome.

---

### SH-04 · State strips
The most useful sheet pattern for a game UI: one object, every state, in a row.

```text
Generate a state strip: the same object repeated six times left to right, identical silhouette
and identical pixel dimensions, 160 by 48 logical pixels each, 16-pixel gaps, on a flat solid
#FF00FF background. Only the lighting and accent colour change, never the geometry, never the
size, never the position of any internal element. Pixel art game UI button, [OBJECT
DESCRIPTION]. States in order: idle; hover; pressed; focus; disabled; danger. Chunky 32-bit era
pixel art at 8x pixel pitch.
No text or lettering, strict pixel grid with hard edges, no anti-aliasing, no blur, no
gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635
#ef4444 #e8ecf4 #8a94a8 only.
```

State definitions to paste in place of `[OBJECT DESCRIPTION]`:

- **idle** — base bevel, no glow.
- **hover** — lit: one step lighter frame, 2 px accent line on the top inner edge.
- **pressed** — inverted bevel, face 2 px lower and darker, accent line on the bottom inner edge.
- **focus** — 2 px pale-cyan outline 2 px outside the outer stroke, geometry otherwise identical.
- **disabled** — desaturated to `#2a3550` / `#1a1f2e`, no accent.
- **danger** — frame and accent in `#ef4444`, for destructive actions.

Then crop the six cells with equal widths. If the model produced unequal widths, crop to the
**common** box anchored on the silhouette; do not scale.

---

## Export spec

| Property | Value |
|---|---|
| Source | 1024 px minimum on the short edge, `#FF00FF` flat background |
| Key | Chroma tolerance ≤ 24, then 1 px alpha erode, no feathering |
| Downscale | Integer factor only, nearest-neighbour, measured from the pixel pitch |
| Colour | Quantise to the twelve-colour palette, PNG-8, no dithering added by the tool |
| Alpha | 0 or 255 on the edge — a semi-transparent rim becomes a grey halo at 4× CSS scale |
| Padding | Pad to the spec size; never scale to fit |
| 9-slice | Border width a multiple of 4 px; corners rotationally identical |
| Budget | Whole sheet sliced under ~120 KB; total assets under 6 MB |
| Naming | `ui.<family>.<piece>` and `ui.<family>.<piece>.<state>` in `manifest.json` |

**Manifest entry shape** (`packages/client/assets/atlas/manifest.json` — file and size only):

```json
"ui.button.cta.hover": { "file": "ui/button-cta-hover.png", "atlas": "ui.json", "w": 192, "h": 64 }
```

The frame box lives in the per-family atlas (`packages/client/assets/atlas/ui.json`):

```json
"ui.button.cta.hover": { "file": "ui/button-cta-hover.png", "x": 0, "y": 0, "w": 192, "h": 64 }
```

If the piece replaces an existing chrome key, update `CHROME_FILES` in
`packages/client/src/ui/chrome.ts` in the same commit — a test pins the two together, and that
test exists precisely because a mismatch silently renders nothing.

---

## The one-sheet fallback

If you only want to spend one generation on this whole project, use SH-01 and stop there. A
consistent chrome sheet plus the icon sheets (SH-03) replaces every panel, button, bar, chip,
field and icon in the game. The HUD and screens can then be composed from those pieces without
another prompt. Everything else in this pack is refinement.
