"""Gymnasium wrapper around the headless env-server stdio bridge.

Mirrors the frozen TS contracts:
- ``OBS_LENGTH`` 92 and ``clean`` clamp ``[-1, 2]`` from
  ``packages/env/src/observation.ts`` pin the ``Box`` shape and bounds.
- ``ACTION_DIMS`` ``[3, 9, 2, 2, 2, 2, 2, 2]`` and ``ACTION_LENGTH`` 8 from
  ``packages/env/src/action.ts`` pin the ``MultiDiscrete`` nvec.
- ``handleReset`` / ``handleStep`` field names in
  ``packages/env/src/env-server.ts`` pin the reset/step payloads and
  the 5-tuple mapping (``truncated`` is always ``False``).

Spawn order mirrors ``packages/env/test/protocol.test.ts``: use the built
``dist/env-server.js`` bundle when present, else fall back to
``npx tsx src/env-server.ts``.
"""

from __future__ import annotations

import json
import queue
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Sequence

import gymnasium as gym
import numpy as np
from gymnasium import spaces

# Frozen contracts mirrored from the TS sources (see module docstring).
OBS_LENGTH = 92
OBS_LOW = -1.0
OBS_HIGH = 2.0
ACTION_DIMS: tuple[int, ...] = (3, 9, 2, 2, 2, 2, 2, 2)
ACTION_LENGTH = 8

# Repo root is two levels above this file: rl/scrapline_rl/env.py -> repo.
_REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_DIST = _REPO_ROOT / "packages" / "env" / "dist" / "env-server.js"
SERVER_SRC = _REPO_ROOT / "packages" / "env" / "src" / "env-server.ts"

# Per-protocol-line read timeout (seconds).
_RPC_TIMEOUT = 10.0


def _resolve_cmd(server: Any = None) -> list[str]:
    """Resolve the env-server spawn command.

    ``server`` overrides auto-resolution: a list/tuple is used as the
    command verbatim, a str/Path is run with ``node``.
    """
    if server is not None:
        if isinstance(server, (list, tuple)):
            return [str(part) for part in server]
        return ["node", str(server)]
    if SERVER_DIST.exists():
        return ["node", str(SERVER_DIST)]
    return ["npx", "tsx", str(SERVER_SRC)]


