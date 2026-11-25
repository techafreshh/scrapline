# 05 · Icons

Icons are the highest-leverage UI art in the pack: a HUD with six crisp, consistent weapon
silhouettes looks designed even when the panels are plain; a HUD with six mismatched icons looks
homemade even when the panels are beautiful.

Three rules:

1. **One sheet, one style.** Generate a whole family in one prompt so stroke weight, muzzle
   direction and palette are identical. Never mix a single-item generation into a family sheet.
2. **Side-on, facing right, silhouette-first.** These are read at 16–48 px. Internal detail is
   noise; the outline carries the recognition.
3. **No text in any icon.** Numbers on ammo, timers and scores are HTML.

Standard icon canvas: **32×32 logical** inside a **64×64 cell**, 16 px gutter, on `#FF00FF`.

---

### IC-01 · Weapon icons — six, one sheet
**Use:** ammo module (`#ammo-icon`, 48 px well), kill feed (36 px well), weapon pads.
**Lane:** `Cut-out` · 6:1 sheet · six 64×64 cells.

```text
Pixel art game weapon icon set, six weapons in a single horizontal row, each icon 32 by 32
logical pixels centred in its own 64 by 64 cell with 16-pixel gutters, all side-on and facing
right, all sharing the same 1-pixel #0b0f1a outline and the same three-tone shading of #e8ecf4
body, #8a94a8 mid-tone and #2a3550 shadow. Left to right: a compact semi-automatic pistol with
a short barrel and squared grip; a stubby submachine gun with a short magazine and a folded
stock; an assault rifle with a long barrel, a curved magazine and a carry handle; a pump
shotgun with a wide bore and a ribbed pump; a long sniper rifle with a heavy scope and a
bipod; a rocket launcher with a fat tube and a conical warhead. No text, no numbers, no hands,
no muzzle flash. Chunky 32-bit era pixel art at 8x pixel pitch, orthographic side view.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Sheet slicing:** six equal cells, trim each to its own bounding box, pad back to 32×32 with
the weapon's grip line on the bottom row so all icons sit on a shared baseline. If the model
drifts in scale, normalise by barrel length, not by bounding box.

**Small-size fallback:** at 16 px the shotgun and SMG become indistinguishable. Keep a second
set generated with `simplified to silhouette only: single flat #e8ecf4 shape, 1-pixel #0b0f1a
outline, no internal detail` for the kill feed.

**Avoid:** guns pointing left, mixed angles, or weapons drawn with bayonets and attachments the
game doesn't have.

---

### IC-02 · Pickup icons — health, grenade, shield, ammo
**Use:** `atlas/pads.json` pad faces and the pickup toast well.
**Lane:** `Cut-out` · four cells · 32×32 each.

```text
Pixel art game pickup icon set, four icons in a single row, each 32 by 32 logical pixels
centred in a 64 by 64 cell with 16-pixel gutters, viewed straight on, all sharing a 1-pixel
#0b0f1a outline and the same two-tone shading. Left to right: a health cross — a chunky
plus sign in #a3e635 with a #e8ecf4 highlight on its top and left arms; a fragmentation
grenade — a rounded #2a3550 body with a #FF6B35 band and a 2-pixel pin; a shield — a heater
shield in #00E5FF with a 1-pixel #a5f3fc rim and a 3-pixel centre boss; an ammunition box — a
square #eab308 crate with a 1-pixel #2a3550 band and two 4-pixel bullet tips visible on top. No
text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** health crosses in red. Red means damage everywhere else in this game; health is lime.

---

### IC-03 · UI glyphs — the base set
**Use:** every icon button, list affordance, toggle label and hint.
**Lane:** `Cut-out` · 5×4 sheet · twenty 64×64 cells.

```text
Pixel art game UI icon set, twenty glyphs in a grid of five columns by four rows, each glyph 24
by 24 logical pixels centred in its own 64 by 64 cell with 12-pixel gutters, all drawn with a
consistent 2-pixel stroke weight in #e8ecf4 on no background, all geometric and square-cornered
with 2-pixel chamfers. Row one: a close X, a left chevron, a right chevron, an up chevron, a
down chevron. Row two: a check mark, a padlock, a speaker with one sound wave, a musical note,
a four-corner expand icon. Row three: a four-corner contract icon, a monitor with a scanline, a
rank tag, a magnifying glass, a three-line menu glyph. Row four: a gamepad, a circular refresh
arrow, a clipboard, a star, an information circle. No text, no numbers, no letters. Chunky
32-bit era pixel art at 8x pixel pitch, orthographic front view.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Second batch** (same spec, same grid): `a skull, a shield with a check, a jetpack nozzle, a
stopwatch, a warning triangle, a copy/duplicate double-square, a share arrow out of a box, a
plus, a minus, a question mark, an eye, a crossed-out eye`.

**States:** for each glyph that appears in a button, also generate `the same glyph in #00E5FF`
(hover) and `in #8a94a8` (disabled). Do not ask for all three in one prompt — the model will
change the geometry.

**Avoid:** 1 px strokes. At 24 px with an 8× downscale a 1 px stroke either vanishes or becomes
2 px inconsistently. 2 px is the floor.

