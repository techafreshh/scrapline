# PRD: Scrapline *(working title)*

**A browser jetpack shooter with offline bots — and a first-class RL training environment.**

---

## 1. Executive Summary

**Scrapline** is an original, browser-playable 2D jetpack shooter in the genre of *Skyscrap* (play.skyscrap.fun): fast 60 Hz matches on tile-based maps, run/jetpack/crouch traversal, hitscan and projectile weapons, grenades, pickups, and skill-scaled bot opponents. It is built **offline-first** — instant play, no sign-up, no server dependency.

The differentiator is architectural: the entire game simulation is a **pure, deterministic TypeScript core** with zero rendering dependencies. The same binary that renders the browser game runs **headless in Node** as a Gymnasium-compatible RL environment, exposed to Python over a stdio JSON protocol. This makes Scrapline simultaneously (a) a shippable game and (b) a clean, reproducible, unlimited-throughput RL benchmark — no reverse-engineering, no renderer stubbing, no server gates.

**MVP goal**: a player can open a browser and win (or lose) a bot deathmatch at four difficulty tiers, and an RL practitioner can run `python train.py` and watch a PPO agent climb from losing to beating the same bots.

---

## 2. Mission

**Mission**: make a jetpack shooter that is fun to play *and* honest to agents — one deterministic world shared by humans and RL.

**Core principles**

1. **Determinism above all** — same seed + same inputs ⇒ identical world, byte-for-byte, in browser and Node.
2. **Sim is sacred** — `core/` never imports DOM, PixiJS, Node APIs, or `Math.random`; all entropy flows through a seeded PRNG.
3. **Bots are content** — bot quality defines the offline experience; difficulty must feel like players, not aimbots or sandbags.
4. **The env is a product** — observation/action/reward design is treated with the same care as game feel.
5. **Own the stack** — original code and art; public design references inform mechanics, never assets.

---

## 3. Target Users

| Persona | Description | Technical comfort | Needs / pain points |
|---|---|---|---|
| **The player (primary)** | Casual shooter fan; plays in short sessions in the browser | Low — just wants a URL | Instant load, no sign-up, readable controls, bots that scale to their skill |
| **The RL practitioner (primary)** | The same person or a researcher training agents (PPO and successors) on a game env | High — Python, Gymnasium, PyTorch | Deterministic resets, fast parallel envs, stable obs/action schemas, eval harnesses |
| **The tinkerer (secondary)** | Wants to add maps, weapons, or tune bots | Medium — edits TS constants | Data-driven maps/weapons, one-file tuning constants, clear tests |

---

## 4. MVP Scope

### In Scope

**Core functionality**
- [x] Deterministic 60 Hz simulation: run / jetpack / crouch / hop movement, tile collision
- [x] Weapons: pistol, SMG, rifle, shotgun (hitscan), sniper (hitscan + scope), rocket (projectile + splash), grenades (thrown, fused, bouncing)
- [x] Health, regen, respawn, spawn protection; ammo/reload/reserve
- [x] Pickups: weapon pads, health, grenade crates; destructible barrels/crates
- [x] FFA deathmatch: score limit + time limit, standings, kill feed
- [x] Bots: utility-AI opponents with 4 skill tiers (easy / normal / hard / elite) + ramping
- [x] Maps: 2–3 tile-based maps (32 px tiles, ASCII rows format)
- [x] Browser client: PixiJS rendering, keyboard+mouse input, camera with look-ahead, HUD

**RL / technical**
- [x] Headless env-server (Node, stdio JSON): `reset` / `step` / `close`
- [x] Gymnasium environment wrapper + parallel env workers (Python subprocesses)
- [x] Fixed observation vector (~90 floats, egocentric) and MultiDiscrete action space
- [x] PPO training baseline (Stable-Baselines3) + eval harness (win-rate per bot tier)
- [x] Determinism test: replay seed + recorded inputs → identical state hash

**Deployment**
- [x] Local dev: `npm run dev` (Vite) + `python train.py`
- [x] Static hosting of the client (single URL, no backend)

### Out of Scope (future phases)

- [ ] Online multiplayer / matchmaking / authoritative server (protocol blueprint exists in `RECON.md`)
- [ ] Accounts, progression, leaderboards, cosmetics
- [ ] Audio (music/SFX beyond placeholder blips)
- [ ] Mobile / touch / phone-as-gamepad
- [ ] Melee, ricochet/vortex/rhino exotic weapons, shields
- [ ] Spectator mode, replays UI (replay *file* format ships with determinism tooling)

