"""Whole-image parity for the product stocks, against the **public upstream** reference.

`engine/resources_product/profiles/` holds the stock sets this port ships on top
of upstream's 28: Kodak T-Max 100, Tri-X 400, Ilford HP5 Plus 400, Ilford
Multigrade IV RC, Fujifilm Neopan Acros 100 II and CineStill 800T. The private
fork's reference (the one `parity_render.py` drives) knows them, but it is not
in this repository and not installed here, so their parity was unverified until
this harness existed.

The public upstream package can render them once three engine behaviours are
mirrored, because the product JSON is a superset of the 0.3.4 profile schema:

* unknown keys are dropped - the product files carry `metadata.tags`,
  `metadata.provenance`, `metadata.what`, which upstream's dataclasses reject;
* `derived_from` is materialized - cinestill_800t is an alias of
  kodak_vision3_500t with only `info` overrides; upstream has no alias concept.
  `engine/src/core/profile.cpp:243-290` defines the resolution: the base's whole
  profile, then the alias's `info` keys (the same allowlist is used here), and
  `stock`/`base_stock` renamed;
* the Hanatos-2025 window is skipped when a profile has no window parameters.
  The engine has this guard (`engine/src/core/hanatos.cpp:218`); upstream
  evaluates unconditionally and raises `ValueError: not enough values to unpack`
  (`spectral_upsampling.py:270`).

This harness reuses `parity_upstream.py`'s frame, comparison and reporting, and
patches `load_profile` for the product names only, so every other name still
resolves through the real upstream package - the same oracle, plus six files.

Known divergence, marked `expect_divergence`:

    cinestill_800t
        The engine's 1.3.4 owner decision renders a film tagged
        `antihalation: no` with the back-reflection halation model and, for an
        alias, prints with the base stock's neutral filter pack
        (`engine/src/core/params.cpp:546-563` and `:604-608`). Public 0.3.4 has
        neither: the Gaussian `no` preset (`(65 um, 0.30/0.10/0.015)`) and the
        default pack. Both sides are internally consistent; they must not agree.
        The other five stocks have no alias and no `no` tag, so they compare
        directly.

Measured 2026-11-16 at 128 px against the DLL built from this tree
(`build/win-tag/engine`, commit 9ceca33 plus the P0 patch set): the five
non-alias stocks land at 8.8e-06 .. 9.3e-06 absolute (1 count each), and
cinestill_800t diverges by 39181 counts - the back-reflection model showing in
the highlight halo, which is why the case is here rather than silent.

Usage:
    python engine/tests/parity_product_stocks.py --size 256 \
        --library build/win-host/spektrafilm_engine.dll \
        --resources build/win-host/resources

The reference package must be importable (see `parity_upstream.py`): set
SPEKTRAFILM_REF_SRC to the upstream checkout's `src/` (pinned commit
3bb2c2d2801ff68b92019cf1dbcbb133d60832bc) or pass `--ref-src`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import fields
from functools import lru_cache
from pathlib import Path

import numpy as np

from spk_test_paths import add_engine_arguments, engine_options

# This harness compares against the *optical* reference build. The macOS 2.x
# reading refinements (the print hue from the negative, and the minilab
# print table) are deliberate departures from the reference: with them on,
# every chromatic pair would differ by their design, so they are pinned off
# for the comparison (the same switch the macOS harnesses use).
os.environ.setdefault("SPK_V2_REFERENCE_OPTICAL", "1")
os.environ.setdefault("SPK_REFERENCE_HALATION_SHAPE", "1")   # the reference's equal-width halo

REPO = Path(__file__).resolve().parents[2]
PRODUCT = REPO / "engine/resources_product/profiles"
SHARED = REPO / "engine/resources/profiles"

# The engine's `override_info` allowlist (`engine/src/core/profile.cpp:218-227`)
# minus `stock`, which always names the alias itself.
ALIAS_INFO_KEYS = (
    "name", "type", "support", "stage", "use", "antihalation", "target_print",
    "channel_model", "densitometer", "reference_illuminant", "viewing_illuminant",
    "log_sensitivity_density_over_min",
)

CASES = [
    ("cinestill_800t", {"film_stock": "cinestill_800t"}),
    ("fujifilm_neopan_acros_100_ii", {"film_stock": "fujifilm_neopan_acros_100_ii"}),
    ("ilford_hp5_plus_400", {"film_stock": "ilford_hp5_plus_400"}),
    ("kodak_tmax_100", {"film_stock": "kodak_tmax_100"}),
    ("kodak_tri_x_400", {"film_stock": "kodak_tri_x_400"}),
    ("ilford_multigrade_iv_rc", {"print_stock": "ilford_multigrade_iv_rc"}),
]

EXPECT_DIVERGENCE = {
    "cinestill_800t": "1.3.4 back-reflection halation and alias base-pack vs upstream's Gaussian 'no' preset",
}


def product_stocks() -> tuple[str, ...]:
    return tuple(sorted(path.stem for path in PRODUCT.glob("*.json")))


def _read(name: str) -> dict:
    path = PRODUCT / f"{name}.json"
    if not path.is_file():
        path = SHARED / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _sanitize(entry: dict, allowed: set[str]) -> dict:
    return {key: value for key, value in entry.items() if key in allowed}


@lru_cache(maxsize=None)
def _profile_dict(name: str) -> dict:
    """The product profile as the public reference's dataclasses accept it."""
    from spektrafilm.profiles.io import ProfileData, ProfileInfo, ProfileMetadata

    raw = _read(name)
    if "derived_from" not in raw:
        out = raw
    else:
        base = _read(raw["derived_from"])
        if "derived_from" in base:
            raise ValueError(f"{base['derived_from']!r} is itself an alias; the engine rejects that")
        out = {"metadata": base.get("metadata", {}), "info": dict(base["info"]),
               "data": base["data"]}
        for key, value in raw.get("info", {}).items():
            if key in ALIAS_INFO_KEYS:
                out["info"][key] = value
        out["info"]["stock"] = name
    return {
        "metadata": _sanitize(out.get("metadata", {}), {f.name for f in fields(ProfileMetadata)}),
        "info": _sanitize(out.get("info", {}), {f.name for f in fields(ProfileInfo)}),
        "data": _sanitize(out.get("data", {}), {f.name for f in fields(ProfileData)}),
    }


