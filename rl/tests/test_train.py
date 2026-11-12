"""Fast unit tests for the PPO training baseline (no training, no torch)."""

import math
import re
import subprocess
import sys
from pathlib import Path

_TRAIN_PY = Path(__file__).resolve().parents[1] / "scrapline_rl" / "train.py"


def test_help_lists_required_flags():
    proc = subprocess.run(
        [sys.executable, str(_TRAIN_PY), "--help"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(_TRAIN_PY.parents[2]),
    )
    assert proc.returncode == 0
    out = proc.stdout + proc.stderr
    assert "--steps" in out
    assert "--envs" in out
    assert "--tier" in out


def test_format_summary_emits_mean_reward():
    from scrapline_rl.train import format_summary

    line = format_summary("easy", [0.5, -0.25, 1.0], [3.0, 5.0])
    assert "tier=easy" in line
    match = re.search(r"mean_reward=(-?\d+\.\d+)", line)
    assert match is not None
    assert math.isfinite(float(match.group(1)))

    # Fallback: zero completed episodes still yields a finite number.
    fallback = format_summary("easy", [0.5, -0.25], [])
    match = re.search(r"mean_reward=(-?\d+\.\d+)", fallback)
    assert match is not None
    assert math.isfinite(float(match.group(1)))

    empty = format_summary("easy", [], [])
    match = re.search(r"mean_reward=(-?\d+\.\d+)", empty)
    assert match is not None
    assert math.isfinite(float(match.group(1)))
