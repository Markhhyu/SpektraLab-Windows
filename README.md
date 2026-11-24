# SpektraLab Windows

[简体中文](README.zh-CN.md) · [Download for Windows x64](https://github.com/Markhhyu/SpektraLab-Windows/releases/latest) · [Release notes](RELEASES.md)

Develop a camera RAW as a film exposure, then choose how to print it. You can see what changes when you switch film stock, push development or change paper, and carry the same settings through a batch of photographs.

[Markhhyu](https://github.com/Markhhyu) independently maintains this Windows edition. It began with [SpektraLab for Windows v1.3.4-beta.3](https://github.com/JamesQiu2005/SpektraLab/releases/tag/spektralab-windows-v1.3.4-beta.3). This repository has its own releases, with ongoing work on film response, RAW highlights and the Windows editing workflow.

## Install and develop your first photo

1. Open the [latest Windows release](https://github.com/Markhhyu/SpektraLab-Windows/releases/latest) and download `SpektraLab-Windows-Markhhyu-<version>-x64-setup.exe`. The adjacent `.sha256` file contains its SHA-256 checksum.
2. Run the installer on Windows 10 or 11 x64 with a Vulkan 1.1-capable graphics driver. Setup can download Microsoft Edge WebView2 if needed. The installer is unsigned.
3. Open a RAW from the library and select a film stock. For a negative, pick a paper and adjust exposure. Inspect grain and highlight edges at 100%, then export a JPEG or a 16-bit TIFF. [Supported RAW formats and cameras](RAW-SUPPORT-20261029.md)

## What this edition changes

| When working on a photograph | What the Windows edition does |
| --- | --- |
| Placing exposure on 50D or E100 | The auto-exposure guard uses the selected stock’s characteristic curve. E100 layer exposure is checked against daylight grey-wedge densities. |
| Rendering lamps and signs on CineStill 800T | On supported Bayer RAWs, the renderer checks which sensor channels clipped before white balance when deciding where to reconstruct a light core. |
| Inspecting texture at 100% | VISION3 stocks have individual grain calibrations. On 50D, the spread of fine detail also follows Kodak’s published red, green and blue MTF curves. |
| Editing a shoot | Rate and flag photos in the library, apply local adjustments with masks, and batch-export a selection. Edits are stored separately from the original RAW. |

Calibration uses published film data and synthetic targets. For example, on daylight samples held out of the E100 fit, blue-layer density RMS error fell from 0.170 D to 0.041 D. A same-scene comparison with physical film is still pending. [Measurements and test conditions](RELEASES.md#en-1.10.0) · [Differences from upstream](DIFFERENCES.md)

## Build and contribute

The desktop app uses Tauri and React with a C++20/Vulkan render host. See the [Windows engine build guide](engine/WINDOWS.md) for the host and the [installer build guide](desktop/docs/WINDOWS-INSTALLER.md) for packaging. The [release guide](RELEASES.md) covers versioning and publishing.

For Windows bugs and feature requests, [open an issue here](https://github.com/Markhhyu/SpektraLab-Windows/issues). For a rendering issue, include the app version, GPU, input format, film stock and settings so someone else can reproduce the frame.

## Origins and licenses

- The desktop film and print simulator comes from [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab). The code is licensed under [GPL-3.0-or-later](license/LICENSE).
- Andrea Volpato’s [spektrafilm](https://github.com/andreavolpato/spektrafilm) supplies the photographic process model and film/paper profiles. Its profiles, LUTs and direct derivatives are licensed under [CC BY-SA 4.0](license/SPEKTRAFILM_LICENSE.txt). Hanze Qiu contributed the black-and-white profiles.
- Bundled Windows libraries have their own [third-party notices](license/windows-runtime-notices.json).
