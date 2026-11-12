"""Fast unit tests for the bot-tier eval harness (no env, no torch)."""

import subprocess
import sys
from pathlib import Path

_EVAL_PY = Path(__file__).resolve().parents[1] / "scrapline_rl" / "eval.py"


def test_help_lists_required_flags():
    proc = subprocess.run(
        [sys.executable, str(_EVAL_PY), "--help"],
        capture_output=True,
        text=True,
        timeout=60,
        cwd=str(_EVAL_PY.parents[2]),
    )
    assert proc.returncode == 0
    out = proc.stdout + proc.stderr
    assert "--model" in out
    assert "--episodes" in out
    assert "--tier" in out
    assert "--seed" in out
    assert "--max-steps" in out
    assert "--bots" in out
    assert "--map" in out


def test_resolve_tiers():
    from scrapline_rl.eval import TIERS, resolve_tiers

    assert resolve_tiers("easy") == ["easy"]
    assert resolve_tiers("EASY") == ["easy"]
    assert resolve_tiers("all") == list(TIERS)
    assert list(TIERS) == ["easy", "normal", "hard", "elite"]
    assert resolve_tiers("bogus") == ["normal"]


def test_compute_row_win_tie_loss():
    from scrapline_rl.eval import _is_win, compute_row

    assert _is_win([5, 3, 2]) is True
    assert _is_win([5, 5, 2]) is True  # ties count as wins (player 0)
    assert _is_win([3, 5, 2]) is False

    row = compute_row("easy", 1, 9, 2)
    assert row["tier"] == "easy"
    assert row["episodes"] == 2
    assert row["wins"] == 1
    assert row["win_rate"] == 50.0
    assert row["kills"] == 9
    assert row["kills_per_match"] == 4.5


def test_format_table_header_and_counts():
    from scrapline_rl.eval import compute_row, format_table

    rows = [compute_row("easy", 1, 9, 2)]
    text = format_table(rows)
    header = text.splitlines()[0]
    assert "tier" in header
    assert "wins" in header
    assert "win-rate" in header
    assert "kills" in header
    assert "episodes" in header
    assert "easy" in text


def test_load_policy_random_never_imports_torch():
    for module in ("stable_baselines3", "torch"):
        sys.modules.pop(module, None)
    from scrapline_rl.eval import load_policy

    kind, handle = load_policy("random")
    assert kind == "random"
    assert handle is None
    assert "stable_baselines3" not in sys.modules
