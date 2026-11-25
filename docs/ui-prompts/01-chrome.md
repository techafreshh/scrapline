# 01 · Chrome — the control library

Cut-out lane throughout. Generate each piece on flat `#FF00FF`, key it out, quantise, ship as
a 9-slice or a fixed-size background. Text is never in the image.

**Chrome grammar** (every piece in this chapter obeys it):

```
outer stroke     1px   #0b0f1a
frame            2px   #2a3550
bevel light      1px   #4a5a7f   (top + left edges)
bevel shadow     1px   #0a0e18   (bottom + right edges)
surface                #16213a   (dither the corners, never a gradient)
accent rail      3px   #00E5FF   (top edge of HUD modules only)
rivets           2x2   #2a3550 + 1px #4a5a7f highlight, inset 6px from corners
```

Corners are **rotationally** identical (four distinct corner tiles), never mirrored — mirrored
corners produce a seam at the top-right when the 9-slice stretches.

Every prompt below ends with the standard lock. Don't strip it.

---

### CH-01 · Panel frame — base nine-slice
**Use:** every overlay, dialog and menu sub-panel. Atlas key `ui.panel`.
**Canvas:** 1:1 · 128×128 logical · 24px border · generate at 1024².

```text
Pixel art game UI panel, single empty rectangular frame viewed straight on, 128 by 128
logical pixels. A 24-pixel-thick bevelled metal border in dark brushed steel #2a3550 with a
1-pixel #4a5a7f highlight along the top and left inner edges and a 1-pixel near-black #0a0e18
shadow along the bottom and right, a 1-pixel solid #0b0f1a outer stroke, four 2x2 rivets inset
6 pixels from each corner, and a completely flat empty interior of dithered #16213a that has
no noise, no rivets and no gradient so the middle can stretch to any size. Chunky 32-bit era
pixel art at an 8x pixel pitch, orthographic, flat front lighting.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** inner shadows that darken the centre, chamfered corners larger than 8 px, any
highlight colour outside the palette.
**Variants:** `sharper corners (4px chamfer)` for tooltips, `heavier 32px border` for the end
screen. Generate the four corner tiles as one piece; if the model produces a symmetric frame,
flip the bottom-right 180° rather than asking again.
**Ship as:** `ui.panel`, `border-image` width 24 at 1× (96 px at 4× CSS scale).

---

### CH-02 · Panel variants — elevated, inset, hazard
**Use:** elevated = modals over the menu; inset = the “well” behind standings and the locker
grid; hazard = the end-screen header and the death/respawn card.
**Canvas:** 1:1 · 128×128 · three separate generations.

```text
Three pixel art game UI panel frames in a single row, each 96 by 96 logical pixels, 20-pixel
bevelled borders, identical construction. Left: elevated panel, slightly lighter surface
#16213a with a thin 1-pixel #00E5FF line inset 4 pixels around the outer edge. Centre: inset
recessed well — the border bevel inverted so light sits on the bottom-right, interior one step
darker than the frame, no accent line. Right: hazard panel — the top and bottom border bands
carry diagonal 45-degree orange #FF6B35 and near-black #0b0f1a stripes 4 pixels wide, the rest
matching the base panel. Flat empty interiors, no text, no icons. Chunky 32-bit pixel art at
8x pixel pitch, orthographic front view.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** the model drawing three different design languages; ask for “identical construction,
only the finish differs”. If it drifts, regenerate the three separately with CH-01 as the
reference image.
**Ship as:** `ui.panel.elevated`, `ui.panel.inset`, `ui.panel.hazard`.

---

### CH-03 · Button — four states, one strip
**Use:** every `.sl-btn`. Atlas keys `ui.button`, `ui.button.hover`.
**Canvas:** 4:1 strip, four 64×32 logical cells at 2× gap, or generate one at a time — one at a
time is more reliable for the bevel.

```text
Pixel art game UI button, empty, 64 by 32 logical pixels, viewed straight on. A bevelled
rectangular plate of #2a3550 with a 1-pixel #4a5a7f highlight on the top and left, a 3-pixel
near-black #0a0e18 shadow on the bottom and right, a 1-pixel #0b0f1a outer stroke, and a flat
dithered #16213a face with no text. Two 1-pixel cyan #00E5FF ticks, one inset 6 pixels from
each short end, like a bracket pair. Chunky 32-bit era pixel art at 8x pixel pitch,
orthographic, flat front lighting.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

Then, per state, change **only lighting**:

| State | Add to the prompt |
|---|---|
| hover | `face lightened one step toward #16213a with a 2-pixel #00E5FF glow line along the top inner edge, same silhouette` |
| pressed | `bevel inverted, face raised 2 pixels darker, new 1-pixel #00E5FF line along the bottom inner edge, same silhouette` |
| disabled | `desaturated to #2a3550 and #1a1f2e only, no cyan ticks, same silhouette` |
| focus | `2-pixel #a5f3fc outline 2 pixels outside the outer stroke, same silhouette` |

