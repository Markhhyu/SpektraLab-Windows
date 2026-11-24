#!/usr/bin/env python3
"""Per-stock grain calibration (the audit's G-2; T1/T3/T2 in sources.md §8).

    python engine/tests/grain_stock_checks.py --library PATH [--resources DIR]

Before the fix every still stock fell back to the VISION3 50D calibration: the
audit measured EKTAR 100 and PORTRA 800 within 1-3 % of each other in print
space, against real PGI 25 vs 48 (about 1.7x in sigma). What is held here:

  T3 (Kodak stills) EKTAR 100 / PORTRA 800 grain sigma is about 0.59 (0.76 /
                    1.29 by PGI, the anchor being PORTRA 400 at the 50D visual
                    level), measured at the *same print level* so density
                    differences do not mask the grain difference.
  anchor            PORTRA 400 / PORTRA 800 is about 0.77 (1.00 / 1.29).
  T1 retained       VISION3 500T is much grainier than 50D, and its blue (the
                    coarse record) more than its red.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spk_ctypes as spk  # noqa: E402

BASE = {
    "print_stock": "kodak_supra_endura", "auto_exposure": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
    "glare_active": False, "halation_active": False,
}
LEVEL = 30000.0   # print code to match across stocks


def render(engine, stock, value, delta):
    img = np.full((341, 512, 3), value, np.float32)
    session = engine.open(img, dict(BASE, film_stock=stock, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def grain_at_level(engine, stock):
    """The stock's grain sigma (per channel, print codes) at a common print level."""
    lo, hi = 0.01, 4.0
    for _ in range(14):
        mid = 0.5 * (lo + hi)
        if render(engine, stock, mid, {}).mean() < LEVEL:
            lo = mid
        else:
            hi = mid
    value = 0.5 * (lo + hi)
    on = render(engine, stock, value, {})
    off = render(engine, stock, value, {"grain_active": False})
    return (on - off).std(axis=(0, 1)), float(on.mean())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", "--dylib", dest="library", type=Path, required=True)
    ap.add_argument("--resources", type=Path, default=None)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()
    os.environ.setdefault("SPK_V2_REFERENCE_OPTICAL", "1")
    engine = spk.Engine(library=args.library, resources=args.resources)
    print(engine.build_info)
    failures: list[str] = []
    report: dict = {"build": engine.build_info}

    def check(ok: bool, what: str):
        print(("  ok    " if ok else "  FAIL  ") + what)
        if not ok:
            failures.append(what)

    sigma: dict[str, np.ndarray] = {}
    for stock in ("kodak_ektar_100", "kodak_portra_400", "kodak_portra_800",
                  "kodak_vision3_50d", "kodak_vision3_500t"):
        sigma[stock], level = grain_at_level(engine, stock)
        print(f"    {stock:22s} level {level:.0f}  sigma R/G/B "
              f"{sigma[stock][0]:7.1f}/{sigma[stock][1]:7.1f}/{sigma[stock][2]:7.1f}")
        report[stock] = [float(v) for v in sigma[stock]]

    print("T3: EKTAR 100 against PORTRA 800")
    ratio = sigma["kodak_ektar_100"] / np.maximum(sigma["kodak_portra_800"], 1e-9)
    report["ektar_over_portra800"] = [float(v) for v in ratio]
    check(np.all((ratio > 0.45) & (ratio < 0.72)),
          f"grain sigma ratio {ratio[0]:.2f}/{ratio[1]:.2f}/{ratio[2]:.2f} (target ~0.59; the audit measured 0.97-0.99)")

    print("T3 anchor: PORTRA 400 against PORTRA 800")
    ratio = sigma["kodak_portra_400"] / np.maximum(sigma["kodak_portra_800"], 1e-9)
    check(np.all((ratio > 0.68) & (ratio < 0.88)),
          f"grain sigma ratio {ratio[0]:.2f}/{ratio[1]:.2f}/{ratio[2]:.2f} (target ~0.78)")

    print("T1 retained: VISION3 500T against 50D")
    ratio = sigma["kodak_vision3_500t"] / np.maximum(sigma["kodak_vision3_50d"], 1e-9)
    report["vision3_500t_over_50d"] = [float(v) for v in ratio]
    check(ratio[2] > 1.6 and ratio[2] > ratio[0],
          f"blue record is the coarsest ({ratio[2]:.2f}x vs red {ratio[0]:.2f}x)")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
