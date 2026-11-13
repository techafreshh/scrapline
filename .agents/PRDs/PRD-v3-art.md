# PRD v3: Scrapline Art & Presentation Milestone

**Goal**: replace the rectangle world with characters and maps that read like a real jetpack shooter — plus fix the fullscreen bug. Same hard constraint as v2: `packages/core` stays pure/deterministic; all rendering work lives in `packages/client` (PixiJS v8), drawing **programmatically** (Graphics / generated textures) so the repo keeps zero binary asset files.

**Starting point (v2 merged)**: real tile geometry on 3 maps, tracers/shake/zoom/audio, setup + standings screens. Players render as flat colored rects (with a small barrel line); tiles are single-tone blocks; canvas is hardcoded 640×360 and the fullscreen API is never invoked.

---

## F. Fullscreen & responsive canvas (bug — user-reported)

- **F1. Responsive canvas scaling.** The game canvas (backing store 640×360, no CSS sizing) must scale to fill the window while preserving the world aspect: set CSS size on resize (letterbox-fit or fill with camera-aware crop), keep the HUD DOM layer aligned, handle devicePixelRatio for crisp rendering, and re-run on `resize`/`orientationchange`. A browser F11 (or any window shape) must yield a correctly scaled, unclipped game.
- **F2. In-game fullscreen toggle.** A Settings entry + `F` key calls `requestFullscreen()`/`exitFullscreen()` on the game root; persist the preference; show the current state in Settings. Guard the autoplay/audio context on the gesture.

## C. Character art

- **C1. Character sprite system.** Replace the flat rect with a composed vector character: body, head, visor/face, two arms holding the current weapon (barrel from the weapon tip so tracers/muzzle align), two legs. Enemy color families stay warm, player cyan; silhouette must read at 26×58 px and at 0.64 zoom.
- **C2. Animation states.** Run cycle (leg swing by speed), jet pose (legs tucked, flame from pack — replaces the current flicker rect), crouch pose, hurt flash, death burst pose, spawn-in blink. Driven from existing sim state (vx, onGround, jetting, crouching) — no core changes.
- **C3. Cosmetics-lite.** Per-player picks persisted in localStorage: helmet style (cap/beret/hood/bandana), visor type, and a palette from the reference's accent set. Enemies get randomized combos so bots look distinct. Setup screen shows your picks next to Start.

## M. Map art

- **M1. Themed tileset system.** Per-theme tile rendering (top surface highlight, edge shading, depth tint) replacing single-tone blocks; one-way platforms and bounce pads get distinct shapes; backwall layer (`:` tiles) rendered darker behind open interiors like the reference.
- **M2. Per-map dressing.** kilima = outpost (sandbags, antenna mast, watchtower silhouette), dune = refinery (pipes, vats, catwalk rails), frostbite = station (ice sheen, antenna dishes, warm window lights). Decorations are drawn from map def metadata (new deterministic decorations array in map files — pure data, core just carries it) and must never occlude gameplay tiles.
- **M3. Atmosphere.** Per-theme background (gradient sky/backdrop band above the playfield), subtle vignette; frostbite gets cold-blue grade, dune warm, kilima neutral. Lighting respects the existing lights/decoration fields if present.

## V. Verification

- **V1. Presentation verification lap.** In-box browser captures at 1920×1080 and 1280×720: menu, setup, mid-match showing characters with weapons/legs and themed tiles, fullscreen toggle on/off, standings. Assert canvas CSS scales with window (resize eval check) and no probe from earlier milestones regresses. fps guardrail test still green.

**Acceptance (milestone level)**
- [ ] F11/`F` fullscreen plays correctly at any window size (F1, F2)
- [ ] A screenshot mid-match shows characters with heads/arms/legs/weapon and three visibly distinct themed maps (C1–C3, M1–M3)
- [ ] Zero binary assets added; `core` purity tests green; runtime scenario ALL GREEN

**Out of scope**: online play, progression/economy, sprite-sheet assets, music.
