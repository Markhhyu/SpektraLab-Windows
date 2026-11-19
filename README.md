# SpektraLab for Windows

**English** · [简体中文](README.zh-CN.md)

A Windows / Vulkan build of [SpektraLab](https://github.com/JamesQiu2005/SpektraLab) —
the spectral film-and-print simulator — derived from the original project's last
Windows beta, **v1.3.4-beta.3** (tag `9ceca33`). The Windows edition has its own
version line, currently **v1.9.3**, plus the Windows port fixes, performance work
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

This is not a recompile: the renderer was ported from Metal to Vulkan, the
interface was rebuilt as a Tauri/React app, and the film path gained capabilities
the macOS app does not have. The full list with measurements is in
[`DIFFERENCES.md`](DIFFERENCES.md); per-release changes are in
[`RELEASES.md`](RELEASES.md) and the port's engineering detail in
[`WINDOWS-PORT.md`](WINDOWS-PORT.md).

In short:

- **Film** — per-stock grain calibrated to film datasheets, development push/pull
  with temperature, selectable scan and viewing illuminants, a recalibrated Tone
  Mask, and Scene Placement guidance.
- **Performance** — warm-up before the first live frame, two-stage RAW opens, one
  export path for preview and export, parallel Deflate, and a four-host batch
  export pool.
- **Workflow** — a library with collections, a history panel, presets, masked
  local adjustments, and an imaging-path panel for the camera and scanner
  controls.

## Packaging and releases

- The shipped host is **static** (`-DSPEKTRALAB_STATIC_RUNTIME=ON`), so it
  depends only on system DLLs (ADVAPI32, KERNEL32, SHELL32, USER32, WS2_32,
  ole32, UCRT) — same as the original Windows beta.
- Release notes are written in **both Chinese and English**, and list what
  changed in that build. See [`RELEASES.md`](RELEASES.md) for the release
  process and the history.
- Small changes land as **commits on `main`**; an installer and a Release are
  produced when a batch of work is worth shipping. Tags follow this
  repository's own semantic versioning, `v<major>.<minor>.<patch>` (the first
  release is `v1.0.0`). [`RELEASES.md`](RELEASES.md) has the checklist.

## Build from source

Windows, MinGW-w64 GCC and CMake. The full dependency list (Vulkan headers +
glslang, LibRaw, export codecs, OpenEXR/lcms/heif, lensfun + static GLib) and
the exact configure lines are in [`WINDOWS-PORT.md`](WINDOWS-PORT.md) and
[`engine/WINDOWS.md`](engine/WINDOWS.md). Short version:

```powershell
# host + engine (Vulkan), resources, tests
cmake -S engine -B build/win-host -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build/win-host -j
ctest --test-dir build/win-host --output-on-failure     # 43 tests
```

Desktop app (Tauri + Rust + Node):

```bash
cd desktop && npm ci
node scripts/package.mjs win      # stages host, builds the frontend and NSIS
```

## Tests

- `ctest` — 43 engine/host tests, including the mask kernel oracle, residency
  policy, development model and illuminant tests.
- `engine/tests/parity_upstream.py` — whole-image parity against the public
  upstream Python package (needs a Python venv with numpy/scipy/numba/
  colour-science).
- `engine/tests/calibration_sweep.py` — DIR/halation/grain monotonicity.
- `cd desktop && npx vitest run` — 531 frontend tests (2 skipped).
- GitHub Actions — `Build` (upstream macOS clean checkout) and
  `Windows build` (an MSYS2 MinGW compile gate for the engine).

## Known limits

- This tree is based on upstream **v1.3.4-beta.3**: the macOS app has since added
  features (newer UI and other macOS-side features) that are not in this tree.
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
