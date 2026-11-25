# 04 · Screens — the panels behind the menu

Six overlay panels, three full-screen states. Every panel shares the same skeleton: a
translucent plate (CH-01/CH-02), a head strip with a title and a close button (CH-16), a body of
rows (CH-14), and one primary action. Generate the panel mockups so we can check that skeleton
holds at every content length — a panel that only works with three rows is not a design.

`scripts/verify-ui.js` captures setup, how-to, challenges and locker; end screen and loading are
captured in the mid-match and boot passes.

---

### SC-01 · Loading screen
**Use:** `#loading` + `#loading-bar`, shown while the atlas and fonts preload.
**Lane:** `Mockup` · 16:9 · 1920×1080.

```text
Pixel art game loading screen, 16:9 widescreen. A near-black #0b0f1a field with a faint
dithered #16213a vignette in the corners and a horizontal band of scattered 2-pixel cyan
#00E5FF indicator lights along the bottom third, like idle machinery. Dead centre, the
Scrapline wordmark area left as an empty dark plate 640 by 128 pixels framed by a 1-pixel
#2a3550 line, and beneath it a horizontal progress track 640 by 12 pixels with a 3-pixel
#00E5FF fill on the left and a 1-pixel #a5f3fc top highlight. A small 24-pixel square scanning
indicator sits at the fill's leading edge. No text, no percentage. Chunky 32-bit era pixel art
at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no device frame, no watermark,
palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444
#e8ecf4 #8a94a8 only.
```

**Avoid:** a spinner. A horizontal fill communicates progress and matches the HUD bars.
**Note:** the percentage text and the bar width are live; the art supplies the track only.

---

### SC-02 · Match setup panel
**Use:** `#setup` — bots, arena, cosmetics, Start.
**Lane:** `Mockup` · 4:3 · 1280×960.

```text
Pixel art game match-setup panel mockup, 1280 by 960 pixels, viewed straight on over a dimmed
arena background. A single tall translucent navy panel with a bevelled steel frame occupies the
centre. A header strip across the top carries a 3-pixel cyan rail along its bottom edge and a
small square close button at the right end. The body is five rows with generous 24-pixel gaps:
a bot-count row with a minus button, a large number field and a plus button; an arena row of
three small landscape thumbnails with one selected and outlined in cyan; a row of three
dropdown plates for helmet, visor and palette; a preview square on the right showing a soldier
bust; and a full-width primary start button at the bottom. All rows share one bevel grammar.
No readable text — placeholder bars. Chunky 32-bit era pixel art at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a two-column dense layout. Setup has five decisions; one column at 640 px wide reads
instantly and leaves the preview visible.

---

### SC-03 · Settings panel
**Use:** `#settings` — volume, music, fullscreen, quality, name tags, zoom hint.
**Lane:** `Mockup` · 3:4 · 960×1280. **Or** cut-outs + CH-09/CH-10, which is the cheaper route.

```text
Pixel art game settings panel mockup, 960 by 1280 pixels, viewed straight on over a dimmed
arena. A tall translucent navy panel with a bevelled steel frame. Header strip with a cyan rail
and a close button. The body lists eight settings rows separated by 1-pixel #2a3550 rules: two
rows with a label on the left and a wide slider on the right; three rows with a label and a
toggle switch on the right; one read-only row with a label and small italic hint placeholder;
and at the bottom a reset button and a wide done button. Every control is the same pixel-art
kit — same bevel, same keyline, same cyan accent. No readable text — placeholder bars only.
Chunky 32-bit era pixel art at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** the settings list turning into a form with different control widths. Every control
occupies the same right-hand column width (200 px) so the eye can scan the values.

---

### SC-04 · How to Play panel
**Use:** `#howto` — objective, controls table, tips.
**Lane:** `Mockup` · 4:3 · 1280×960.

