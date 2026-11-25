# 02 · HUD — everything visible mid-match

The HUD has to survive chaos: it sits over a bright dune, a dark frost arena and a green
jungle, often with two tracer lines crossing it. That forces three rules on every piece here:

1. **A dark keyline around every module.** 1 px of `#0b0f1a` on the outside. It is the only
   thing that keeps a panel legible against a sand-coloured wall.
2. **Translucency is dithered, not alpha.** A checkerboard dither of the panel colour reads as
   glass at 1× and survives pixel scaling; real alpha over a busy background turns to mud.
3. **No animation baked into the art.** Pulse, shake and fade are code. Art supplies the rest
   state only.

Reference layout (`scripts/verify-ui.js` captures this view as *mid-match HUD*):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ╔══ HP 100 ══════════╗            ╔═══════════╗        ╔══ killfeed ═══╗ │
│ ║ ▰▰▰▰▰▰▰▰▰▱  100   ║            ║  3  :  2  ║        ║ McKay ▸ Roach ║ │
│ ║ ▰▰▰▰▰▰▱▱▱▱  JET   ║            ║   02:41   ║        ║ Roach ▸ You   ║ │
│ ║ ◈ ◈ ◇   32/96     ║            ╚═══════════╝        ╚═══════════════╝ │
│ ╚═══════════════════╝                                                  │
│                                                                        │
│                    ✛  crosshair        name tags over players           │
│                                                                        │
│                                        ╔══ [icon] Hornet SMG ═══════╗  │
│                                        ║        32/96  ▮▮▮▯▯       ║  │
│                                        ╚═══════════════════════════╝  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### HU-01 · Full HUD mockup — the target
**Lane:** `Mockup` · 16:9 · 1920×1080.

```text
Pixel art game HUD mockup for a 2D jetpack arena shooter, 16:9 widescreen, viewed over a
jungle-industrial arena mid-fight. Composition: top-left a compact vertical status cluster
(health bar with number, jetpack fuel bar, three grenade pips, weapon name); top-centre a small
score-and-timer chip; top-right a four-row kill feed with weapon icons; bottom-right a weapon
ammo module with a weapon silhouette, large reserve count and five magazine pips. Centre clear
for play, with a crosshair at centre and two small name tags floating beside characters.
Translucent dark navy panels, 1-pixel near-black keylines, cyan accent rails, orange enemy
markers. No readable text — use abstract placeholder bars. Chunky 32-bit era pixel art at a
consistent 4x pixel pitch over a pixel-art arena.
16:9 game UI mockup, no readable words, no browser chrome, no device frame, no watermark,
palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444
#e8ecf4 #8a94a8 only.
```

**How to use it:** as the composition reference for the whole chapter and the thing to compare
`captures/` against. Export at 1920×1080 and keep it next to the real capture.
**Avoid:** a mockup that fills the centre with panels. The middle two-thirds belongs to the
game; if the model crowds it, ask for “HUD hugging the four screen corners, centre empty”.

---

### HU-02 · Status cluster frame
**Use:** `#hud-status` — top-left. Contains HP, fuel, grenades, weapon name.
**Lane:** `Cut-out` · 1:1-ish · 208×96 logical.

```text
Pixel art game HUD status panel, empty, 208 by 96 logical pixels, viewed straight on. A
translucent-looking panel: 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550 frame, interior a
50 percent checkerboard dither of #0b0f1a over #16213a so it reads as smoked glass over the
game, a 3-pixel #00E5FF accent rail across the top edge inset 8 pixels from each end, and two
notched 8-pixel corner brackets at the bottom corners in #2a3550. Interior completely empty.
Chunky 32-bit era pixel art at 8x pixel pitch, orthographic front view.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a fully opaque black box. The dither is what makes it read as a HUD element rather
than a hole punched in the screen.

---

### HU-03 · Health readout — three states
**Use:** the HP bar + numeric label, `#hud-health`, `.hp-bar`.
**Lane:** `Cut-out` · three states stacked.
**Base geometry:** CH-08 (160×8 track + fill). This prompt is the HUD-specific version.

```text
Pixel art game HUD health bar in three states stacked vertically, each 160 by 12 logical
pixels, 6-pixel gaps, viewed straight on. Same recessed 12-pixel-tall track in every state:
1-pixel #0b0f1a stroke, 1-pixel #2a3550 inner bottom-right edge, flat dithered #0b0f1a
interior, 1-pixel segment ticks every 20 pixels. Top: 90 percent filled in #a3e635 with a
1-pixel #e8ecf4 top highlight. Middle: 45 percent filled in #eab308, with a 2-pixel #FF6B35
line along the fill's right end. Bottom: 15 percent filled in #ef4444, with a dithered #ef4444
haze bleeding 8 pixels past the fill and the track's left 4 pixels flashing solid #ef4444.
No text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a gradient from green to red inside one bar. Three discrete states are legible at a
glance; a gradient makes the player read a value instead of feeling a state.

---

### HU-04 · Jetpack fuel bar
**Use:** `#hud-fuel`. Sits directly under HP, same width, deliberately quieter.
**Lane:** `Cut-out` · 160×8 logical.