class ScraplineEnv(gym.Env):
    """Single env-server subprocess exposed as a Gymnasium env."""

    metadata = {"render_modes": []}

    def __init__(
        self,
        tier: str = "normal",
        bots: int = 3,
        map: str = "kilima",
        server: Any = None,
    ) -> None:
        super().__init__()
        self.tier = tier
        self.bots = bots
        self.map = map
        # Box(-1, 2, (92,)) per OBS_LENGTH/clean in observation.ts.
        self.observation_space = spaces.Box(
            low=OBS_LOW, high=OBS_HIGH, shape=(OBS_LENGTH,), dtype=np.float32
        )
        # MultiDiscrete([3,9,2,2,2,2,2,2]) per ACTION_DIMS in action.ts.
        self.action_space = spaces.MultiDiscrete(list(ACTION_DIMS))
        cmd = _resolve_cmd(server)
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            cwd=str(_REPO_ROOT),
        )
        self._lines: queue.Queue[str | None] = queue.Queue()
        self._closed = False
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _pump(self) -> None:
        """Background reader: forward stdout lines into the queue."""
        proc = self._proc
        stdout = proc.stdout
        try:
            while True:
                line = stdout.readline() if stdout is not None else ""
                if line == "":
                    break
                self._lines.put(line)
        except Exception:
            pass
        finally:
            try:
                self._lines.put(None)
            except Exception:
                pass

    def _rpc(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Send one JSON line and return the parsed reply line."""
        if self._closed or self._proc.poll() is not None:
            raise RuntimeError("scrapline-rl: env-server process is not running")
        stdin = self._proc.stdin
        if stdin is None:
            raise RuntimeError("scrapline-rl: env-server stdin is closed")
        try:
            stdin.write(json.dumps(payload) + "\n")
            stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as exc:
            raise RuntimeError(f"scrapline-rl: failed to write to env-server: {exc}") from exc
        try:
            line = self._lines.get(timeout=_RPC_TIMEOUT)
        except queue.Empty as exc:
            raise RuntimeError("scrapline-rl: timed out waiting for env-server reply") from exc
        if line is None:
            raise RuntimeError("scrapline-rl: env-server closed stdout (EOF)")
        text = line.strip()
        if text == "":
            raise RuntimeError("scrapline-rl: empty reply from env-server")
        try:
            reply = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"scrapline-rl: non-JSON reply: {text[:80]}") from exc
        if isinstance(reply, dict) and "error" in reply:
            raise RuntimeError(f"scrapline-rl: env-server error: {reply['error']}")
        if not isinstance(reply, dict):
            raise RuntimeError("scrapline-rl: malformed reply from env-server")
        return reply

    @staticmethod
    def _coerce_action(action: Any) -> list[int]:
        """Coerce to a plain 8-int list, strictly validating ranges."""
        if isinstance(action, np.ndarray):
            items: Sequence[Any] = action.flatten().tolist()
        elif isinstance(action, (list, tuple)):
            items = list(action)
        else:
            try:
                items = list(action)
            except TypeError as exc:
                raise ValueError(f"scrapline-rl: invalid action {action!r}") from exc
        if len(items) != ACTION_LENGTH:
            raise ValueError(
                f"scrapline-rl: invalid action: expected length {ACTION_LENGTH}, "
                f"got {len(items)}"
            )
        coerced: list[int] = []
        for i, value in enumerate(items):
            size = ACTION_DIMS[i]
            if isinstance(value, bool):
                raise ValueError(
                    f"scrapline-rl: invalid action: entry {i} must be an integer "
                    f"in [0, {size})"
                )
            if isinstance(value, np.integer):
                value = int(value)
            elif isinstance(value, (float, np.floating)):
                if not float(value).is_integer():
                    raise ValueError(
                        f"scrapline-rl: invalid action: entry {i} must be an integer "
                        f"in [0, {size})"
                    )
                value = int(value)
            elif not isinstance(value, int):
                raise ValueError(
                    f"scrapline-rl: invalid action: entry {i} must be an integer "
                    f"in [0, {size})"
                )
            if value < 0 or value >= size:
                raise ValueError(
                    f"scrapline-rl: invalid action: entry {i} must be an integer "
                    f"in [0, {size})"
                )
            coerced.append(int(value))
        return coerced

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        seed_int = 0 if seed is None else int(seed)
        tier = self.tier
        bots = self.bots
        map_name = self.map
        if options:
            if "tier" in options and isinstance(options["tier"], str):
                tier = options["tier"]
            if "bots" in options:
                bots = int(options["bots"])
            if "map" in options and isinstance(options["map"], str):
                map_name = options["map"]
        reply = self._rpc(
            {"op": "reset", "seed": seed_int, "tier": tier, "bots": bots, "map": map_name}
        )
        obs = np.asarray(reply.get("obs", []), dtype=np.float32)
        info_raw = reply.get("info", {})
        info = dict(info_raw) if isinstance(info_raw, dict) else {}
        return obs, info

    def step(self, action: Any) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        discrete = self._coerce_action(action)
        reply = self._rpc({"op": "step", "action": discrete})
        obs = np.asarray(reply.get("obs", []), dtype=np.float32)
        reward = float(reply.get("reward", 0.0))
        terminated = bool(reply.get("terminated", False))
        truncated = bool(reply.get("truncated", False))
        info_raw = reply.get("info", {})
        info = dict(info_raw) if isinstance(info_raw, dict) else {}
        return obs, reward, terminated, truncated, info

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        proc = self._proc
        try:
            if proc.poll() is None and proc.stdin is not None:
                try:
                    proc.stdin.write('{"op":"close"}\n')
                    proc.stdin.flush()
                except (BrokenPipeError, OSError, ValueError):
                    pass
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                except (OSError, ValueError):
                    pass
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:
                        proc.kill()
                    except (OSError, ValueError):
                        pass
        finally:
            for stream in (proc.stdin, proc.stdout):
                try:
                    if stream is not None:
                        stream.close()
                except (OSError, ValueError):
                    pass

    def __del__(self) -> None:  # pragma: no cover - best-effort cleanup
        try:
            self.close()
        except Exception:
            pass


def make_vec_env(num_envs: int = 2, **kwargs: Any) -> gym.vector.SyncVectorEnv:
    """Build a SyncVectorEnv of N independent ScraplineEnv instances.

    Each instance owns its own stdio pipe, so no port or lock sharing is
    needed; AsyncVectorEnv fork/spawn machinery is deliberately avoided.
    """

    def _make(**kw: Any) -> Callable[[], ScraplineEnv]:
        def _thunk() -> ScraplineEnv:
            return ScraplineEnv(**kw)

        return _thunk

    return gym.vector.SyncVectorEnv([_make(**kwargs) for _ in range(num_envs)])
