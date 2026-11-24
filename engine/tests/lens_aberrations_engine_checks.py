#!/usr/bin/env python3
"""The taking lens's aberrations (API-SPEC §21.6, macOS 2.x, ported).

    python engine/tests/lens_aberrations_engine_checks.py --library PATH [--resources DIR]

Needs numpy and the built engine DLL; no fixture. What is held, and why each one
can fail:

  off is identity   with `lens_aberrations_active` false -- even with every other
                    lens field set -- the render is byte-identical to one that
                    never mentions the lens.
  zeros are identity active with every optical size at zero moves nothing.
  deterministic     the same settings render the same picture twice.
  lateral CA        a point of light's red channel is magnified (or shrunk)
                    about the frame centre by red's own sign, and blue by its
                    own; green never moves. A wrong radial map or Jacobian
                    changes both the position and the energy.
  field curvature   a checker loses high-frequency energy at the corner and
                    keeps it at the centre: the blur grows with field height.
  coma              a point near the edge is asymmetric about its own centre:
                    the comet pushes light outward (positive) or inward.
  LoCA              the defocused channels (purple: R and B; green: G) gain a
                    halo the sharp channel does not have.
  glow              the spherical glow spreads a point's light symmetrically with
                    its amount, all channels alike.
  combinations      CA + curvature + coma + LoCA + glow run together, twice, to
                    the same picture.

The readings are all in 16-bit display codes, on synthetic frames; the film is
the optical one (`SPK_V2_REFERENCE_OPTICAL=1`) so the test measures the lens and
nothing else.
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
    # A small format puts more pixels between the optical sizes: the effects are
    # physical (µm at the frame's edge), so this only makes them measurable.
    "film_format_mm": 12.0,
}
LENS = {"lens_aberrations_active": True}


def render(engine, image, delta):
    session = engine.open(image, dict(BASE, **delta))
    try:
        rgba, _ = session.render("full")
    finally:
        session.close()
    return rgba.astype(np.float64)[..., :3]


def checker(h, w, cell=3):
    img = np.full((h, w, 3), 0.18, np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    img += (((yy.astype(np.int32) + xx.astype(np.int32)) // cell & 1) * 0.22)[..., None]
    return img


def spot(h, w, x, y, radius=1):
    img = np.zeros((h, w, 3), np.float32)
    img[max(0, y - radius):y + radius + 1, max(0, x - radius):x + radius + 1] = 8.0
    return img


def hf(rgb):
    g = rgb[..., 1]
    lap = 4.0 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(np.std(lap))


def centroid(channel, x, y, radius=24):
    """Sub-pixel centroid of a point, in a window about (x, y), over its local
    baseline: a whole-frame centroid would be dragged to the image centre by the
    print's pedestal in whichever channel the spot is dimmest."""
    y0, y1 = max(0, y - radius), min(channel.shape[0], y + radius + 1)
    x0, x1 = max(0, x - radius), min(channel.shape[1], x + radius + 1)
    win = channel[y0:y1, x0:x1]
    v = np.clip(win - np.median(win), 0.0, None)
    total = v.sum()
    if total <= 0:
        return None
    yy, xx = np.mgrid[y0:y1, x0:x1]
    return float((xx * v).sum() / total), float((yy * v).sum() / total)