```text
Pixel art game HUD fuel bar, 160 by 8 logical pixels, viewed straight on. A recessed 8-pixel
track with a 1-pixel #0b0f1a stroke and dithered #0b0f1a interior, filled 60 percent with a
#00E5FF gradient-free block that carries a 1-pixel #a5f3fc highlight on top, and a repeating
2-pixel diagonal hatch of #16213a across the unfilled right portion so it reads as a gauge
rather than a second health bar. No text. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Low-fuel state:** regenerate with `the fill drops to the left 20 percent, turns #FF6B35, and
gains a 2-pixel checkerboard blink pattern at its right end`.
**Avoid:** cyan identical to the HP bar's cyan. If health is healthy-green, fuel cyan is fine;
if health is cyan the fuel must shift.

---

### HU-05 · Ammo module — frame + slots
**Use:** `#ammo-module` — bottom-right. Icon, weapon name, `32/96`, magazine pips.
**Lane:** `Cut-out` · 3:1 · 192×64 logical.

```text
Pixel art game HUD weapon module, empty, 192 by 64 logical pixels, viewed straight on. A
translucent smoked-glass plate, 1-pixel #0b0f1a outer stroke, 2-pixel #2a3550 frame, interior a
50 percent checkerboard dither of #0b0f1a over #16213a. On the left, a 48-pixel square recessed
weapon slot: a 2-pixel #0a0e18 shadow on its top and left inner edges, a 1-pixel #2a3550
outline, flat #0b0f1a interior, and a 4-pixel #00E5FF corner bracket in its top-left. On the
right, five empty 8-by-8 magazine pip sockets in a row along the bottom edge, each a 1-pixel
#2a3550 outline with #0b0f1a interior. No text, no icons, no numbers. Chunky 32-bit era pixel
art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Pip states:** separate 1:1 8×8 prompt — `empty socket`, `filled solid #00E5FF with #a5f3fc
top highlight`, `empty and flashing #FF6B35` (reloading).
**Ship as:** `ui.slot` (frame), `ui.pip`, `ui.pip.on`, `ui.pip.low`.

---

### HU-06 · Grenade pips
**Use:** `#hud-grenades` — max 3 (`GRENADE_MAX`).
**Lane:** `Cut-out` · one 3-state strip, 16×16 each.

```text
Pixel art game HUD grenade counter, three 16 by 16 logical cells in a row with 8-pixel gaps,
viewed straight on. Each cell holds a tiny grenade silhouette 12 pixels tall, two-tone #e8ecf4
body with a #2a3550 band and a #FF6B35 2-pixel pin. Left cell lit and full, middle cell lit and
full, right cell dark silhouette in #2a3550 only meaning spent. Chunky 32-bit era pixel art at
8x pixel pitch, orthographic.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** sprites with internal anti-aliased shading — at 12 px tall that becomes noise. Two
tones plus one accent only.

---

### HU-07 · Score + timer chip
**Use:** `#hud-center` — the top-centre match state chip.
**Lane:** `Cut-out` · 4:1 · 160×40 logical.

```text
Pixel art game HUD match-state chip, empty, 160 by 40 logical pixels, viewed straight on. A
compact smoked-glass plate: 1-pixel #0b0f1a stroke, 2-pixel #2a3550 frame, checkerboard dither
of #0b0f1a over #16213a, split by a 1-pixel #2a3550 vertical divider into a wider left cell for
the score and a narrower right cell for the clock. Along the bottom edge, a 3-pixel rail in
#00E5FF for the leading side and #FF6B35 for the trailing side, meeting at the divider. Two
8-pixel corner brackets at the top corners. No text, no numbers. Chunky 32-bit era pixel art at
8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Match-point state:** regenerate with `both rails switch to #eab308 and a 2-pixel gold
chevron row appears along the top inner edge`.

---

### HU-08 · Kill feed row
**Use:** `#killfeed` — `Killer ▸ Victim` with a weapon icon between, 5 rows max, 6 s hold.
**Lane:** `Cut-out` · 6:1 · 240×32 logical.