def install_reference_profiles(stocks: tuple[str, ...]) -> None:
    """Teach the public reference to load the product stocks, nothing else."""
    import spektrafilm.profiles.io as upstream_io
    import spektrafilm.runtime.params_builder as params_builder
    from spektrafilm.profiles.io import profile_from_dict

    upstream_load = upstream_io.load_profile

    def load_profile(name):
        if name in stocks:
            return profile_from_dict(_profile_dict(name))
        return upstream_load(name)

    upstream_io.load_profile = load_profile
    params_builder.load_profile = load_profile


def reference_render(frame, film: str, paper: str, delta: dict, output_space: str) -> np.ndarray:
    from spektrafilm.runtime.params_builder import digest_params, init_params
    from spektrafilm.runtime.pipeline import SimulationPipeline

    import parity_upstream as parity

    # `init_params` takes stock *names* (params_builder.py:147-156) and is the
    # only door that applies the halation preset (`_apply_halation_preset`,
    # :199) that the engine's digest() also applies.
    params = init_params(film_profile=film, print_profile=paper)
    parity.apply_delta(params, {**parity.BASE, **delta})
    # Mirror the engine's guard: no window parameters means no window.
    params.settings.apply_hanatos2025_adaptation_window = bool(
        np.asarray(params.film.data.hanatos2025_adaptation_window_params).size)
    params.io.output_color_space = output_space
    params.io.output_cctf_encoding = delta.get("output_cctf_encoding", True)
    params.settings.working_precision = "float32"
    params.settings.gpu_backend = ""
    params = digest_params(params)
    return np.asarray(SimulationPipeline(params).process(frame), dtype=np.float64)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", action="append", help="run only these cases")
    ap.add_argument("--size", type=int, default=256,
                    help="synthetic frame height in pixels (default 256)")
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

    import parity_upstream as parity
    from spk_ctypes import Engine

    stocks = product_stocks()
    missing = [name for name, _ in CASES if name not in stocks]
    if missing:
        print(f"error: no product profile for {missing} under {PRODUCT}")
        return 2
    install_reference_profiles(stocks)
    print(f"product stocks: {', '.join(stocks)}")

    lib = Path(args.library or os.environ.get("SPEKTRAFILM_ENGINE_LIBRARY")
               or (REPO / "build/win-host/spektrafilm_engine.dll")).expanduser().resolve()
    frame = parity.load_frame(args.size)
    print(f"frame {frame.shape[1]}x{frame.shape[0]} range {frame.min():.4f}..{frame.max():.4f}")

    if sys.platform == "win32":
        dirs = [lib.parent, lib.parent / "host"]
        dirs += list(args.dll_dir or [])
        deps = os.environ.get("SPEKTRAFILAB_DEPS_DIR") or os.environ.get("SPEKTRAFILM_DEPS_DIR")
        if deps:
            dirs.append(Path(deps) / "mingw64/bin")
        for directory in dirs:
            if directory.is_dir():
                os.add_dll_directory(str(directory))

    cases = [case for case in CASES if not args.case or case[0] in args.case]
    failures = 0
    with Engine(**engine_options(args)) as engine:
        print(f"engine {engine.build_info}")
        for name, delta in cases:
            film = delta.get("film_stock", "kodak_portra_400")
            paper = delta.get("print_stock", "kodak_portra_endura")
            full = {**parity.BASE, **delta}
            try:
                with engine.open(frame, full) as session:
                    rgba, _ = session.render("full")
                    output_space = session.reply["params"]["output_color_space"]
            except Exception as exc:  # noqa: BLE001
                print(f"FAIL {name}: the engine refused - {exc}")
                failures += 1
                continue
            want = reference_render(frame, film, paper, delta, output_space)
            if not parity.compare(name, rgba, want, args.verbose,
                                  expected=EXPECT_DIVERGENCE.get(name)):
                failures += 1

    print(f"\n{len(cases)} product-stock cases, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