**Avoid:** any change in width/height between states — that causes layout shift on hover, which
reads as a bug. If a state comes back 1 px different, crop to the common box.
**Ship as:** `ui.button` / `ui.button.hover` (already wired in `chrome.ts`).
**Note:** the hover and pressed bevels must be *inversions*, not darkening. Darkening alone is
invisible on a dark panel.

---

### CH-04 · Primary CTA — Quick Play
**Use:** `#quick-play`, the one hero action. Never used twice on a screen.
**Canvas:** 3:1 · 192×64 logical.

```text
Pixel art game UI primary call-to-action button, empty, 192 by 64 logical pixels, viewed
straight on. A heavy bevelled plate, 4-pixel #2a3550 frame, 1-pixel #4a5a7f highlight top and
left, 4-pixel #0a0e18 shadow bottom and right, 1-pixel #0b0f1a outer stroke, face filled with
a tight 1-bit dither of #00E5FF over #16213a so it reads as a lit cyan-glass plate rather than
a solid fill, and a 2-pixel #a5f3fc specular line inset 6 pixels along the top edge. Two
reinforced 8-pixel corner brackets in #00E5FF at the top-left and bottom-right only. No text.
Chunky 32-bit era pixel art at 8x pixel pitch, orthographic, flat front lighting.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a fully cyan face. The dither is the point — it keeps the button from becoming a
flat rectangle of saturated colour that fights the text.
**Ship as:** `ui.button.cta` (+ `.cta.hover`).
**Layout note:** the sub-line (`3 bots · normal · first to 25 · 5 min`) is HTML inside the
button, not part of the art.

---

### CH-05 · Icon button — close, gear, arrow
**Use:** `.panel-close`, carousel arrows, settings rows.
**Canvas:** 1:1 · 32×32 logical, one icon per prompt.

```text
Pixel art square icon button, empty frame only, 32 by 32 logical pixels, viewed straight on.
A 2-pixel #2a3550 frame with a 1-pixel #4a5a7f top-left highlight and 1-pixel #0a0e18
bottom-right shadow, a flat #16213a face, and a 4-pixel chamfer on all four corners. No glyph
inside — the glyph is added separately. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** the model adding an X, gear or arrow unprompted — say “empty frame only” twice if
needed. Glyphs come from IC-03 so they stay consistent across buttons.
**Ship as:** `ui.iconbtn` + `ui.iconbtn.hover`.

---

### CH-06 · Secondary / ghost button
**Use:** the five stack items under Quick Play, panel Close buttons.
**Canvas:** 5:1 · 160×32 logical.

```text
Pixel art game UI secondary button, empty, 160 by 32 logical pixels, viewed straight on. A
thin plate: 2-pixel #2a3550 frame, a 1-pixel #4a5a7f highlight on the top and left, a 2-pixel
#0a0e18 shadow bottom and right, face filled with dithered #0b0f1a (darker than the panel
behind it, so it reads as a recessed row), and a 4-pixel #00E5FF bar on the left edge only,
like a tab marker. No text. Chunky 32-bit era pixel art at 8x pixel pitch, orthographic.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** ghost buttons that are lighter than the panel. They must recede; that is what makes
Quick Play pop.
**Ship as:** `ui.button.secondary` (+ hover).

---

### CH-07 · Chip / badge
**Use:** `#quick-play-chip`, `#profile-badge`, map-card meta, kill-feed tags.
**Canvas:** 1:1 · 48×20 logical (generate wide, trim).

```text
Pixel art game UI chip, empty, 48 by 20 logical pixels, viewed straight on. A small rounded-
corner pill (2-pixel chamfer) with a 1-pixel #4a5a7f border, a translucent-looking 1-bit
dither of #0b0f1a over #16213a, and a 3-pixel #00E5FF nub on the left edge. No text, no icon.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Variants:** `accent nub in orange #FF6B35` (level badge), `gold #eab308` (rank),
`lime #a3e635` (completed challenge).

---

### CH-08 · Progress bar family
**Use:** HP (`#hud-hp`), jetpack fuel (`#hud-fuel`), XP and challenge progress.
**Canvas:** 20:1 · 160×8 logical track + fill, or two separate strips.

