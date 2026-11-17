# Windows port and optimisations (this repository)

This tree is a snapshot of SpektraLab **v1.3.4-beta.3** (`9ceca33`, the last
Windows beta release of the original project) plus the Windows/Vulkan work
described below.

- Original project: <https://github.com/JamesQiu2005/SpektraLab> — a macOS
  product (SwiftUI + C++/Metal engine).
- Film model and profile data: <https://github.com/andreavolpato/spektrafilm>
  (public Python reference; profile data v0.3.2).
- Licence: GPL-3.0-or-later — `license/LICENSE`; profiles and other data are
  CC BY-SA 4.0 — `license/SPEKTRAFILM_LICENSE.txt` and each profile's metadata.
- Snapshot upstream commit: `9ceca33` ("Recognize independent Windows beta
  releases in update checks").

## What was added or changed

### P0 — correctness / robustness

1. **Tone Mask (contrast mask) on the Windows Vulkan backend.** The macOS node
   (`engine/src/pipeline/contrast_mask.cpp`) was made platform-neutral and two
   compute kernels were added (`spk_mask_reduce`, `spk_mask_epilogue`). The host
   no longer lists `contrast_mask` in `unsupported_features`. Covered by a
   float64 kernel oracle and a C-API test (`engine/tests/gpu_vulkan_mask.cpp`,
   `spk_vulkan_mask --api`), plus boundary tests.
2. **Whole-image parity harness against the public Python reference**
   (`engine/tests/parity_upstream.py`): 22 cases, 512 px, all within the
   `3e-5` absolute bar; the two documented RFC-034 divergences
   (`halation_amount`, `dir_couplers_amount`) are asserted separately.
   The six fork-only stocks are covered by `parity_product_stocks.py`.
3. **Host-side residency budget / LRU eviction** (`engine/host/residency.hpp`,
   `engine/host/main.cpp`): at most `SPEKTRAFILM_HOST_RESIDENT_EDITORS`
   (default 2) editor sessions keep GPU caches; older ones are suspended and
   their bytes released. Tested in `engine/tests/host_residency.cpp`.
4. **GUI first frame:** the embedded camera preview is painted before the
   engine open (`desktop/src/state/session.ts`), so first view no longer waits
   for the full decode; the host gained a `warm_up` method.

### P1 — performance

5. **First-frame warm-up (`P1-3'`):** `spk_warm_up` is exposed through the host
   and run in a loop while the RAW decodes; the meter computation dropped from
   140.7 ms to ~50 ms (`std::nth_element` for the median, parallel legacy
   estimators in `engine/src/pipeline/pipeline.cpp`). Cold live first frame
   went from ~260 ms to ~180 ms.
6. **TIFF Deflate + predictor (`P1-5`):** compressor tag 259=8, predictor tag
   317=2, frontend option and export gating. Measured on 16-bit scans this
   saves ~11%; 8-bit TIFF/PNG is the larger lever and the docs say so.
7. **Unified export path (`P1-6`):** `export_image` now builds an
   `export_frame` request and reuses the GPU render + streaming encoder:
   `tiff16` 2079 -> 217 ms, `jpeg` 1849 -> 243 ms on a 32.95 MP frame.
8. **Calibration sweep harness (`P1-9`):** `engine/tests/calibration_sweep.py`
   checks DIR-coupler, halation and grain monotonicity against the public
   reference (13 points, 0 failures).
9. **Decode instrumentation and partial parallelism (`P1-10`):** per-stage
   decode timings (`SPEKTRAFILM_DECODE_TIMINGS`) and a parallel 16-bit -> float
   pack step. Two-stage decode and batch prefetch are documented as follow-ups
   because they change product semantics.
10. **Development model (`P1-7`, native extension):** parametric push/pull
    (-3..+3 stops) and developer temperature (18-24 C). The measured density
    curve is bent by `D_push = a * D(g * logE + s)`, fitted per channel to the
    Portra 800 push1/push2 profiles, with temperature folded in at 1/6 stop
    per degree C and grain RMS scaled with the push. `active=false` is an
    exact bypass. Parameters: `film_render.development.*`; test:
    `engine/tests/development_morph.cpp` (schema, bypass, direction,
    temperature equivalence, range refusal); desktop panel in the right rail.
    It is an approximation of the measured push profiles, not a per-stock
    replacement - the measured mean difference is ~2.6% of the frame.
11. **Scan / viewing illuminants (`P1-8`, native extension):** `io.scan_illuminant`
    and `io.viewing_illuminant` (print layer, `''` = the stock profile's own
    viewing illuminant, i.e. the old colour path). Scan constants are rebaked
    for the named light; a different viewing light shifts the values with CAT02
    for a soft proof and takes over the glare tint. Accepted names:
    `D50/D55/D65/D75/E/A/Incandescent/Kinoton 75P/TH-KG3/BB<kelvin>`; unknown
    names are refused by `validate_delta`. Test: `engine/tests/illuminants.cpp`;
    desktop Lighting panel. Paper surface/gloss (the rest of P1-8) is not done.

### Application features (v1.1.0)

12. **Persistent Lightroom-style library (v1.1.0):** importing a folder or a
    photo registers references only (nothing is copied and originals are never
    written). The catalog lives at
    `%AppData%\app.spektralab.desktop\Catalog\catalog.json` with thumbnails in
    `Catalog\thumbs\` (Rust commands in `desktop/src-tauri/src/catalog.rs`;
    logic in `desktop/src/shared/catalog.ts` and `desktop/src/state/library.ts`).
    The library view (`desktop/src/windows/LibraryView.tsx`) provides 0-5 star
    ratings, Pick/Reject flags, keywords, an "edited" badge, folder/keyword/
    rating/flag/search filtering, sorting, multi-select, and double-click/Enter
    to open a photo in the editor. Ratings and flags are catalog metadata;
    per-image adjustments stay in the existing sidecars, so editing is still
    non-destructive, and the library reopens with the last view/selection.
    Tests: `desktop/src/shared/catalog.test.ts` (8 cases) plus the full desktop
    suite (472 passed / 2 skipped); typecheck and lint are clean.

### Packaging

- Static-runtime host build (`-DSPEKTRALAB_STATIC_RUNTIME=ON`; the static
  `libgomp.a` needs `-ldl`, added via `CMAKE_CXX_STANDARD_LIBRARIES` in
  `engine/host/CMakeLists.txt`) so the shipped host depends only on system DLLs.
- Tauri bundle config and a test-only per-user installer config
  (`desktop/src-tauri/tauri.test.json`) used for install verification.
- `.github/workflows/parity.yml` runs the whole-image parity harness in CI.

## Windows build (short version)

The original Windows instructions are in `engine/WINDOWS.md`. This snapshot was
built on Windows with:

- MinGW GCC 15.2 x64, CMake 3.25+, Vulkan headers + glslang, LibRaw 0.22.2
- export codecs (libjpeg-turbo, libpng, zlib-ng, nasm), input codecs
  (OpenEXR, Imath, lcms2, libheif, libde265) and lensfun + static GLib
- host configure: `-DSPEKTRALAB_BUILD_HOST=ON -DSPEKTRALAB_BUILD_NATIVE_RAW=ON
  -DSPEKTRALAB_BUILD_TEST_DLL=ON -DSPEKTRALAB_REQUIRE_VULKAN=ON` plus
  `SPEKTRALAB_INPUT_CODEC_PREFIX` and `SPEKTRALAB_LENS_PREFIX`.
- desktop: Node + `npm ci`, Rust GNU toolchain with vendored crates, then
  `node scripts/package.mjs win` (or a host staging plus
  `npx tauri build --config src-tauri/tauri.bundle.json --bundles nsis`).

## Verification summary

RTX 4070 Laptop, 8 GB, 32.95 MP Sony ARW, default Portra 400 / Portra Endura:

- engine CTest 42/42; parity 22/22 cases within bar at 512 px.
- installed build: host hello ok (`backend.api=vulkan`), open 1.21-1.55 s
  (decode 1.11-1.16 s + engine open 90-130 ms), live first frame 226.7 ms,
  preview warm 34.6 ms, full warm 158 ms.
- desktop suite: 472 passed / 2 skipped (68 files), typecheck/lint clean.
- installer 37.54 MiB (39,362,478 B, sha256
  `eec29bb665ef9cf60ec0d74d34d1c33ccc4f3b0ace4d25a5e019d30009fe33c8`), host
  static (ADVAPI32/KERNEL32/SHELL32/USER32/WS2_32/ole32/UCRT only); install
  verification 166 files / 150.4 MiB on the earlier build; the v1.1.0 bundle
  reuses the same host.

## Known limits

- The other parity harnesses (`parity_render.py`, `parity_schema.py`, ...) need
  the private macOS-side Python reference; only `parity_upstream.py` and
  `calibration_sweep.py` run against the public package.
- `P1-8`'s paper surface/gloss half (a paper BRDF and observer choice) is not
  implemented; the scan/viewing illuminant half is (see above).
- P1-7 is a fitted parametric model, not measured per-stock push curves: the
  measured push1 profile and the model differ by ~1.7k counts mean on a
  32.95 MP frame (shape residual of the three-parameter family).
- `P0-2` fork-only nodes and the six product stocks are only compared where the
  public reference exposes them.
- Library thumbnails come from the camera-embedded preview; files the host
  cannot preview keep a placeholder cell, and removing an original from disk
  leaves an entry that is reported as missing when reopened.
