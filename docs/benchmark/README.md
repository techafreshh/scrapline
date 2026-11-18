# Presentation benchmark references (#161)

Committed 1920x1080 reference captures for the side-by-side proof against
the live game. These are the implementer's own captures (no third-party
art), so they carry no manifest entry and do not count toward the 6 MB
dist asset budget. They are the single allowlisted exception to the
zero-image rule (see the skeleton zero-image walk, which cites #161).

## Capture protocol

Each reference is produced by the presentation verifier
(`npm run verify:presentation`) with Chromium at 1920x1080,
deviceScaleFactor 1:

- `menu.png` — menu scene after backing out of a finished match through
  the end-screen Menu affordance; asserts the Play vs bots affordances
  plus the map carousel with all three scene cards.
- `carousel.png` — close-up element capture of the map carousel on the
  same menu; asserts kilima/dune/frostbite cards render thumbnails.
- `midmatch-kilima.png` — mid-match on `?bots=1&tier=normal&map=kilima`
  while holding fire for ~2 s, then tapping `g` for a grenade: captured
  with the trigger still down, so the muzzle flash and tracer are live.
  Proves particles on fire/explosion (bright pixels within 24 px of the
  mapped muzzle), glow (static lights), readable name tags, and the
  ammo module text.
- `standings.png` — end screen after forcing the score limit; asserts
  the Winner callout plus one standings row per player.

## Side-by-side table

| reference | live counterpart | guard it proves |
|---|---|---|
| `menu.png` | `artifacts/menu.png` | menu scene + carousel at 1920x1080 |
| `carousel.png` | `artifacts/carousel.png` | carousel close-up renders |
| `midmatch-kilima.png` | `artifacts/midmatch-kilima.png` | muzzle flash within 24 px, glow, tags, ammo text, fps mean >= 30 |
| `standings.png` | `artifacts/standings.png` | Winner callout + standings rows |

Regeneration: run `npm run verify:presentation`, eyeball the fresh
frames in `artifacts/` for the same-class-as-reference bar (soldiers,
themed terrain, glow, particles, full HUD), then copy the four files
over these names and confirm `npm run verify:benchmark` stays green.

## Theme cohesion captures (#205)

One committed 1920x1080 capture per map under `docs/benchmark/themes/`
(the single `themes/` exception to the zero-image rule alongside the
references above). Each frame is a settled mid-match capture proving
the map still renders its own cohesion at review time:

| capture | map entry | guard it proves |
|---|---|---|
| `docs/benchmark/themes/kilima.png` | `?bots=1&tier=normal&map=kilima` | dusk savanna (sun disc, acacias, birds) at 1920x1080, >50KB |
| `docs/benchmark/themes/dune.png` | `?bots=1&tier=normal&map=dune` | golden-hour desert (dune ridges, chimneys) at 1920x1080, >50KB |
| `docs/benchmark/themes/frostbite.png` | `?bots=1&tier=normal&map=frostbite` | polar night (aurora, antennas, snow) at 1920x1080, >50KB |

Regeneration: run `npm run capture:themes`, eyeball the three frames
for distinct themed mid-match gameplay (terrain, decor, HUD), then
confirm `node --test tests/cohesion.test.js` stays green.

Cohesion rule: the rendered layers mirrored at `window.__game`
(`backdropLayers`) must be a subset of the theme declaration
(`THEME_BACKDROP_LAYERS` in `packages/client/src/view/theme.ts`). Any
rendered layer the theme does not declare — e.g. a reintroduced `city`
silhouette — fails the checklist (`tests/cohesion.test.js`) and the
live capture gate (`scripts/capture-themes.mjs` via
`scripts/cohesion-check.mjs`).

## Milestone closeout (#219)

Single green proof that every milestone leg stays green together:

- `npm test` — full suite including `tests/milestone-closeout.test.js`
  (theme-capture inventory, menu live-DOM ids, built-bundle mirrors,
  WebAudio/quality/fps-mirror/codec/netcode source-shape pins, and the
  test-inventory pin) plus `tests/cohesion.test.js` (all three theme
  captures at exactly 1920x1080, every pair > 5 % histogram-distinct).
  Budget: whole suite green in under 120 s.
- `npm run probe:online` — headless two-client smoke
  (`scripts/probes/online-two-client.mjs`): one snapshot carrying both
  pids within 2 s, bogus-session 4002, malformed close, double-join
  error with a still-usable socket, 2 MB payload closing 1009.
- `npm run probe:online:tabs` — browser two-tab leg
  (`scripts/probes/online-two-tab.mjs`, reference runner only,
  skip-green without Chromium): two 1920x1080 tabs click `#play-online`,
  share one room with a remote row and a growing snapshot feed within
  2 s, hold 10 s of connected/remote/growing feed with
  `interpDelayMs === 100`, then sample `__game.fps` for 60 s.
- `npm run capture:themes` — regenerates the three captures under
  `docs/benchmark/themes/` (`scripts/capture-themes.mjs`).
- `npm run verify:presentation` — regenerates the `artifacts/` captures
  and `verify.json` (`scripts/verify-presentation.mjs`).

Regeneration protocol: run `npm run capture:themes`, eyeball the three
fresh frames for distinct themed mid-match gameplay (terrain, decor,
HUD), copy them over the committed captures, then confirm
`node --test tests/cohesion.test.js` and `npm run verify:benchmark`
stay green.

Fps rule: quality `high` (the default), frostbite entry, 60 s sampled at
500 ms from `window.__game.fps` — the mean must read >= 50 while every
sample sees a live ambient bed (`ambientCount > 0`, frostbite snowfall),
plus the kilima spot-check (`ambientBirdCount > 0` within 5 s).

## Sprite verification (#272)

Side-by-side proof that sprite captures read at least as detailed as
the references above: the sprite verifier regenerates twelve committed
frames under the captures directory (six scenes at 1920x1080 and
1280x720) and gates every frame at or above its mapped reference
below. Menu frames map to the menu reference; standings frames to the
standings reference; kilima run and HUD frames to the midmatch-kilima
reference; dune jet frames to the dune theme capture; frostbite
particle frames to the frostbite theme capture.

Regeneration: run npm run verify:sprites, eyeball the fresh frames for
sprite soldiers (run cycle, jetting), themed tilesets, fire and
explosion particles, HUD chrome, and standings, then confirm the capture
inventory gate stays green.
