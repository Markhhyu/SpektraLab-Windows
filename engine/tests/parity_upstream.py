"""Whole-image parity against the **public upstream** Python reference.

This repo's `parity_render.py` drives the private fork's `spektrafilm.service`
API (`schema.validate_delta` / `schema.apply_delta`), which the public upstream
package (github.com/andreavolpato/spektrafilm, v0.3.4) does not expose. This
adapter compares the same shipping DLL, through the same ctypes boundary, with
the *public* reference instead, so the port has a parity baseline that can be
reproduced without the fork.

The two references agree on the physics both of them implement: for the 28
stock profiles the two trees share, `src/spektrafilm/data/profiles/*.json` is
byte-identical to this repo's `resources/profiles/*.json` (profile data version
0.3.2). What the public reference cannot express are fork-only features
(contrast mask, scene latitude, Cineon DI, EDR) - those are not compared here.
The six stocks that live only in `engine/resources_product/` are covered by
`parity_product_stocks.py`, which adapts them for this package's loader.

Known divergence, marked `expect_divergence`:

    halation_amount off 1.0
        RFC-034 made this engine's number an *area* multiplier; the public
        reference scales the light only. At 1.0 both are the identity.

    dir_couplers_amount above ~1.736
        the reference's coupler inverse leaves `np.interp`'s documented domain
        (non-monotonic exposure axis) on kodak_portra_400; its output there is
        an artefact of the binary search, so agreement would be a coincidence.

`lens_blur_um` *does* agree: the fork-era note ("reference prunes it before
pixel_size_um exists") no longer holds for upstream 0.3.4, which applies it.

Usage:
    python engine/tests/parity_upstream.py --size 512 \\
        --library build/win-host/spektrafilm_engine.dll \\
        --resources build/win-host/resources

The reference package must be importable: set SPEKTRAFILM_REF_SRC to the
upstream checkout's `src/`, or pass `--ref-src`. Its dependencies are numpy,
scipy, colour-science, numba, opt-einsum (numba JIT makes the first run slow).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np

from spk_test_paths import add_engine_arguments, engine_options

REPO = Path(__file__).resolve().parents[2]

FLOAT_TOLERANCE = 3e-5
COUNT_TOLERANCE = 1.0
COUNT_OUTLIER_FRACTION = 1e-5

BASE = {"grain_active": False, "glare_active": False, "auto_exposure": False}

# wire name -> RuntimePhotoParams path
DELTA_MAP = {
    "exposure_compensation_ev": "camera.exposure_compensation_ev",
    "auto_exposure": "camera.auto_exposure",
    "lens_blur_um": "camera.lens_blur_um",
    "film_format_mm": "camera.film_format_mm",
    "density_curve_gamma": "film_render.density_curve_gamma",
    "dir_couplers_active": "film_render.dir_couplers.active",
    "dir_couplers_amount": "film_render.dir_couplers.amount",
    "halation_active": "film_render.halation.active",
    "halation_amount": "film_render.halation.halation_amount",
    "halation_boost_ev": "film_render.halation.boost_ev",
    "grain_active": "film_render.grain.active",
    "print_exposure": "enlarger.print_exposure",
    "m_filter_shift": "enlarger.m_filter_shift",
    "y_filter_shift": "enlarger.y_filter_shift",
    "preflash_exposure": "enlarger.preflash_exposure",
    "scanner_lens_blur": "scanner.lens_blur",
    "scan_film": "io.scan_film",
    "output_color_space": "io.output_color_space",
    "output_cctf_encoding": "io.output_cctf_encoding",
}

CASES = [
    ("defaults", {}),
    ("exposure_up", {"exposure_compensation_ev": 1.5}),
    ("gamma", {"density_curve_gamma": 1.4}),
    ("no_couplers", {"dir_couplers_active": False}),
    ("coupler_amount", {"dir_couplers_amount": 1.5}),
    ("no_halation", {"halation_active": False}),
    ("boost", {"halation_boost_ev": 3.0}),
    ("print_exposure", {"print_exposure": 1.6}),
    ("filter_shift", {"m_filter_shift": 0.4, "y_filter_shift": -0.3}),
    ("preflash", {"preflash_exposure": 0.35}),
    ("scan_film", {"scan_film": True}),
    ("srgb_out", {"output_color_space": "sRGB"}),
    ("linear_out", {"output_cctf_encoding": False}),
    ("prophoto_out", {"output_color_space": "ProPhoto RGB"}),
    ("scanner_blur", {"scanner_lens_blur": 4.0}),
    ("format_medium", {"film_format_mm": 60.0}),
    ("stock_gold", {"film_stock": "kodak_gold_200"}),
    ("stock_positive", {"film_stock": "fujifilm_velvia_100"}),
    ("paper_premier", {"print_stock": "kodak_endura_premier"}),
    ("lens_blur", {"lens_blur_um": 50.0}),
    ("halation_amount", {"halation_amount": 2.5}),
    ("coupler_amount_nonmonotonic", {"dir_couplers_amount": 2.0}),
]

EXPECT_DIVERGENCE = {
    "halation_amount": "RFC-034 area-multiplier vs the reference's light-only scaling",
    "coupler_amount_nonmonotonic": "reference np.interp outside its monotonic domain",
}


def set_path(obj, path: str, value) -> None:
    parts = path.split(".")
    for part in parts[:-1]:
        obj = getattr(obj, part)
    setattr(obj, parts[-1], value)


def apply_delta(params, delta: dict) -> None:
    for key, value in delta.items():
        if key in ("film_stock", "print_stock"):
            continue
        if key == "glare_active":
            params.film_render.glare.active = value
            params.print_render.glare.active = value
            continue
        path = DELTA_MAP.get(key)
        if path is None:
            print(f"  (unchanged reference key {key!r}: no mapping)")
            continue
        set_path(params, path, value)


def load_frame(size: int) -> np.ndarray:
    """Deterministic synthetic frame: gradient + noise + 1 px checker + highlights.

    The checker is load-bearing: a smooth gradient cannot show a 50 um lens
    blur, and this harness has no 1 MP smoke TIFF (that fixture lives in the
    private fork's tests/Test_image/).
    """
    rng = np.random.default_rng(7)
    h = size
    w = int(size * 4 / 3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    base = 0.05 + 0.5 * (xx / w) * (1.0 - 0.4 * yy / h)
    array = np.stack([base, base * 0.8 + 0.05, base * 0.6 + 0.1], axis=-1)
    array += 0.03 * rng.standard_normal(array.shape).astype(np.float32)
    array += (((yy.astype(np.int32) + xx.astype(np.int32)) & 1) * 0.10)[..., None]
    array[h // 4:h // 4 + h // 16, w // 3:w // 3 + w // 12] = 6.0
    return np.ascontiguousarray(np.clip(array, 0.0, None).astype(np.float32))


def reference_render(frame, film, paper, delta, output_space):
    from spektrafilm.runtime.params_builder import digest_params, init_params
    from spektrafilm.runtime.pipeline import SimulationPipeline

    params = init_params(film_profile=film, print_profile=paper)
    apply_delta(params, {**BASE, **delta})
    params.io.output_color_space = output_space
    # The engine resolves cctf from the delta too; the reference defaults to on.
    params.io.output_cctf_encoding = delta.get("output_cctf_encoding", True)
    params.settings.working_precision = "float32"
    params.settings.gpu_backend = ""
    params = digest_params(params)
    return np.asarray(SimulationPipeline(params).process(frame), dtype=np.float64)


def to_counts(array: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(array, dtype=np.float32), 0.0, 1.0)
    return (clipped * 65535.0 + 0.5).astype(np.uint16)


def compare(name: str, got: np.ndarray, want: np.ndarray, verbose: bool,
            expected: str | None = None) -> bool:
    """Report one case; `expected` overrides this module's divergence table.

    The product-stock harness keeps its own table because its divergences are
    about profiles this list cannot name, but the bars are the same ones.
    """
    if got.shape[:2] != want.shape[:2]:
        print(f"FAIL {name}: C++ {got.shape[:2]}, reference {want.shape[:2]}")
        return False
    a = got[..., :3].astype(np.int32)
    b = to_counts(want).astype(np.int32)
    delta = np.abs(a - b)
    worst_counts = int(delta.max())
    over = int((delta > COUNT_TOLERANCE).sum())
    fraction = over / delta.size
    float_delta = np.abs(a.astype(np.float64) / 65535.0
                         - np.clip(np.asarray(want, dtype=np.float64), 0.0, 1.0))
    worst_float = float(float_delta.max())

    note = expected if expected is not None else EXPECT_DIVERGENCE.get(name)
    if note:
        ok = worst_counts > COUNT_TOLERANCE
        print(("ok   " if ok else "FAIL ") + f"{name}: "
              + (f"diverges by {worst_counts} counts as expected ({note})" if ok
                 else "agrees, but this case exists because the two must not"))
        return ok

    ok = worst_float <= FLOAT_TOLERANCE and fraction <= COUNT_OUTLIER_FRACTION
    detail = (f"max {worst_float:.2e} absolute, {worst_counts} count"
              f"{'' if worst_counts == 1 else 's'}")
    if over:
        detail += f", {over} of {delta.size} ({100 * fraction:.5f} %) over 1 count"
    print(("ok   " if ok else "FAIL ") + f"{name}: {detail}")
    if not ok:
        idx = np.unravel_index(int(np.argmax(float_delta)), float_delta.shape)
        print(f"       worst at {idx}: C++ {float_delta[idx]:.2e} abs")
    if verbose:
        for q in (50, 90, 99, 99.9):
            print(f"       p{q}: {np.percentile(float_delta, q):.2e}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", action="append", help="run only these cases")
    ap.add_argument("--size", type=int, default=512,
                    help="synthetic frame height in pixels (default 512)")
    ap.add_argument("--ref-src", type=Path,
                    help="upstream reference src/ (or SPEKTRAFILM_REF_SRC)")
    ap.add_argument("--dll-dir", action="append", type=Path,
                    help="extra directory with MinGW runtime DLLs (Windows)")
    ap.add_argument("--verbose", "-v", action="store_true")
    add_engine_arguments(ap)
    args = ap.parse_args()

    ref_src = args.ref_src or os.environ.get("SPEKTRAFILM_REF_SRC")
    if not ref_src:
        print("error: pass --ref-src or set SPEKTRAFILM_REF_SRC to the upstream src/")
        return 2
    sys.path.insert(0, str(Path(ref_src).expanduser().resolve()))
    sys.path.insert(0, str(Path(__file__).resolve().parent))

    lib = Path(args.library or os.environ.get("SPEKTRAFILM_ENGINE_LIBRARY")
               or (REPO / "build/win-host/spektrafilm_engine.dll")).expanduser().resolve()
    frame = load_frame(args.size)
    print(f"frame {frame.shape[1]}x{frame.shape[0]} range {frame.min():.4f}..{frame.max():.4f}")

    if sys.platform == "win32":
        dirs = [lib.parent, lib.parent / "host"]
        dirs += list(args.dll_dir or [])
        deps = os.environ.get("SPEKTRAFILAB_DEPS_DIR") or os.environ.get("SPEKTRAFILM_DEPS_DIR")
        if deps:
            dirs.append(Path(deps) / "mingw64/bin")
        for d in dirs:
            if d.is_dir():
                os.add_dll_directory(str(d))

    from spk_ctypes import Engine

    cases = [c for c in CASES if not args.case or c[0] in args.case]
    failures = 0
    with Engine(**engine_options(args)) as engine:
        print(f"engine {engine.build_info}")
        for name, delta in cases:
            film = delta.get("film_stock", "kodak_portra_400")
            paper = delta.get("print_stock", "kodak_portra_endura")
            full = {**BASE, **delta}
            try:
                with engine.open(frame, full) as session:
                    rgba, _ = session.render("full")
                    output_space = session.reply["params"]["output_color_space"]
            except Exception as exc:
                print(f"FAIL {name}: the engine refused - {exc}")
                failures += 1
                continue
            want = reference_render(frame, film, paper, delta, output_space)
            if not compare(name, rgba, want, args.verbose):
                failures += 1

    print(f"\n{len(cases)} cases, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
