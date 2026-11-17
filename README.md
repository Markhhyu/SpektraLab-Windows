# SpektraLab for Windows

**English** · [简体中文](README.zh-CN.md)

A Windows / Vulkan build of [SpektraLab](https://github.com/JamesQiu2005/SpektraLab) —
the spectral film-and-print simulator — derived from the original project's last
Windows beta, **v1.3.4-beta.3** (tag `9ceca33`). The Windows edition has its own
version line, currently **v1.1.1**, plus the Windows port fixes, performance work
and two native extensions described below.

The film process model, the 28 measured film/paper profiles and the print LUTs
come from [spektrafilm](https://github.com/andreavolpato/spektrafilm). The
original app is a macOS product (SwiftUI + Metal); this repository keeps its
C++20 engine and drives it through a Vulkan host on Windows.

> **This is a derivative, not the upstream project.** Bug reports about the
> macOS app belong to [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab);
> issues about this Windows build belong here.

## Download and install

Grab the installer from **[Releases](https://github.com/Markhhyu/SpektraLab-Windows/releases)** —
`SpektraLab_<version>_x64-setup.exe` (NSIS, ~38 MB).

- Windows 10/11, 64-bit.
- A GPU with a working Vulkan 1.1+ driver (RTX 4070 Laptop / 8 GB was the
  reference machine; any recent AMD, Intel or NVIDIA GPU should work).
- WebView2 Runtime (the installer downloads it if missing).
- The installer is **not code-signed**, so SmartScreen says "Windows protected
  your PC" — choose *More info → Run anyway*.
- Default install mode is per-machine and needs elevation. That is the same
  behaviour as the original Windows beta.

First run: **Open** a RAW (LibRaw-supported), pick a film and a paper, edit.
The right rail has the parameters; the left rail has the film/print choice.
Interactively, a 32.95 MP Sony ARW opens in ~1.2 s and shows its first live
frame in ~0.2 s on the reference machine.

## What this build adds

Everything is listed with measurements in [`WINDOWS-PORT.md`](WINDOWS-PORT.md);
the short version:

#### Correctness and robustness (P0)

1. **Tone Mask on the Vulkan backend** — the macOS contrast-mask node was made
   platform-neutral and two compute kernels were added; the host no longer
   advertises `contrast_mask` as unsupported, so the UI works.
2. **Whole-image parity harness** against the public Python reference
   (`engine/tests/parity_upstream.py`): 22 cases, all inside the 3e-5 bar;
   documented semantic divergences are asserted separately.
3. **Editor residency budget** — at most two editor caches stay resident;
   older ones are suspended to disk and their GPU memory released
   (`SPEKTRAFILM_HOST_RESIDENT_EDITORS` overrides).
4. **First-viewer latency** — the embedded camera preview is painted before
   the engine open; the host gained `warm_up`, and meter computation no longer
   sorts 1.7 M doubles.

#### Performance (P1)

5. First-frame warm-up: `spk_warm_up` runs while the RAW decodes; cold live
   first frame ~260 ms → ~180 ms.
6. TIFF **Deflate + predictor** option (`tiff_compression: "deflate"`):
   ~11 % smaller 16-bit exports (lossless, validated against libtiff/OIIO).
7. Unified export path: `export_image` reuses the GPU render + streaming
   encoder — `tiff16` 2079 → 217 ms, `jpeg` 1849 → 243 ms on 32.95 MP.
8. Calibration sweep harness (`engine/tests/calibration_sweep.py`): DIR
   couplers, halation and grain monotonicity against the reference, 13 points,
   0 failures.
9. Decode instrumentation (`SPEKTRAFILM_DECODE_TIMINGS`) and a parallel
   16-bit→float pack step; two-stage decode is documented as a product decision.

#### Native extensions (not in the macOS app)

10. **Development panel (`P1-7`)** — push/pull −3…+3 stops in 1/3 stops and
    developer temperature 18–24 °C. The measured density curve is bent by a
    three-parameter family fitted to the Portra 800 push1/push2 profiles;
    temperature folds in at 1/6 stop per °C and grain scales with the push.
    `Off` is a byte-exact bypass. This is an approximation of the measured
    push profiles (~2.6 % mean difference), not a per-stock replacement.
11. **Lighting panel (`P1-8`)** — scan light and viewing light are selectable
    (`D50/D55/D65/D75/E/A/Incandescent/Kinoton 75P/TH-KG3/BB<kelvin>`).
    Scan constants rebake for the named light; a different viewing light is a
    CAT02 soft proof and takes over the glare tint. Leaving both on the stock
    default is the exact pre-P1-8 rendering.

12. **Library (`v1.1.1`)** — a persistent photo catalog. Open it from the
    labelled **Library** button in the toolbar or **File → Library…**
    (`Ctrl+Shift+L`). Importing a folder or photo registers references only
    (originals are never copied or modified) and photos opened through the
    normal open path are registered automatically as well. Thumbnails, 0–5 star
    ratings, pick/reject flags, keywords and edit markers live in
    `<AppData>\app.spektralab.desktop\Catalog\catalog.json` and
    `...\Catalog\thumbs\`. The library restores on launch, filters by
    folder/keyword/rating/flag/search, sorts, remembers the last selection, and
    double-click opens a frame in the editor. Edits stay non-destructive
    per-image sidecars, exactly as before.

## Packaging and releases

- The shipped host is **static** (`-DSPEKTRALAB_STATIC_RUNTIME=ON`), so it
  depends only on system DLLs (ADVAPI32, KERNEL32, SHELL32, USER32, WS2_32,
  ole32, UCRT) — same as the original Windows beta.
- Release notes are written in **both Chinese and English**, and list what
  changed in that build. See [`RELEASES.md`](RELEASES.md) for the release
  process and the history.
- Every code update gets a rebuilt installer and a new release entry; tags
  follow this repository's own semantic versioning, `v<major>.<minor>.<patch>`
  (the first release is `v1.0.0`).

## Build from source

Windows, MinGW-w64 GCC and CMake. The full dependency list (Vulkan headers +
glslang, LibRaw, export codecs, OpenEXR/lcms/heif, lensfun + static GLib) and
the exact configure lines are in [`WINDOWS-PORT.md`](WINDOWS-PORT.md) and
[`engine/WINDOWS.md`](engine/WINDOWS.md). Short version:

```powershell
# host + engine (Vulkan), resources, tests
cmake -S engine -B build/win-host -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build/win-host -j
ctest --test-dir build/win-host --output-on-failure     # 41 tests
```

Desktop app (Tauri + Rust + Node):

```bash
cd desktop && npm ci
node scripts/package.mjs win      # stages host, builds the frontend and NSIS
```

## Tests

- `ctest` — 41 engine/host tests, including the mask kernel oracle, residency
  policy, development model and illuminant tests.
- `engine/tests/parity_upstream.py` — whole-image parity against the public
  upstream Python package (needs a Python venv with numpy/scipy/numba/
  colour-science).
- `engine/tests/calibration_sweep.py` — DIR/halation/grain monotonicity.
- `cd desktop && npx vitest run` — 472 frontend tests.

## Known limits

- This tree is based on upstream **v1.3.4-beta.3**: the macOS app has since added
  features (newer UI, Local Adjustments, etc.) that are not in this tree.
- P1-8's paper surface/gloss half (paper BRDF, 2°/10° observer) is not
  implemented; only the illuminant half is.
- Whole-image parity is checked against the public `spektrafilm` package; the
  private macOS-side reference used by the other `parity_*.py` harnesses is not
  available here, so the fork-only stocks are only covered by
  `parity_product_stocks.py`.
- The GUI is a Windows Tauri/React port, not the macOS SwiftUI interface.

## Credits and licence

- Original project: [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab)
  (GPL-3.0-or-later), snapshot tag `9ceca33`.
- Film process model, profiles and LUTs: [spektrafilm](https://github.com/andreavolpato/spektrafilm)
  by Andrea Volpato (profiles CC BY-SA 4.0).
- B&W profiles: Hanze Qiu.

| | |
|---|---|
| app and engine | GPL-3.0-or-later — [`license/LICENSE`](license/LICENSE) |
| film/paper profiles, print LUTs | CC BY-SA 4.0 — [`license/SPEKTRAFILM_LICENSE.txt`](license/SPEKTRAFILM_LICENSE.txt) |
| third-party notices | `license/windows-runtime-notices.json` |
