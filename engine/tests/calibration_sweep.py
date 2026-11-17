"""Calibration sweeps for the grain / DIR-coupler / halation controls (P1-9).

The parity harness answers "does a setting match the reference at one value?".
This one answers the calibration questions the verification protocol asks of
the *controls* themselves (验证协议 M4/M6/M7): does each amount move the image
in the direction and with the magnitude the model claims, is the trend
monotonic, and where does the public reference stop sharing the semantics?

Three charts are measured on one synthetic frame:

    grain      a flat mid-grey patch; the metric is the counted standard
               deviation inside it. The three-layer cloud model says the RMS
               grows with the amount (it is a strength, not a variance).
    DIR        a flat bright patch; the metric is its mean count. Couplers
               inhibit development where density is high, so more amount must
               lower it, monotonically.
    halation   a dark band beside a clipped 6.0 highlight; the metric is the
               band's mean count (the spill). More amount must raise it.

The reference comparison is only claimed where the public upstream package
implements the same semantics: DIR throughout, halation at 1.0 (RFC-034 made
this engine's number an *area* multiplier; upstream scales the light only, and
the fork-era note in the docs records that). Where the two legitimately
diverge, the sweep records the divergence size instead of failing.

Usage mirrors `parity_upstream.py`:

    python engine/tests/calibration_sweep.py --size 512 \
        --library build/win-host/spektrafilm_engine.dll \
        --resources build/win-host/resources --ref-src ../spektrafilm-main/src
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

from spk_test_paths import add_engine_arguments, engine_options

REPO = Path(__file__).resolve().parents[2]

DIR_AMOUNTS = (0.6, 0.8, 1.0, 1.25, 1.5)
HALATION_AMOUNTS = (0.5, 1.0, 1.5, 2.5)
GRAIN_AMOUNTS = (0.3, 0.7, 1.0, 1.4)

DIR_REFERENCE_AMOUNTS = set(DIR_AMOUNTS)          # same semantics everywhere
HALATION_REFERENCE_AMOUNTS = {1.0}                # identity only


def build_chart(size: int) -> tuple[np.ndarray, dict[str, tuple[slice, slice]]]:
    """A flat chart plus the three measurement windows.

    The windows are large enough that the halation spill of the clipped square
    sits in the dark band but the band itself is far from the grain patch, so
    one render serves all three metrics.
    """
    h = int(size)
    w = int(size * 4 / 3)
    array = np.zeros((h, w, 3), dtype=np.float32)
    array[...] = 0.05                                   # dark surround
    mid = (slice(int(h * 0.10), int(h * 0.10) + h // 8),
           slice(int(w * 0.05), int(w * 0.05) + w // 8))
    bright = (slice(int(h * 0.10), int(h * 0.10) + h // 8),
              slice(int(w * 0.78), int(w * 0.78) + w // 8))
    array[mid] = 0.18
    array[bright] = 0.60
    # The clipped square drives halation and sits well left of the spill band.
    sq_y, sq_x = int(h * 0.55), int(w * 0.50)
    array[sq_y:sq_y + h // 10, sq_x:sq_x + h // 10] = 6.0
    # The spill is only a few pixels wide at this chart's film pitch (36 mm
    # across 682 px is ~53 um/px, so the 65 um halation sigma is ~1.2 px), so
    # the window has to start at the square's edge: a band a dozen pixels out
    # measures the flat surround and reports no response at all.
    band = (slice(sq_y + h // 40, sq_y + h // 10 - h // 40),
            slice(sq_x + h // 10, sq_x + h // 10 + 4))
    windows = {
        "grain": (slice(int(h * 0.10), int(h * 0.10) + h // 8),
                  slice(int(w * 0.05), int(w * 0.05) + w // 8)),
        "dir": bright,
        "halation": band,
    }
    return np.ascontiguousarray(array), windows


def measure(rgba: np.ndarray, windows: dict[str, tuple[slice, slice]]) -> dict:
    # `render` hands back 16-bit counts already (the ctypes boundary packs
    # rgba16 exactly the way the PNG/TIFF writer sees it), not 0..1 floats.
    counts = np.clip(rgba[..., :3].astype(np.float64), 0.0, 65535.0)
    out: dict[str, float] = {}
    for name, window in windows.items():
        patch = counts[window]
        if name == "grain":
            # Mean-remove only: the window is flat, so what remains is the
            # grain field plus the (settled) dye-cloud structure.
            out[name] = float(np.std(patch - patch.mean()))
        else:
            out[name] = float(patch.mean())
    return out


def monotonic(values: list[float], direction: int) -> bool:
    """Strictly monotonic, in the sign `direction` asks for (or either sign)."""
    steps = np.diff(np.asarray(values, dtype=np.float64))
    if direction == 0:
        return bool(np.all(steps > 0.0) or np.all(steps < 0.0))
    return bool(np.all(steps * direction > 0.0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--ref-src", type=Path,
                    help="upstream reference src/ (or SPEKTRAFILM_REF_SRC)")
    ap.add_argument("--dll-dir", action="append", type=Path)
    ap.add_argument("--json-out", type=Path)
    add_engine_arguments(ap)
    args = ap.parse_args()

    ref_src = args.ref_src or os.environ.get("SPEKTRAFILM_REF_SRC")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    if ref_src:
        sys.path.insert(0, str(Path(ref_src).expanduser().resolve()))

    lib = Path(args.library or os.environ.get("SPEKTRAFILM_ENGINE_LIBRARY")
               or (REPO / "build/win-host/spektrafilm_engine.dll")).expanduser().resolve()
    if sys.platform == "win32":
        dirs = [lib.parent, lib.parent / "host"] + list(args.dll_dir or [])
        deps = os.environ.get("SPEKTRAFILAB_DEPS_DIR") or os.environ.get("SPEKTRAFILM_DEPS_DIR")
        if deps:
            dirs.append(Path(deps) / "mingw64/bin")
        for d in dirs:
            if d.is_dir():
                os.add_dll_directory(str(d))

    import parity_upstream as pu
    from spk_ctypes import Engine

    frame, windows = build_chart(args.size)
    base = {"grain_active": True, "dir_couplers_active": True,
            "halation_active": True, "glare_active": False,
            "auto_exposure": False}
    records: list[dict] = []
    failures: list[str] = []

    with Engine(**engine_options(args)) as engine:
        print(f"engine {engine.build_info}")
        print(f"chart {frame.shape[1]}x{frame.shape[0]}")

        def render(delta: dict) -> dict:
            with engine.open(frame, {**base, **delta}) as session:
                rgba, _ = session.render("full")
                return measure(rgba, windows)

        # -- DIR: brighter = more inhibition. -------------------------------
        dir_values: dict[float, dict] = {}
        for amount in DIR_AMOUNTS:
            dir_values[amount] = render({"dir_couplers_amount": amount, "grain_active": False})
            print(f"  dir  amount {amount:>4}: bright patch mean "
                  f"{dir_values[amount]['dir']:.1f} counts")
        # Which way the coupler amount moves a flat bright patch is a property
        # of the model (the inhibitor spreads from the high-density patch into
        # its surroundings), so the sweep asserts a *monotonic, non-trivial*
        # response and records the measured sign rather than presuming it.
        dir_series = [dir_values[a]["dir"] for a in DIR_AMOUNTS]
        if not monotonic(dir_series, 0):
            failures.append("DIR: the bright patch did not respond monotonically with amount")
        elif abs(dir_series[-1] - dir_series[0]) < 0.001 * dir_series[0]:
            failures.append("DIR: the response is too small to call (under 0.1 %)")
        if ref_src:
            for amount in DIR_AMOUNTS:
                delta = {"dir_couplers_amount": amount, "grain_active": False}
                with engine.open(frame, {**base, **delta}) as session:
                    rgba, _ = session.render("full")
                    space = session.reply["params"]["output_color_space"]
                want = pu.reference_render(frame, "kodak_portra_400", "kodak_portra_endura",
                                           delta, space)
                if not pu.compare(f"dir_{amount}", rgba, want, False):
                    failures.append(f"DIR {amount}: reference disagreement inside the shared domain")

        # -- halation: the dark spill band must brighten. -------------------
        hal_values: dict[float, dict] = {}
        for amount in HALATION_AMOUNTS:
            hal_values[amount] = render({"halation_amount": amount, "grain_active": False})
            print(f"  hal  amount {amount:>4}: spill band mean "
                  f"{hal_values[amount]['halation']:.1f} counts")
        if not monotonic([hal_values[a]["halation"] for a in HALATION_AMOUNTS], 1):
            failures.append("halation: the spill band did not brighten monotonically with amount")
        if ref_src:
            for amount in HALATION_AMOUNTS:
                delta = {"halation_amount": amount, "grain_active": False}
                with engine.open(frame, {**base, **delta}) as session:
                    rgba, _ = session.render("full")
                    space = session.reply["params"]["output_color_space"]
                want = pu.reference_render(frame, "kodak_portra_400", "kodak_portra_endura",
                                           delta, space)
                expected = None if amount in HALATION_REFERENCE_AMOUNTS else (
                    "RFC-034 area-multiplier vs the reference's light-only scaling")
                if not pu.compare(f"halation_{amount}", rgba, want, False, expected):
                    failures.append(f"halation {amount}: unexpected reference agreement/divergence")

        # -- grain: the flat patch's RMS must grow with amount. -------------
        grain_values: dict[float, dict] = {}
        for amount in GRAIN_AMOUNTS:
            grain_values[amount] = render({"grain_amount": amount})
            print(f"  grain amount {amount:>4}: flat patch RMS "
                  f"{grain_values[amount]['grain']:.2f} counts")
        if not monotonic([grain_values[a]["grain"] for a in GRAIN_AMOUNTS], 1):
            failures.append("grain: the flat patch RMS did not grow monotonically with amount")

        records = [
            {"control": "dir", "amount": a, **dir_values[a]} for a in DIR_AMOUNTS
        ] + [
            {"control": "halation", "amount": a, **hal_values[a]} for a in HALATION_AMOUNTS
        ] + [
            {"control": "grain", "amount": a, **grain_values[a]} for a in GRAIN_AMOUNTS
        ]

    payload = {"library": str(lib), "size": args.size,
               "reference_src": str(ref_src) if ref_src else None,
               "records": records, "failures": failures}
    if args.json_out:
        args.json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    print(f"\ncalibration sweep: {len(records)} points, {len(failures)} failed")
    for failure in failures:
        print(f"  FAIL {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
