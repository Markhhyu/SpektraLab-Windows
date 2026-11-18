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

12. **Persistent library (v1.1.0, entry reworked in v1.1.1):** importing a
    folder or a photo registers references only (nothing is copied and originals
    are never written), and photos opened through the normal open path are
    registered automatically since v1.1.1. The library is reachable from the
    labelled toolbar button and **File → Library…** (`Ctrl+Shift+L`). The catalog
    lives at `%AppData%\app.spektralab.desktop\Catalog\catalog.json` with
    thumbnails in `Catalog\thumbs\` (Rust commands in
    `desktop/src-tauri/src/catalog.rs`; logic in
    `desktop/src/shared/catalog.ts` and `desktop/src/state/library.ts`); missing
    previews are hydrated in the background when the library opens. The library
    view (`desktop/src/windows/LibraryView.tsx`) provides 0-5 star ratings,
    Pick/Reject flags, keywords, an "edited" badge, folder/keyword/rating/flag/
    search filtering, sorting, multi-select, and double-click/Enter to open a
    photo in the editor. Ratings and flags are catalog metadata; per-image
    adjustments stay in the existing sidecars, so editing is still
    non-destructive, and the library reopens with the last view/selection.
    Opening a photo from the library (`openCollection` in
    `desktop/src/state/session.ts`) loads the whole visible catalog page into the
    editor filmstrip with the clicked frame focused, so frames can be browsed
    there without returning to the grid; the editor's Library button syncs the
    current frame back into the grid selection (v1.2.0).
    Tests: `desktop/src/shared/catalog.test.ts` (8 cases) plus the full desktop
    suite (472 passed / 2 skipped); typecheck and lint are clean.

### Batch and Library improvements (unreleased)

- Folder imports read camera-embedded previews through the render pool when 8
  or more files are imported: up to four workers, cancellable from the import
  dialog, with a failure list and one-click retry. Small imports stay on the
  interactive host.
- The filmstrip's context menu can set rating (1-5 / clear), flag (pick /
  reject / unflag) and colour labels for every picked frame, so culling works
  in Develop without hopping back to the Library. The same marks are on the
  keyboard: 0-5 stars, P pick, X reject, U unflag, applied to the picked frames
  (or the open frame).
- The Library grid has a thumbnail-size slider (96-240 px, remembered).
- The Library can sort by EXIF capture time ("Captured"), read from the file
  during import; files without a capture time fall back to their file mtime.
- A photo being decoded shows a canvas skeleton instead of the previous frame,
  so a ~1 s open reads as progress.
- The canvas histogram can be folded away (small toggle) so it never covers
  the picture; the choice is remembered.
- A unit test guards the Windows copy against macOS Command/Shift glyphs.
- Deflate TIFF export compresses a window of strips in parallel (up to four
  threads; strips are independent and writes stay in order). The 32.95 MP
  tiff16 export dropped from ~2.9 s to ~0.96 s on the reference machine, with
  byte-identical pixels on decode.
- The Library can rename a photograph in place from the metadata panel: the
  original file moves, its sidecar edits follow the fingerprint, the preview
  moves with it and collections keep tracking the photo. Renaming the frame
  that is open in Develop is refused, and a name clash is reported without
  touching the file.
- A window-level module bar (Library | Develop | Export) sits above all
  three views, so the modes share one visible order instead of being an
  overlay on top of the editor. The active mode is highlighted, Export is
  disabled until a photograph is selected, and the canvas bar's Library button
  routes through the same switcher.
- The right-hand parameter rail is titled "Develop" (Chinese "修改") like the
  module, so "develop" no longer means both the film development stage and the
  whole edit page; the solve action is "Solve" / "配光" and the meter-and-balance
  action is "Meter and balance" / "测光与配光".

### Local adjustments (v1.8.0)

- Per-photo masked grades (linear gradients and radial masks) with exposure,
  contrast, highlights, shadows, saturation, temperature, tint, feather and
  invert; up to 16 layers. Geometry is normalised over the finished frame, so a
  mask follows crop and rotation.
- The pass lives in the host (`engine/host/local_adjust.{hpp,cpp}`): the engine
  renders the print through Layer 2 as before, then the host decodes the frame
  to linear light, evaluates each mask, applies the grade and re-encodes. The
  engine ABI and parameter schema are unchanged; an empty list is an exact
  bypass.
- `adjustments.localAdjustments` rides the existing sidecar/wire JSON. The
  TypeScript side (`desktop/src/shared/localAdjust.ts`) owns validation, the
  tolerant sidecar decode and the client-side mask maths used by tests.
- The RightRail panel adds the layer list, grade sliders and geometry sliders.
- Verified by a host probe (`film-validation/bench/probe_local.py`): empty
  bypass is byte-identical, radial mask brightens the centre only, linear mask
  ramps to its end side, malformed layers return `bad_request`, and an export
  with a mask differs from one without.

### Batch render pool (unreleased)

- Batch exports can run on up to four **background host processes** instead of
  the interactive one (`desktop/src-tauri/src/pool.rs`, `HostPool`). Each worker
  is a normal `spektralab-host` started with `HostManager::new_named(..., quiet)`
  so its state changes never reach the editor; the pool starts on demand and is
  shut down when the batch ends, returning the GPU memory.
- A worker needs no session: `export_frame` accepts `source_path` + `decode`,
  opens a private frame internally and releases it (`engine/host/main.cpp`).
  That is what lets four photographs render at once.
- Tauri commands: `pool_ensure`, `pool_state`, `pool_request`, `pool_restart`,
  `pool_shutdown` (`src/lib.rs`). `pool_request` takes the same workspace lease
  as `host_request` for anything except `cancel`/`ping`/`shutdown`.
- The batch page (`desktop/src/export/ExportPage.tsx`) schedules frozen frames
  with `runPooled` (`src/export/poolBatch.ts`), one lane per worker, cancels
  every lane on Stop, and falls back to the interactive host when the pool
  cannot start. Settings → Rendering → Batch rendering picks 1–4 workers.
- Verified at the protocol level (`film-validation/bench/probe_pool.py`):
  three RAW frames sequentially on one host 18.1 s vs concurrently on three
  hosts 5.8 s (3.1×), VRAM 1.95 → 2.42 GB; frontend 521 tests pass.

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
