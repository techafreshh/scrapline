# 03 · Menu — the first ten seconds

The menu is the only surface every player sees, and the one we can't hide behind gameplay. It
also has a hard constraint the other screens don't: **it has to work at 1280×720 without
scrolling**, with a large CTA visible above the fold.

Layout target (`scripts/verify-ui.js` captures this view as *menu*):

```
┌────────────────────────────────────────────────────────────────────────┐
│  SCRAPLINE   ·  wordmark                                    [You   ▾]  │
│  ───────────────────────────────────────────────────────   [ Lv 1 ]    │
│                                                                        │
│   ┌──────────────────────┐     ┌──────────────────────────────────┐    │
│   │      QUICK PLAY      │     │  ARENA                           │    │
│   │ 3 bots·normal·25·5m  │     │  ◀  [ kilima ] [ dune ] [ frost ] ▶│   │
│   └──────────────────────┘     └──────────────────────────────────┘    │
│   ┌──────────────────────┐                                             │
│   │ ▎ Play vs bots       │           hero: soldier + jetpack flame     │
│   ├──────────────────────┤                                             │
│   │ ▎ Play online        │                                             │
│   ├──────────────────────┤                                             │
│   │ ▎ Challenges         │                                             │
│   ├──────────────────────┤                                             │
│   │ ▎ Locker             │                                             │
│   ├──────────────────────┤                                             │
│   │ ▎ Settings           │                                             │
│   ├──────────────────────┤                                             │
│   │ ▎ How to Play        │                                             │
│   └──────────────────────┘                                             │
│  ── tip strip ──────────────────────────────────────────────────────── │
└────────────────────────────────────────────────────────────────────────┘
```

---

### ME-01 · Menu mockup — the target
**Lane:** `Mockup` · 16:9 · 1920×1080.

```text
Pixel art game main menu mockup for a 2D jetpack arena shooter, 16:9 widescreen. A single tall
panel sits in the left third holding a big cyan primary button at the top and a stack of six
narrow secondary buttons beneath it. The centre-left keeps breathing room. On the right, a
horizontal arena carousel: three landscape cards, the middle one selected and lifted with a
cyan outline, with small arrow buttons at each end and a row of three dots beneath. A wordmark
sits top-left, a player row (avatar chip, name field, level badge) top-right. A full-width tip
strip runs along the bottom edge. The background is a dimmed pixel-art industrial-jungle arena
with parallax layers, darkened so the UI reads. Translucent navy panels, 1-pixel near-black
keylines, cyan accents, orange secondary highlights. No readable text — placeholder bars only.
Chunky 32-bit era pixel art at a consistent 4x pixel pitch.
16:9 game UI mockup, no readable words, no browser chrome, no device frame, no watermark,
palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444
#e8ecf4 #8a94a8 only.
```

**Avoid:** a menu centred in the middle of the screen with a blurry background. We use a
left-weighted composition so the carousel and hero art carry the right side.

---

### ME-02 · Wordmark
**Use:** the `SCRAPLINE` lockup, top-left of the menu and the loading screen.
**Lane:** `Cut-out` · 6:1 · 768×128 logical.
**Note:** the only prompt in this pack that *should* contain letters.

```text
Pixel art game logo wordmark reading SCRAPLINE in capital letters, 768 by 128 logical pixels,
viewed straight on. Heavy industrial stencil letterforms built from bevelled steel plates:
each letter is a #2a3550 slab with a 1-pixel #4a5a7f top-left highlight and a 3-pixel #0a0e18
bottom-right shadow, a 1-pixel #0b0f1a outline, and a 3-pixel cyan #00E5FF seam running through
the lower third of every glyph. The A and the I are slightly damaged — one chipped corner each
— to suggest salvage. Slight forward lean of 4 degrees, kerning tight, all letters the same
height, no tagline, no extra words, no subtitle. Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, strict pixel grid with hard edges, no anti-aliasing, no blur, no
gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635
#ef4444 #e8ecf4 #8a94a8 only.
```

**Reality check:** expect 6–10 attempts before the letterforms are all correct. Gemini is the
best of the current models at short all-caps words. Keep the attempts where only one glyph is
wrong and repair that glyph by hand at 8× — it's faster than re-rolling.
**Fallback:** Orbitron 700 (`DISPLAY_FONT_FAMILY`) at 40 px with a 2 px cyan shadow is the
current wordmark and is not embarrassing. Only ship generated lettering if it beats that.
**Ship as:** `assets/ui/wordmark.png`, 1×, used with a max-width and `image-rendering: pixelated`.

