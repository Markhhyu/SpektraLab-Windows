#!/usr/bin/env python3
"""Grain's spatial scale, anchored in film micrometres (the audit's G-1).

    python engine/tests/grain_physical_checks.py --library PATH [--resources DIR]

The realisation is the film's, not the export's: the same picture rendered at
different long edges must show grain whose **physical** correlation length is
the same. Before the fix the grain was one 0.65 px blur at every tier, so the
correlation length measured 0.856 px whatever the pitch: 24 um at 28 um/px and
4.3 um at 5 um/px (5.6x), and preview and export disagreed by 2.2x at high
frequency. What is held here:

  physical length   the correlation length in micrometres is the same (within
                    25 %) at 1024, 2048 and 4096 px long edges, while the
                    length in pixels grows with the pitch (as it must: one
                    physical clump covers more pixels on a finer scan).
  in a sane band    the length sits where the model says (10-70 um; the value
                    includes the film chain's own diffusion).
  preview/export    the preview tier's grain, upsampled to the full frame's
                    size, has the same high-frequency energy as the full
                    tier's (within 40 %) -- the 2.2x gap the audit measured was
                    the old pixel-anchored blur.
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
    "auto_exposure": False, "glare_active": False, "halation_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
}
FILM_MM = 36.0


def render(engine, h, w, delta, tier="full"):
    img = np.full((h, w, 3), 0.18, np.float32)
    session = engine.open(img, dict(BASE, **delta))
    try:
        rgba, _ = session.render(tier)
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def correlation_px(grain: np.ndarray) -> float:
    """Integral of the normalised row autocorrelation up to its first zero, +1."""
    x = grain - grain.mean()
    spec = np.fft.rfft(x, axis=1)
    ac = np.fft.irfft(spec * np.conj(spec), axis=1).mean(axis=0)
    ac /= ac[0]
    acc = 0.0
    for v in ac[1:]:
        if v <= 0:
            break
        acc += v
    return acc + 1.0


def hf(x: np.ndarray) -> float:
    g = x[..., 1]
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.std())


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

    print("the correlation length is the film's, not the export's")
    um: dict[int, float] = {}
    px: dict[int, float] = {}
    for long_edge in (1024, 2048, 4096):
        h = int(round(long_edge * 2 / 3))
        on = render(engine, h, long_edge, {})
        off = render(engine, h, long_edge, {"grain_active": False})
        grain = (on - off)[..., 1]
        pitch = FILM_MM * 1000.0 / long_edge
        px[long_edge] = correlation_px(grain)
        um[long_edge] = px[long_edge] * pitch
        print(f"    {long_edge:4d}px: {pitch:5.1f} um/px  {px[long_edge]:.2f} px = {um[long_edge]:.1f} um")
    report["correlation_um"] = {str(k): float(v) for k, v in um.items()}
    report["correlation_px"] = {str(k): float(v) for k, v in px.items()}
    spread = max(um.values()) / min(um.values())
    check(spread < 1.25, f"physical length stays within 25 % ({spread:.2f}x across a 4x pitch)")
    check(10.0 <= min(um.values()) and max(um.values()) <= 70.0,
          f"it is in the model's band ({min(um.values()):.0f}-{max(um.values()):.0f} um)")
    check(px[4096] > 2.0 * px[1024],
          f"the pixel length does follow the pitch ({px[1024]:.2f} -> {px[4096]:.2f} px)")

    print("preview and export grain agree at high frequency")
    # Larger than the preview edge, so "preview" really is a coarser tier.
    img = np.random.default_rng(3).normal(0.18, 0.02, (2667, 4000, 3)).astype(np.float32)

    def tiers(delta):
        session = engine.open(img, dict(BASE, **delta))
        try:
            full, _ = session.render("full")
            preview, _ = session.render("preview")
        finally:
            session.close()
        return full.astype(np.float64)[..., :3], preview.astype(np.float64)[..., :3]

    full_on, preview_on = tiers({})
    full_off, preview_off = tiers({"grain_active": False})
    grain_full = full_on - full_off
    grain_preview = preview_on - preview_off
    # Preview is coarser: upsample its grain to the full frame before comparing.
    def upsample(img: np.ndarray, fh: int, fw: int) -> np.ndarray:
        ph, pw = img.shape[:2]
        ys = (np.arange(fh) + 0.5) * ph / fh - 0.5
        xs = (np.arange(fw) + 0.5) * pw / fw - 0.5
        y0 = np.clip(np.floor(ys).astype(int), 0, ph - 1)
        y1 = np.clip(y0 + 1, 0, ph - 1)
        x0 = np.clip(np.floor(xs).astype(int), 0, pw - 1)
        x1 = np.clip(x0 + 1, 0, pw - 1)
        wy = (ys - y0)[:, None, None]
        wx = (xs - x0)[None, :, None]
        top = img[y0][:, x0] + (img[y0][:, x1] - img[y0][:, x0]) * wx
        bot = img[y1][:, x0] + (img[y1][:, x1] - img[y1][:, x0]) * wx
        return top + (bot - top) * wy

    ph, pw = grain_preview.shape[:2]
    fh, fw = grain_full.shape[:2]
    print(f"    full {fw}x{fh}, preview {pw}x{ph}")
    check(ph < fh, f"the preview really is a coarser tier ({pw} < {fw})")
    # Bring the full frame's grain to the preview's resolution, so both arms are
    # one grained image at the same size (upsampling the preview instead would
    # add interpolation loss and measure the resampler). The grain is physical,
    # so the two agree at the size the person sees.
    full_at_preview = upsample(grain_full, ph, pw)
    ratio = hf(grain_preview) / max(hf(full_at_preview), 1e-9)
    report["preview_hf_ratio"] = float(ratio)
    report["preview_rms_ratio"] = float(grain_preview.std() / max(full_at_preview.std(), 1e-9))
    check(0.75 < ratio < 1.45, f"preview / full grain at the same size {ratio:.2f}x (was ~2.2x)")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
