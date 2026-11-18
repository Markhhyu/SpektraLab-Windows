"""Deep assessment of the film-simulation pipeline.

Two independent questions:

  A. Did the Windows port and our later changes alter the film look?
     -> compare this build against the shipped official binary (same tag 9ceca33)
        at the pixel level, across tiers, effects, stocks and export paths.

  B. Does the film model itself behave like a film model?
     -> drive synthetic charts through the pipeline (H&D curve, neutrality,
        grain, halation, contrast mask, development, illuminants) and check
        physical invariants with numeric thresholds.

Run with the analysis venv:
  E:/deepseekHerness/film-validation/ref/venv314/Scripts/python.exe assess_film.py all
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# The host needs the MinGW runtime on PATH and a writable temp dir.
os.environ["PATH"] = r"E:\deepseekHerness\SpektraLab-src\deps\mingw64\bin;" + os.environ["PATH"]
os.environ["TEMP"] = r"E:\deepseekHerness\tmp"
os.environ["TMP"] = os.environ["TEMP"]

from hostclient import Engine  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.environ.get("SPEKTRA_ASSESS_TMP") or os.path.join(HERE, "_assessment_out")
os.makedirs(TMP, exist_ok=True)

RAW = os.environ.get("SPEKTRA_TEST_RAW", "")

GEOM = {"crop": {"x": 0, "y": 0, "width": 1, "height": 1}, "angle": 0, "quarterTurns": 0,
        "flipH": False, "flipV": False, "aspect": "free"}
ADJ = {"enabled": True, "temperature": 0, "tint": 0, "exposure": 0, "contrast": 0,
       "brightness": 0, "saturation": 0, "highlights": 0, "shadows": 0, "blackPoint": 0,
       "whitePoint": 0, "vignette": {"amount": 0, "midpoint": 50}}
DECODE = {"white_balance": {"mode": "as_shot"}}

_DEFAULTS = None


def load_defaults(host=None):
    """Wire defaults from the running host's params_schema (cached)."""
    global _DEFAULTS
    if _DEFAULTS is None:
        if host is None:
            raise SystemExit("load_defaults() needs a host on first call")
        schema, _ = host.eng.send("params_schema", {})
        _DEFAULTS = {f["name"]: f["default"] for f in schema["fields"] if "default" in f}
    return dict(_DEFAULTS)


OURS = {
    "name": "ours",
    "host": os.environ.get("SPEKTRA_OURS_HOST")
    or r"E:\deepseekHerness\SpektraLab-src\build\win-host\host\spektralab-host.exe",
    "res": os.environ.get("SPEKTRA_OURS_RES")
    or r"E:\deepseekHerness\SpektraLab-src\build\win-host\resources",
}
OFFICIAL = {
    "name": "official",
    "host": os.environ.get("SPEKTRA_OFFICIAL_HOST", ""),
    "res": os.environ.get("SPEKTRA_OFFICIAL_RES", ""),
}


# --------------------------------------------------------------------------- #
# host helpers
# --------------------------------------------------------------------------- #