```text
Pixel art game UI progress bar, empty, 160 by 8 logical pixels, viewed straight on, in two
separate pieces: a recessed track and a fill. Track: 1-pixel #0b0f1a outer stroke, 1-pixel
#2a3550 inner edge along the bottom and right only, interior flat dithered #0b0f1a, with a
1-pixel #00E5FF tick at every 16 pixels along the top edge. Fill: a solid #00E5FF block 8
pixels tall with a 1-pixel #a5f3fc highlight along its top edge and a 1-pixel #0a0e18 shadow
along its bottom edge, flat right end so segments butt cleanly. Chunky 32-bit era pixel art at
8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Fill colour set** — same geometry, only the fill changes:

| Bar | Fill | Highlight |
|---|---|---|
| HP healthy | `#a3e635` | `#e8ecf4` |
| HP wounded | `#eab308` | `#fef08a` is out of palette — use `#e8ecf4` |
| HP critical | `#ef4444` | `#e8ecf4` |
| Fuel | `#00E5FF` | `#a5f3fc` |
| XP | `#a5f3fc` | `#e8ecf4` |

**Avoid:** rounded fill ends — they leave a gap when the value is near zero. Flat ends only.
**Ship as:** `ui.bar`, `ui.bar.fill` (+ colour variants as CSS `background-color` over a
greyscale fill, which is cheaper than five PNGs).

---

### CH-09 · Slider
**Use:** `#volume`, `#music-volume` (settings).
**Canvas:** 20:1 · 160×16 logical track; 1:1 16×16 knob.

```text
Pixel art game UI horizontal slider, 160 by 16 logical pixels, viewed straight on. A recessed
8-pixel-tall groove centred vertically, 1-pixel #0b0f1a stroke, dithered #0b0f1a interior,
with a filled left portion of solid #00E5FF and a 1-pixel #a5f3fc highlight along the groove's
top edge. The thumb is a 16 by 16 bevelled square of #2a3550 with a #4a5a7f top-left highlight,
a #0a0e18 bottom-right shadow, a 1-pixel #0b0f1a stroke, and a 4-pixel #00E5FF notch across its
middle. No text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** the native browser slider showing through. The art is a `background-image` over a
transparent `input[type=range]` with the real thumb made invisible — generate the thumb centred
in its own 16×16 cell so the CSS thumb box can sit exactly on it.
**Ship as:** `ui.slider.track`, `ui.slider.thumb`.

---

### CH-10 · Toggle
**Use:** settings rows (fullscreen, quality, name tags are buttons today; toggles are the
target).
**Canvas:** 2:1 · 48×24 logical, two states side by side, 8 px gap.

```text
Pixel art game UI toggle switch in two states side by side, each 48 by 24 logical pixels,
viewed straight on. Left, off: a recessed bevelled pill, 2-pixel #2a3550 frame, interior
dithered #0b0f1a, knob is a 16-pixel bevelled #2a3550 block with a #4a5a7f highlight, resting
at the left end. Right, on: identical pill but the interior carries a dithered #00E5FF glow
and the knob sits at the right end, lit with a 1-pixel #a5f3fc rim. No text, no labels.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** iOS-style round caps. Everything here is square with a 2 px chamfer.

---

### CH-11 · Checkbox
**Use:** challenge rows, “remember name”, stats options.
**Canvas:** 3:1 · 48×16 logical, three states.

```text
Pixel art game UI checkbox in three states in a row, each 16 by 16 logical pixels, 8-pixel
gaps, viewed straight on. Empty: a 2-pixel #2a3550 frame with a #4a5a7f top-left highlight and
dithered #0b0f1a interior. Hover: same box with the frame in #00E5FF. Checked: same box with a
chunky 3-pixel #00E5FF tick drawn corner to corner and a 1-pixel #a5f3fc rim. No text.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### CH-12 · Text field + select
**Use:** `#profile-name` (name input), `#profile-palette`, `#cos-helmet`, `#cos-visor`,
`#cos-palette` (selects).
**Canvas:** 8:1 · 256×32 logical.

```text
Pixel art game UI text input field, empty, 256 by 32 logical pixels, viewed straight on. A
recessed bevelled rectangle: 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550 frame, a 2-pixel
#0a0e18 shadow along the top and left inner edges so it reads as cut into the panel, interior
flat dithered #0b0f1a, and a 2-pixel #00E5FF bar at the left end of the interior as a caret
anchor. No text, no placeholder, no cursor. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Select variant:** same plate plus `a 12-pixel-wide chevron cavity at the right end, framed by
a 1-pixel #2a3550 divider, with a chunky 3-pixel #00E5FF down-chevron inside it`.

**Avoid:** the native `<select>` arrow leaking through — the real element keeps
`appearance: none` and the art supplies the chevron.

---

### CH-13 · Scrollbar
**Use:** locker grid, challenges list, standings overflow.
**Canvas:** 1:8 · 12×96 logical track and thumb.

