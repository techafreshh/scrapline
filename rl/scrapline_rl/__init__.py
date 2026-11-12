"""scrapline_rl package: Gymnasium Scrapline-v0 registration and exports."""

from __future__ import annotations

import gymnasium as gym

from scrapline_rl.env import ScraplineEnv, make_vec_env

try:
    gym.register(id="Scrapline-v0", entry_point="scrapline_rl.env:ScraplineEnv")
except Exception:
    # Double import must not raise (pytest re-imports this module).
    pass

__all__ = ["ScraplineEnv", "make_vec_env"]