```text
Pixel art game how-to-play panel mockup, 1280 by 960 pixels, viewed straight on over a dimmed
arena. A wide translucent navy panel with a bevelled steel frame and a header strip with a cyan
rail plus close button. The body is split: on the left, a two-column controls table of eleven
rows, each row a 24-pixel keycap plate on the left and an action placeholder bar on the right,
with 1-pixel #2a3550 rules between rows; on the right, a narrow column with three stacked tip
cards, each a small plate with a 3-pixel cyan rail on its left edge and two placeholder text
lines. No readable text — placeholder bars only. Chunky 32-bit era pixel art at a consistent 4x
pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a keycap per key with different widths and no alignment. Keycaps right-align at a
fixed column so the labels all start on the same x.

---

### SC-05 · Challenges panel
**Use:** `#challenges` — daily challenges with progress and reward.
**Lane:** `Mockup` · 4:3 · 1280×960 + one row cut-out.

```text
Pixel art game challenges panel mockup, 1280 by 960 pixels, viewed straight on over a dimmed
arena. A translucent navy panel with a bevelled steel frame, header strip with cyan rail and a
close button, and a right-aligned reset-countdown chip in the header. The body holds five
challenge rows with 12-pixel gaps. Each row: a 40-pixel square icon well on the left, a title
placeholder bar and a thin progress bar beneath it in the middle, and a reward chip on the
right showing a small gold glyph. The third row is completed — its icon well is outlined in
lime, the progress bar is full lime, and a lime check chip sits at the right. No readable text.
Chunky 32-bit era pixel art at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Cut-out for the row itself** (5:1, 400×80): same description, `empty of text and icons`,
`a 1-pixel #2a3550 bottom rule`, `a 40-pixel recessed icon well`, `a 200-pixel progress track
slot`, `a 96-by-32 reward chip slot`.

---

### SC-06 · Locker panel
**Use:** `#locker` — cosmetics grid, preview, equipped state.
**Lane:** `Mockup` · 4:3 · 1280×960, plus a grid-cell cut-out.

```text
Pixel art game cosmetics locker mockup, 1280 by 960 pixels, viewed straight on over a dimmed
arena. A wide translucent navy panel with a bevelled steel frame, header strip with cyan rail
and close button. The body is two columns: on the left a scrolling grid of 16 cosmetic
thumbnails in four columns, each a square plate with a recessed well; the equipped item is
outlined in cyan with a small check chip, locked items are desaturated with a padlock
silhouette, and one item is hovered with a lighter frame. On the right a large preview plate
holding a soldier bust, three category tabs above it, and an equip button plus a status line
beneath. No readable text — placeholder bars only. Chunky 32-bit era pixel art at a consistent
4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Grid cell cut-out** (1:1, 96×96): `a square bevelled cosmetic slot plate, 1-pixel #0b0f1a
stroke, 2-pixel #2a3550 frame, 1-pixel #4a5a7f top-left highlight, a recessed 1-pixel #0a0e18
inset well 12 pixels from each edge holding nothing, and a 1-pixel #2a3550 rail along the bottom
edge for a label`.

---

### SC-07 · End screen
**Use:** `#end-screen` — the moment the match ends. Currently the weakest screen in the game.
**Lane:** `Mockup` · 16:9 · 1920×1080.

```text
Pixel art game match-results screen, 16:9 widescreen, over the frozen game camera with a heavy
dark scrim. A wide centred panel, 1100 by 820 pixels, with a hazard-striped header band
and a bevelled steel frame. Header: a large winner announcement area with a 96-pixel trophy
glyph on the left and two placeholder lines; a 3-pixel gold rail runs beneath it. Body: a
standings table of five rows, each a 56-pixel-tall list row with a 40-pixel rank plate on the
left, a name placeholder bar, three numeric columns for score, kills and deaths, and a small
team-colour rail on the left edge; the local player's row is outlined in cyan with a 4-pixel
cyan marker bar. Footer: two buttons side by side, the left one primary cyan and the right one
secondary. No readable text, no numbers. Chunky 32-bit era pixel art at a consistent 4x pixel
pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a results screen that fades the arena to black. Keep the arena visible behind a
dither scrim — players want to see where they died, and the scrim prevents the old
“standings bleeding through the menu” bug from returning.

---

### SC-08 · Standings row
**Use:** `#end-standings` rows and the in-match standings overlay.
**Lane:** `Cut-out` · 10:1 · 800×80 logical, four states stacked.