```text
Pixel art game UI vertical scrollbar, 12 by 96 logical pixels, viewed straight on. A recessed
track 12 pixels wide: 1-pixel #0b0f1a stroke, dithered #0b0f1a interior. The thumb is a
10-pixel-wide bevelled block of #2a3550 with a #4a5a7f top-left highlight, a #0a0e18
bottom-right shadow, and two 4-pixel #2a3550 grip lines across its middle. No arrows, no text.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** arrow buttons at the ends. We use overlay scrollbars; arrows waste 24 px and look
dated.

---

### CH-14 · List row — default, hover, selected
**Use:** standings rows, locker item rows, challenge rows, settings rows.
**Canvas:** 8:1 · 256×32 logical, three states stacked with 4 px gaps.

```text
Pixel art game UI list row in three states stacked vertically, each 256 by 32 logical pixels,
viewed straight on. Default: a flat translucent-looking dithered #0b0f1a band with a 1-pixel
#2a3550 line along the bottom edge only, no outer frame. Hover: identical band with a 2-pixel
#4a5a7f line along the bottom edge and a faint dithered #16213a wash. Selected: identical band
with the full 4 edges framed in 1-pixel #00E5FF, a 4-pixel #00E5FF marker bar at the left end,
and a dithered #16213a fill. No text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** row heights that differ between states. Selected rows that grow 2 px cause the whole
table to jump — the single most common tell of generated UI.

---

### CH-15 · Keycap
**Use:** the controls table in How to Play (`#controls-table`).
**Canvas:** 1:1 · 24×24 logical.

```text
Pixel art game UI keycap, empty, 24 by 24 logical pixels, viewed straight on. A bevelled
square cap of #2a3550 with a #4a5a7f highlight on the top and left, a 4-pixel #0a0e18 shadow
along the bottom giving it thickness, a 1-pixel #0b0f1a outer stroke, and a flat #16213a top
face. No text, no letter. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Note:** the key label is HTML centred on the cap; a 24 px cap holds two characters at 12 px
Orbitron. Wide keys (Space, Shift) stretch the 9-slice horizontally.

---

### CH-16 · Divider, corner bracket, header strip
**Use:** panel headers, section rules, modal corners.
**Canvas:** three separate prompts — horizontal rule 64×8, bracket 16×16, header 256×24.

```text
Three small pixel art game UI ornaments on one canvas, all viewed straight on. Top: a
horizontal divider 64 by 8 logical pixels — a 2-pixel #2a3550 rule with a 1-pixel #4a5a7f
highlight above it, fading to a 4-pixel #00E5FF diamond at the exact centre. Middle left: a
corner bracket 16 by 16 logical pixels, two 2-pixel #00E5FF arms meeting at a right angle with
a 1-pixel #a5f3fc inner edge. Middle right: an empty header strip 96 by 24 logical pixels, a
flat #16213a band with a 3-pixel #00E5FF rail along the bottom edge and 1-pixel #2a3550
verticals at each end. No text. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### CH-17 · Tooltip / callout
**Use:** hovering a locked cosmetic, the zoom hint, “press Z” hints.
**Canvas:** 3:2 · 96×64 logical, with a 12 px arrow tail below.

```text
Pixel art game UI tooltip bubble, empty, 96 by 64 logical pixels, viewed straight on, with a
12-pixel-wide pointed tail centred on its bottom edge. A 2-pixel #2a3550 frame, 1-pixel #4a5a7f
top-left highlight, 1-pixel #0a0e18 bottom-right shadow, 1-pixel #0b0f1a outer stroke, flat
dithered #0b0f1a interior, and a 2-pixel #00E5FF line along the top inner edge. No text.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### CH-18 · Toast frame
**Use:** `#toast` — “Copied!”, “Joined room”, “Failed to connect”.
**Canvas:** 6:1 · 192×32 logical.

```text
Pixel art game UI toast notification frame, empty, 192 by 32 logical pixels, viewed straight
on. A bevelled strip: 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550 frame, flat dithered
#16213a interior, and a 6-pixel-tall coloured status block at the left end framed by a
1-pixel #0b0f1a divider. The status block is #00E5FF for neutral. No text, no icon.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Variants:** status block `#a3e635` success, `#ef4444` error, `#eab308` warning, `#FF6B35`
online/connecting.

---

## Assembly order

If the whole chapter gets regenerated, assemble one screen and stop: menu with CH-01 panel,
CH-06 secondary stack, CH-04 CTA, CH-07 chips, CH-16 header rail. If those five read as one kit at
1280×720, the rest will follow. If they don't, the problem is usually **bevel depth** — fix it
in CH-01 and regenerate the rest against it as a reference image, not by tweaking each file.