---

### ME-03 · Menu backdrop
**Use:** the dimmed arena behind the menu, one per theme (kilima / dune / frostbite).
**Lane:** `Mockup` (it's a scene, not a component) · 16:9 · 1920×1080, three variants.

```text
Pixel art game menu background scene, 16:9 widescreen, a derelict industrial-jungle arena at
dusk, viewed side-on with three parallax depth layers: a dark silhouette skyline of cranes and
pipes at the back, mid-ground scaffolding with hanging cables and a broken gantry, foreground
crates and foliage framing the bottom corners. Deep navy #0b0f1a sky with a dithered #16213a
horizon glow, a few 2-pixel #00E5FF indicator lights on the machinery, warm #FF6B35 rim light
from an off-screen source at the right. The whole scene is 40 percent darker than a gameplay
frame and has no characters, so UI can sit on top. Chunky 32-bit era pixel art at a consistent
4x pixel pitch.
No readable text, no logo, no watermark, no UI elements, palette #0b0f1a #16213a #2a3550
#4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Variants** (same composition, swap the three bolded elements):
- **dune** — `sandstone ruins and a rusted refinery, warm #eab308 haze, no foliage`
- **frostbite** — `frozen pipes and ice-crusted gantries, cold #a5f3fc rim light, snow dither`
**Ship as:** three Pixi atlas backdrops, already partly implemented in `view/backdrop.ts`. These
replace the generated *menu* layer only, not the gameplay layers.

---

### ME-04 · Arena card — three states
**Use:** `#map-carousel` cards. One per theme, each with default / selected / locked states.
**Lane:** `Cut-out` (frame) + `Mockup` (thumbnail inside it) · 16:9 · 384×216 logical.

```text
Pixel art game UI arena selection card frame, empty, 384 by 216 logical pixels, viewed
straight on. A bevelled landscape plate: 1-pixel #0b0f1a outer stroke, 3-pixel #2a3550 frame, a
2-pixel #4a5a7f highlight on the top and left, a 4-pixel #0a0e18 shadow on the bottom and right,
a flat #0b0f1a thumbnail well inset 8 pixels from the frame on all sides (the well will hold an
arena screenshot), a 3-pixel #00E5FF rail across the bottom edge inside the frame, and two
6-pixel corner brackets at the top corners. No text, no imagery inside the well. Chunky 32-bit
era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

| State | Add |
|---|---|
| selected | `the frame becomes #00E5FF, a 2-pixel #a5f3fc glow line runs inside it, and the card is 4 pixels taller with an additional bottom rail` |
| locked | `the frame and rail desaturate to #2a3550 only, a 16-pixel padlock silhouette in #2a3550 sits centred over the well, no cyan` |
| hover | `the frame shifts one step lighter to #4a5a7f and the bottom rail brightens` |

**Thumbnails** (fill the well, 16:9, 320×160): reuse ME-03 prompts with `no HUD, side-on arena
gameplay framing, brighter, 30 percent fewer background layers`.

---

### ME-05 · Carousel arrows + dots
**Use:** the `◀ ▶` affordances and page dots under the cards.
**Lane:** `Cut-out` · one prompt, 96×32 logical strip.

```text
Pixel art game UI carousel controls on one strip 96 by 32 logical pixels, viewed straight on.
Left: a 24-pixel square bevelled arrow button, #2a3550 frame, #4a5a7f top-left highlight,
containing a chunky 3-pixel #00E5FF left chevron. Centre: a 24-pixel square matching button with
a right chevron. Right: three 8-pixel page dots in a 24-pixel row, the first filled #00E5FF, the
other two empty with a 1-pixel #2a3550 outline. No text. Chunky 32-bit era pixel art at 8x
pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** chevrons drawn as smooth curves. Two 3 px steps per arm, four pixels total.

---

### ME-06 · Tip strip
**Use:** `#menu-tip` — one rotating line of advice along the bottom.
**Lane:** `Cut-out` · 20:1 · 960×48 logical.

```text
Pixel art game UI tip strip, empty, 960 by 48 logical pixels, viewed straight on. A low
translucent band spanning the width: 1-pixel #0b0f1a stroke top and bottom, a 50 percent
checkerboard dither of #0b0f1a over #16213a interior, a 40-pixel square inset icon well at the
left end framed by a 1-pixel #2a3550 divider, and a 4-pixel #00E5FF nub at the left end of the
well. Otherwise empty and flat so text can sit inside it. Chunky 32-bit era pixel art at 8x
pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a full-screen-width bar with heavy borders — at 48 px tall the frame eats the strip.

---

### ME-07 · Profile row
**Use:** `#profile-row` — avatar, name input, palette picker, level badge.
**Lane:** `Mockup` (it's a composition, not one object) · 4:1 · 768×192 logical.

```text
Pixel art game UI player profile row mockup, 768 by 192 logical pixels, viewed straight on.
Left to right: a 64-pixel square avatar plate with a bevelled #2a3550 frame and a recessed
#0b0f1a well holding a simple pixel-art soldier bust silhouette in cyan; a 256-by-32 text field
plate; a 160-by-32 dropdown plate with a chevron cavity; and a 96-by-32 level chip with a
3-pixel cyan nub and two 8-pixel star pips. All pieces share the same bevel grammar and sit on
one flat row with 16-pixel gaps over the menu background. No text, no numbers. Chunky 32-bit
era pixel art at 8x pixel pitch.
16:9 game UI mockup, no readable words, no watermark, no device frame, palette #0b0f1a #16213a
#2a3550 #4a5a7f #00E5FF #a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** the avatar getting more visual weight than the CTA. It's a settings row, not a
character select.

---

### ME-08 · Hero — soldier and jetpack
**Use:** the menu's right-side character art (`#menu-scene`, `#menu-soldier`, `#menu-flame`).
**Lane:** `Cut-out` · 1:2 · 256×512 logical.

```text
Pixel art game character hero art, 256 by 512 logical pixels, viewed side-on. A rugged
salvage soldier in a patched exosuit, standing three-quarter view facing right, helmet with a
slit visor glowing #00E5FF, shoulder pauldron with a welded #FF6B35 stripe, a compact jetpack on
the back venting a short hard-edged #FF6B35 flame downward, one hand resting on a slung rifle.
Heavy 1-pixel #0b0f1a outline around the whole silhouette, two-tone shading with 1-bit dither
on the metal, no soft gradients, no glow bleed. Chunky 32-bit era pixel art at 8x pixel pitch,
orthographic side view.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

**Avoid:** a detailed face. The visor is a slit and the character is 256 px tall on screen; a
rendered face turns into mush and reads as a different art style.
**Ship as:** `ui.hero.soldier`. The flame is animated by CSS/Pixi using HU-16, so ask for the
flame as a separate small strip if the model bakes a good one in — otherwise swap it out.

---

### ME-09 · Install / PWA banner
**Use:** the “install Scrapline” prompt (offline-first PWA).
**Lane:** `Cut-out` · 8:1 · 512×64 logical.

```text
Pixel art game UI install banner, empty, 512 by 64 logical pixels, viewed straight on. A wide
bevelled plate: 1-pixel #0b0f1a stroke, 2-pixel #2a3550 frame, 1-pixel #4a5a7f top-left
highlight, flat dithered #16213a interior, a 48-pixel square inset glyph well at the left end
holding a recessed #0b0f1a square with a 3-pixel #00E5FF down-arrow cavity, and a 96-by-32
button slot at the right end framed by a 1-pixel #2a3550 divider. No text, no letters.
Chunky 32-bit era pixel art at 8x pixel pitch.
Flat #FF00FF background, no text or lettering, strict pixel grid with hard edges,
no anti-aliasing, no blur, no gradients, palette #0b0f1a #16213a #2a3550 #4a5a7f #00E5FF
#a5f3fc #FF6B35 #eab308 #a3e635 #ef4444 #e8ecf4 #8a94a8 only.
```

---

## Assembly notes

- The menu is CSS grid: `grid-template-columns: minmax(280px, 34%) 1fr` with the panel column
  left and the carousel/hero column right. Generate to that ratio or the mockup will lie to you.
- `#menu` is `display: none` at boot because `main.ts` auto-joins a match. If you're comparing
  mockup to capture, force `document.getElementById('menu').style.display = ''` first, or you
  will be looking at the HUD.
- Title must be fully visible with `top >= 0` — `verify-ui.js` asserts this, and the F1
  regression (UI-pack tiling) was exactly a missing panel behind the title.
