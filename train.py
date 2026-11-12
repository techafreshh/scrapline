"""Root alias for the RL training entry point.

Proxies every CLI arg in-process to ``rl/scrapline_rl/train.py`` so
``python train.py --help`` prints the same ``--steps/--envs/--tier/--seed``
help text (and exit code) as invoking the module directly.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def main() -> int:
    target = Path(__file__).resolve().parent / "rl" / "scrapline_rl" / "train.py"
    if not target.is_file():
        print(f"train.py: missing training module at {target}", file=sys.stderr)
        return 1
    sys.argv = [str(target), *sys.argv[1:]]
    runpy.run_path(str(target), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