---

## 5. User Stories

1. As a **player**, I want to click a URL and be in a match in under 5 seconds, so that I get a quick shooter fix without installing or signing up.
   - *Example*: open the page → menu → "Play vs bots (normal)" → alive on the map, holding the pistol, within 3 s.
2. As a **player**, I want jetpack movement with fuel that regenerates on the ground, so that flying is a resource decision, not a permanent flight.
   - *Example*: full burn drains ~3 s of fuel; landing refills it visibly on the HUD bar.
3. As a **player**, I want to swap between a weak always-available pistol and map weapons (SMG/rifle/shotgun/sniper/rocket), so that map control matters.
   - *Example*: grabbing the sniper at a high perch changes my engagement range; dying drops me back to the pistol.
4. As a **player**, I want four bot difficulties that ramp over matches, so that I always have a fair fight.
   - *Example*: `easy` bots telegraph and miss often; `elite` bots strafe, lead projectiles, and use grenades.
5. As an **RL practitioner**, I want `reset(seed)` to produce a reproducible episode, so that experiments are comparable and bugs are debuggable.
   - *Example*: two resets with `seed=1234` yield identical trajectories under identical action logs (verified by state hash).
6. As an **RL practitioner**, I want a stable, documented obs/action schema, so that my training code doesn't break when the game changes.
   - *Example*: `observation.ts` and `action.ts` export versioned schemas; the gym env validates shapes at `reset`.
7. As an **RL practitioner**, I want 8+ parallel env processes, so that a 1M-step PPO run finishes in minutes, not hours.
   - *Example*: `make_vec_env(8)` saturates without JSON-protocol bottlenecks (step round-trip < 1 ms).
8. As a **developer**, I want the sim decoupled from rendering, so that browser and RL both drive the exact same world code.
   - *Example*: `packages/core` has zero DOM/Node imports (lint-enforced); client and env-server are thin shells around it.

**Technical user stories**

9. As a **developer**, I want `npm test` to catch determinism regressions, so that I can refactor the sim fearlessly.
   - *Example*: CI runs a 3,600-tick replay twice and asserts identical state hashes.
10. As a **tinkerer**, I want to add a map by editing one ASCII file, so that content doesn't require code.
    - *Example*: rows strings + spawn/pickup arrays; a validation test rejects unreachable spawns.

---

## 6. Core Architecture & Patterns

**Monorepo (npm workspaces)** — one deterministic core, three thin consumers:

```
skaiscrap/
├─ package.json                 # npm workspaces: packages/*
├─ RECON.md                     # design reference (extracted from Skyscrap) — reference only
├─ packages/
│  ├─ core/      @scrapline/core    # PURE deterministic sim (no DOM / Node / PixiJS)
│  │  └─ src/
│  │     ├─ constants.ts    # all tuning in one file (60 Hz tick, movement, weapons)
│  │     ├─ rng.ts          # mulberry32 + fork() — the ONLY randomness source
│  │     ├─ map.ts          # ASCII rows → tiles, 32 px, collision queries, raycast, A* grid
│  │     ├─ weapons.ts      # data-driven weapon stat table
│  │     ├─ entities.ts     # Player / Projectile / Pickup / Prop state types
│  │     ├─ world.ts        # step(inputsPerPlayer[]) → Event[]  (the whole sim)
│  │     ├─ match.ts        # FFA orchestration: score, respawn, end conditions
│  │     ├─ bots/           # director.ts (tokens, roam points) + brain.ts (utility AI)
│  │     └─ events.ts       # typed sim events: shot, damage, kill, pickup, hop, land…
│  ├─ env/       @scrapline/env     # headless Node bridge (imports core ONLY)
│  │  └─ src/
│  │     ├─ env-server.ts   # stdio JSON-lines: reset/step/close; one proc per env
│  │     ├─ observation.ts  # egocentric float32 vector builder (versioned schema)
│  │     └─ action.ts       # MultiDiscrete → Input mapping (versioned schema)
│  └─ client/    @scrapline/client  # PixiJS v8 + Vite browser app
│     └─ src/
│        ├─ main.ts         # fixed-timestep accumulator loop → world.step at 60 Hz
│        ├─ renderer/       # layered draw (map → props → entities → fx), simple vector art
│        ├─ input.ts        # keyboard/mouse → Input{moveX, aim, buttons}
│        ├─ camera.ts       # follow + aim look-ahead + zoom
│        └─ hud/            # health/fuel/ammo/score/killfeed
├─ tools/sim-replay.ts           # seed + input log → state hash (determinism checker)
└─ rl/                           # Python
   ├─ pyproject.toml
   └─ scrapline_rl/
      ├─ env.py            # Gymnasium env; spawns env-server subprocess(es)
      ├─ train.py          # SB3 PPO baseline (SubprocVecEnv, N workers)
      └─ eval.py           # win-rate table vs each bot tier
```

