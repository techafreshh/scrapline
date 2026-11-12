# PRD v2: Scrapline Feel-Parity Milestone

**Goal**: make Scrapline *recognizably* a Skyscrap-class jetpack shooter to a player in the first 30 seconds — art, maps, game feel, sound, and complete UI flow — while preserving the deterministic core and the RL env.

**Current state (post-MVP, all merged)**: playable FFA vs 3 bots; deterministic 60 Hz core (world, map, weapons, match, replay); utility-AI bots with 4 tiers; headless env-server + gymnasium + PPO scripts; runtime scenario ALL GREEN on main. Presentation is placeholder: flat rectangles, sparse map, one-button menu, no end screen.

**Hard constraint**: `packages/core` stays pure and deterministic (no DOM/PixiJS/audio imports; seeded RNG only). All work in this milestone touches `packages/client`, map content files, and (where an API addition is unavoidable) `core` via small, tested, deterministic extensions. Existing runtime scenario probes must stay green after every issue.

---

## 1. Bug fixes (play-verified defects)

- **B1. No match-end screen.** When a match ends (timer or score limit) the client silently returns to the menu with no winner display or standings table. Expected: a results overlay listing final standings (kills/deaths per player, winner highlighted), then "Play again" and "Menu" buttons. The match state already carries `standings()` — surface it.
- **B2. No match setup.** "Play vs bots" jumps straight into a hardcoded match. Expected: a pre-match setup screen offering bot count (1–7), difficulty tier (easy/normal/hard/elite), and map (kilima/dune/frostbite), persisted to localStorage like the settings keys in the reference design.
- **B3. Threat readability.** Enemy players render as flat orange rects with no facing or aim cue. Expected: enemies show a weapon/facing indicator (a short barrel line from the body toward their aim angle) so a player can read who is about to shoot.
- **B4. Barren world.** Across minutes of roaming, no pickups, props, or platforms were ever visible. Audit the three maps' pickup/prop/platform markers: verify they materialize (the pickup-materialization fix already merged), that they sit in reachable positions, and that the default camera view (viewport ~1450×850 world px) actually encounters them during normal roaming. Add a test asserting each map has ≥ 8 pickups, ≥ 4 props, and ≥ 10 platform tiles inside the spawn-connected region.

## 2. Map geometry pass

Rebuild the three shipped maps (kilima, dune, frostbite) as real jetpack-shooter arenas in the ASCII rows format, inspired by the reference game's structure (32 px tiles; ROCK walls, one-way PLATFORM rows, BOUNCE pads; 12 spawn points spread across the arena; weapon pads for rifle/shotgun/sniper/rocket; health + grenade pads; barrels/crates for cover):
- Vertical play: towers, catwalks, overhangs — the jetpack must matter (routes only reachable by jet).
- Horizontal cover: walls and crates breaking sightlines between the 12 spawns.
- Each map keeps a distinct silhouette (e.g. kilima = outpost with central tower; dune = refinery with pipes and vats; frostbite = station with long sightlines).
- Validation test (extends B4's): every spawn reaches every pickup without leaving the solid-connected region; no spawn inside a wall.

## 3. Game-feel ("juice") pass

All in the client renderer, driven by the existing sim event stream (shot/damage/kill/hop/land/bounce events already flow):
- **Tracers**: hitscan shots draw brief fading line tracers from muzzle to hit point (event carries origin + aim).
- **Muzzle flash**: 1–2 frame flash at muzzle on shot events.
- **Hit feedback**: damage events spawn small sparks at the hit position; a hit marker on the player's crosshair when they dealt the damage; brief red flash tint on the victim.
- **Kill feedback**: death event spawns a short particle burst + the kill feed entry (exists) gets a subtle flash.
- **Screen shake**: small trauma-based shake on taking damage, firing the rocket, nearby explosions (reference pattern: trauma value, decays, offsets camera by noise).
- **Camera zoom**: three zoom levels cycling on a key (multipliers ~1 / 0.8 / 0.64, clamped to ≤ 2100×1280 world px view), smooth interpolation like the reference.
- **Player rendering**: keep vector style but add: weapon barrel line + held-weapon silhouette, jet flame flicker while jetting, crouch/stand body shapes, team/enemy color consistency (player cyan, enemies warm tones), spawn-protection blink.

## 4. Audio pass (WebAudio, no assets — synthesized)

- Shot per weapon family (pistol crack, SMG ticks, rifle snap, shotgun boom, sniper crack, rocket thump), reload click, dry-fire click, grenade bounce + explosion, hop/land, jet loop (soft noise, follows fuel), damage grunt, kill confirm blip, pickup chime, match-start/end stingers.
- Master volume in settings (persisted), muted-by-default-off (sound on, volume 0.8 default).
- All synthesized via WebAudio oscillators/noise buffers — zero asset files; guard against autoplay restrictions (init on first user gesture).

## 5. UI completeness pass

- **Menu**: title, Play (→ setup screen), Settings (volume, zoom hint), How-to-play (controls table). Keep the single-click "quick play" as the prominent default.
- **Setup screen** (B2): bot count / tier / map pickers + Start.
- **HUD**: keep HP/ammo/score/timer; add fuel bar (jetpack), grenade count, current weapon name; kill feed styled.
- **Match end overlay** (B1): standings, winner, stats (your kills/deaths/accuracy), Play again + Menu.
- **Death feedback**: brief "eliminated by X" line on death before respawn.

## 6. Performance guardrail

- Client holds ≥ 55 fps at 1280×720 with 3 bots + particles + audio on integrated graphics (in-box verification uses agent-browser screenshots + `requestAnimationFrame` sampling via eval).
- Bundle: split PixiJS into a lazy chunk (current warning: 979 kB lib.js) — loading screen while it fetches.

---

## Acceptance (milestone level)

- [ ] A new player can: open → quick-play → fight bots with readable threats → see match-end standings → adjust settings → replay on another map/tier.
- [ ] All B1–B4 fixed and covered by tests where testable (map validation, end-screen render, setup persistence).
- [ ] Runtime scenario ALL GREEN; determinism suite untouched and passing; `core` remains dependency-free.
- [ ] In-box browser verification captures: menu → setup → mid-match with tracers/shake visible → end standings.

## Out of scope (still)

Online multiplayer, cosmetics/progression, mobile/touch, music soundtrack (SFX only in this pass).
