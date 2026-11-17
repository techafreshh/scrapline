# PRD v6: Scrapline Sprite-Swap Milestone

**Goal**: replace the procedural vector art with real sprite art from the committed CC0 Kenney packs (`packages/client/assets/vendor/`), closing the last measurable gap to the reference (art depth, density, animation smoothness) while keeping the deterministic core untouched.

**Starting point (v5 merged)**: authoritative multiplayer via single combined server, meta systems, themed backdrops, ambient beds — all presentation is drawn procedurally; vendor packs are staged and licensed but unused.

**Constraints**: `packages/core` stays pure; assets are committed and never fetched during laps; shipped asset weight ≤ 6 MB (atlas + lazy loading, enforced by existing tests); LICENSES.md row required per used pack; all scenario contracts stay green.

---

## A. Asset ingestion

- **A1. Atlas pipeline.** Build-time step that reads `assets/vendor/*/PNG` + `Tilesheets`, emits PixiJS texture atlases (per family: characters, tiles per theme, particles, UI) plus a manifest mapping logical names → atlas frames (e.g. `soldier.run.3`, `tile.kilima.solid`, `fx.smoke.2`). Manifest validates: every frame referenced by renderer code exists; total atlas weight ≤ 6 MB.
- **A2. License compliance.** Every pack referenced in the manifest has its `LICENSES.md` row; test fails on vendor files used without a manifest row.

## B. Character swap (highest impact first)

- **B1. Soldier from `platformer-characters`.** Replace the composed-vector soldier with the pack's **Soldier** set (Poses + Limbs): idle, run cycle, jet pose, crouch, hurt, death frames; limb pieces keep arm-aim (weapon barrel anchored to the arm, tracers/muzzle aligned as in v4). Per-player tinting maps the pack's palette to the roster colors (cyan player, warm enemies) while keeping outlines.
- **B2. Weapon sprites in hand.** In-hand weapon silhouettes per weapon id (pistol/smg/rifle/shotgun/sniper/rocket) drawn or adapted from pack pieces, muzzle point exported in the manifest so particles/tracers originate correctly.
- **B3. Bot variety.** Bots use the pack's other sets (Adventurer/Zombie/Player/Female variants) tinted per roster color — distinct silhouettes per bot like the reference's varied soldiers.

## C. World swap

- **C1. Themed tilesets.** Map tiles render from `pixel-platformer` (+ `industrial expansion` for dune/frostbite) over the ASCII core 1:1 (32 px), theme-mapped per map; platform one-way and bounce tiles keep distinct shapes; backwall layers use the pack's interior tiles darkened.
- **C2. Props + pickups as sprites.** Crates, barrels, weapon pads, health/grenade pads, bounce pads from pack sprites with the existing states (crack/explosion squash) and labels/glow retained.
- **C3. Cohesion retint.** A single palette pass aligns pack sprites with each theme's backdrop/grade (kilima warm dusk, dune golden, frostbite cold) — no mismatched hue zones (the v4 audit test must stay green).

## D. Effects + UI swap

- **D1. Particle textures.** `pixi-v8-particle-emitter` emitters consume `particle-pack` textures: muzzle flash, impact sparks (surface-tinted), explosion (flash + smoke + debris), jet exhaust trail, death burst, pickup sparkle. Existing event-driven emitters stay; textures swap.
- **D2. UI chrome.** HUD frame (health bar, ammo module), menu buttons/panels from `ui-pack-pixel-adventure` (pixel style); bitmap HUD numbers retained; kill feed weapon icons from the weapon sprites (B2).
- **D3. Loading + budget.** Atlas families load behind the existing loading screen; verify ≤ 6 MB and the fps guardrail (≥ 55 fps at 1920×1080, ambient high, 3 bots).

## V. Verification

- **V1. Sprite-swap verification lap.** agent-browser captures at 1920×1080 + 1280×720: menu (chrome), mid-match showing sprite soldiers running/jetting, themed tilesets on all three maps, particles on fire/explosion, HUD chrome, standings. Side-by-side against `docs/benchmark/` — the sprite version must read *at least as detailed* as the vector version in every capture. All prior probes green.

**Acceptance (milestone level)**
- [ ] In-match captures show pack sprites for soldiers/tiles/props/particles/UI with cohesive palette
- [ ] Bundle + atlases ≤ 6 MB; fps guardrail green; determinism/purity + all scenario contracts green
- [ ] `LICENSES.md` complete; zero non-CC0 files

**Out of scope**: online deployment, phone controller, spectate, music changes.
