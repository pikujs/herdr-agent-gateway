"""Hermes plugin entrypoint for Herdr Agent Gateway."""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure root plugin directory is in sys.path so submodules import cleanly
_pkg_root = Path(__file__).resolve().parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from hermes_herdr import register

__all__ = ["register"]