```text
Pixel art game HUD kill feed row plate, empty, 240 by 32 logical pixels, viewed straight on.
A low smoked-glass band: 1-pixel #0b0f1a stroke, a 1-pixel #2a3550 line along the bottom edge
only, interior a 50 percent dither of #0b0f1a over #16213a, a 4-pixel #00E5FF marker bar at the
left end, and a 36-pixel square inset well on the right end for a weapon icon, recessed with a
1-pixel #0a0e18 inner shadow. No text, no icons. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Variants:** `marker bar #FF6B35` when the local player is the victim; `#eab308` when it was a
headshot (set the marker to a 3-pixel skull notch instead of a bar).
**Avoid:** the model drawing three name-ish blobs inside the row. The plate must be empty; the
names are HTML with per-team colour from `teamCss`.

---

### HU-09 · Crosshair set
**Use:** `#crosshair` — one per weapon family, plus a hit state.
**Lane:** `Cut-out` · 4:1 · four 32×32 cells at 8 px gaps, or one at a time (better).

```text
Pixel art game crosshair, 32 by 32 logical pixels, centred, viewed straight on. A minimalist
cyan #00E5FF reticle: four 6-pixel tick marks with a 4-pixel gap at the centre, 2 pixels thick,
each tick capped with a 1-pixel #a5f3fc highlight, plus a single 2-by-2 centre dot. No circle,
no outline, no glow. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

Per weapon (same cell, only geometry changes):

| Weapon | Change |
|---|---|
| pistol | as above |
| smg | ticks 4 px long, 6 px gap — wide, loose |
| rifle | ticks 7 px long, 3 px gap |
| shotgun | four short corner brackets instead of ticks, 10 px gap |
| sniper | no reticle when scoped (see HU-11); unscoped = 2 px dot only |
| rocket | square bracket frame with a 2 px dot |

**Hit state:** `the four ticks turn #e8ecf4 and pull inward 2 pixels, and a 6-pixel diagonal
dash appears at each of the four corners`.
**Kill state:** `the reticle becomes a 4-pixel #ef4444 X with 1-pixel #e8ecf4 tips, 40 percent
larger`.
**Avoid:** symmetric dots with no gap — at 240 px/s movement a solid dot hides the target.

---

### HU-10 · Respawn card
**Use:** `#respawn` — the centre card while dead (RESPAWN 180 ticks = 3 s).
**Lane:** `Cut-out` · 2:1 · 320×160 logical.

```text
Pixel art game HUD respawn card, empty, 320 by 160 logical pixels, viewed straight on. A
heavy hazard-striped plate: 1-pixel #0b0f1a stroke, 4-pixel #2a3550 frame, diagonal 45-degree
stripes of #FF6B35 and #0b0f1a 6 pixels wide across the top and bottom border bands only, the
interior a 50 percent checkerboard dither of #0b0f1a over #16213a, and a large 24-pixel
inset well in the centre framed by a 1-pixel #2a3550 line for the countdown digit. Four 8-pixel
#FF6B35 corner brackets. No text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a full-screen dim baked into the art. Dimming is code (the `#respawn` root's own
background); the card must sit on a transparent surround so the death camera stays visible.

---

### HU-11 · Scope overlay (sniper)
**Use:** `SCOPE` button state. Full-bleed vignette with a lens ring.
**Lane:** `Cut-out` · 1:1 · 1024×1024 logical. This one is meant to fill the viewport.

```text
Pixel art game sniper scope overlay, 1024 by 1024 logical pixels, viewed straight on, designed
as a full-screen mask. A hard-edged circular lens window 620 pixels in diameter dead centre,
surrounded by a solid #0b0f1a surround that reaches the canvas edges. The lens rim is a
4-pixel #2a3550 ring with 1-pixel #00E5FF inner and 1-pixel #0a0e18 outer strokes, four
12-pixel #00E5FF ranging ticks at the cardinal points, and a 1-pixel cyan crosshair through the
lens centre with ticks every 32 pixels that get shorter toward the middle. The lens interior is
fully transparent (no tint, no gradient). Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background outside the canvas edges only, no text or lettering, strict pixel grid
with hard edges, no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550
#4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a soft radial vignette. We need a hard circular hard cut so the edge can be keyed;
soft edges reveal the renderer's low resolution immediately.

---

### HU-12 · Name tag plate
**Use:** `#nametags` — floating above players. Team colour comes from `teamCss`.
**Lane:** `Cut-out` · 1:2 · 64×24 logical, plus a 6 px caret.

