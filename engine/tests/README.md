# Engine test harnesses

Most of these are CTest targets built next to the engine. The `parity_*.py`
harnesses are **not** part of CTest: they need a Python reference and are run by
hand before believing an engine change, except the two `parity_upstream*.py`
harnesses, which CI runs.

| Harness | Oracle | Notes |
| --- | --- | --- |
| `parity_setup.py` | fork `src/` | setup maths, float64 agreement |
| `parity_schema.py` | fork `src/` | wire/params parity |
| `parity_render.py` | fork `src/` | whole image, numba `SimulationPipeline` |
| `parity_session.py` | fork `src/` | live session fields |
| `parity_grain.py` | fork `src/` | grain distributions |
| `parity_lut.py` | fork `src/` | print LUT tables |
| `parity_upstream.py` | **public upstream** | subset of `parity_render.py` against `github.com/andreavolpato/spektrafilm` v0.3.4 |
| `parity_product_stocks.py` | **public upstream** | the six `engine/resources_product/` stocks, through the same adapter |

The two `parity_upstream*.py` harnesses are the only ones CI runs (workflow
`parity.yml`, Linux + lavapipe, `--size 256`); the rest need the private fork's
reference (`spektrafilm.service`) and stay hand-run.

## parity_upstream.py

`parity_render.py` needs the private fork's `spektrafilm.service` API
(`schema.validate_delta` / `schema.apply_delta`), which is not public. This
adapter compares the same shipping DLL through the same ctypes boundary with
the public upstream package instead, so the port keeps a reproducible parity
baseline when the fork is not at hand.

For the 28 stocks the two trees share, `src/spektrafilm/data/profiles/*.json`
is byte-identical to this repo's `resources/profiles/*.json` (profile data
0.3.2), so the two references implement the same physics for those stocks.
Fork-only features (contrast mask, scene latitude, Cineon DI, EDR) are out of
scope here; the six stocks that live only in `engine/resources_product/` are
covered by `parity_product_stocks.py` below.

```bash
# upstream checkout's src/ (v0.3.4), plus its venv/pip deps:
#   numpy scipy colour-science numba opt-einsum
export SPEKTRAFILM_REF_SRC=/path/to/spektrafilm/src

python engine/tests/parity_upstream.py --size 512 \
    --library build/win-host/spektrafilm_engine.dll \
    --resources build/win-host/resources
```

Bars are the same as `parity_render.py`: `3e-5` absolute in 16-bit counts, and at
most `1e-5` of samples more than one count out. The frame is deterministic and
synthetic (gradient + noise + 1 px checker + highlights); the 1 MP smoke TIFF
lives in the fork's `tests/Test_image/`.

Two cases diverge **by design** and fail if they ever agree:

- `halation_amount` off 1.0 — RFC-034 made this engine's number an area
  multiplier; the public reference scales the light only.
- `dir_couplers_amount` above ~1.736 — the reference's coupler inverse leaves
  `np.interp`'s monotonic domain, so its output is a search artefact.

`lens_blur_um` does agree: the fork-era "reference prunes it" note no longer
holds for upstream v0.3.4, which applies the blur.

## parity_product_stocks.py

The six stocks in `engine/resources_product/profiles/` — `cinestill_800t`,
`fujifilm_neopan_acros_100_ii`, `ilford_hp5_plus_400`,
`ilford_multigrade_iv_rc`, `kodak_tmax_100`, `kodak_tri_x_400` — are not in
the public package, so this harness teaches the upstream loader to read them
and then runs the same comparison. Three engine behaviours have to be
mirrored, all of them existing code, not test-side fudging:

- their metadata carries keys the upstream dataclasses do not know (`tags`,
  `provenance`, `what`); those are dropped, the physics fields are kept;
- `cinestill_800t` is an alias (`derived_from: kodak_vision3_500t`): the base's
  data is used whole and the alias's `info` overrides only the keys
  `engine/src/core/profile.cpp:243-290` allows;
- the five independent stocks carry no `hanatos2025_adaptation_window_params`,
  while the upstream applies the window unconditionally; the engine skips it
  when empty (`engine/src/core/hanatos.cpp:218`), so the harness mirrors that
  guard. (`cinestill_800t` inherits its base's parameters, so it keeps the
  window.)

```bash
export SPEKTRAFILM_REF_SRC=/path/to/spektrafilm/src
python engine/tests/parity_product_stocks.py --size 256 \
    --library build/win-host/spektrafilm_engine.dll \
    --resources build/win-host/resources
```

Bars are the same as above. At 256 px (what CI runs) the five independent
stocks land at 9.0e-06..1.2e-05 absolute, one count each; at 128 px they sit at
8.8e-06..9.3e-06.

`cinestill_800t` diverges **by design** and fails if it ever agrees: this engine
gives the film's own back-reflection halation model to a profile tagged
`antihalation: no` (`engine/src/core/params.cpp:546-563`, a 1.3.4 decision),
where upstream only has the Gaussian `no` preset; and an alias prints with its
base's neutral print pack (`params.cpp:604-608`), where upstream looks the pack
up by the alias name, finds nothing and uses defaults. Measured divergence:
35992 counts at 256 px, 39181 at 128 px.