def energy(rgb):
    return float(rgb.sum())


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

    W, H = 768, 512
    frame = checker(H, W)

    print("off is identity")
    off_a = render(engine, frame, {})
    off_b = render(engine, frame, {**LENS, "lens_aberrations_active": False,
                                   "lens_field_curvature_um": 60.0, "lens_coma_um": 100.0})
    check(np.array_equal(off_a, off_b), "inactive with the lens fields set equals untouched")

    print("zeros are identity")
    zero = {**LENS, "lens_field_curvature_um": 0.0, "lens_astigmatism_um": 0.0,
            "lens_coma_um": 0.0, "lens_lateral_ca_r": 0.0, "lens_lateral_ca_b": 0.0,
            "lens_loca_um": 0.0, "lens_spherical_amount": 0.0}
    check(np.array_equal(render(engine, frame, zero), off_a), "all-zero optics is the identity")

    print("deterministic")
    ca = {**LENS, "lens_lateral_ca_r": 2.0, "lens_lateral_ca_b": -2.0}
    check(np.array_equal(render(engine, frame, ca), render(engine, frame, ca)),
          "the same settings render the same picture twice")

    print("lateral CA: red and blue move by their own sign, green does not")
    # A point on the +x side of the axis: positive red CA magnifies red, so its
    # centroid moves further out (and blue, negative, closer in).
    img = spot(H, W, int(W * 0.88), H // 2)
    base = render(engine, img, {})
    ca_r = render(engine, img, {**LENS, "lens_lateral_ca_r": 2.0})
    ca_b = render(engine, img, {**LENS, "lens_lateral_ca_b": -2.0})
    sx, sy = int(W * 0.88), H // 2
    g0 = centroid(base[..., 1], sx, sy); gr = centroid(ca_r[..., 0], sx, sy); gb = centroid(ca_b[..., 2], sx, sy)
    check(g0 is not None and gr is not None and gb is not None, "the point renders")
    if g0 and gr and gb:
        check(gr[0] > g0[0] + 0.2, f"red centroid {g0[0]:.2f} -> {gr[0]:.2f} px (outward)")
        check(gb[0] < g0[0] - 0.2, f"blue centroid {g0[0]:.2f} -> {gb[0]:.2f} px (inward)")
        check(abs(centroid(ca_r[..., 1], sx, sy)[0] - g0[0]) < 0.15, "green stays put")
        e0, er = energy(base), energy(ca_b)
        check(abs(er / max(e0, 1e-9) - 1.0) < 0.08,
              f"a point keeps its energy through the CA map ({er/e0:.3f}x)")

    print("field curvature: the corner blurs, the centre does not")
    fc = render(engine, frame, {**LENS, "lens_field_curvature_um": 120.0, "lens_field_exponent": 2.0})
    cy, cx = H // 2, W // 2
    r = 40
    centre0 = hf(off_a[cy - r:cy + r, cx - r:cx + r])
    centre1 = hf(fc[cy - r:cy + r, cx - r:cx + r])
    corner0 = hf(off_a[H - 2 * r:H, W - 2 * r:W])
    corner1 = hf(fc[H - 2 * r:H, W - 2 * r:W])
    check(abs(centre1 / max(centre0, 1e-9) - 1.0) < 0.02,
          f"centre HF {centre0:.0f} -> {centre1:.0f} (unchanged)")
    check(corner1 < 0.75 * corner0,
          f"corner HF {corner0:.0f} -> {corner1:.0f} (blurred)")

    print("coma: a point near the edge is asymmetric, outward")
    edge = spot(H, W, int(W * 0.94), H // 2)
    e0 = render(engine, edge, {})
    cm = render(engine, edge, {**LENS, "lens_coma_um": 150.0})
    ex, ey = int(W * 0.94), H // 2
    c0 = centroid(e0[..., 1], ex, ey); c1 = centroid(cm[..., 1], ex, ey)
    check(c0 is not None and c1 is not None, "the edge point renders")
    if c0 and c1:
        check(c1[0] > c0[0] - 0.05, f"coma centroid {c0[0]:.2f} -> {c1[0]:.2f} px (outward)")
        # Asymmetry: the comet puts more light on the outward side.
        x0 = int(round(c0[0]))
        y0 = int(round(c0[1]))
        left = cm[y0 - 8:y0 + 8, max(0, x0 - 14):x0].sum()
        right = cm[y0 - 8:y0 + 8, x0 + 1:min(W, x0 + 15)].sum()
        check(right > left, f"outward side {right:.0f} > inward side {left:.0f}")

    print("LoCA: the soft channels gain a halo the sharp one does not")
    lo = spot(H, W, W // 2, H // 2)
    l0 = render(engine, lo, {})
    lp_ = render(engine, lo, {**LENS, "lens_loca_um": 30.0, "lens_loca_sign": "purple"})
    ring = np.zeros((H, W), bool)
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - W // 2, yy - H // 2)
    ring = (dist > 2) & (dist < 12)
    gain = {}
    for ch, name in ((0, "red"), (1, "green"), (2, "blue")):
        gain[name] = lp_[..., ch][ring].sum() / max(l0[..., ch][ring].sum(), 1e-9)
        report[f"loca_{name}"] = float(gain[name])
    # The film and print couple the channels, so "green is untouched" is not the
    # bar; the bar is that the sign moves the halo to the channels it names.
    check(gain["red"] > 1.5 * gain["green"] and gain["blue"] > 1.5 * gain["green"],
          f"purple: R {gain['red']:.1f}x and B {gain['blue']:.1f}x the ring vs G {gain['green']:.1f}x")
    lp_g = render(engine, lo, {**LENS, "lens_loca_um": 30.0, "lens_loca_sign": "green"})
    gain_g = {}
    for ch, name in ((0, "red"), (1, "green"), (2, "blue")):
        gain_g[name] = lp_g[..., ch][ring].sum() / max(l0[..., ch][ring].sum(), 1e-9)
    check(gain_g["green"] > 1.5 * gain_g["red"] and gain_g["green"] > 1.5 * gain_g["blue"],
          f"green: G {gain_g['green']:.1f}x the ring vs R {gain_g['red']:.1f}x and B {gain_g['blue']:.1f}x")

    print("spherical glow: symmetric spread, all channels alike")
    gl0 = render(engine, lo, {})
    gl = render(engine, lo, {**LENS, "lens_spherical_amount": 0.4, "lens_spherical_um": 120.0})
    gains = []
    for ch in range(3):
        gains.append(gl[..., ch][ring].sum() / max(gl0[..., ch][ring].sum(), 1e-9))
    report["glow_ring_gain"] = [float(g) for g in gains]
    check(min(gains) > 2.0, f"the glow puts light in the ring ({min(gains):.1f}-{max(gains):.1f}x)")
    check(max(gains) - min(gains) < 1.0, "the glow is the same in R, G and B (print coupling aside)")

    print("combinations: one pass, deterministic")
    everything = {**LENS, "lens_field_curvature_um": 80.0, "lens_astigmatism_um": 40.0,
                  "lens_field_exponent": 2.0, "lens_sharp_radius": 0.1, "lens_coma_um": 90.0,
                  "lens_spherical_amount": 0.2, "lens_spherical_um": 80.0,
                  "lens_lateral_ca_r": 1.5, "lens_lateral_ca_b": -1.0,
                  "lens_loca_um": 12.0, "lens_loca_sign": "green"}
    first = render(engine, frame, everything)
    check(np.array_equal(first, render(engine, frame, everything)), "CA + curvature + coma + LoCA + glow")
    check(not np.array_equal(first, off_a), "and it changes the picture")

    report["failures"] = failures
    if args.json:
        args.json.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