```text
Pixel art game HUD name tag plate, empty, 64 by 24 logical pixels with a 6-pixel caret on the
bottom edge, viewed straight on. A compact translucent band: 1-pixel #0b0f1a stroke, interior a
50 percent dither of #0b0f1a over #16213a, a 3-pixel team-colour rail along the left edge (drawn
in #00E5FF), and a tiny 2-by-2 rank pip inset 4 pixels from the right edge in #a5f3fc. No text.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Enemy variant:** `the rail and caret become #FF6B35, and the band gains a 1-pixel #FF6B35
outline`. **Self variant:** `rail #eab308, no caret`.
**Avoid:** name tags with drop shadows — they read as smeared at 1×. Depth comes from the
keyline.

---

### HU-13 · Pickup pad label
**Use:** `#padlabels` — small labels floating near weapon/health/grenade pads.
**Lane:** `Cut-out` · 3:1 · 72×24 logical.

```text
Pixel art game HUD pickup label, empty, 72 by 24 logical pixels, viewed straight on. A tiny
translucent plate: 1-pixel #0b0f1a stroke, 1-pixel #2a3550 top edge, interior 50 percent dither
of #0b0f1a over #16213a, and a 3-pixel #a3e635 underline along the bottom edge. No text, no icon.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Variants:** underline `#a3e635` health, `#00E5FF` fuel/weapon, `#EF4444` hazard.

---

### HU-14 · Hit marker + damage number
**Use:** local hit feedback and floating damage.
**Lane:** `Cut-out` · two prompts, 24×24 and 16×24.

```text
Pixel art game hit marker sprite, 24 by 24 logical pixels, centred, viewed straight on. Four
2-pixel diagonal ticks of #e8ecf4 arranged as an X, each 6 pixels long, with a 1-pixel #00E5FF
inner edge and a 4-pixel transparent gap at the centre. No glow, no outline. Chunky 32-bit era
pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

```text
Pixel art game damage number plate, empty, 16 by 24 logical pixels, viewed straight on. A tiny
stepped pixel-art digit slot: no plate, no frame, just a flat 2-pixel #0b0f1a shadow offset
2 pixels down and right, leaving the front area fully transparent for a digit to be drawn on
top. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Headshot marker:** `the X becomes #eab308 and a 4-pixel inner X of #FF6B35 appears inside it`.
**Avoid:** asking the model for the digit itself. Digits 0–9 across every size is a font —
and we already have the bitmap font in `packages/client/src/ui/fonts.ts`.

---

### HU-15 · Pickup toast
**Use:** `#toast` when a pad is taken (“+50 health”, “Grenade +2”).
**Lane:** `Cut-out` · 3:1 · 96×32 logical.

```text
Pixel art game HUD pickup toast, empty, 96 by 32 logical pixels, viewed straight on. A small
translucent plate with a 1-pixel #0b0f1a stroke, interior 50 percent dither of #0b0f1a over
#16213a, a 32-pixel square inset icon well at the left end recessed by 1 pixel of #0a0e18, and a
3-pixel #a3e635 underline. No text, no icon. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### HU-16 · Jetpack flame sprite strip
**Use:** the player's jetpack exhaust. Four frames, loops at 12 fps.
**Lane:** `Cut-out` · 4:1 strip · four 16×24 cells, or 4 separate files.

```text
Pixel art game jetpack exhaust flame, four animation frames left to right, each 16 by 24
logical pixels, 8-pixel gaps, viewed straight on, pointing down. Frame 1: a short 10-pixel
tongue, white #e8ecf4 core 4 pixels wide, #eab308 middle, #FF6B35 outer edge. Frame 2: 16
pixels long, core narrows, outer edge flickers 2 pixels wider. Frame 3: 20 pixels long with a
detached 3-pixel #FF6B35 ember below. Frame 4: 14 pixels long, core cooling to #eab308. Hard
pixel edges, no glow bleed, no smoke. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** fire that reads as a gradient blob. At 16 px wide you get three tones and a hard
edge — that's it. Ask for “flat colour bands, not blended”.
**Note:** this belongs to the in-world lane, not CSS — it ships as a Pixi atlas frame
(`fx.flame.0..3`), but it is generated the same way.

---

## Integration notes

- Every HUD plate is a CSS `background-image` with `image-rendering: pixelated` and an integer
  `background-size` multiple (4× at 1920×1080, 3× at 1440, 2× at 720). Non-integer multiples
  destroy pixel art.
- Module padding must land on 8 px multiples so the 9-slice corners never land mid-pixel.
- Bars animate width in code; art supplies a 1 px slice that repeats. Don't generate “70 %
  full” art — generate full and clip.
- Everything here is `pointer-events: none` except the respawn/end cards. The HUD sits over a
  canvas that needs the mouse.