**Key patterns**

- **Fixed-timestep deterministic core**: `world.step()` consumes one `Input` per player per tick (moveX ∈ [−1,1] quantized 1/64, aim in radians, 10-button bitmask). Clients send inputs; they never mutate state.
- **Seeded PRNG discipline**: mulberry32 with `fork(label)` derived streams (per-bot, per-effects). Sim never touches `Math.random` or clocks (lint rule).
- **Data-driven content**: weapons, maps, bot skill profiles are plain data tables — adding content = adding rows.
- **Event-driven readout**: `step()` returns typed events (shot/damage/kill/pickup…); renderer, HUD, and reward functions all consume the same event list.
- **Bridge over embedding**: Python never embeds JS; the env is a subprocess speaking JSON-lines over stdio (robust on Windows, trivially parallelizable).

---

## 7. Tools / Features

### 7.1 Game systems (MVP numbers — proven starting values from recon, tuned by playtest)

| System | Spec |
|---|---|
| **Tick** | 60 Hz fixed; aim quantized to 4096 steps; moveX to 1/64 |
| **Movement** | run 290 px/s, crouch 120; hop 300 px/s; ground accel 2600 / friction 2300; air accel 1500 / drag 160; gravity 1550; max fall 1150 |
| **Jetpack** | accel 3350, max rise 470 px/s; fuel 100, burn 34/s, regen 60/s grounded / 14/s air after 0.35 s delay; needs ≥ 8 to (re)ignite |
| **Player body** | 26×58 px (crouch 40); head hitbox 15 px; health 100; regen 10/s after 5 s; respawn 3 s with 1.5 s protection; 3 grenade slots |
| **Weapons** | pistol 20 dmg/14t, smg 11/5t, rifle 17/7t, shotgun 9×8 pellets, sniper 95/60t scoped 2600 range, rocket 110 + 150 px splash; headshot ×1.3–1.6; each with spread/recoil/mag/reload/reserve |
| **Grenades** | fuse 2.4 s, throw 760 px/s (½ inherited velocity), gravity 1300, bounce 0.45, 115 dmg, 165 px radius |
| **Pickups** | weapon pads respawn 15 s, health +50 @ 20 s, grenades +2 @ 20 s; pickup radius 22 px |
| **Props** | barrels (30 hp, explode) and crates (60 hp), destructible |
| **Match** | FFA: 25 kills or 5 min, 6 s end screen, standings |

### 7.2 Bots (utility AI, 4 tiers)

- **Director** (match-level): roam-point assignment, attack tokens (limit simultaneous attackers on one victim), grenade permission window.
- **Brain** (per-bot): replan at 12 Hz — perceive (sight raycast, notice delay, rear penalty, memory of last-seen) → choose target → choose goal by priority chain `fight > health(low) > weapon(better) > grenades > evade > roam`.
- **Movement**: A* on the tile grid (jet-aware climb costs), combat strafing in weapon-specific distance bands (e.g. shotgun ~150 px, sniper ~780 px), dodge hops when hit.
- **Aim**: tracked estimate with lag, velocity lead per weapon kind, acquisition error that settles over time, Ornstein-Uhlenbeck wobble, all parameterized by tier: reaction 0.35→0.22 s, angle error 0.018→0.011 rad, acquire error 66→50 px, dodge 0.25→0.7, grenade usage 0.03→0.6 (easy→elite).
- **Ramp**: tier profiles lerp toward the next tier over N matches (easy 10, normal 15, hard 20).

### 7.3 RL environment

- **Action** — MultiDiscrete `[3, 9, 2, 2, 2, 2, 2, 2]`:
  moveX {−1, 0, +1} · aim delta {−4…+4 × base turn} · buttons {jet, crouch, fire, grenade, reload, swap}
