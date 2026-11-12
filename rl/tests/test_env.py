"""Behavior probes for the Scrapline Gymnasium wrapper."""

import numpy as np

from scrapline_rl.env import ScraplineEnv, make_vec_env

# Fixed 10-action log for the fast determinism probe (the 100-action
# acceptance runs the same pattern over the live service).
ACTIONS = [
    [2, 4, 1, 0, 1, 0, 0, 0],
    [0, 3, 0, 1, 0, 0, 0, 0],
    [1, 5, 1, 0, 1, 0, 0, 0],
    [2, 4, 0, 0, 0, 1, 0, 0],
    [1, 4, 0, 0, 1, 0, 0, 1],
    [0, 6, 1, 1, 0, 0, 0, 0],
    [2, 2, 0, 0, 0, 0, 1, 0],
    [1, 7, 0, 1, 1, 0, 0, 0],
    [2, 4, 1, 0, 0, 0, 0, 0],
    [0, 4, 0, 0, 1, 0, 0, 1],
]


def _run(env: ScraplineEnv, seed: int) -> list[list[float]]:
    obs, _ = env.reset(seed=seed)
    out = [obs.tolist()]
    for action in ACTIONS:
        obs, _, _, _, _ = env.step(action)
        out.append(obs.tolist())
    return out


def test_obs_contract_after_reset():
    env = ScraplineEnv()
    try:
        obs, info = env.reset(seed=1234)
        assert isinstance(obs, np.ndarray)
        assert obs.dtype == np.float32
        assert obs.shape == (92,)
        assert len(obs) == 92
        assert np.all(np.isfinite(obs))
        assert obs.min() >= -1.0 - 1e-6
        assert obs.max() <= 2.0 + 1e-6
        assert info["tick"] == 0
    finally:
        env.close()


def test_same_seed_reproducible():
    env = ScraplineEnv()
    try:
        first = _run(env, 1234)
        second = _run(env, 1234)
        assert first == second
    finally:
        env.close()


def test_different_seeds_diverge():
    env = ScraplineEnv()
    try:
        first = _run(env, 1234)
        second = _run(env, 5678)
        assert first != second
    finally:
        env.close()


def test_invalid_action_raises():
    env = ScraplineEnv()
    try:
        env.reset(seed=1)
        try:
            env.step([9] * 8)
        except (ValueError, RuntimeError):
            pass
        else:
            raise AssertionError("expected invalid action to raise")
    finally:
        env.close()


def test_make_vec_env_steps_two_envs():
    venv = make_vec_env(2)
    try:
        obs, _ = venv.reset(seed=1234)
        assert obs.shape == (2, 92)
        actions = np.array([[1, 4, 0, 0, 0, 0, 0, 0], [1, 4, 0, 0, 0, 0, 0, 0]])
        obs, _, _, _, _ = venv.step(actions)
        assert obs.shape == (2, 92)
        assert np.all(np.isfinite(obs))
    finally:
        venv.close()
