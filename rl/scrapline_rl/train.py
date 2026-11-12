"""One-command PPO baseline over the Gymnasium Scrapline wrapper.

Trains SB3 ``PPO("MlpPolicy")`` on a ``SubprocVecEnv`` of ``Monitor``-wrapped
``ScraplineEnv`` workers (tier from CLI), saves ``model.zip`` to the current
working directory, and logs the reward curve to stdout.

Reward shaping lives server-side (``handleStep`` in
``packages/env/src/env-server.ts``); this script consumes the env reward
verbatim.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Any, Callable, Sequence

# Allow `python rl/scrapline_rl/train.py` without an installed package:
# the importable root (`rl/`) is the parent of this file's package dir.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapline_rl.env import ScraplineEnv


def build_parser() -> argparse.ArgumentParser:
    """CLI parser: exactly --steps/--envs/--tier/--seed."""
    parser = argparse.ArgumentParser(
        description="Train an SB3 PPO baseline against Scrapline bots."
    )
    parser.add_argument(
        "--steps", type=int, default=5000, help="Total env steps to train."
    )
    parser.add_argument(
        "--envs", type=int, default=2, help="Number of SubprocVecEnv workers."
    )
    parser.add_argument(
        "--tier", type=str, default="easy", help="Bot tier for worker envs."
    )
    parser.add_argument(
        "--seed", type=int, default=1, help="Base RNG seed (worker i uses seed+i)."
    )
    return parser


def format_summary(
    tier: str,
    step_rewards: Sequence[float] | None,
    episode_rewards: Sequence[float] | None,
) -> str:
    """Pure summary line; always carries a finite numeric mean_reward."""
    steps = [float(v) for v in (step_rewards or [])]
    episodes = [float(v) for v in (episode_rewards or [])]
    source = episodes if episodes else steps
    if source:
        mean = sum(source) / len(source)
        if not math.isfinite(mean):
            mean = 0.0
    else:
        mean = 0.0
    return (
        f"tier={tier} episodes={len(episodes)} "
        f"steps={len(steps)} mean_reward={mean:.4f}"
    )


def make_env_fn(tier: str, seed: int, rank: int) -> Callable[[], Any]:
    """Thunk factory for SubprocVecEnv workers.

    Each thunk builds ``Monitor(ScraplineEnv(tier=tier))`` and performs the
    initial ``reset(seed=seed + rank)``; post-termination reseeds are left to
    SB3. The thunk closure captures only picklable scalars.
    """

    def _init() -> Any:
        from stable_baselines3.common.monitor import Monitor

        env = Monitor(ScraplineEnv(tier=tier))
        env.reset(seed=seed + rank)
        return env

    return _init


def main(argv: Sequence[str] | None = None) -> int:
    """Parse CLI, train PPO, save model.zip, log the reward curve."""
    from stable_baselines3 import PPO
    from stable_baselines3.common.callbacks import BaseCallback
    from stable_baselines3.common.vec_env import SubprocVecEnv

    args = build_parser().parse_args(argv)
    print(
        f"tier={args.tier} steps={args.steps} envs={args.envs} seed={args.seed}",
        flush=True,
    )

    class RewardCurveCallback(BaseCallback):
        """Accumulate per-step rewards and per-episode Monitor returns."""

        def __init__(self) -> None:
            super().__init__()
            self.step_rewards: list[float] = []
            self.episode_rewards: list[float] = []
            self.episode_count = 0

        def _on_step(self) -> bool:
            rewards = self.locals.get("rewards")
            if rewards is not None:
                try:
                    self.step_rewards.extend(float(r) for r in rewards)
                except TypeError:
                    self.step_rewards.append(float(rewards))
            infos = self.locals.get("infos")
            if isinstance(infos, dict):
                infos = [infos]
            for info in infos or []:
                if not isinstance(info, dict):
                    continue
                episode = info.get("episode")
                if isinstance(episode, dict) and "r" in episode:
                    value = float(episode["r"])
                    self.episode_rewards.append(value)
                    self.episode_count += 1
                    print(
                        f"episode={self.episode_count} "
                        f"reward={value:.4f} "
                        f"length={episode.get('l', '?')}",
                        flush=True,
                    )
            return True

    vec_env = SubprocVecEnv(
        [make_env_fn(args.tier, args.seed, rank) for rank in range(args.envs)]
    )
    callback = RewardCurveCallback()
    try:
        model = PPO("MlpPolicy", vec_env, seed=args.seed, device="cpu", verbose=1)
        model.learn(total_timesteps=args.steps, callback=callback)
        model.save("model.zip")
    finally:
        vec_env.close()
    print(
        format_summary(args.tier, callback.step_rewards, callback.episode_rewards),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
