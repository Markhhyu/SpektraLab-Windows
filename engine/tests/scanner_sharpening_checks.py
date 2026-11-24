#!/usr/bin/env python3
"""The scan's unsharp mask, exposed (the audit's M-3).

    python engine/tests/scanner_sharpening_checks.py --library PATH [--resources DIR]

The engine always ran a 0.7 px / 0.7 unsharp mask on every render -- the
reference's default that the audit measured as +70 % gain at Nyquist, hidden
from the UI and applied to exports too. The wire now carries it, the engine
keeps the reference default (parity unchanged), and the product sends 0. What
is held here:

  explicit zero     amount 0 is a byte-for-byte bypass (the node is skipped).
  sigrna zero       a sigma of 0 with an amount is also the identity.
  acutance          on a checker, amount 0.7 raises the high-frequency metric;
                    0.4 < 0.7 in the same direction.
  grain             on a flat grey with grain on, sharpening amplifies the
                    grain -- the texture consequence the audit described.
  refused           an out-of-range amount/sigma is refused at open.
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
    "film_stock": "kodak_vision3_50d", "print_stock": "kodak_portra_endura",
    "auto_exposure": False, "glare_active": False, "halation_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
}


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def hf(rgb: np.ndarray) -> float:
    """Checkerboard/edge acutance: the Laplacian's standard deviation."""
    g = rgb[..., 1]
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.std())


def grain_rms(rgb: np.ndarray) -> float:
    g = rgb[..., 1]
    return float((g - g.mean()).std())


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

    h = w = 768
    yy, xx = np.mgrid[0:h, 0:w]
    checker = np.full((h, w, 3), 0.18, np.float32)
    checker += (((yy + xx) // 3 & 1) * 0.10)[..., None]

    print("amount 0 is a byte-for-byte bypass")
    off = render(engine, checker, {"scanner_unsharp_amount": 0.0, "scanner_unsharp_sigma": 0.7})
    off2 = render(engine, checker, {"scanner_unsharp_amount": 0.0, "scanner_unsharp_sigma": 0.0})
    check(np.array_equal(off, off2), "amount 0 renders the same as both at 0")

    print("a sigma of 0 with an amount is also the identity")
    check(np.array_equal(render(engine, checker, {"scanner_unsharp_amount": 0.7,
                                                  "scanner_unsharp_sigma": 0.0}), off),
          "amount 0.7 with sigma 0 is the bypass")

    print("acutance rises with the amount")
    a4 = render(engine, checker, {"scanner_unsharp_amount": 0.4, "scanner_unsharp_sigma": 0.7})
    a7 = render(engine, checker, {"scanner_unsharp_amount": 0.7, "scanner_unsharp_sigma": 0.7})
    base, mid, strong = hf(off), hf(a4), hf(a7)
    report["checker_hf"] = {"0": base, "0.4": mid, "0.7": strong}
    check(mid > base * 1.05, f"0.4 > off ({base:.0f} -> {mid:.0f})")
    check(strong > mid * 1.05, f"0.7 > 0.4 ({mid:.0f} -> {strong:.0f})")

    print("sharpening amplifies grain (the texture consequence)")
    flat = np.full((h, w, 3), 0.18, np.float32)
    g_off = render(engine, flat, {"scanner_unsharp_amount": 0.0,
                                  "scanner_unsharp_sigma": 0.7, "grain_active": True})
    g_on = render(engine, flat, {"scanner_unsharp_amount": 0.7,
                                 "scanner_unsharp_sigma": 0.7, "grain_active": True})
    r_off, r_on = grain_rms(g_off), grain_rms(g_on)
    report["grain_rms"] = {"off": r_off, "on": r_on}
    check(r_on > r_off * 1.10, f"grain rms {r_off:.1f} -> {r_on:.1f} (+{100.0*(r_on/r_off-1.0):.0f}%)")

    print("refused: out-of-range values never reach the pipeline")
    for bad in ({"scanner_unsharp_amount": -0.1}, {"scanner_unsharp_amount": 3.0},
                {"scanner_unsharp_sigma": 9.0}):
        try:
            engine.open(checker, dict(BASE, **bad)).close()
            check(False, f"{bad} must be refused")
        except spk.EngineError as exc:
            check("scanner_unsharp" in str(exc), f"refused: {exc}")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
