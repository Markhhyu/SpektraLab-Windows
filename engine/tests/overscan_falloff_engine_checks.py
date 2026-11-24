#!/usr/bin/env python3
"""The film-with-no-antisky lens falloff over the picture (API-SPEC §21.4,
macOS 2.x, ported): `overscan_falloff`.

    python engine/tests/overscan_falloff_engine_checks.py --library PATH [--resources DIR]

Needs numpy and the built engine DLL; no fixture. What is held:

  no film edge        with `overscan_active` false the field is inert: an amount
                      set but no edge renders exactly as without it.
  off is identity     an edge with `overscan_falloff` 0 is the edge without it.
  corners, not centre the falloff is cos^n about the gate's centre: with it on,
                      the frame's corners lose light while the centre keeps it.
  deterministic       the camera's own exponent (3.8-4.2) is drawn from the
                      camera seed, so the same seeds render the same picture.
  monotone            a larger amount darkens the corners further.
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
    "film_stock": "kodak_portra_400", "print_stock": "kodak_supra_endura",
    "auto_exposure": False, "exposure_compensation_ev": 0.0,
    "grain_active": False, "glare_active": False, "halation_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
    # A flat, bright grey: the falloff is a gain, and flat light shows it.
}
EDGE = {"overscan_active": True, "overscan_format": "135", "overscan_fog": 0.0,
        "overscan_leaks": 0.0, "overscan_edge_text": "", "overscan_gate": "square"}


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def flat(h=384, w=576, value=0.5):
    return np.full((h, w, 3), value, np.float32)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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
        if not ok: failures.append(what)

    frame = flat()

    print("no film edge: the field is inert")
    plain = render(engine, frame, {})
    with_amount = render(engine, frame, {"overscan_falloff": 1.2})
    check(np.array_equal(plain, with_amount), "an amount without the film edge is the render without it")

    print("off is identity")
    edge = render(engine, frame, EDGE)
    edge_off = render(engine, frame, {**EDGE, "overscan_falloff": 0.0})
    check(np.array_equal(edge, edge_off), "an edge with the falloff at 0 is the edge without it")

    print("corners lose light, the centre keeps it")
    on = render(engine, frame, {**EDGE, "overscan_falloff": 1.2})
    base_l = edge.mean(axis=2)
    # Compare only where the picture is bright (the rebate is near black and a
    # ratio there divides by noise); the deepest loss must be away from the
    # gate's centre, and the centre itself must keep its light.
    bright = base_l > 0.35 * np.median(base_l)
    ratio = on.mean(axis=2) / np.maximum(base_l, 1e-9)
    h, w = ratio.shape[:2]
    cy, cx = h // 2, w // 2
    yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(yy - cy, xx - cx) / np.hypot(cy, cx)
    usable = bright & (ratio > 0.3) & (ratio < 1.3)
    centre_mask = usable & (np.abs(yy - cy) < 30) & (np.abs(xx - cx) < 30)
    centre = ratio[centre_mask].mean()
    idx = np.argmin(np.where(usable, ratio, np.inf))
    deepest, deepest_r = ratio.flat[idx], rr.flat[idx]
    report["centre_ratio"] = float(centre)
    report["deepest_ratio"] = float(deepest)
    report["deepest_radius"] = float(deepest_r)
    check(centre > 0.98, f"the centre keeps its light ({centre:.3f}x)")
    check(deepest < 0.92 and deepest_r > 0.35,
          f"the deepest loss is off-centre: {deepest:.3f}x at {deepest_r:.2f} of the half-diagonal")

    print("deterministic")
    on2 = render(engine, frame, {**EDGE, "overscan_falloff": 1.2})
    check(np.array_equal(on, on2), "the same camera seed draws the same exponent")

    print("monotone in the amount")
    more = render(engine, frame, {**EDGE, "overscan_falloff": 1.5})
    more_ratio = more.mean(axis=2) / np.maximum(base_l, 1e-9)
    check(more_ratio[usable].mean() < ratio[usable].mean(),
          f"a larger amount darkens the picture further ({more_ratio[usable].mean():.3f} < {ratio[usable].mean():.3f})")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
