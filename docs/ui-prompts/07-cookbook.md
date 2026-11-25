# 07 · Cookbook — modifiers, platforms, failure modes

The prompts in this pack are starting points, not final answers. This chapter is the vocabulary
for fixing them.

---

## 1. Modifier library

Append one or two — never five. Every added phrase dilutes the rest.

**Pixel discipline**

- `each logical pixel is a crisp 8-pixel square block` — the single most useful phrase; without
  it you get "pixel-art style" smoothness.
- `no anti-aliasing, no sub-pixel edges, no feathering`
- `shade only with 1-bit dithering, never with smooth gradients`
- `hard 90-degree steps, no diagonal smoothing`
- `readable as a silhouette at one quarter size`

**Material and craft**

- `brushed steel with 1-pixel horizontal grain lines`
- `welded seams and 2-pixel rivets at the joints`
- `chipped paint revealing bare metal at the corners`
- `hazard-striped edge banding, 45 degrees, 4-pixel stripes`
- `glass-like smoked panel, dithered rather than transparent`

**Depth without gradients**

- `recessed: shadow on the top and left inner edges, highlight on the bottom and right`
- `raised: highlight on the top and left, shadow on the bottom and right`
- `1-pixel near-black keyline around the whole object`
- `2-pixel pale edge light on the top surface only`

**Composition**

- `the object fills 80 percent of the frame with even margins`
- `symmetric on the vertical axis`
- `flat orthographic front view, camera perfectly level`
- `nothing overlapping, nothing cropped`

**Restraint (use these when output looks AI-generic)**

- `restrained: three tones plus one accent colour only`
- `no glow, no bloom, no lens flare`
- `no decorative filigree, no gemstones, no sci-fi circles`
- `functional industrial design, not fantasy ornament`

That last one matters. Default model taste for "game UI" is glossy fantasy sci-fi with orbiting
rings and hexagons. Scrapline is salvage: plates, bolts, stencils.

---

## 2. Google-specific notes

### AI Studio / Gemini image (Nano Banana)

- **Conversational editing beats re-prompting.** Generate once, then say: `keep everything
  identical, only make the bevel 2 pixels deeper`. This is far more reliable than a fresh prompt
  and it preserves the pixel pitch.
- **Attach references.** `Match the construction and palette of the reference image exactly;
  only change the subject to a shotgun icon.` The chrome sheet (SH-01) is the reference for
  everything.
- **No negative-prompt field.** Phrase exclusions as instructions: `the background is flat
  #FF00FF with nothing on it` works better than `no shadows`.
- **Aspect in words.** `a square image`, `a 16:9 widescreen image`. There is no `--ar`.
- **Ask for the grid, not the collage.** "Specimen sheet, strict grid, 20 px margins" is
  followed well; "a collection of UI elements" produces overlap.
- **Iterate in the same thread** for a family, so tone stays locked. Start a new thread for a
  different family.

### Flow

Flow is a film tool. Use it only if you want motion — a menu backdrop with drifting dust, a
flame loop.

- Generate the still frame first, then animate.
- Add `static frame, no camera motion, no cuts`.
- Export the **first frame** as the still; never ship the video. We render in real time and a
  video texture costs 10–40 MB against a 6 MB budget.
- For the flame loop specifically: `a seamless loop of the same flame cycle, four distinct
  poses`, and then cut four frames by hand. Flow will not give you an exact four-frame cycle.

### Other platforms (brief)

If you paste these into something else:

| Platform | Change |
|---|---|
| Midjourney | append `--ar 1:1 --style raw --no text, letters, watermark, blur`; use `--tile` for repeating surfaces; `--s 50` to reduce stylisation |
| DALL·E / GPT-image | keep the prompt but lead with the layout: "A single image containing a 6 by 4 grid of…"; it follows structure better than style |
| Stable Diffusion / Flux | move the palette and pixel-grid sentences into the negative prompt; use a pixel-art LoRA, not just prompt words |

---

## 3. Failure modes and what to change

