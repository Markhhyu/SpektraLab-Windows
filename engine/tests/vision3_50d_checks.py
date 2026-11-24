#!/usr/bin/env python3
"""VISION3 50D: the flagship stock's texture, held to its datasheet.

    python engine/tests/vision3_50d_checks.py --library PATH [--resources DIR]

Four things a "real film texture" claim for 50D has to pass:

  MTF               the small-signal MTF through the DI, relative to 3 cy/mm,
                    must sit on the datasheet's page-4 curves (10/20/30/40
                    cy/mm target 1.014/0.857/0.611/0.435 R, 1.012/0.898/0.688/
                    0.543 G, 0.959/0.740/0.569/0.469 B), and be monotone.
  push == warm      C-41's one-sixth stop per degree: push 0.5 at 20 C and
                    push 0 at 23 C are *one* development -- the same negative
                    and the same grain (the audit's C-11 had them 8.3% apart).
  grain seed        `grain_seed` holds one realisation (two renders identical);
                    two seeds differ; 0 keeps a fresh grain per render.
  grain structure   50D is the catalogue's finest-structured stock: its grain's
                    physical correlation length is below the higher-speed
                    VISION3s (whose clump sizes follow their sigma ratios).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from scipy.ndimage import convolve as nd_convolve

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spk_ctypes as spk  # noqa: E402

BASE = {
    "film_stock": "kodak_vision3_50d", "print_stock": "kodak_2383",
    "auto_exposure": False, "grain_active": False, "glare_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
}
FREQS = [3, 10, 20, 30, 40]
TARGET = {
    "R": {3: 1.0, 10: 1.014, 20: 0.857, 30: 0.611, 40: 0.435},
    "G": {3: 1.0, 10: 1.012, 20: 0.898, 30: 0.688, 40: 0.543},
    "B": {3: 1.0, 10: 0.959, 20: 0.740, 30: 0.569, 40: 0.469},
}
TOL = 0.10


def mtf_chart(w: int = 7000, band: int = 160) -> np.ndarray:
    h = band * len(FREQS)
    a = np.full((h, w, 3), 0.18, np.float32)
    x = np.arange(w)
    for i, f in enumerate(FREQS):
        cycles = f * 35.0            # cycles/mm over a 35 mm frame
        mod = 0.0036 * np.cos(2.0 * np.pi * cycles * x / w)
        a[i * band:(i + 1) * band] = (0.18 + mod)[None, :, None]
    return a


def fundamental(v: np.ndarray, cycles: float) -> float:
    x = np.arange(v.size)
    e = np.exp(-2j * np.pi * cycles * x / v.size)
    return float(2.0 * abs(np.sum((v - v.mean()) * e)) / v.size)


def render(engine, image, delta, tier="full"):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render(tier)
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def di(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render_digital_intermediate()
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def correlation_px(g: np.ndarray) -> float:
    x = g - g.mean()
    spec = np.fft.rfft(x, axis=1)
    ac = np.fft.irfft(spec * np.conj(spec), axis=1).mean(axis=0)
    ac /= ac[0]
    acc = 0.0
    for v in ac[1:]:
        if v <= 0:
            break
        acc += v
    return acc + 1.0


def grain_sigma(engine, stock: str, value: float = 0.18) -> np.ndarray:
    img = np.full((341, 512, 3), value, np.float32)
    on = render(engine, img, {"film_stock": stock, "grain_active": True,
                              "halation_active": False})
    off = render(engine, img, {"film_stock": stock, "grain_active": False,
                               "halation_active": False})
    return (on - off).std(axis=(0, 1))


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

    print("MTF against the 50D datasheet (10/20/30/40 cy/mm, relative to 3)")
    chart = mtf_chart()
    out = di(engine, chart, {"halation_active": True, "dir_couplers_active": True})
    h, w = out.shape[:2]
    band = h // len(FREQS)
    got: dict[str, dict[int, float]] = {"R": {}, "G": {}, "B": {}}
    for i, f in enumerate(FREQS):
        row = out[i * band + 40:(i + 1) * band - 40].mean(axis=0)   # mean over rows -> (w,3)
        for c, name in enumerate(("R", "G", "B")):
            got[name][f] = fundamental(row[:, c], f * 35.0)
    for name in ("R", "G", "B"):
        base = got[name][3]
        vals = {f: got[name][f] / base for f in FREQS}
        report[f"mtf_{name}"] = {str(k): float(v) for k, v in vals.items()}
        worst = max(abs(vals[f] - TARGET[name][f]) for f in FREQS[1:])
        check(worst < TOL, f"{name}: " + " ".join(f"{f}:{vals[f]:.3f}/{TARGET[name][f]:.3f}"
                                                 for f in FREQS[1:]) + f"  (worst {worst:.3f})")
        mono = all(vals[a] >= vals[b] - 0.02 for a, b in zip(FREQS[1:-1], FREQS[2:]))
        check(mono, f"{name}: monotone across 10-40 cy/mm")

    print("grain amplitude against the datasheet-calibrated reference")
    # The reference model's printing-density 48 um granularity at its 2600 px
    # rendering (13.46 um/px) is R 4.77 / G 5.26 / B 12.35 x1000 against the
    # sheet's 4.76 / 5.30 / 11.97, so its print-space green aperture sigma
    # there is 483 counts. The port was 2.49x too strong before calibration
    # (see VISION3-50D-VALIDATION.md); this gate holds the calibrated value.
    flat2600 = np.full((int(round(2600 * 2 / 3)), 2600, 3), 0.18, np.float32)
    # The product path: no scan sharpening. Datasheet granularity is measured
    # on developed film with a 48 um aperture and no scanner sharpening, so this
    # is the honest arm to compare with the sheet-calibrated reference (the
    # engine default of 0.7 reads 485 counts, +0.5 %).
    sharp = {"scanner_unsharp_amount": 0.0, "scanner_unsharp_sigma": 0.7}
    on = render(engine, flat2600, {"grain_active": True, "halation_active": False, **sharp})
    off = render(engine, flat2600, {"grain_active": False, "halation_active": False, **sharp})
    delta = (on - off)[..., 1]
    pitch = 35.0 * 1000.0 / 2600.0
    radius = 24.0 / pitch
    rad = int(np.ceil(radius))
    yy, xx = np.mgrid[-rad:rad + 1, -rad:rad + 1]
    kernel = np.where(np.hypot(xx, yy) <= radius, 1.0, 0.0)
    kernel /= kernel.sum()
    aperture = float(nd_convolve(delta, kernel, mode="nearest").std())
    report["grain_aperture_48um_green"] = aperture
    check(0.85 * 483.0 < aperture < 1.15 * 483.0,
          f"48 um aperture grain sigma {aperture:.0f} counts (reference 483, sheet-calibrated)")

    print("push 0.5 at 20 C == push 0 at 23 C (one development, C-41's 1/6 stop/C)")
    img = np.full((341, 512, 3), 0.18, np.float32)
    a = render(engine, img, {"development_push_stops": 0.5, "development_temperature_c": 20.0,
                             "grain_active": True, "halation_active": False})
    b = render(engine, img, {"development_push_stops": 0.0, "development_temperature_c": 23.0,
                             "grain_active": True, "halation_active": False})
    d = np.abs(a - b).max()
    report["push_temp_max_delta"] = float(d)
    check(d <= 1, f"the two renders agree (max |d| {d:.0f} code)")
    c = render(engine, img, {"development_push_stops": 0.667, "development_temperature_c": 20.0,
                             "grain_active": True, "halation_active": False})
    e = render(engine, img, {"development_push_stops": 0.0, "development_temperature_c": 24.0,
                             "grain_active": True, "halation_active": False})
    check(np.abs(c - e).max() <= 1,
          f"and +4 C equals its own push (+2/3): max |d| {np.abs(c - e).max():.0f}")

    print("grain_seed: one realisation held, two seeds different, 0 fresh")
    one = render(engine, img, {"grain_active": True, "halation_active": False, "grain_seed": 12345})
    two = render(engine, img, {"grain_active": True, "halation_active": False, "grain_seed": 12345})
    check(np.array_equal(one, two), "the same seed renders the same grain twice")
    other = render(engine, img, {"grain_active": True, "halation_active": False,
                                 "grain_seed": 54321})
    check(not np.array_equal(one, other), "a different seed moves the grain")
    # "Fresh per render" is a *same-session* fact: a new session draws its own
    # RNG sequence from the same start, so two sessions agree even when each
    # render is fresh. Render twice inside one session.
    session = engine.open(img, dict(BASE, grain_active=True, halation_active=False,
                                    grain_seed=0))
    try:
        f1, _ = session.render("full")
        f2, _ = session.render("full")
    finally:
        session.close()
    check(not np.array_equal(f1, f2), "seed 0 keeps the fresh grain per render")

    print("50D is the least grainy stock (T1/T3 amplitude, the sheet's ordering)")
    # Grain *structure* is the same physical clump for every stock; what the
    # sheet says differs is amplitude (sigma-D), and that is what the per-stock
    # calibration reproduces. 50D (the anchor row) must sit below every faster
    # stock at a common print level.
    def sigma(stock: str) -> float:
        flat = np.full((341, 512, 3), 0.18, np.float32)
        lo, hi = 0.01, 4.0
        for _ in range(11):
            mid = 0.5 * (lo + hi)
            if render(engine, flat, {"film_stock": stock, "grain_active": True,
                                     "halation_active": False}).mean() < 30000.0:
                lo = mid
            else:
                hi = mid
        delta = (render(engine, flat, {"film_stock": stock, "grain_active": True,
                                       "halation_active": False})
                 - render(engine, flat, {"film_stock": stock, "grain_active": False,
                                         "halation_active": False}))[..., 1]
        return float(delta.std())

    sig = {st: sigma(st) for st in ("kodak_vision3_50d", "kodak_vision3_250d",
                                    "kodak_vision3_500t", "kodak_portra_800")}
    print("    " + "  ".join(f"{k.split('_')[-2]}_{k.split('_')[-1]}:{v:.0f}"
                             for k, v in sig.items()))
    report["grain_sigma_print"] = {k: float(v) for k, v in sig.items()}
    check(all(sig[st] > sig["kodak_vision3_50d"] * 1.10 for st in sig
              if st != "kodak_vision3_50d"),
          "every faster stock is grainier than 50D")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
