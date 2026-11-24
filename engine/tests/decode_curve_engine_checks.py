#!/usr/bin/env python3
"""The Decode curve (API-SPEC §17, macOS 2.x, ported).

    python engine/tests/decode_curve_engine_checks.py --library PATH [--resources DIR]

Needs numpy and the built engine DLL; no fixture. What is held, and why each one
can fail:

  off is byte-exact    no `scene_curve` is the render without one, exactly.
  the identity is off  a table that samples the diagonal renders the same bits
                       as "" (the gain is exactly 1 everywhere it is read).
  a curve bends tone    y = x^0.7 (a brightening curve) lifts the picture, and
                       a darkening curve drops it; the direction is the row's.
  the axis is stops    a narrow notch in the curve lifts one band of a grey
                       ramp. The band sits at mid-grey (0.184) with Film
                       Exposure 0, and one stop above it with Film Exposure +1:
                       the table is read at E + c (RFC-035 §5.3), so the curve
                       stays on the scene the person drew it on while the film
                       exposure moves the scene along it.
  refused              a malformed table (values outside 0..1, a count that is
                       not five rows of at least two) is refused at open.
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
}
N = 33


def table(fn) -> str:
    """Five identical rows of a curve sampled at N points (rgb, luma, r, g, b)."""
    values = [fn(i / (N - 1)) for i in range(N)]
    return ",".join("%.8f" % v for _ in range(5) for v in values)


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def flat(value=0.18, h=64, w=64):
    return np.full((h, w, 3), value, np.float32)


def ramp(h=96, w=384):
    """A grey ramp from -6 to +6 stops about mid-grey, as linear light."""
    stops = np.linspace(-6.0, 6.0, w)
    values = (0.184 * np.power(2.0, stops)).astype(np.float32)
    img = np.empty((h, w, 3), np.float32)
    img[:] = values[None, :, None]
    return img, values


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

    print("off is byte-exact")
    off = render(engine, frame, {})
    check(np.array_equal(off, render(engine, frame, {"scene_curve": ""})), "no table is the render without one")

    print("the identity is off")
    ident = render(engine, frame, {"scene_curve": table(lambda x: x)})
    check(np.array_equal(ident, off), "a diagonal table renders the same bits as \"\"")

    print("a curve bends tone, in its row's direction")
    bright = render(engine, frame, {"scene_curve": table(lambda x: x ** 0.7)})
    dark = render(engine, frame, {"scene_curve": table(lambda x: x ** 1.6)})
    report["identity_level"] = float(off.mean())
    report["bright_level"] = float(bright.mean())
    report["dark_level"] = float(dark.mean())
    check(bright.mean() > off.mean() + 100.0, f"brightening curve: {off.mean():.0f} -> {bright.mean():.0f}")
    check(dark.mean() < off.mean() - 100.0, f"darkening curve: {off.mean():.0f} -> {dark.mean():.0f}")

    print("the axis is stops about mid-grey: +0.32 stop on the luma row is that much exposure")
    # One row only (luma), so the gain is one multiplication and the film sees
    # exactly v * 2^(16 * 0.02): the same bits as scaling the input by it.
    Nn = N
    def one_row(row: int, fn) -> str:
        rows = [[i / (Nn - 1) for i in range(Nn)] for _ in range(5)]
        rows[row] = [fn(i / (Nn - 1)) for i in range(Nn)]
        return ",".join("%.8f" % v for r in rows for v in r)
    luma = one_row(1, lambda x: min(1.0, x + 0.02))
    with_curve = render(engine, flat(0.184), {"scene_curve": luma})
    scaled = render(engine, np.full((64, 64, 3), 0.184 * 2.0 ** 0.32, np.float32), {})
    d = np.abs(with_curve - scaled)
    report["luma_gain_max_code"] = float(d.max())
    check(d.max() <= 2, f"the luma row's +0.02 is a +0.32 stop exposure (max |d| {d.max():.0f} codes)")

    print("the axis is stops about mid-grey, moved by Film Exposure")
    img, values = ramp()
    # A narrow +0.8 stop bump centred on u = 0.5 (E = 0 with no Film Exposure).
    def notch(x: float) -> float:
        return float(np.clip(x + 0.05 * np.exp(-((x - 0.5) / 0.08) ** 2), 0.0, 1.0))

    def peak_column(ec: float) -> float:
        on = render(engine, img, {"scene_curve": table(notch), "exposure_compensation_ev": ec})
        base = render(engine, img, {"exposure_compensation_ev": ec})
        ratio = (on[:, 8:-8] / np.maximum(base[:, 8:-8], 1e-9)).mean(axis=(0, 2))
        col = int(np.argmax(ratio)) + 8
        return float(np.log2(max(values[col] / 0.184, 1e-9)))

    peak0 = peak_column(0.0)
    peak1 = peak_column(1.0)
    report["notch_stop_ec0"] = peak0
    report["notch_stop_ec1"] = peak1
    report["notch_stop_ec0"] = peak0
    # The table is read at E + c, so the curve's mid-grey lands on the input that
    # the film exposure lifts to mid-grey: one stop *down* the input ramp at +1 EV.
    check(abs((peak1 - peak0) + 1.0) < 0.6,
          f"Film Exposure +1 moves the notch one stop down the input ({peak0:+.2f} -> {peak1:+.2f})")

    print("refused: a malformed table never reaches the pipeline")
    for bad in ("1,2,3", "0,2", "0,0.5,1"):
        try:
            engine.open(flat(), dict(BASE, scene_curve=bad)).close()
            check(False, f"'{bad}' must be refused")
        except spk.EngineError as exc:
            check("scene_curve" in str(exc), f"refused: {exc}")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
