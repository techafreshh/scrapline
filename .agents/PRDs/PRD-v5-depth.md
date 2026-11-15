# PRD v5: Scrapline Depth & Connection Milestone

**Goal**: close the remaining visible gaps from the 2026-11-15 side-by-side against play.skyscrap.fun — art cohesion per scene theme, animation smoothness, ambient life, meta-lite progression (account/challenges/cosmetics), a synthesized soundtrack, and the **multiplayer foundation** (authoritative server reusing the deterministic core, per the netcode blueprint in `RECON.md`).

**Starting point (v4 merged)**: presentation at reference parity in structure — carousel with live thumbnails, summary chip, tips, name tags, glow/particles, ammo module, PWA offline, gamepad. Verified gaps: kilima shows city silhouettes (theme mismatch), flat terrain blending, sparse ambient life, no gait blending, no music, no progression, no server.

**Constraints**: `packages/core` stays pure/deterministic; CC0 assets only with `LICENSES.md` manifest; client bundle stays lazy-loaded; all existing scenario probes and purity tests stay green. Multiplayer server code lives in a new `packages/server` workspace and MUST NOT break the offline env (`core` untouched except additive, tested extensions).

---

## A. Art cohesion (scene themes)

- **A1. Theme-correct backdrops.** Each map's parallax set must match its theme: kilima = dusk savanna (acacia tree silhouettes, warm sun disc, birds occasionally crossing), dune = golden-hour desert (dunes, refinery chimneys, haze), frostbite = polar night (aurora band, station antennas, drifting snow). Remove the generic city silhouettes. A `themeFor` audit test asserts each theme's backdrop layers contain theme-declared shapes.
- **A2. Terrain texture + edge blending.** Tile tops get theme-tinted highlight caps with soft edge shading (grass tuft tops on kilima, sand ripples on dune, frost sheen on frostbite); platform undersides get depth shading; adjacent same-type tiles merge visually (no internal seams). Pure rendering — physics tiles unchanged.
- **A3. Cohesion audit.** agent-browser captures of all three maps at 1920×1080 committed to the benchmark themes capture directory; a checklist test fails if any map renders a backdrop layer not declared by its theme.

## B. Animation polish

- **B1. Gait + pose blending.** Run cycle blends by speed (walk↔sprint), air pose blends crouch↔stand by vy, weapon aim smooths arm angle (no snapping), landing squash-and-stretch ~4 frames, death and spawn-in transitions eased (no pop).
- **B2. Jet flame density.** Full-duration exhaust (v4 fixed coverage) now also: flicker rate varies with fuel burn, small smoke wisps at low fuel, brighter core when ascending fast.

## C. Ambient life

- **C1. Ambient particle beds.** Per-theme ambient emitters: kilima dust motes + drifting birds (decor, non-colliding), dune heat shimmer + blowing sand streaks, frostbite snowfall + occasional aurora shimmer. All behind the quality guard (off on low).
- **C2. Micro-decoration.** Grass tufts, small rocks, pipe valves, antenna details scattered from map decoration arrays (deterministic placement); never occluding gameplay tiles.

## D. Meta-lite (local profile, no server)

- **D1. Local profile.** Name (editable, used in nametags/kill feed), avatar palette; XP/level from matches (win +50, kill +10, match-complete +20 curve), persisted localStorage; menu badge shows level like the reference.
- **D2. Daily challenges.** 3 challenges/day from templates (e.g. "3 kills with the rifle", "win on dune", "2 grenade kills"), progress tracked from sim events, reward XP, panel from the menu; refresh at local midnight.
- **D3. Cosmetics locker.** Grid of unlockable helmet/visor/palette combos (locked until level/XP thresholds or challenge completion), 3D-ish preview on the setup screen (reuse existing preview), applied in-match.

## E. Music (synthesized)

- **E1. Scene soundtrack.** WebAudio generative loops: menu (calm pad + pluck), match (driving bass + hats, intensity rises with `heat`-style match tension), match-end stinger. Separate music volume in Settings, persisted; respects autoplay guard; zero asset files.

## F. Multiplayer foundation (RECON.md blueprint, local deployment)

- **F1. Authoritative server workspace.** New `packages/server`: Node WS server hosting `@scrapline/core` worlds bit-for-bit — fixed 60 Hz authoritative step, same seeded RNG, same match rules. Endpoints: `/health` (JSON), WS join with `{t:'hello', proto, view, client}` handshake then room create/join; reconnection token support. **Scenario probe contract**: health returns `{"status":"ok","rooms":N}`; joining with a bogus session id gets a clean 4xx-class WS close (4002-style), never a hang.
- **F2. Snapshot + input encoding.** Bit-packed snapshots (player: x/y/aim/flags/weapon/hp/shield; events: shot/damage/kill/bounce…) and input packets (moveX 8-bit signed /64, aim 12-bit, buttons 10-bit, delta-compressed, 1–12 inputs per packet) following the RECON.md wire format; unit tests for round-trip encode/decode.
- **F3. Client netcode.** Client connects to `ws://host/room` (menu "Play online → host local room" flow), sends inputs at 60 Hz, receives snapshots; **interpolation buffer** (~100 ms) renders remote players smoothly; local prediction stays OFF in v5 (input-latency honest mode) — world state is server-authoritative render.
- **F4. Remote rendering + roster.** Remote players render with the full soldier system + name tags from server roster; kill feed/events identical to offline; disconnect handling shows "Player left" and reclaims bot control if host enables backfill.
- **F5. Online smoke scenario.** New runtime probes (port stays "first"): server boots, health OK, two headless WS clients join a room, server broadcasts a snapshot containing both pids within 2 s, bogus session rejected. Holdout: malformed hello → clean close; double-join same session → error; huge payload → close 1009.

## V. Verification

- **V1. Depth verification lap.** Captures: all three themed maps (cohesion audit), menu with level badge + challenge panel, locker preview, online 2-client smoke via in-box agent-browser + headless WS client. Assert: theme audit green, music audible only via WebAudio state (no autoplay before gesture), netcode probes green, all prior milestones' probes green, fps guardrail green with ambient beds on.

**Acceptance (milestone level)**
- [ ] Side-by-side redo vs the benchmark references shows no theme mismatches; menus match reference anatomy
- [ ] A human can: earn XP → level up → unlock a cosmetic → see it in-match; complete a daily challenge
- [ ] Two browser tabs can play the same authoritative match locally over WS with smooth remote movement
- [ ] Determinism/purity + all scenario contracts green; `core` additions additive and tested

**Out of scope (still)**: public deployment of the multiplayer server (operator task when ready), account sync across devices, matchmaking service, spectating, mobile.
