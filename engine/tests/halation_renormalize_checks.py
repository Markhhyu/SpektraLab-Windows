#!/usr/bin/env python3
"""H-2: the late-halation renormalise, exposed.

    python engine/tests/halation_renormalize_checks.py --library PATH [--resources DIR]

The reference's halation mixes `(raw + a*halo)/(1+a)`, which dims the source's
highlights to keep the total light: the audit measured a 23 % drop in CineStill's
red peak at the default strength, against about 6 % on a real RAW. The wire now
carries `halation_renormalize` (engine default stays true, so parity is
unchanged; the product sends false). What is held here:

  default is true   omitting the field is byte-identical to setting it true.
  off is brighter   with it false, the point light's peak is higher.
  halo not divided  with the normalisation off the ring keeps the a*halo
                    light instead of dividing it by (1+a) -- 1.1-1.8x.
  off is identity   with halation off, both settings render the same picture.
  refused           a non-bool value is refused at open.
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
    "film_stock": "cinestill_800t", "print_stock": "kodak_portra_endura",
    "auto_exposure": False, "glare_active": False, "grain_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
    "halation_boost_ev": 0.0,
}


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


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

    side = 512
    img = np.zeros((side, side, 3), np.float32)
    c = side // 2
    img[c - 6:c + 6, c - 6:c + 6] = 0.6

    print("the engine default is renormalize=true")
    implicit = render(engine, img, {})
    explicit = render(engine, img, {"halation_renormalize": True})
    check(np.array_equal(implicit, explicit), "omitted == true, byte for byte")

    print("turning the darkening off brightens the source")
    off = render(engine, img, {"halation_renormalize": False})
    core = (slice(c - 4, c + 4), slice(c - 4, c + 4))
    peak_on = float(implicit[core].mean())
    peak_off = float(off[core].mean())
    report["core_peak"] = {"on": peak_on, "off": peak_off}
    check(peak_off > peak_on * 1.005, f"core mean {peak_on:.0f} -> {peak_off:.0f}")

    print("the halo itself is the same")
    yy, xx = np.mgrid[0:side, 0:side]
    ring = (np.hypot(xx - c, yy - c) > 12) & (np.hypot(xx - c, yy - c) < 80)

    def halo(image):
        diff = image - render(engine, img, {"halation_active": False})
        return float(np.clip(diff[..., 0][ring], 0, None).sum())

    h_on, h_off = halo(implicit), halo(off)
    report["halo_energy"] = {"on": h_on, "off": h_off}
    # Without the normalisation the halo is not divided by (1 + a), so the
    # halo-only ring gains that factor (CineStill's red a=0.30, print coupling
    # measured 1.44x).
    ratio = h_off / max(h_on, 1e-9)
    check(1.10 < ratio < 1.80, f"ring energy {ratio:.2f}x when the darkening is off")

    print("with halation off the setting is inert")
    a = render(engine, img, {"halation_active": False, "halation_renormalize": True})
    b = render(engine, img, {"halation_active": False, "halation_renormalize": False})
    check(np.array_equal(a, b), "no halo, no difference")

    print("refused: a non-bool value never reaches the pipeline")
    try:
        engine.open(img, dict(BASE, halation_renormalize=1)).close()
        check(False, "integer must be refused for a bool field")
    except spk.EngineError as exc:
        check("halation_renormalize" in str(exc), f"refused: {exc}")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