```text
Pixel art game scoreboard row in four states stacked vertically, each 800 by 80 logical pixels,
10-pixel gaps, viewed straight on. Same geometry in all four: a flat band with a 1-pixel #2a3550
bottom rule, a 56-pixel rank plate on the left with a bevelled #2a3550 frame, a 4-pixel team
rail on the far left, and three 64-pixel numeric slots right-aligned. State 1, normal: team rail
cyan, rank plate plain. State 2, local player: 1-pixel #00E5FF outline around the whole row, the
rank plate filled with a dithered cyan wash, a 4-pixel cyan marker bar at the left end. State 3,
leader: rank plate carries a #eab308 12-pixel crown notch instead of a digit. State 4, dead:
row dithered 50 percent toward #0b0f1a and the team rail drops to #2a3550. No text, no numbers.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** row states that change height. See CH-14; this is the same trap with more columns.

---

### SC-09 · Winner banner
**Use:** `#end-winner` — the “McKay wins” line.
**Lane:** `Cut-out` · 6:1 · 768×128 logical.

```text
Pixel art game winner banner, empty, 768 by 128 logical pixels, viewed straight on. A
ceremonial plate: 4-pixel #2a3550 frame, 1-pixel #0b0f1a outer stroke, interior filled with a
dithered wash of #eab308 over #16213a at low density, a 3-pixel gold rail along the top edge and
a 3-pixel cyan rail along the bottom edge, and two 16-pixel #eab308 laurel-bracket ornaments
flanking the empty centre. A 96-pixel trophy silhouette well sits at the left end, recessed
with a 1-pixel #0a0e18 shadow. No text, no letters. Chunky 32-bit era pixel art at 8x pixel
pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Defeat variant:** replace gold with `#FF6B35` and the laurels with `two 16-pixel broken-plate
notches`.

---

### SC-10 · Connecting / online states
**Use:** online play handshake, room join, reconnect. Today these are bare toasts.
**Lane:** `Mockup` (small, centred) · 16:9 · 1920×1080 with a centred card.

```text
Pixel art game online-connection overlay, 16:9 widescreen over a dimmed arena. Dead centre, a
compact panel 560 by 320 pixels with a bevelled steel frame and a 3-pixel cyan rail along the
bottom edge. Inside: a 64-pixel square status well at the top centre holding three stacked
chevrons, a placeholder title bar, a thin indeterminate progress track 320 by 8 pixels with a
dithered cyan segment, and a small secondary cancel button at the bottom right. A faint
dithered cyan halo ring surrounds the panel. No text, no numbers. Chunky 32-bit era pixel art
at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Error variant:** `the rail and halo turn #ef4444, the status well holds a 32-pixel X, and a
retry button replaces cancel`.
**Avoid:** a modal that blocks the whole screen with a solid scrim. Online failures must leave
the menu usable.

---

### SC-11 · No-JS / hard-failure fallback
**Use:** `#noscript` and the “canvas stayed black” state.
**Lane:** `Mockup` · 16:9 · 1920×1080.

```text
Pixel art game error fallback screen, 16:9 widescreen, completely static. A near-black #0b0f1a
field with a single centred panel 720 by 360 pixels: bevelled #2a3550 frame, 1-pixel #0b0f1a
stroke, a 3-pixel #FF6B35 rail along the top edge, a 48-pixel broken-plate glyph at the top
centre in #FF6B35, two placeholder text lines beneath it, and a 24-pixel hint line in a dimmer
tone at the bottom. No background art, no animation hints. Chunky 32-bit era pixel art at a
consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no watermark, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Note:** this must be CSS-only art (background image + no JS), because the whole point is that
scripting is dead. Ship it as one PNG, not an atlas lookup.

---

## Panel skeleton contract

Every panel in this chapter is built from the same five parts, and the generated mockups exist
to validate this contract, not to be sliced:

| Part | Element | Prompt |
|---|---|---|
| Plate | `.sl-panel` | CH-01 / CH-02 |
| Head | `.panel-head` + `.panel-close` | CH-16, CH-05 |
| Body rows | CH-14 | CH-14 |
| Backdrop | the overlay root's own `background` (`--color-veil`) | none — CSS colour only |
| Primary action | one, at the bottom | CH-04 (full) / CH-03 (narrow) |

If a mockup shows a panel without a scrim, a header rail or a single obvious primary action, the
mockup is wrong regardless of how good it looks.
