# Scrapline

A browser jetpack shooter you play against bots — free, no sign-up — with a
deterministic 60 Hz simulation core and a one-command RL training baseline.

## Prerequisites

- Node.js `>= 20`
- Python `>= 3.11`

## Quickstart

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>, click **Play vs bots**, and fight 3 bots in a
free-for-all.

### Controls

| Input | Action |
|---|---|
| `A` / `D` or `←` / `→` | Move left / right |
| `W` / `↑` / `Space` | Jetpack (hop on rising edge while grounded) |
| `S` / `↓` | Crouch |
| Mouse | Aim |
| Left click | Fire |
| Right click or `G` | Throw grenade |
| `R` | Reload |

### Match rules (FFA)

- 4 players: you plus 3 bots.
- First to **25 kills** wins, or highest score when the **5-minute** clock
  (18000 ticks at 60 Hz) expires.
- 6 weapons (pistol, SMG, rifle, shotgun, sniper, rocket), grenades, weapon /
  health / grenade pickups, and destructible barrel / crate props.
- 4 bot skill tiers (`easy`, `normal`, `hard`, `elite`) with reaction, aim,
  and strafing ramps.

## Static hosting build

```sh
npm run build
npm run preview
```

`npm run build` compiles the client Vite bundle, typechecks, builds the
headless env-server, and stages a filtered copy of `packages/client/dist` to the
repo-root `dist/` (web artifacts only — TypeScript byproducts such as `.d.ts`
and `tsconfig.tsbuildinfo` are excluded). Open <http://localhost:3000> (or serve `dist/` from any
static host — asset URLs are relative, so `file://` and subpath hosts work
too) and click **Play vs bots** to play offline.

`dist/` is a build artifact (gitignored); it stays under 50 MB.

## RL quickstart

```sh
pip install -e "rl[test]"
python train.py --help
```

`train.py` is a thin root shim over `rl/scrapline_rl/train.py`:

```sh
python train.py --steps 5000 --envs 2 --tier easy --seed 1
```

This trains an SB3 PPO baseline (`MlpPolicy` over a `SubprocVecEnv` of
`ScraplineEnv` workers), saves `model.zip`, and prints the reward curve plus a
`mean_reward` summary line. The observation is the versioned egocentric
vector, actions are the versioned `MultiDiscrete` map decoded by
`actionToInput`, and rewards come from the headless env-server over stdio.

Evaluate a saved model per bot tier with:

```sh
cd rl && python -m scrapline_rl.eval --model ../model.zip --episodes 10 --tier normal
```

## Project layout

| Path | Contents |
|---|---|
| `packages/core` | Deterministic sim: `World` (60 Hz physics, combat, pickups, props, FFA match), seeded PRNG, 6-weapon table, utility-AI `BotBrain` tiers |
| `packages/client` | PixiJS v8 browser client (menu, HUD, killfeed, camera) driving the exact core |
| `packages/env` | Headless RL gateway: stdio JSON-lines env-server (`reset`/`step`/`close`), observation vector, versioned action map |
| `rl/` | Gymnasium wrapper (`ScraplineEnv`), PPO training baseline, per-tier eval harness |
| `server.js` | Zero-dependency static server: prefers staged root `dist/`, falls back to `packages/client/dist`, then client source |
| `tools/` | `stage-dist.js` (root `dist/` staging, excluding compiler byproducts), throughput / repro benches |
| `tests/` | Live HTTP contract probes (`node --test tests/skeleton.test.js`) |

## Scripts

| Command | Effect |
|---|---|
| `npm run dev` | Build client, serve on `http://localhost:3000` |
| `npm run build` | Full build + stage root `dist/` |
| `npm run preview` | Serve staged `dist/` (same `PORT` / `--port` contract as `dev`) |
| `npm start` | Serve (no rebuild) |
| `npm run lint` | ESLint over the repo |
| `npm test` | Client build + `tsc -b` + env build, vitest suites, HTTP contract tests |
| `python -m pytest rl/tests` | Python env / train / eval tests |

Set `PORT=8080 npm run preview` (or `npm run preview -- --port 8080`) to serve
on another port.
