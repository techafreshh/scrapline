# World parity vs HU-01 (issue #403)

Mid-match screen dressing, character, and effect density pass against the
`docs/ui-prompts/results/HU-01-hud-v1.jpg` composition target. Side-by-side:
open each capture below next to HU-01 at the same size; the table at the
bottom records what matches and what remains.

## Captures (1280x720, live fire + jetpack burn)

| theme | capture | probes at capture |
|---|---|---|
| kilima | [`world-parity-403-kilima-1280x720.png`](./world-parity-403-kilima-1280x720.png) | decor=130, particles=136, tracers=1, flame=local+bot, fps=35.2 |
| dune | [`world-parity-403-dune-1280x720.png`](./world-parity-403-dune-1280x720.png) | decor=131, particles=53, tracers=1, flame=local, fps=32.5 |
| frostbite | [`world-parity-403-frostbite-1280x720.png`](./world-parity-403-frostbite-1280x720.png) | decor=186, particles=110, tracers=1, flame=local, fps=30.7 |

Cumulative emitter counts at capture prove the full combat loop fired on
every theme (kilima muzzle=50/impact=60/trail=160, dune 60/60/45,
frostbite 50/50/305). Regenerate with
`node scripts/capture-world-parity.mjs` (holds fire at canvas center plus
a Space jetpack burn, then asserts density, live fx, flame, and fps before
accepting each frame).

## Per-screen prop count before / after

Before: 3 static rects per theme plus the seeded scatter band
`40 + floor(rng * 81)` = 40-120, i.e. **43-123 decorations per screen**,
drawn from 3-4 micro kinds (`grass-tuft` on kilima only; `rock`, `valve`,
`antenna` everywhere). The pre-change look is on record in
[`themes/`](./themes) (`kilima.png`, `dune.png`, `frostbite.png`).

After: **7 static terrain-edge rects per theme** (foliage clusters,
hanging vines, and a second sandbag line added to the verified-empty sky
bands) plus the raised scatter band `90 + floor(rng * 91)` = 90-180 from
5-6 micro kinds (`foliage` and `vines` join every theme's pool):

| theme | before (formula) | after, probe seeds 123/0/1/999 | after, capture |
|---|---|---|---|
| kilima | 43-123 | 133-181 | 130 |
| dune | 43-123 | 105-180 | 131 |
| frostbite | 43-123 | 120-177 | 186 |

Every sampled seed on every theme mixes `foliage` and `vines` into the
scatter (asserted in `packages/client/test/world-parity.test.ts`), zero
rects intersect `#` solid tiles, and the 15-200 / 203 acceptance bands
still hold (observed max 187 combined).

## What matches HU-01 now

- **Arena dressing density.** Foliage blobs, vine strands, antenna
  crosses, crates, and barrels fill the terrain edges on all three themes
  (see the top bands of the dune/frostbite captures); the pre-change
  isolated-tufts look in `themes/` is gone.
- **Character presence.** Airborne non-jetting soldiers dangle on the
  committed `soldier.fall` card (new `fall` frame, below tuck/crouch/dead
  in priority); the 4-frame run cycle, jet tuck, and roster tints are
  unchanged. The jetpack burns the committed `particle-pack` flame cards
  (`fx.flame.0/1`, alternating every 6 ticks) over the vector flame on
  canvas2d and through the Pixi jet-trail roulette on WebGL.
- **Effect density.** Pooled emission raised to mockup density: muzzle
  6->10, impact 6->10, static sparks 6->10 per hit, jet exhaust 3->5 per
  frame (Pixi one-shot waves match). Captures show live tracers, pooled
  particle fields, and jet trails; cumulative emitter counts are >0 for
  muzzle, impact, and trail on every theme.
- **Kill-feed rows.** Styled name-bar + weapon-icon + coloured-segment
  rows (covered by #394) read in the dune/frostbite captures.
- **fps floor.** 35.2 / 32.5 / 30.7 fps at 1280x720 under fire, all above
  the 30 floor; the 512-particle pool cap and the 412-ember emitter-cap
  sum are untouched, and dressing is static geometry (no per-frame cost).
- **No #393 regression.** Dressing is world-space rects painted behind
  the tiles (`DECOR_Z`, occlusion-free by construction); no new
  screen-space labels were added.

## What remains (out of scope for this pass)

- HU-01 is a dark, moody jungle-industrial backdrop; the live themes keep
  their brighter flat backdrops (backdrop art is a separate pass).
- Live dressing scatters over free tiles; HU-01 drapes foliage from
  platform edges. Edge-anchoring was deliberately not done: the free-tile
  rejection sampler is what keeps the zero-occlusion guarantee cheap.
- Live soldiers read smaller on screen than HU-01's chunky sprites; the
  camera zoom was left alone so the HUD scale work (#380) does not regress.
- Foliage/vines are vector paint in the existing decor palette, not
  vendor sprites (cc0-only, no-new-art constraint).
- Bots keep the hurt-card mapping for `fall` (their `<set>.fall` is the
  flinch card); the dangle pose is soldier-only.
