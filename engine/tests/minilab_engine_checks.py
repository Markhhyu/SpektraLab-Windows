#!/usr/bin/env python3
"""The minilab print (core/minilab.hpp, ported from the macOS 2.x line): what it must do.

    python engine/tests/minilab_engine_checks.py --library PATH [--resources DIR]

Needs numpy and the built engine DLL; no fixture. Ported from the macOS line's
`minilab_resource_checks.py`, without its macOS-only `performance_compare` and
`scene_curve_checks` dependencies: this checks the engine's own behaviour.

What is checked, and why each one can fail:

  catalogued pair   the pair the catalog lists (Portra 400 / Portra Endura)
                    renders differently with the table than with the optical
                    path (`SPK_V2_REFERENCE_OPTICAL`), and the same picture
                    twice (the table is deterministic).
  not catalogued    a colour pair the catalog does not list renders identically
                    with and without `SPK_V2_REFERENCE_OPTICAL` once the hue
                    node is off: it must not pick up another pair's table.
  missing catalog   an engine whose resources have no `minilab/index.json`
                    refuses to start (the catalog gate), rather than silently
                    printing optically.
  corrupt table     a catalogued pair with a changed table payload fails at
                    open with a named minilab error, never a substituted render.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spk_ctypes as spk  # noqa: E402

BASE = {
    "auto_exposure": False, "exposure_compensation_ev": 0.0,
    "grain_active": False, "glare_active": False, "halation_active": False,
    "input_color_space": "ProPhoto RGB", "input_cctf_decoding": False,
    "output_color_space": "Display P3", "output_cctf_encoding": True,
}
CATALOGUED = {"film_stock": "kodak_portra_400", "print_stock": "kodak_portra_endura"}
OTHER = {"film_stock": "kodak_ultramax_400", "print_stock": "kodak_supra_endura"}


class Env:
    """Environment switches the pipeline reads when it is built, for the length of one render."""

    def __init__(self, **kv): self.kv = kv

    def __enter__(self):
        self.saved = {k: os.environ.get(k) for k in self.kv}
        for k, v in self.kv.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v


def chart():
    h, w = 96, 192
    img = np.empty((h, w, 3), np.float32)
    x = np.linspace(0.02, 0.9, w, dtype=np.float32)[None, :]
    y = np.linspace(0.92, 0.08, h, dtype=np.float32)[:, None]
    img[:, :, 0] = x * y
    img[:, :, 1] = (x ** 0.8) * (y ** 1.2)
    img[:, :, 2] = (x ** 1.1) * (0.1 + 0.8 * y)
    return img


def render(engine, image, delta, **env):
    with Env(**env):
        s = engine.open(image, dict(BASE, **delta))
        try:
            rgba, _ = s.render("full")
        finally:
            s.close()
    return rgba


def resources_copy(src: Path, dest: Path, *, drop_minilab: bool = False) -> Path:
    shutil.copytree(src, dest)
    if drop_minilab:
        shutil.rmtree(dest / "minilab", ignore_errors=True)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--library", "--dylib", dest="library", type=Path, required=True)
    ap.add_argument("--resources", type=Path, default=None)
    ap.add_argument("--json", type=Path, default=None)
    args = ap.parse_args()
    resources = spk.resolve_resources(args.resources, args.library)
    engine = spk.Engine(library=args.library, resources=resources)
    print(engine.build_info)
    failures: list[str] = []
    report: dict = {"build": engine.build_info, "resources": str(resources)}

    def check(ok: bool, what: str):
        print(("  ok    " if ok else "  FAIL  ") + what)
        if not ok: failures.append(what)

    img = chart()

    print("catalogued pair: the table prints, and deterministically")
    with_table = render(engine, img, CATALOGUED)
    optical = render(engine, img, CATALOGUED, SPK_V2_REFERENCE_OPTICAL="1")
    again = render(engine, img, CATALOGUED)
    check(not np.array_equal(with_table, optical),
          f"Portra 400 -> Portra Endura: the table differs from the optical path "
          f"(mean |d| {np.abs(with_table.astype(int) - optical.astype(int)).mean():.2f} codes)")
    check(np.array_equal(with_table, again), "the same settings render the same picture twice")

    print("not catalogued: no other pair picks up the table")
    other_default = render(engine, img, OTHER, SPK_NEGATIVE_HUE="0")
    other_optical = render(engine, img, OTHER, SPK_NEGATIVE_HUE="0", SPK_V2_REFERENCE_OPTICAL="1")
    check(np.array_equal(other_default, other_optical),
          f"{OTHER['film_stock']} -> {OTHER['print_stock']}: identical with the table path off")

    print("missing catalog: the engine refuses to start")
    with tempfile.TemporaryDirectory() as td:
        broken = resources_copy(resources, Path(td) / "resources", drop_minilab=True)
        try:
            spk.Engine(library=args.library, resources=broken)
            check(False, "an engine without minilab/index.json must refuse to start")
        except spk.EngineError as exc:
            check("minilab" in str(exc), f"refused: {exc}")
        except FileNotFoundError as exc:
            check(False, f"library missing: {exc}")

    print("corrupt table: a listed pair fails by name, never render on a substitute")
    with tempfile.TemporaryDirectory() as td:
        broken = resources_copy(resources, Path(td) / "resources")
        # Both qualified tables: the engine picks the one matching the output
        # space (ProPhoto for Display P3/sRGB calibration), so corrupt every
        # payload rather than guessing which route this run takes.
        for table in sorted((broken / "minilab").glob("*.lut3d")):
            data = bytearray(table.read_bytes())
            data[len(data) // 2] ^= 0xFF
            table.write_bytes(bytes(data))
        e = None
        try:
            e = spk.Engine(library=args.library, resources=broken)
            s = e.open(img, dict(BASE, **CATALOGUED))
            s.close()
            check(False, "a corrupt table must fail the open")
        except spk.EngineError as exc:
            check("minilab" in str(exc), f"refused: {exc}")
        finally:
            if e is not None:
                e.close()   # Windows keeps the resources mapped; release before cleanup

    engine.close()

    report["failures"] = failures
    if args.json:
        args.json.write_text((__import__("json").dumps(report, indent=1)), encoding="utf-8")
    print(f"\n{len(failures)} failure(s)" if failures else "\nall checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