| What you see | Cause | Fix |
|---|---|---|
| Smooth, painted, "AI art" look | no pixel lock, or the model ignored it | add `each logical pixel is a crisp 8-pixel square block` at the **start** of the prompt, not the end |
| Colours drift outside the palette | palette listed once, late | restate the hex list in the first third of the prompt and again at the end |
| Colours are right but muddy/greyish | quantisation happened before chroma key | key first, quantise second; never quantise against magenta |
| Text appears unbidden | "button", "panel" pull labels | add `empty, no text, no lettering` immediately after the noun, and again at the end |
| Perspective creeps in (top face visible) | "3D", "isometric", "bevel" alone | add `flat orthographic front view, camera perfectly level, no top face visible` |
| Pieces overlap on a sheet | no grid contract | use the specimen-sheet preamble from chapter 06 verbatim |
| Pixel blocks are 7 or 9 px | model scale drift | re-roll. Retouching inconsistent pitch costs more than a new generation |
| Missing pieces from a sheet | too many objects | split into two sheets, use the first as a reference image |
| Great panel, wrong bevel depth vs other pieces | separate generations | attach the accepted piece as reference and say `match this construction exactly` |
| Transparent background arrives with a painted checkerboard | asked for transparency | ask for flat `#FF00FF` and key it yourself |
| Inner shadow eats the centre, so 9-slice stretching looks blotchy | decorative detail inside the frame | regenerate with `completely flat, empty, tile-safe interior with no rivets and no noise` |
| Frame is symmetric so the 9-slice seam shows at the top-right | mirrored corners | ask for `rotationally identical corners, light always on the top-left, shadow always on the bottom-right` |
| Glow halo bakes a coloured fringe into the cut | glow requires alpha | remove the glow from the art; glow is a CSS `box-shadow` / Pixi `GlowFilter`, not pixels |
| Icons in one sheet have different stroke weights | mixed families | split into one sheet per family and attach a reference |

---

## 4. Iteration protocol

1. **Generate four.** Same prompt, four times. Pixel art is a lottery; four samples usually
   contain one usable composition.
2. **Judge at 1×.** Downscale to the exact final size, view at 100 % zoom on `#0b0f1a`. Anything
   that only looks good at 800 % is not usable.
3. **Pick, then edit conversationally.** One structural fix per turn. If a second structural fix
   is needed, the generation is wrong — start again.
4. **Stop after six.** If six generations haven't produced something usable, the prompt is
   wrong, not the model. Re-read the failure table, change one variable, try six more.
5. **Record the prompt.** The accepted file's PR description carries the prompt text, the model,
   and the variant number. Without it the asset is unreproducible and untweakable.

**The stop rule matters.** Generated UI has a long tail of "almost" and a short window where
more attempts help. Hand-fixing a near-miss at 8× for ten minutes usually beats another twenty
generations — especially for bevels, outlines and palette drift, which are mechanical fixes.

---

## 5. Prompt upgrader

Before sending any prompt from this pack, check it has all seven:

1. **Noun first, clearly.** `Pixel art game UI panel` — the model classifies from the first five
   words.
2. **Logical size in pixels.** `128 by 128 logical pixels`. Not "large".
3. **Material.** Steel, glass, hazard tape. Without material, the model invents glossy plastic.
4. **Lighting model.** `flat front lighting` or `light from the top left`. Without it you get
   ambient occlusion mush.
5. **Structural description in reading order.** Top edge, then left edge, then interior.
6. **Explicit emptiness.** `empty, no text, no icons, no numbers`.
7. **The three locks.** Palette, pixel grid, chroma background.

If a prompt is missing 2, 4 or 6, that's usually the reason the output looks generic.

---

## 6. What to generate first

A suggested order, cheapest value first:

1. **SH-01 chrome sheet** — replaces every panel, button, bar, chip and field. One generation,
   game-wide effect.
2. **IC-01 weapon icons** — the ammo module and kill feed are on screen constantly.
3. **HU-01 HUD mockup** — tells you whether the corner-cluster composition works at all before
   you generate twelve individual modules.
4. **ME-01 menu mockup + ME-02 wordmark** — the first thing anyone sees.
5. **SC-07 end screen mockup** — currently the weakest moment in the product.
6. **SH-03 icon sheets** — consistency polish.
7. Everything else, as needed.

Do not start with the wordmark. It's the most seductive prompt in the pack and the least
consequential: a bad menu with a great logo still reads as a bad menu.

---

## 7. Field notes — first run in Google Flow (24 Nov)

