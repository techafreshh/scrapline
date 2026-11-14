# PRD v4: Scrapline Presentation v2 — benchmark: play.skyscrap.fun

**Goal**: close the visible gap to the reference game (play.skyscrap.fun) measured in a side-by-side agent-browser session on 2026-11-14. Reference in-match shows: pixel-art terrain + dusk-savanna backdrop with parallax mountains/trees, hazard-striped platforms, lit doorways with glow, sandbags/barrels/weapon pads with icons, 8 fully-articulated soldier sprites with name tags, tracers mid-flight, kill feed with weapon icons and colored names, HUD with heart-HP, standings chip ("4th /8 · You 0/25"), and an ammo module ("Hornet SMG 32/96 · 3 grenades"). Its menu: animated art scene, map carousel with thumbnails, match-summary chip on Play, rotating tips, account/career/settings icons.

**Asset policy change (approved direction)**: the zero-asset rule becomes **CC0-assets-allowed** — third-party art/audio only from public-domain (CC0) sources with a LICENSES manifest file. Everything still drawn/rendered deterministically client-side; core stays pure.

**Existing lib stack to adopt**: `pixi-v8-particle-emitter` (v8-native particles), `pixi-filters` (GlowFilter, shockwave/vignette), `@tweenjs/tween.js` (UI tweens), optional `pixi-tiledmap` only if we adopt Tiled authoring (see M2). No physics engine needed — core sim stays ours.

---

## A. Art assets (CC0 pipeline)

- **A1. Asset pipeline + license manifest.** Add `packages/client/assets/` (CC0 packs only), a `LICENSES.md` manifest (pack name, author, license, files), and a build step that ingests sprites into Pixi texture atlas(es). Bundle budget: ≤ 6 MB assets total, loaded behind the existing loading screen (lazy chunk already exists).
- **A2. Character sprites.** Replace the composed-vector soldier with an animated CC0 soldier (idle/run/jet/crouch/death frames), tinted per player color family; weapon sprites per weapon id drawn in hand with muzzle point aligned so tracers/muzzle flashes originate correctly.
- **A3. Tilesets per theme.** CC0 tilesets for kilima (savanna outpost: earth tops, hazard-striped metal platforms, sandbags), dune (refinery), frostbite (station). Physics stays the ASCII core format — sprites render over it 1:1 (32 px tiles).
- **A4. Props + pickups art.** Crates, barrels (with cracked/explosion frames), weapon pads with icon plaques, health cross, grenade icon, bounce pad with squash animation.

## B. Effects (libraries)

- **B1. Particle system.** Integrate `pixi-v8-particle-emitter`; emitters for: muzzle flash, bullet impact sparks (surface-tinted), rocket/grenade/barrel explosion (flash + smoke + debris), jet exhaust trail following the player while jetting, death burst, pickup sparkle. Emitters driven from existing sim events; capped for perf.
- **B2. Glow + post effects.** `pixi-filters` GlowFilter on pickups, doorway lights, muzzle flashes (reference's lit doorways); shockwave ring on explosions; keep the existing vignette; add subtle chromatic pulse on player hurt (cheap filter, toggled off on low quality).

## C. World presentation

- **C1. Parallax backdrops.** Per-theme layered backdrop (sky gradient → mountain/treeline silhouettes → haze band) scrolling at fractional camera rates like the reference's dusk savanna; drawn from CC0/decorative shapes, no photorealism.
- **C2. Lighting pass.** Static lights from map decorations (doorways, lamps) rendered as additive glow sprites; flicker variants for frostbite station windows.

## D. HUD & typography

- **D1. Display font + bitmap HUD text.** Bundle one display webfont (OFL) for titles/menu and switch HUD numbers to a bitmap font (crisp at zoom levels).
- **D2. Ammo module.** Bottom-right weapon module like the reference: weapon icon + name, mag/reserve counts, grenade pips.
- **D3. Kill feed upgrade.** Weapon icon between names, attacker/victim colored by player color, entries fade after 6 s.
- **D4. Name tags.** Small name labels above players (yours highlighted); bots use the generated-name pool; toggle in Settings.
- **D5. Pickup labels.** Weapon pads show the weapon they hold; health pad shows cross icon; grenade pad icon.

## E. Menu & meta polish

- **E1. Menu art scene.** Full-bleed animated menu background: theme backdrop + idle animated soldier (jet hover loop) like the reference menu; Quick Play button carries a match-summary chip ("3 bots · normal · first to 25 · 5 min") reflecting current settings.
- **E2. Map carousel.** Scene cards with live thumbnails (headless core renders each map to an offscreen canvas at boot) — reference's 6-scene carousel; selecting a card sets the setup default.
- **E3. Rotating tips.** Small tip line on menu (mechanics tips: shield pickups, spawn protection, jet fuel), rotating every 10 s.
- **E4. Gamepad support.** Gamepad API: left stick move, A/cross hop-jet, RT fire, LT grenade, X reload, D-pad weapon swap; auto-detect + "controller connected" toast; keyboard stays primary.
- **E5. PWA offline.** Service worker caching the built bundle for offline play vs bots (reference ships this); safe fallback when storage unavailable.

## F. Bug fixes (verified 2026-11-14)

- **F1. noscript fallback text overlaps gameplay.** The "If the canvas above stays black, JavaScript is disabled." paragraph renders through the live game view. Hide it once the client boots (remove/`display:none` on init), and only ever show it when no WebGL context exists.
- **F2. Jet flame inconsistent.** Jet exhaust was not visible during jet in captures (flame flicker too sparse/short-lived); with B1's exhaust emitter, ensure a clearly visible trail for the full jet duration.

## V. Verification

- **V1. Presentation-v2 verification lap.** agent-browser protocol (as #121): at 1920×1080 + 1280×720 capture menu scene, carousel, mid-match with particles/glow/name tags/ammo module, fullscreen toggle, standings. Assert: particles visible on fire/explosion, glow on pickups/doorways, name tags readable, assets ≤ 6 MB, fps guardrail green, all prior probes green. Compare side-by-side against freshly captured live reference screenshots of play.skyscrap.fun taken via the agent-browser protocol each verification lap, with no committed screenshot directory per the zero-image policy.

**Acceptance (milestone level)**
- [ ] Mid-match screenshot is recognizable as "same class as" the reference at a glance: articulated soldiers, themed terrain, glow, particles, full HUD
- [ ] All F1–F2 fixed; A–E delivered with CC0 manifest complete
- [ ] Determinism/purity tests + runtime scenario ALL GREEN; bundle+assets lazy-loaded behind loading screen

**Out of scope**: online multiplayer, career/challenges/locker systems, phone-controller mode, music soundtrack.
