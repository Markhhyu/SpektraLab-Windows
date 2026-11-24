#!/usr/bin/env python3
"""The halo's per-channel geometry for every stock (the audit's H-1).

    python engine/tests/halation_stock_checks.py --library PATH [--resources DIR]

Before the fix all 27 non-CineStill stocks shared one 65 um three-channel
Gaussian (50 um for cine): the red record's halo was exactly as wide as the
blue's, against real film where red is the deepest record and reaches furthest.
CineStill already had the physical back-reflection kernel. What is held here:

  strong layer      PORTRA 400's halo is small (a strong anti-halation layer);
  weak layer        GOLD 200 / ULTRA MAX 400's halo is several times the strong
                    one's in total energy;
  red reaches       the weak layer's red halo is wider than its blue (the layer
                    geometry shows through the residual return);
  CineStill         still the physical ring: the most light, the most reach,
                    red furthest -- and its halo is deterministic.
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
    "glare_active": False, "grain_active": False,
}
SIDE = 1536
DOT = 6


def render(engine, stock, delta=None):
    img = np.zeros((SIDE, SIDE, 3), np.float32)
    c = SIDE // 2
    img[c - DOT:c + DOT, c - DOT:c + DOT] = 30.0
    session = engine.open(img, dict(BASE, film_stock=stock, **(delta or {})))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def halo(engine, stock):
    """The halation-only difference image (the point's own light subtracted)."""
    return render(engine, stock) - render(engine, stock, {"halation_active": False})


def radial(img: np.ndarray, channel: int):
    c = img.shape[0] // 2
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[0]]
    r = np.hypot(xx - c, yy - c).astype(int)
    prof = np.bincount(r.ravel(), weights=img[..., channel].ravel())
    cnt = np.bincount(r.ravel())
    return prof / np.maximum(cnt, 1)


def stats(diff: np.ndarray, core_px: int = DOT + 2) -> dict:
    c = diff.shape[0] // 2
    yy, xx = np.mgrid[0:diff.shape[0], 0:diff.shape[0]]
    r = np.hypot(xx - c, yy - c)
    mask = (r > core_px) & (r < SIDE // 2)
    out = {}
    for ch, name in ((0, "R"), (1, "G"), (2, "B")):
        v = np.clip(diff[..., ch][mask], 0.0, None)
        total = float(v.sum())
        order = np.argsort(r[mask])
        rv = r[mask][order]
        vv = v[order]
        cum = np.cumsum(vv)
        r75 = float(rv[np.searchsorted(cum, 0.75 * cum[-1])]) if cum[-1] > 0 else 0.0
        out[name] = {"energy": total, "r75": r75}
    return out


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

    s: dict[str, dict] = {}
    for stock in ("kodak_portra_400", "kodak_gold_200", "kodak_ultramax_400",
                  "cinestill_800t"):
        s[stock] = stats(halo(engine, stock))
        report[stock] = s[stock]
        print(f"    {stock:20s} R {s[stock]['R']['energy']:9.3g}@{s[stock]['R']['r75']:.1f}px"
              f"  G {s[stock]['G']['energy']:9.3g}@{s[stock]['G']['r75']:.1f}px"
              f"  B {s[stock]['B']['energy']:9.3g}@{s[stock]['B']['r75']:.1f}px")

    strong = s["kodak_portra_400"]
    weak = s["kodak_gold_200"]
    weak2 = s["kodak_ultramax_400"]
    cine = s["cinestill_800t"]

    print("the layer, not one shared width: weak anti-halation halates far more")
    check(weak["R"]["energy"] > 2.0 * strong["R"]["energy"],
          f"GOLD 200 / PORTRA 400 red halo energy {weak['R']['energy']/strong['R']['energy']:.1f}x")
    check(weak2["R"]["energy"] > 2.0 * strong["R"]["energy"],
          f"ULTRA MAX 400 / PORTRA 400 red halo energy {weak2['R']['energy']/strong['R']['energy']:.1f}x")
    check(0.6 < weak["R"]["energy"] / max(weak2["R"]["energy"], 1e-9) < 1.6,
          "the two weak-layer stocks share their family (a tag, not a per-stock guess)")

    print("red reaches further than blue once the layer lets the geometry through")
    check(weak["R"]["r75"] > 1.10 * weak["B"]["r75"],
          f"GOLD 200 red {weak['R']['r75']:.1f}px vs blue {weak['B']['r75']:.1f}px")
    check(weak["R"]["r75"] > weak["G"]["r75"] >= weak["B"]["r75"] * 0.98,
          "R >= G >= B in reach")

    print("CineStill keeps the physical back-reflection kernel")
    check(cine["R"]["energy"] > 5.0 * strong["R"]["energy"],
          f"its red halo is {cine['R']['energy']/strong['R']['energy']:.0f}x the strong layer's")
    check(cine["R"]["r75"] > 2.0 * strong["R"]["r75"],
          f"its reach is {cine['R']['r75']:.1f}px against strong {strong['R']['r75']:.1f}px")
    check(cine["R"]["r75"] > 1.10 * cine["B"]["r75"],
          f"and its red reaches furthest ({cine['R']['r75']:.1f} vs {cine['B']['r75']:.1f}px)")

    print("deterministic")
    check(np.array_equal(halo(engine, "kodak_gold_200"), halo(engine, "kodak_gold_200")),
          "the same stock's halo is the same picture twice")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