- **Observation** (~90 float32, egocentric, zero-padded):
  self (hp, fuel, vel×2, onGround, aim, weapon one-hot ×6, mag fraction, reloading) · 3 nearest **visible** enemies (rel pos, rel vel, hp, aim, dist) · 4 nearest projectiles (rel pos, vel, kind one-hot) · 4 nearest active pickups (rel pos, kind one-hot) · 16-ray tile lidar (distance fraction) · match (own score, best-opponent score, time-left fraction)
- **Reward**: +1 kill · −1 death · +0.5×(damage dealt) − 0.25×(damage taken) · ±2 match end (win/loss). Deliberately light; documented as the v1 reward spec.
- **Protocol** (JSON-lines over stdio): see §10.

---

## 8. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5 (strict) | one language for sim + client; types as env-schema contract |
| Sim/core | zero-dependency TS | determinism + headless portability |
| Renderer | **PixiJS v8** | genre-proven WebGL 2D, same family as the reference game |
| Client build | Vite 6 | instant HMR dev loop, static output |
| Tests | Vitest | workspace-native, fast watch mode |
| Env runtime | Node ≥ 20 | subprocess management, streams |
| RL | Python 3.11+, **Gymnasium**, **Stable-Baselines3 (PPO)**, NumPy, PyTorch (CPU fine for MLP policy) | standard, well-documented baseline; swappable later |
| Lint/format | ESLint + `no-restricted-globals` guard in core (`Math.random`, `Date`, `performance`) | enforce determinism at CI level |

---

## 9. Security & Configuration

- **Auth**: none — offline-first, no accounts, no network calls at runtime (MVP).
- **Config**: game tuning lives in `core/constants.ts`; map/weapon/bot content as data files; RL hyperparams in `rl/train.py` CLI flags (`--steps`, `--envs`, `--tier`, `--seed`). No environment variables required.
- **Security scope**: in scope — nothing sensitive exists (no PII, no secrets); out of scope — server hardening, anti-cheat (bots are local), telemetry.
- **Deployment**: client = static files (any static host later); env-server + training run locally only. Determinism across machines relies on IEEE-754 float64 math (no `Math.*` nondeterminism in sim paths).

---

## 10. API Specification

### 10.1 Env-server protocol (Node ↔ Python, JSON-lines over stdio)

**Request — reset**
```json
{"op": "reset", "seed": 1234, "tier": "normal", "bots": 3, "map": "kilima", "ramp": 0}
```
**Response**
```json
{"obs": [/* ~90 floats */], "info": {"tick": 0, "scores": [0,0,0,0]}}
```

**Request — step** (action = flat MultiDiscrete indices)
```json
{"op": "step", "action": [2, 4, 1, 0, 1, 0, 0, 0]}
```
**Response**
```json
{"obs": [/* floats */], "reward": 1.0, "terminated": false, "truncated": false,
 "info": {"tick": 601, "events": ["kill"], "scores": [3,1,0,2]}}
```

- One process per env instance; `close` terminates. Observations are float32 arrays as flat JSON; if profiling shows JSON overhead, an optional length-prefixed binary framing (Float32Array + uint8 actions) is a drop-in upgrade behind the same ops.

### 10.2 Core sim API (TypeScript)

```ts
const world = new World({ map: MAPS.kilima, seed: 1234, mode: 'ffa', scoreLimit: 25, timeLimitTicks: 18_000 });
const events: Event[] = world.step([myInput, bot1Input, bot2Input, bot3Input]); // 1 tick
world.state;                       // players, projectiles, pickups, scores, tick — fully serializable
const hash = world.hash();         // FNV-1a over state → determinism testing
```

---

## 11. Success Criteria

**MVP is done when all of these pass:**

Functional
- [ ] Browser match: load URL → finish a 5-min FFA vs 3 bots, HUD/camera/kill feed working, ≥ 55 fps
- [ ] All 6 weapons + grenades function with distinct feel; pickups/props respawn correctly
- [ ] Bots at 4 tiers produce visibly different skill; easy is beatable by a new player, elite beats a new player

RL
- [ ] `reset(seed)` reproducibility: identical action log ⇒ identical final state hash (10k-tick test, ×2 processes)
- [ ] 8 parallel envs step ≥ 10k ticks/s aggregate (JSON protocol acceptable; else binary framing)
- [ ] PPO (~2–5M steps) reaches ≥ 60 % win rate vs `easy` bots and > 0 kills/match average vs `normal`

Quality
- [ ] `core` imports nothing DOM/Node (lint-enforced); zero `Math.random` in sim (lint-enforced)
- [ ] Vitest suite: determinism, collision sanity, weapon DPS invariants, map reachability, bot smoke (≥ 1 kill vs dummy)
- [ ] No copied code/assets from the reference game

