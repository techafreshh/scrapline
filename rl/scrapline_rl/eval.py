"""Standardized bot-tier eval harness for Scrapline.

Plays N episodes per bot tier (``TIER_LIST`` order from
``packages/core/src/bots/tiers.ts``) with either a random policy or a
trained ``model.zip`` checkpoint, and prints a win-rate table with
kills/match to stdout.

Win rule mirrors the ``standings()`` id-ascending tie-break: the agent
(player 0) wins ties, i.e. ``scores[0] >= max(opponent scores)``.
Scores are consumed verbatim from ``info["scores"]`` produced by
``handleStep`` in ``packages/env/src/env-server.ts``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Sequence

# Allow `python rl/scrapline_rl/eval.py` without an installed package:
# the importable root (`rl/`) is the parent of this file's package dir.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapline_rl.env import ScraplineEnv

# Tier names in ascending skill order, mirroring TIER_LIST in
# packages/core/src/bots/tiers.ts.
TIERS: tuple[str, ...] = ("easy", "normal", "hard", "elite")


def resolve_tiers(name: str | None) -> list[str]:
    """Resolve a --tier value to the list of tiers to evaluate.

    Known tier names (case-insensitive) evaluate just that tier;
    ``"all"`` evaluates every tier in ``TIERS`` order; anything else
    falls back to ``["normal"]``, mirroring the ``getTier`` fallback
    in ``packages/core/src/bots/tiers.ts``.
    """
    if name is None:
        return ["normal"]
    normalized = str(name).strip().lower()
    if normalized == "all":
        return list(TIERS)
    for tier in TIERS:
        if normalized == tier:
            return [tier]
    return ["normal"]


def build_parser() -> argparse.ArgumentParser:
    """CLI parser: --model/--episodes/--tier/--seed/--max-steps/--bots/--map."""
    parser = argparse.ArgumentParser(
        description="Evaluate a model (or random policy) against Scrapline bot tiers."
    )
    parser.add_argument(
        "--model",
        type=str,
        default="random",
        help='Model path to load, or "random" for a random policy.',
    )
    parser.add_argument(
        "--episodes", type=int, default=3, help="Episodes to play per tier."
    )
    parser.add_argument(
        "--tier", type=str, default="all", help="Bot tier to evaluate, or all."
    )
    parser.add_argument(
        "--seed", type=int, default=0, help="Base RNG seed (episode i uses seed+i)."
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=1000,
        help="Cap on env steps per episode.",
    )
    parser.add_argument(
        "--bots", type=int, default=3, help="Number of bot opponents."
    )
    parser.add_argument(
        "--map", type=str, default="kilima", help="Map name for env resets."
    )
    return parser


def compute_row(
    tier: str, wins: int, kills_total: int, episodes: int
) -> dict[str, Any]:
    """Pure per-tier result row with win-rate percent and kills/match."""
    episodes_int = int(episodes)
    wins_int = int(wins)
    kills_int = int(kills_total)
    if episodes_int > 0:
        win_rate = 100.0 * wins_int / episodes_int
        kills_per_match = kills_int / episodes_int
    else:
        win_rate = 0.0
        kills_per_match = 0.0
    return {
        "tier": tier,
        "episodes": episodes_int,
        "wins": wins_int,
        "win_rate": win_rate,
        "kills": kills_int,
        "kills_per_match": kills_per_match,
    }


def format_table(rows: Sequence[dict[str, Any]]) -> str:
    """Pure fixed-width table; header carries tier/wins/win-rate/kills."""
    header = (
        f"{'tier':<8} {'episodes':>8} {'wins':>6} "
        f"{'win-rate':>8} {'kills':>6} {'kills/match':>11}"
    )
    lines = [header]
    for row in rows:
        lines.append(
            f"{str(row.get('tier', '')):<8} "
            f"{int(row.get('episodes', 0)):>8d} "
            f"{int(row.get('wins', 0)):>6d} "
            f"{float(row.get('win_rate', 0.0)):>7.1f}% "
            f"{int(row.get('kills', 0)):>6d} "
            f"{float(row.get('kills_per_match', 0.0)):>11.2f}"
        )
    return "\n".join(lines)


def load_policy(model: str) -> tuple[str, Any]:
    """Resolve --model to a (kind, handle) pair without top-level torch.

    ``"random"`` returns ``("random", None)`` and never imports
    ``stable_baselines3``; any other value lazily imports ``PPO`` and
    loads the checkpoint, surfacing a clear error when the file is
    missing.
    """
    if str(model) == "random":
        return ("random", None)
    path = Path(str(model))
    if not path.exists():
        raise FileNotFoundError(f"eval: model file not found: {model}")
    from stable_baselines3 import PPO

    return ("sb3", PPO.load(str(path)))


def _is_win(scores: Any) -> bool:
    """Agent (player 0) ties-or-beats every opponent score."""
    try:
        values = [float(v) for v in (scores or [])]
    except (TypeError, ValueError):
        return False
    if not values:
        return False
    agent = values[0]
    opponents = values[1:]
    if not opponents:
        return True
    return agent >= max(opponents)


def _final_kills(scores: Any) -> int:
    """Kills for the match: final agent score as an int."""
    try:
        values = [float(v) for v in (scores or [])]
    except (TypeError, ValueError):
        return 0
    if not values:
        return 0
    return int(values[0])


def eval_tier(
    tier: str,
    episodes: int,
    max_steps: int,
    seed: int,
    bots: int,
    map_name: str,
    policy: tuple[str, Any],
) -> dict[str, Any]:
    """Play episodes of one tier; return the compute_row result dict."""
    kind, handle = policy
    env = ScraplineEnv(tier=tier, bots=bots, map=map_name)
    try:
        if kind == "random":
            try:
                env.action_space.seed(seed)
            except Exception:
                pass
        wins = 0
        kills_total = 0
        steps_capped = max(1, int(max_steps))
        episodes_int = max(0, int(episodes))
        for i in range(episodes_int):
            obs, info = env.reset(seed=int(seed) + i)
            last_scores: Any = info.get("scores", []) if isinstance(info, dict) else []
            done = False
            for _ in range(steps_capped):
                if kind == "random":
                    action = env.action_space.sample()
                else:
                    action, _ = handle.predict(obs, deterministic=True)
                    action = ScraplineEnv._coerce_action(action)
                obs, _, terminated, truncated, info = env.step(action)
                if isinstance(info, dict) and "scores" in info:
                    last_scores = info["scores"]
                if terminated or truncated:
                    done = True
                    break
            if not done and isinstance(info, dict) and "scores" in info:
                last_scores = info["scores"]
            if _is_win(last_scores):
                wins += 1
            kills_total += _final_kills(last_scores)
        return compute_row(tier, wins, kills_total, episodes_int)
    finally:
        env.close()


def main(argv: Sequence[str] | None = None) -> int:
    """Parse CLI, run per-tier evals, print the win-rate table."""
    args = build_parser().parse_args(argv)
    tiers = resolve_tiers(args.tier)
    policy = load_policy(args.model)
    rows: list[dict[str, Any]] = []
    for tier in tiers:
        print(
            f"tier={tier} episodes={args.episodes} model={args.model}",
            flush=True,
        )
        row = eval_tier(
            tier,
            args.episodes,
            args.max_steps,
            args.seed,
            args.bots,
            args.map,
            policy,
        )
        rows.append(row)
    print(format_table(rows), flush=True)
    total = sum(int(row["episodes"]) for row in rows)
    print(f"episodes={total}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
