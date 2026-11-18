# Film assessment

Two independent checks on the film simulation:

- **regress** — compares this build's host against another build's host (the
  shipped official binary works as an oracle) at the pixel level: tiers,
  effects, stocks, export and the two-stage decode. Any non-zero difference
  means the look changed.
- **physics** — drives synthetic charts through the pipeline and asserts that
  the film model still behaves like a film model: H&D curve, granularity,
  halation, tone mask, push/pull development, illuminants, sharpness,
  banding, determinism and the stock matrix.

`physics` needs only a built host and its resources (~10 s). `regress` also
needs a reference host and a RAW file (~110 s).

## Usage

```bat
set SPEKTRA_OURS_HOST=build\win-host\host\spektralab-host.exe
set SPEKTRA_OURS_RES=build\win-host\resources
python assess_film.py physics
```

```bat
set SPEKTRA_OFFICIAL_HOST=E:\path\to\official\spektralab-host.exe
set SPEKTRA_OFFICIAL_RES=E:\path\to\official\host\engine
set SPEKTRA_TEST_RAW=D:\photos\DSC07923.ARW
python assess_film.py all
```

Environment:

| Variable | Meaning |
|---|---|
| `SPEKTRA_OURS_HOST` / `SPEKTRA_OURS_RES` | host under test (defaults to the local `build/win-host` tree) |
| `SPEKTRA_OFFICIAL_HOST` / `SPEKTRA_OFFICIAL_RES` | reference host; when unset the regress chain is skipped |
| `SPEKTRA_TEST_RAW` | RAW file for the regress chain |
| `SPEKTRA_ASSESS_TMP` | output directory for charts and the JSON baseline |
| `SPEKTRA_HOST` / `SPEKTRA_RES` | used by `hostclient.py` when run standalone |

Output: `assess_<mode>.json` (checks, metrics, summary) plus the generated
charts. Exit code 0 means every check passed.

Run from a Python 3 environment with `numpy`; the regress chain also uses
`tifffile`. The host needs the MinGW runtime on `PATH` and a writable
directory in `TEMP`/`TMP` (the residency snapshot writes there).

## Interpreting the neutral-ramp baseline

`B.neutral` is a **baseline**, not a physics pass/fail: the desktop render
path produces a cross-over on neutral ramps (max RGB spread ~0.12), and the
shipped official binary is bit-identical there. The engine API path
(`spk_render`) is near-neutral and matches the upstream Python reference, so
the cross-over lives in the desktop view/export chain rather than in the film
model. The threshold locks the current behaviour so future changes cannot
widen it unnoticed.

## CI

Only the `physics` chain is CI-friendly (no reference binary, no RAW):

```yaml
- run: python engine/tools/film_assessment/assess_film.py physics
```