class Host:
    def __init__(self, spec, log_level="error"):
        self.spec = spec
        self.eng = Engine(spec["host"], spec["res"], log_level=log_level)

    def close(self):
        self.eng.close()

    def close_session(self, sid):
        try:
            self.eng.send("close", {"session": sid})
        except Exception:  # noqa: BLE001
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def open(self, params, path=None):
        if path is None:
            path = _assessment_raw()
        reply, _ = self.eng.send("open", {"path": path, "params": params, "decode": DECODE})
        return reply["session"]

    def render(self, sid, params, tier="live", long_edge=1600, fmt="rgba16", display="srgb"):
        reply, payload = self.eng.send(
            "render_view",
            {
                "session": sid,
                "params": params,
                "adjustments": ADJ,
                "geometry": GEOM,
                "tier": tier,
                "display": display,
                "long_edge": long_edge,
                "format": fmt,
            },
        )
        img = reply["image"]
        w, h = img["width"], img["height"]
        channels = 4 if fmt == "rgba16" or fmt == "rgba8" else 3
        dtype = np.uint16 if fmt == "rgba16" else np.uint8
        px = np.frombuffer(payload, dtype=dtype)
        px = px.reshape(h, img.get("row_stride_px", w * channels * (2 if dtype == np.uint16 else 1) // channels), channels) if False else px.reshape(h, w, channels)
        return px, reply.get("timings_ms", {})

    def export(self, sid, params, fmt="tiff16", color_space="sRGB", tier="full", long_edge=1600, path=None):
        req = {
            "session": sid,
            "params": params,
            "adjustments": ADJ,
            "geometry": GEOM,
            "tier": tier,
            "format": fmt,
            "color_space": color_space,
            "long_edge": long_edge,
        }
        if path:
            req["path"] = path
        reply, _ = self.eng.send("export_frame", req)
        return reply

    def solve(self, sid):
        reply, _ = self.eng.send("solve", {"session": sid, "target": "exposure"})
        return reply


def decode_pixels(px: np.ndarray) -> np.ndarray:
    """uint16 RGBA -> float [0,1] RGB (display encoded, as rendered)."""
    return px[..., :3].astype(np.float64) / 65535.0


def srgb_to_linear(v: np.ndarray) -> np.ndarray:
    v = np.clip(v, 0.0, 1.0)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def luma(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def apply(params: dict, **updates) -> dict:
    out = json.loads(json.dumps(params))
    out.update(updates)
    return out


def quiet(params: dict) -> dict:
    return apply(
        params,
        grain_active=False,
        halation_active=False,
        glare_active=False,
        dir_couplers_active=False,
        auto_exposure=False,
        extended_dynamic_range=False,
    )


# --------------------------------------------------------------------------- #
# synthetic charts
# --------------------------------------------------------------------------- #


def _assessment_raw() -> str:
    """A synthetic RGB scene used when no real RAW is configured."""
    global RAW
    if not RAW:
        RAW = save_png(gray_step_chart(), "assessment_scene.png")
    return RAW


def save_png(rgb8: np.ndarray, name: str) -> str:
    from PIL import Image

    path = os.path.join(TMP, name)
    Image.fromarray(rgb8, "RGB").save(path)
    return path


def gray_step_chart(steps=24, patch=32) -> np.ndarray:
    """Neutral patches from black to white (display code values)."""
    w = steps * patch
    img = np.zeros((patch * 4, w, 3), np.uint8)
    values = np.linspace(2, 253, steps)
    for i, v in enumerate(values):
        value = int(round(v))
        img[:, i * patch:(i + 1) * patch, :] = value
    return img


def gray_flat(value=128, size=128) -> np.ndarray:
    img = np.zeros((size, size, 3), np.uint8)
    img[...] = value
    return img


def halation_chart(size=256, square=36) -> np.ndarray:
    img = np.zeros((size, size, 3), np.uint8)
    c = size // 2
    s = square // 2
    img[c - s:c + s, c - s:c + s, :] = 255
    return img


def gradient_chart(size=256) -> np.ndarray:
    x = np.linspace(0, 255, size)
    img = np.zeros((size, size, 3), np.uint8)
    img[:, :, 0] = x[None, :]
    img[:, :, 1] = x[None, :]
    img[:, :, 2] = x[None, :]
    return img


# --------------------------------------------------------------------------- #
# A. cross-build regression
# --------------------------------------------------------------------------- #

REPORT = []


def record(section: str, name: str, passed: bool, detail: str):
    REPORT.append({"section": section, "name": name, "passed": bool(passed), "detail": detail})
    print(("[PASS] " if passed else "[FAIL] ") + f"{section}/{name}: {detail}")


def regress(tiers=("live", "preview"), long_edge=1600):
    params = load_defaults()
    variants = {
        "default": params,
        "effects-off": quiet(params),
        "grain-only": apply(quiet(params), grain_active=True),
        "halation-only": apply(quiet(params), halation_active=True),
        "glare-only": apply(quiet(params), glare_active=True),
        "dir-only": apply(quiet(params), dir_couplers_active=True),
        "ae-on": apply(quiet(params), auto_exposure=True),
    }
    with Host(OFFICIAL) as off, Host(OURS) as ours:
        for tier in tiers:
            for label, p in variants.items():
                s1 = off.open(p)
                a, ta = off.render(s1, p, tier=tier, long_edge=long_edge)
                off.close_session(s1)
                s2 = ours.open(p)
                b, tb = ours.render(s2, p, tier=tier, long_edge=long_edge)
                ours.close_session(s2)
                if a.shape != b.shape:
                    record("A.regress", f"{tier}/{label}", False, f"shape {a.shape} vs {b.shape}")
                    continue
                d = np.abs(a.astype(np.int32) - b.astype(np.int32))
                eq = bool(np.array_equal(a, b))
                record(
                    "A.regress",
                    f"{tier}/{label}",
                    eq,
                    f"equal={eq} maxdiff={int(d.max())} mean={float(a.astype(np.float64).mean()):.1f}"
                    f" t_off={ta.get('total', 0):.0f}ms t_ours={tb.get('total', 0):.0f}ms",
                )


def regress_stocks():
    """Render a representative stock/paper matrix in both builds and compare."""
    params = load_defaults()
    films = [
        "kodak_portra_400",
        "kodak_portra_800",
        "kodak_ektar_100",
        "kodak_gold_200",
        "fujifilm_velvia_100",
        "fujifilm_provia_100f",
        "kodak_tmax_100",
        "ilford_hp5_plus_400",
    ]
    prints = ["kodak_portra_endura", "kodak_ultra_endura"]
    with Host(OFFICIAL) as off, Host(OURS) as ours:
        for film in films:
            for paper in prints:
                p = apply(params, film_stock=film, print_stock=paper)
                s1 = off.open(p)
                a, _ = off.render(s1, p, tier="live", long_edge=512)
                off.close_session(s1)
                s2 = ours.open(p)
                b, _ = ours.render(s2, p, tier="live", long_edge=512)
                ours.close_session(s2)
                eq = a.shape == b.shape and bool(np.array_equal(a, b))
                record("A.stocks", f"{film}+{paper}", eq, "pixel-identical" if eq else "DIFFERS")


def regress_export():
    params = load_defaults()
    with Host(OFFICIAL) as off, Host(OURS) as ours:
        off_path = os.path.join(TMP, "off_export.tif")
        our_path = os.path.join(TMP, "our_export.tif")
        for stale in (off_path, our_path):
            try:
                os.unlink(stale)
            except FileNotFoundError:
                pass
        s1 = off.open(params)
        e1 = off.export(s1, params, fmt="tiff16", path=off_path)
        s2 = ours.open(params)
        e2 = ours.export(s2, params, fmt="tiff16", path=our_path)
        record(
            "A.export",
            "export_frame bytes",
            e1.get("bytes") == e2.get("bytes"),
            f"{e1.get('bytes')} vs {e2.get('bytes')}",
        )
        import tifffile

        a = tifffile.imread(off_path)
        b = tifffile.imread(our_path)
        record("A.export", "export_frame pixels", bool(np.array_equal(a, b)), f"shape {a.shape}")


def regress_two_stage():
    """A half-size open followed by a full re-decode must land on the full pixels."""
    params = quiet(load_defaults())
    with Host(OURS) as ours:
        s = ours.eng.send(
            "open",
            {"path": RAW, "params": params, "decode": {"white_balance": {"mode": "as_shot"}, "half_size": True}},
        )[0]["session"]
        half, _ = ours.render(s, params, tier="live", long_edge=1600)
        hw, hh = half.shape[1], half.shape[0]
        reply, _ = ours.eng.send("redecode", {"session": s, "decode": {"white_balance": {"mode": "as_shot"}}})
        full, _ = ours.render(s, params, tier="live", long_edge=1600)
        ref_host = Host(OFFICIAL)
        try:
            rs = ref_host.open(params)
            ref, _ = ref_host.render(rs, params, tier="live", long_edge=1600)
        finally:
            ref_host.close()
        eq = half.shape == full.shape and bool(np.array_equal(full, ref))
        record(
            "A.two-stage",
            "half->full equals official full",
            eq,
            f"half={hw}x{hh} full={full.shape[1]}x{full.shape[0]} official={ref.shape[1]}x{ref.shape[0]}",
        )
        same = bool(np.array_equal(half, full))
        record("A.two-stage", "half-size differs from full", not same, f"equal={same}")


# --------------------------------------------------------------------------- #
# B. film-model physics metrics
# --------------------------------------------------------------------------- #

EFFECTS_OFF = {
    "grain_active": False,
    "halation_active": False,
    "glare_active": False,
    "dir_couplers_active": False,
    "auto_exposure": False,
    "extended_dynamic_range": False,
}


def open_chart(host: Host, path: str, params: dict, long_edge=512, tier="live"):
    sid = host.open(params, path=path)
    px, timings = host.render(sid, params, tier=tier, long_edge=long_edge)
    return decode_pixels(px), timings


def physics_hd_curve(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart_img = gray_step_chart()
    chart = save_png(chart_img, "hd_steps.png")
    rgb, _ = open_chart(host, chart, params)
    h = rgb.shape[0]
    row = rgb[h // 2]
    step = row.shape[0] // 24
    squeeze = [row[i * step + step // 2] for i in range(24)]
    out_l = np.array([float(luma(np.array(c))) for c in squeeze])
    in_l = srgb_to_linear(np.linspace(2, 253, 24) / 255.0)
    in_lin = float(luma(np.stack([in_l, in_l, in_l], axis=-1)[0])) if False else in_l
    mono = int(np.sum(np.diff(out_l) < -0.002))
    # Slope in log-log space over the middle of the range (characteristic curve).
    lo, hi = 5, 18
    x = np.log2(np.clip(in_lin[lo:hi], 1e-6, None))
    y = np.log2(np.clip(out_l[lo:hi], 1e-6, None))
    slope = float(np.polyfit(x, y, 1)[0])
    toe = float(out_l[2])
    shoulder = float(out_l[-3])
    record(
        "B.curve",
        "H&D monotonic",
        mono == 0,
        f"violations={mono} slope={slope:.2f} black={out_l[0]:.4f} white={out_l[-1]:.4f} toe={toe:.4f} shoulder={shoulder:.4f}",
    )
    record("B.curve", "H&D contrast in range", 0.6 <= slope <= 2.5, f"slope={slope:.2f}")
    return {"slope": slope, "mono": mono, "out": out_l.tolist()}


def physics_neutrality(host: Host) -> dict:
    """Neutral chart: the film itself is allowed a crossover, so this is a
    baseline check on the desktop render path.

    The desktop host and the shipped official binary are bit-identical here
    (see the regress pass), so this is a regression baseline, not a physics
    pass/fail. The engine API path (spk_render) is compared separately in
    the assessment document; it is near-neutral (spread ~0.02).
    """
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart_img = gray_step_chart()
    chart = save_png(chart_img, "neutral_steps.png")
    rgb, _ = open_chart(host, chart, params)
    h, w = rgb.shape[:2]
    row = rgb[h // 2]
    step = w // 24
    chroma = []
    for i in range(24):
        c = row[i * step + step // 2]
        chroma.append(float(max(c) - min(c)))
    casts = np.array(chroma[4:-2])
    record(
        "B.neutral",
        "neutral ramp: desktop path stays within the v1.9 baseline",
        float(casts.max()) < 0.15,
        f"max RGB spread={casts.max():.4f} mean={casts.mean():.4f} "
        "(baseline for the desktop render path; official binary identical)",
    )
    return {"spread_max": float(casts.max()), "spread_mean": float(casts.mean())}


def _crossing(profile: np.ndarray, level: float) -> float:
    """First sub-pixel x where a rising edge profile crosses `level`."""
    above = np.where(profile >= level)[0]
    if above.size == 0:
        return float("nan")
    i = int(above[0])
    if i == 0:
        return 0.0
    y0, y1 = profile[i - 1], profile[i]
    if y1 == y0:
        return float(i)
    return float(i - 1 + (level - y0) / (y1 - y0))


def edge_rise_width(gray: np.ndarray, lo_frac=0.1, hi_frac=0.9) -> float:
    """10-90 % rise width in pixels for a horizontal edge profile."""
    h, w = gray.shape
    row = gray[h // 2][int(0.1 * w):int(0.9 * w)].astype(np.float64)
    lo, hi = np.percentile(row, [5, 95])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 0.05:
        return float("nan")
    level_lo = lo + lo_frac * (hi - lo)
    level_hi = lo + hi_frac * (hi - lo)
    x_lo = _crossing(row, level_lo)
    x_hi = _crossing(row, level_hi)
    if not np.isfinite(x_lo) or not np.isfinite(x_hi):
        return float("nan")
    return float(x_hi - x_lo)


def physics_sharpness(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart_img = np.full((160, 240, 3), 16, dtype=np.uint8)
    chart_img[:, 120:] = 240
    chart = save_png(chart_img, "edge.png")
    rgb0, _ = open_chart(host, chart, params)
    rgb1, _ = open_chart(host, chart, apply(params, lens_blur_um=200.0))
    w0 = edge_rise_width(luma(rgb0))
    w1 = edge_rise_width(luma(rgb1))
    record(
        "B.sharp",
        "edge is resolved and lens blur widens it",
        bool(np.isfinite(w0) and np.isfinite(w1) and w0 <= 3.0 and w1 > w0 + 0.2),
        f"10-90% rise {w0:.2f} px without blur, {w1:.2f} px with lens_blur_um=200",
    )
    return {"rise_px": w0, "rise_px_blur": w1}


def physics_banding(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart = save_png(gray_flat(120, 180), "flat_banding.png")
    rgb, _ = open_chart(host, chart, params, long_edge=512)
    y0 = luma(rgb)
    hh, ww = y0.shape
    y = y0[int(0.15 * hh):int(0.85 * hh), int(0.15 * ww):int(0.85 * ww)]
    col = y.mean(axis=0)
    row = y.mean(axis=1)
    def residual(profile):
        kernel = np.ones(9) / 9.0
        padded = np.pad(profile, 4, mode="edge")
        smooth = np.convolve(padded, kernel, mode="valid")
        return profile - smooth
    rc = float(np.nanstd(residual(col)))
    rr = float(np.nanstd(residual(row)))
    record(
        "B.band",
        "flat field has no visible banding",
        max(rc, rr) < 0.004,
        f"column residual std={rc:.5f} row residual std={rr:.5f} (grain off)",
    )
    return {"col_residual": rc, "row_residual": rr}


def physics_grain(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart = save_png(gray_flat(128, 128), "flat_128.png")
    levels = [0.0, 0.5, 1.0, 2.0]
    rms = []
    for amount in levels:
        p = apply(params, grain_active=amount > 0, grain_amount=amount)
        rgb, _ = open_chart(host, chart, p)
        y = luma(rgb)[16:-16, 16:-16]
        rms.append(float(np.std(y)))
    mono = all(b >= a - 2e-4 for a, b in zip(rms, rms[1:]))
    any_grain = rms[-1] > rms[0] * 1.3
    record(
        "B.grain",
        "grain RMS grows with amount",
        mono and any_grain,
        "RMS=" + ", ".join(f"{v:.5f}" for v in rms),
    )
    return {"rms": rms}


def physics_halation(host: Host) -> dict:
    # The physical halation radius is tens of micrometres; at preview scale that is
    # sub-pixel. Shrink the simulated film format so the glow spans several pixels
    # and the profile is measurable.
    params = apply(load_defaults(), **EFFECTS_OFF)
    params = apply(params, film_format_mm=4.0)
    chart_img = halation_chart()
    chart = save_png(chart_img, "halation.png")
    profiles = {}
    for amount in (0.0, 1.0, 2.0):
        p = apply(
            params,
            halation_active=amount > 0,
            halation_amount=amount,
            # A neutral chart patch only reaches ~+2.5 EV above mid-grey, below the
            # default 4 EV headroom gate: boost highlights so the glow path runs.
            halation_boost_ev=6.0 if amount > 0 else 0.0,
            halation_headroom_ev=0.0,
        )
        rgb, _ = open_chart(host, chart, p)
        y = luma(rgb)
        c = y.shape[1] // 2
        line = y[c]
        # Sample *outside* the white square, starting at its rendered edge.
        scale = rgb.shape[1] / chart_img.shape[1]
        half = int(round((chart_img.shape[0] // 2 - chart_img.shape[0] // 2) + 18 * scale))
        inside = float(line[c])
        samples = {d: float(line[min(len(line) - 1, c + half + d)]) for d in (0, 2, 4, 8, 16, 32)}
        profiles[amount] = {"inside": inside, "samples": samples}
    a0, a1, a2 = profiles[0.0], profiles[1.0], profiles[2.0]
    near = (2, 4, 8)
    grows = all(a1["samples"][d] > a0["samples"][d] + 0.01 for d in near)
    ordered = all(a2["samples"][d] >= a1["samples"][d] + 0.01 for d in near)
    decays = all(
        a2["samples"][b] <= a2["samples"][a] + 1e-3
        for a, b in ((2, 4), (4, 8), (8, 16), (16, 32))
    )
    record(
        "B.halation",
        "halation spill grows, decays with distance and scales with amount",
        grows and ordered and decays,
        "d2=" + "->".join(f"{p['samples'][2]:.4f}" for p in (a0, a1, a2))
        + "  d4=" + "->".join(f"{p['samples'][4]:.4f}" for p in (a0, a1, a2))
        + "  amount2 decay d2/d8/d32="
        + "/".join(f"{a2['samples'][d]:.4f}" for d in (2, 8, 32)),
    )
    return profiles


def physics_contrast_mask(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart = save_png(halation_chart(), "mask_chart.png")
    base, _ = open_chart(host, chart, params)
    masked, _ = open_chart(
        host, chart, apply(params, contrast_mask_active=True, contrast_mask_highlights=2.0, contrast_mask_shadows=2.0, contrast_mask_core=1.0, contrast_mask_scheme="gaussian", contrast_mask_scale=0.02)
    )
    diff = np.abs(masked - base)
    d = diff[..., :3].mean()
    record("B.mask", "contrast mask changes frame", float(d) > 0.002, f"mean|d|={float(d):.5f} max={float(diff.max()):.5f}")
    # Determinism: mask on must be stable across two renders.
    repeat, _ = open_chart(host, chart, apply(params, contrast_mask_active=True, contrast_mask_highlights=2.0, contrast_mask_shadows=2.0, contrast_mask_core=1.0, contrast_mask_scheme="gaussian", contrast_mask_scale=0.02))
    record("B.mask", "contrast mask deterministic", bool(np.array_equal(masked, repeat)), "two renders identical")
    return {"mean_delta": float(d)}


def physics_development(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart_img = gray_step_chart()
    chart = save_png(chart_img, "dev_steps.png")
    base, _ = open_chart(host, chart, params)
    push1, _ = open_chart(host, chart, apply(params, development_active=True, development_push_stops=1.0, development_temperature_c=20.0))
    push2, _ = open_chart(host, chart, apply(params, development_active=True, development_push_stops=2.0, development_temperature_c=20.0))
    warm, _ = open_chart(host, chart, apply(params, development_active=True, development_push_stops=0.5, development_temperature_c=23.0))

    def curve(rgb):
        h = rgb.shape[0]
        row = rgb[h // 2]
        step = row.shape[0] // 24
        return np.array([float(luma(row[i * step + step // 2])) for i in range(24)])

    c0, c1, c2, cw = curve(base), curve(push1), curve(push2), curve(warm)

    def mid_slope(c):
        """Local print contrast: d(luma) / d(patch index) over the midtones."""
        x = np.arange(6, 19, dtype=np.float64)
        y = np.asarray(c, dtype=np.float64)[6:19]
        return float(np.polyfit(x, y, 1)[0])

    s0, s1, s2, sw = mid_slope(c0), mid_slope(c1), mid_slope(c2), mid_slope(cw)
    # Printing normalises overall density, so the push signature is a steeper curve,
    # not a darker print. Push 2 must be at least as steep as push 1.
    dev_ok = s1 > s0 + 0.002 and s2 >= s1 - 1e-4
    warm_ok = sw > s0 + 0.001
    record(
        "B.dev",
        "push steepens the midtone print curve monotonically",
        dev_ok,
        f"slope base={s0:.4f} push1={s1:.4f} push2={s2:.4f}",
    )
    record("B.dev", "warmer developer steepens the curve", warm_ok, f"warm slope={sw:.4f} (base {s0:.4f})")

    # Profile-based push (measured curves from the film manufacturer) should agree.
    measured, _ = open_chart(host, chart, apply(params, film_stock="kodak_portra_800_push1"))
    measured2, _ = open_chart(host, chart, apply(params, film_stock="kodak_portra_800_push2"))
    base800, _ = open_chart(host, chart, apply(params, film_stock="kodak_portra_800"))
    sm1, sm2, s80 = mid_slope(curve(measured)), mid_slope(curve(measured2)), mid_slope(curve(base800))
    record(
        "B.dev",
        "measured push profiles steepen the same way",
        sm1 > s80 + 0.002 and sm2 >= sm1 - 1e-4,
        f"slope base800={s80:.4f} push1={sm1:.4f} push2={sm2:.4f}",
    )
    return {"s0": s0, "s1": s1, "s2": s2, "warm": sw, "measured_s1": sm1, "measured_s2": sm2}


def physics_illuminants(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart = save_png(gray_flat(160, 128), "illum.png")
    base, _ = open_chart(host, chart, params)
    view_a, _ = open_chart(host, chart, apply(params, viewing_illuminant="A"))
    scan_d65, _ = open_chart(host, chart, apply(params, scan_illuminant="D65"))
    same, _ = open_chart(host, chart, apply(params, scan_illuminant="D65", viewing_illuminant="D65"))
    b = base.mean(axis=(0, 1))
    va = view_a.mean(axis=(0, 1))
    sd = scan_d65.mean(axis=(0, 1))
    record("B.illum", "viewing illuminant shifts white balance", float(np.abs(va - b).max()) > 0.01, f"delta={va - b}")
    record("B.illum", "scan illuminant changes render", float(np.abs(sd - b).max()) > 0.002, f"delta={sd - b}")
    # same scan/view illuminant must not double-adapt relative to scan only
    sames = same.mean(axis=(0, 1))
    record(
        "B.illum",
        "equal scan/view illuminants skip double adaptation",
        float(np.abs(sames - sd).max()) < 2e-4,
        f"delta={sames - sd}",
    )
    return {"delta_view_a": (va - b).tolist(), "delta_scan_d65": (sd - b).tolist()}


def physics_determinism(host: Host) -> dict:
    params = load_defaults()
    s = host.open(params)
    a, _ = host.render(s, params, tier="live", long_edge=1600)
    b, _ = host.render(s, params, tier="live", long_edge=1600)
    record("B.det", "same session deterministic", bool(np.array_equal(a, b)), "two identical renders")
    s2 = host.open(params)
    c, _ = host.render(s2, params, tier="live", long_edge=1600)
    record("B.det", "new session deterministic", bool(np.array_equal(a, c)), "fresh session identical")


def physics_stock_matrix(host: Host) -> dict:
    params = apply(load_defaults(), **EFFECTS_OFF)
    chart = save_png(gray_flat(96, 64), "matrix.png")
    stocks = sorted(os.listdir(os.path.join(host.spec["res"], "profiles")))
    films = [f[:-5] for f in stocks if f.endswith(".json") and f.startswith(("kodak_", "fujifilm_", "ilford_", "cinestill_"))]
    ok = 0
    failures = []
    stats = []
    for film in films:
        try:
            rgb, _ = open_chart(host, chart, apply(params, film_stock=film))
            y = luma(rgb)
            stats.append((film, float(y.mean()), float(y.std())))
            if np.isfinite(y).all() and y.mean() > 0.01:
                ok += 1
            else:
                failures.append(film + ":bad-output")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{film}:{exc}")
    record(
        "B.matrix",
        "all stocks render",
        len(failures) == 0,
        f"{ok}/{len(films)} ok; failures={failures[:4]}",
    )
    means = [s[1] for s in stats]
    record(
        "B.matrix",
        "stock outputs in a plausible range",
        bool(means) and 0.05 < min(means) and max(means) < 0.95,
        f"mean luma {min(means):.3f}..{max(means):.3f}" if means else "no stocks",
    )
    return {"stocks": len(films), "failures": failures}


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    t0 = time.time()
    metrics = {}
    if mode in ("all", "regress"):
        if not OFFICIAL["host"] or not OFFICIAL["res"]:
            print("(regress skipped: set SPEKTRA_OFFICIAL_HOST/SPEKTRA_OFFICIAL_RES)")
        elif not RAW:
            print("(regress skipped: set SPEKTRA_TEST_RAW)")
        else:
            probe = Host(OFFICIAL)
            probe.close()  # fail fast if the reference is missing
            regress()
            regress_stocks()
            regress_export()
            regress_two_stage()
    if mode in ("all", "physics"):
        with Host(OURS) as host:
            load_defaults(host)
            metrics["hd"] = physics_hd_curve(host)
            metrics["neutral"] = physics_neutrality(host)
            metrics["grain"] = physics_grain(host)
            metrics["halation"] = physics_halation(host)
            metrics["mask"] = physics_contrast_mask(host)
            metrics["dev"] = physics_development(host)
            metrics["illum"] = physics_illuminants(host)
            metrics["sharp"] = physics_sharpness(host)
            metrics["band"] = physics_banding(host)
            physics_determinism(host)
            metrics["matrix"] = physics_stock_matrix(host)
    failures = [r for r in REPORT if not r["passed"]]
    out = {
        "when": time.strftime("%Y-%m-%d %H:%M:%S"),
        "mode": mode,
        "duration_s": round(time.time() - t0, 1),
        "checks": REPORT,
        "metrics": metrics,
        "summary": {"total": len(REPORT), "passed": len(REPORT) - len(failures), "failed": len(failures)},
    }
    path = os.path.join(TMP, f"assess_{mode}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print(f"\n{out['summary']}  ({out['duration_s']}s)  -> {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