What actually happened when the pack was driven through Flow's agent UI, so the next run skips
these.

**Setup that worked**

- Flow's project agent uses the project's *Image defaults* — model, aspect, output count and
  quality. Set them in **Agent settings → Image defaults** before prompting: Nano Banana 2.1,
  aspect per batch (1:1 for components, 16:9 for screens), **x2 outputs**, **High** quality.
  "Nano Banana Pro" would not select (unavailable or gated on this membership); 2.1 was more
  than good enough.
- One prompt per message. Pasting a batch makes the agent merge requests into one generation.
- Changing aspect is a settings trip per batch, so **group generations by aspect**.

**Export reality**

- Flow downloads **1K original as `.jpg`**. There is no PNG and no alpha in the download menu
  (1K original / 2K upscaled / 4K gated). The quantise + chroma-key step is therefore mandatory,
  not optional — JPEG artefacts live in the magenta field and along every outline.
- Chrome on this machine saves to the folder set in `chrome://settings/downloads`, which was
  **not** `Downloads` here. Locate the newest `.jpg` by mtime rather than assuming a path.
- Downloads are named from the prompt (`Pixel_art_game_UI_chrome_<hash>.jpg`), which is a
  usable trace back to the prompt that produced them.

**Prompt behaviours observed**

- **Dither over chroma bleeds.** Asking for a "checkerboard dither" over a `#FF00FF` field
  produced purple pixels inside two bars — the model averaged the surface tone with the
  background. Fix: name both dither colours explicitly *and* say `dither only #0b0f1a over
  #16213a, never over the background colour`.
- **Counts drift.** IC-01 asked for six weapons and returned seven (the sniper twice) and a
  3-2-2 arrangement instead of 3×2. Say `exactly twelve objects, no duplicates, equal cell
  sizes` and check the count before downloading.
- **Text still appears in mockups** even with "no readable text" — timers, `WEAPON-NAME`,
  gibberish kill-feed names. It is fine in a mockup (it conveys hierarchy) and fatal in an
  asset. Keep the asset lock.
- **Palette drift is small but real**: brown wood grips and olive warheads appeared in IC-01.
  Quantising to the twelve colours fixes it; if the brown is load-bearing, add it as a token
  rather than regenerating.

**Agent tab behaviour**

- Agent tabs in Flow were found closed twice within minutes despite `keepOpen`. Reopen with the
  project URL — all generated media persists server-side, so nothing is lost. Work in short
  bursts rather than leaving a tab idle between prompts.

**Verdict**

The quality is good enough to ship. The chrome sheet and HUD mockup both came back as coherent,
on-palette pixel art on the first attempt, and the HUD mockup matches the composition spec
closely enough to use as the acceptance reference. The remaining work is mechanical: crop,
quantise, key, pad, manifest.

---

## 8. Automation notes (batch run)

If you drive this in bulk rather than by hand, four things cost hours before they were obvious.

**The prompt is in the image's `alt` text.** Flow stores the generation prompt verbatim on each
result `<img>`. That is the only reliable way to find "this prompt's output":
`[role=group][aria-label="Media options gallery"] img[alt^="<prompt prefix>"]`. Every weaker
heuristic fails — see below.

**Why the weak heuristics fail**

| Approach | Failure |
|---|---|
| set-diff of image URLs | the chat **virtualises**; old images re-enter the DOM on reload and look new |
| last gallery in the DOM | renders a window, not the tail; and after an aspect switch the previous gallery is still mounted |
| count of result buttons | the editor view unmounts the gallery, so the count goes *down* |
| "Stop button disappeared" alone | fires between two generations, so the previous output looks like the new one |

**Verify by hash, not by hope.** Every export is md5'd against the existing set; a duplicate
means the wrong image was picked. This caught three silently mislabelled files that all looked
plausible in a file listing (`CH-08`=`SH-04`, `ME-05`=`IC-08`, `CH-16`=`CH-14`).

**Export through the DevTools bridge, not the UI.** Flow's download menu is a three-click dance
inside an editor route that the agent tab keeps losing. `fetch(url + "=s1024")` in the page,
base64 the blob, and read it back in ≤80k-character slices (eval results cap at 100k) is stable,
and `=s0` / `=s1024` both return the full-size asset while `=s512-rw` is the thumbnail.


