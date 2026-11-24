#!/usr/bin/env python3
"""The camera's diffusion filter (柔光镜, API-SPEC §21.5, macOS 2.x, ported).

    python engine/tests/diffusion_engine_checks.py --library PATH [--resources DIR] [--json out.json]

Needs numpy and the built engine DLL; no fixture, no Python oracle. The host
tables (p_s, every exponential's lambda and per-channel weight) are held to the
oracle's numbers by `tests/diffusion_psf.cpp` on the CPU; this file holds what
only the engine can show:

  off is identity   with the filter inactive -- even with every other diffusion
                    field set -- the render is byte-identical to a render that
                    never mentions the filter.
  deterministic     the same settings render the same picture twice.
  grey is invariant a uniform grey field is unchanged by a unit-mass blur: with
                    the filter on it must render the same as with it off (a
                    weights-sum-to-one check on the real application path).
  impulse moves     a point of light loses at its centre and gains a halo: the
                    scattered energy is the filter's own, and it reaches further
                    than the unfiltered picture at the halo's radius.
  strength          a checker chart loses high-frequency energy monotonically
                    as strength rises (0.25 < 0.5 < 1.0).
  families          black_pro_mist and cinebloom are different pictures.
  refusal           an unknown family is refused at open with a named error.

Note on parity: the public reference applies the filter to the film's *raw
exposure* (`runtime/stages/filming.py`), the engine applies it to the source in
linear RGB before the film chain (`lens_source` on the macOS line, the same
choice here) -- the macOS line does not parity this through the film either,
and `diffusion_psf.cpp` holds the tables against the oracle instead.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spk_ctypes as spk  # noqa: E402

BASE = {
    "film_stock": "kodak_portra_400", "print_stock": "kodak_portra_endura",
    "auto_exposure": False, "exposure_compensation_ev": 0.0,
    "grain_active": False, "glare_active": False, "halation_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
}
ON = {"diffusion_filter_active": True, "diffusion_filter_family": "black_pro_mist",
      "diffusion_filter_strength": 0.5}


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba


def code_stats(a, b):
    d = np.abs(np.asarray(a).astype(np.int64) - np.asarray(b).astype(np.int64))
    return float(d.mean()), float(np.percentile(d, 99)), int(d.max())


def high_frequency(rgba):
    """Laplacian energy of the green channel, in 16-bit display codes."""
    g = rgba[..., 1].astype(np.float64)
    lap = 4.0 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(np.std(lap))


def checker(h=160, w=224, cell=4):
    """A 1 px-ish checker on a mid-grey field: the filter's HF target."""
    img = np.full((h, w, 3), 0.18, np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    img += (((yy.astype(np.int32) + xx.astype(np.int32)) // cell & 1) * 0.10)[..., None]
    return img


def impulse(h=160, w=224):
    """A small bright square on black: the PSF's own source."""
    img = np.zeros((h, w, 3), np.float32)
    img[h // 2 - 3:h // 2 + 3, w // 2 - 3:w // 2 + 3] = 2.0
    return img


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", "--dylib", dest="library", type=Path, required=True)
    ap.add_argument("--resources", type=Path, default=None)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()
    engine = spk.Engine(library=args.library, resources=args.resources)
    print(engine.build_info)
    failures: list[str] = []
    report: dict = {"build": engine.build_info}

    def check(ok: bool, what: str):
        print(("  ok    " if ok else "  FAIL  ") + what)
        if not ok: failures.append(what)

    print("off is identity")
    frame = checker()
    off_a = render(engine, frame, {})
    off_b = render(engine, frame, {**ON, "diffusion_filter_active": False})
    check(np.array_equal(off_a, off_b), "inactive with the other fields set equals untouched")

    print("deterministic")
    on_a = render(engine, frame, ON)
    on_b = render(engine, frame, ON)
    check(np.array_equal(on_a, on_b), "the same setting renders the same picture twice")

    print("grey is invariant (unit-mass scatter)")
    grey = np.full((128, 160, 3), 0.18, np.float32)
    grey_off = render(engine, grey, {})
    grey_on = render(engine, grey, ON)
    mean, p99, maximum = code_stats(grey_on[..., :3], grey_off[..., :3])
    check(maximum <= 2, f"a uniform grey moves at most {maximum} codes (mean {mean:.3f})")

    print("impulse: centre loses, halo gains")
    img = impulse()
    spot_off = render(engine, img, {}).astype(np.float64)
    spot_on = render(engine, img, ON).astype(np.float64)
    cy, cx = img.shape[0] // 2, img.shape[1] // 2
    centre_off = spot_off[cy - 1:cy + 1, cx - 1:cx + 1, :3].mean()
    centre_on = spot_on[cy - 1:cy + 1, cx - 1:cx + 1, :3].mean()
    # The Black Mist 1/2 halo's first lambda is 16 um; at this pitch
    # (35 mm over 224 px ~ 156 um/px) the halo is sub-pixel, so measure the
    # wider bloom instead: a ring a few pixels out.
    ring_off = spot_off[cy - 6:cy - 3, cx - 6:cx + 6, :3].mean()
    ring_on = spot_on[cy - 6:cy - 3, cx - 6:cx + 6, :3].mean()
    check(centre_on < centre_off, f"centre {centre_off:.0f} -> {centre_on:.0f} codes")
    check(ring_on > ring_off, f"ring {ring_off:.0f} -> {ring_on:.0f} codes")

    print("strength: the checker loses high-frequency energy monotonically")
    hf = []
    for strength in (0.25, 0.5, 1.0):
        rgba = render(engine, checker(), {**ON, "diffusion_filter_strength": strength})
        hf.append(high_frequency(rgba))
    check(hf[0] > hf[1] > hf[2],
          f"HF energy {hf[0]:.1f} > {hf[1]:.1f} > {hf[2]:.1f} for strengths 0.25/0.5/1.0")

    print("families are different pictures")
    bpm = render(engine, frame, {**ON, "diffusion_filter_family": "black_pro_mist"})
    cb = render(engine, frame, {**ON, "diffusion_filter_family": "cinebloom"})
    mean, p99, maximum = code_stats(bpm[..., :3], cb[..., :3])
    check(mean > 1.0, f"black_pro_mist vs cinebloom: mean {mean:.1f}, p99 {p99:.0f}, max {maximum}")

    print("refusal: an unknown family fails by name")
    try:
        engine.open(frame, dict(BASE, **{**ON, "diffusion_filter_family": "no_such_filter"})).close()
        check(False, "an unknown family must be refused")
    except spk.EngineError as exc:
        check("diffusion" in str(exc).lower() or "family" in str(exc).lower(), f"refused: {exc}")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