---

### IC-04 · Challenge icons — eight
**Use:** `#challenges` rows, challenge toasts, profile stats.
**Lane:** `Cut-out` · 4×2 sheet · eight 64×64 cells.

```text
Pixel art game challenge icon set, eight icons in a grid of four columns by two rows, each 32
by 32 logical pixels centred in its own 64 by 64 cell with 16-pixel gutters, all sharing a
2-pixel stroke and the same two-tone fill. Row one: a headshot — a helmeted profile with a
crosshair over the visor; a kill streak — three stacked chevrons with a flame beneath; a jetpack
— a nozzle with a hard-edged exhaust; a match win — a small trophy. Row two: a grenade arc — a
grenade with a dotted parabola; a damage total — a cracked plate with a spark; an accuracy
target — a bullseye with one arrow; a playtime clock — a stopwatch with a wing. All in #e8ecf4
and #a5f3fc with #00E5FF accents. No text, no numbers. Chunky 32-bit era pixel art at 8x pixel
pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** icons that only make sense with their label. A challenge icon should hint at the
action; the label carries the precision.

---

### IC-05 · Cosmetic silhouettes — helmet, visor, palette
**Use:** the locker category tabs, and the `data-helmet` / `data-visor` preview canvas.
**Lane:** `Cut-out` · three cells · 32×32.

```text
Pixel art game cosmetic category icons, three icons in a row, each 32 by 32 logical pixels
centred in a 64 by 64 cell with 16-pixel gutters, viewed side-on facing right, identical stroke
weight. Left: a soldier helmet with a flat crown and a raised ear guard. Centre: a visor — a
narrow horizontal slot with a #00E5FF glow inside and two mounting bolts. Right: a paint palette
— a rectangular swatch card with three overlapping #00E5FF, #FF6B35 and #a3e635 squares. All in
#e8ecf4 with #2a3550 shadow and 1-pixel #0b0f1a outline. No text.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### IC-06 · Rank badge + star pips
**Use:** `#profile-badge` (`Lv 1`), standings rank plates, rank-up moment.
**Lane:** `Cut-out` · two prompts · badge 48×48, pips 8×8.

```text
Pixel art game rank badge, empty, 48 by 48 logical pixels, viewed straight on. An angular
hexagonal plate: 3-pixel #2a3550 frame, 1-pixel #4a5a7f top-left highlight, 1-pixel #0b0f1a
outer stroke, interior flat dithered #16213a, a 3-pixel #00E5FF chevron across the lower third,
and two 4-pixel chamfered notches on the upper edges. No text, no number, no symbol.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

```text
Pixel art game UI star pip in three states in a row, each 8 by 8 logical pixels, 4-pixel gaps,
viewed straight on. Left: a filled #eab308 star with a 1-pixel #e8ecf4 top highlight. Centre: an
outline-only star in #2a3550 with the interior transparent. Right: a filled star with a
2-pixel #FF6B35 crack across it. No text. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### IC-07 · Status + team markers
**Use:** kill feed, name tags, team indicators, dead/alive states.
**Lane:** `Cut-out` · 6:1 sheet · six 32×32 icons.

```text
Pixel art game status icon set, six icons in one row, each 24 by 24 logical pixels in a 64 by
64 cell with 12-pixel gutters, 2-pixel stroke, all viewed straight on. Left to right: a skull in
#e8ecf4 with #2a3550 eye sockets; a shield with a check in #a3e635; a lightning bolt in
#00E5FF; a broken shield in #ef4444; a crown in #eab308; a crosshair-in-square in #8a94a8. No
text, no numbers. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

### IC-08 · App icon / favicon
**Use:** PWA manifest icon (`manifest.webmanifest`), install prompt, tab favicon.
**Lane:** `Cut-out` · 1:1 · 512×512.

```text
Pixel art game app icon, 512 by 512 pixels, square. A dark #0b0f1a rounded-corner plate with a
4-pixel #2a3550 inner frame. Centred, a bold salvage-soldier helmet in profile facing right,
built from #2a3550 and #4a5a7f plates with a glowing #00E5FF visor slit and a #FF6B35
hazard-stripe plate on the jaw. Behind the helmet, a subtle 45-degree dither of #16213a. The
composition reads clearly at 32 pixels. No text, no letter, no badge. Chunky 32-bit era pixel
art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Maskable note:** keep the helmet inside the central 80 percent so Android's circular mask
doesn't crop the visor. Generate 512 and 192 separately; an automatic downscale of a pixel-art
icon produces grey fringes.

---

## Consistency pass

Once a family is generated, put all icons on one contact sheet at 1× against `#0b0f1a` and
check:

- Do all outlines have the same weight? If one is 2 px and another 3 px, regenerate the sheet.
- Do all objects sit on the same baseline and optical centre? Trim, don't scale.
- Is any icon unreadable at 16 px? That icon needs the simplified silhouette variant.
- Does any icon introduce a colour outside the palette? That is the most common drift.

The contact sheet is worth keeping with the prompt pack so future prompts have a
reference image to attach — Gemini restyles far more consistently against a reference than
against a description.
