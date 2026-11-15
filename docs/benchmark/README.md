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