---

## 12. Implementation Phases

### Phase 1 — Deterministic core (~1 week)
**Goal**: the whole game sim running headless with tests.
- [ ] Scaffold workspaces, tsconfig, Vitest, lint guards
- [ ] `rng.ts`, `map.ts` (ASCII format + collision + raycast + A*), `constants.ts`
- [ ] Movement/jet/crouch physics; bullets (hitscan + rocket + grenades); damage/respawn; pickups/props
- [ ] FFA `match.ts`; event list; state serialization + `hash()`
- **Validation**: determinism replay test green; physics sanity (speeds/fuel numbers assertable); DPS table matches weapon data

### Phase 2 — Playable client (~1 week)
**Goal**: fun in the browser.
- [ ] PixiJS bootstrap, fixed-timestep loop, input mapping
- [ ] Map/props/entity rendering (vector art), camera + look-ahead, HUD
- [ ] Placeholder SFX optional; death/respawn/score flow
- **Validation**: manual play session; 60 fps on integrated graphics; input latency imperceptible

### Phase 3 — Bots & content (~1–2 weeks)
**Goal**: the game is a *game*.
- [ ] Director + brain utility AI, A* integration, combat bands, aim error model
- [ ] 4 tiers + ramp; full weapon set in pads; 2–3 maps; barrels/crates
- **Validation**: bot smoke tests; playtest ladder — can a human distinguish all 4 tiers blind?

### Phase 4 — RL loop (~1–2 weeks)
**Goal**: agents train on the same game.
- [ ] `env-server.ts` + protocol; `observation.ts` / `action.ts` (versioned)
- [ ] Gymnasium env, SubprocVecEnv workers, PPO baseline, eval harness
- **Validation**: reproducibility + throughput benchmarks; PPO beats `easy` bots (success criterion §11)

---

## 13. Future Considerations

- **Online multiplayer**: authoritative Node server reusing `core` bit-for-bit; the reference netcode blueprint (bit-packed inputs, snapshots, channel ids) is already documented in `RECON.md` §Netcode
- **Richer RL**: curriculum (tier ramp), self-play leagues, recurrent policies, observation-image mode (pixels) for RL-from-vision
- **Content**: melee, ricochet/vortex/rhino-class exotics, shields, more maps, cosmetics
- **Distribution**: itch.io / static hosting; PWA offline play
- **Replay viewer**: the determinism replay format becomes a spectator tool

---

## 14. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Determinism drift** (float edge cases, accidental clock/RNG use) | Medium | High — breaks replay, RL reproducibility | Lint guards, mulberry32-only rule, hash-replay test in CI from day 1 |
| **JSON stdio throughput bottleneck** | Medium | Medium — slow training | Measure in Phase 4; length-prefixed binary framing designed as drop-in; batch multi-tick steps if needed |
| **Bots feel bad** (too dumb or aimbot-y) | Medium | High — offline mode IS the game | Parameterized error models (not raw aim), playtest ladder, tier validation test |
| **Reward hacking / degenerate policies** (e.g., spawn-camping grenade spam) | Medium | Medium | Keep shaping light, monitor behavior stats per checkpoint, iteratively add penalties as *documented* reward v2 |
| **Scope creep into art/polish** | High | Medium — delays core value | MVP = vector art; polish gated behind Phase 4 success |
| **IP contamination from reference game** | Low | High | Original names/art/code; recon used for numeric reference only; no decompiled code copied |

---

## 15. Appendix

**Related documents**
- `RECON.md` — full reverse-engineering reference of Skyscrap (constants, weapons, netcode, bot architecture, maps). Design reference only.
- `recon/` — archived bundles for reference lookup.

**Key dependencies**
- [PixiJS v8](https://pixijs.com/) · [Vite](https://vite.dev/) · [Vitest](https://vitest.dev/) · [Gymnasium](https://gymnasium.farama.org/) · [Stable-Baselines3](https://stable-baselines3.readthedocs.io/)

**Reference numbers provenance**: all gameplay constants in §7.1 originate from the recon of play.skyscrap.fun and are used as starting values for an original implementation; they may be re-tuned freely during playtesting.

---

*PRD generated from session context — recon of play.skyscrap.fun and user decisions (goal: playable game + RL env; stack: TypeScript + PixiJS; scope: offline vs bots first).*
