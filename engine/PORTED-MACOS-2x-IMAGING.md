# macOS 2.2–2.4 imaging features, ported to the Windows engine

This branch ports the imaging features the macOS line landed between 2.2.0 and
2.4.0 (2026-11-08 .. 2026-11-14), i.e. after the Windows fork's point
(`9ceca33`, v1.3.4-beta.3). The Windows line keeps its own leadership (per-stock
grain, development push/pull, scan/viewing illuminants); these four are the macOS
line's, made to run on Vulkan.

| Feature | macOS origin | Windows files | Wire fields |
|---|---|---|---|
| **The print's hue, from the negative** | `core/negative_hue.{hpp,cpp}`, `shaders/negative_hue.metal`, `tests/negative_hue_checks.py` | `engine/src/core/negative_hue.{hpp,cpp}`, `engine/src/shaders/vulkan/spk_negative_hue.comp`, wired in `pipeline.cpp` (`build`, `print_spectral`, `node_negative_hue`) | none: on by default for a colour negative on a colour paper, exactly as the macOS app |
| **minilab print tables** | `core/minilab.{hpp,cpp}`, `shaders/minilab.metal`, `resources/minilab/`, `tests/minilab_*` | `engine/src/core/minilab.{hpp,cpp}`, `engine/src/shaders/vulkan/spk_minilab.comp`, `resources/minilab/` (the qualified Portra 400 → Portra Endura 65³ tables), wired in `setup_cache.hpp` + `pipeline.cpp` (`build`, `print_spectral`, `node_minilab`) | none: the catalog decides by (film, paper), exactly as the macOS app |
| **Diffusion filter (柔光镜)** | `core/diffusion_psf.{hpp,cpp}`, `pipeline/lens.cpp` (filter half), `shaders/lens.metal`, `tests/diffusion_checks.py` | `engine/src/core/diffusion_psf.{hpp,cpp}`, applied in `pipeline.cpp` `film_prefix` (`node_diffusion_filter`), `engine/tests/diffusion_psf.cpp` | `diffusion_filter_active`, `_family`, `_strength`, `_spatial_scale`, `_halo_warmth`, `_core_intensity`, `_core_size`, `_halo_intensity`, `_halo_size`, `_bloom_intensity`, `_bloom_size` (API-SPEC §21.5) |
| **Lens character (像差)** | `pipeline/lens.cpp` (aberration half), `shaders/lens.metal` (`spk_lens_tca`, `_loca_share`, `_loca_mix`, `_down2`, `_line`), `tests/lens_checks.py` | `engine/src/pipeline/pipeline.cpp` (`lens_field_px`, `node_lens_glow`, `node_lens_aberrations`, `lens_pyramid`, `lens_line`), five Vulkan kernels `spk_lens_{tca,loca_share,loca_mix,down2,line}.comp`, `engine/tests/lens_aberrations_engine_checks.py` | `lens_aberrations_active`, `lens_field_curvature_um`, `lens_astigmatism_um`, `lens_field_exponent`, `lens_sharp_radius`, `lens_coma_um`, `lens_spherical_amount`, `lens_spherical_um`, `lens_lateral_ca_r`, `lens_lateral_ca_b`, `lens_loca_um`, `lens_loca_sign`, `lens_loca_highlight_gate` (API-SPEC §21.6) |
| **Decode curve** | `pipeline/scene_latitude.cpp` (`scene_curve_wanted`, `node_scene_curve`), `shaders/scene_latitude.metal` (`spk_scene_curve`), `params.cpp` `parse_scene_curve`, `tests/scene_curve_checks.py` | `engine/src/pipeline/scene_latitude.cpp` (same two functions), `engine/src/shaders/vulkan/spk_scene_curve.comp`, `core/params.cpp` (`parse_scene_curve` + schema), desktop `DecodeCurveSection` reusing `CurveEditor` | `scene_curve` (5 rows of samples: rgb, luma, r, g, b; "" = off) |
| **Film-edge lens falloff** | `pipeline/overscan.cpp` (`normal_lens_mm`, `L.falloff*`), `shaders/overscan.metal` (`lens_falloff`) | `engine/src/pipeline/overscan.cpp` (same, appended as parameter indices 261-263 so every existing index holds), `engine/src/shaders/vulkan/spk_overscan_body.glsl`, `engine/tests/overscan_falloff_engine_checks.py` | `overscan_falloff` (0…1.5; picture only, never the rebate) |

The desktop exposes the diffusion filter and the lens character in **Imaging
path**: filter on/off, the four families (Glimmerglass / Black Pro-Mist /
Pro-Mist / CineBloom), the commercial stops (1/8, 1/4, 1/2, 1, 2); the lens's
field curvature, astigmatism, coma, lateral CA (red, blue), longitudinal CA
with its soft side, and spherical glow. The **Decode curve** is its own section
in the same rail (five channels, the same curve editor the grade uses, sent as
one five-row table); the film-edge's **lens falloff** is a slider beside Fog in
the film-edge section. Files: `desktop/src/shared/params.ts`,
`desktop/src/panels/RightRail.tsx`, `desktop/src/panels/LeftRail.tsx`,
`desktop/src/panels/CurveEditor.tsx` (now accepts a controlled value).

## Behaviour and deliberate divergences

- **Negative hue** is automatic: colour negative → colour paper, no calibrated
  table, not a scan film, not the DI, not a monochrome stock. Below a chroma
  floor a pixel is the optical print to the bit (greys are bit-identical; the
  test holds a 29-step grey ramp from −7 to +7 EV to that). `SPK_NEGATIVE_HUE=0`
  turns the node off; `SPK_NEGATIVE_HUE=force` puts it in a catalogued pair's
  place. `SPK_V2_REFERENCE_OPTICAL=1` turns off both reading refinements, which
  is what the parity harnesses set (`parity_upstream.py`,
  `parity_product_stocks.py` — pinned in the file so the comparison stays
  meaningful).
- **minilab** replaces the enlarger + print exposure + paper curves for a
  catalogued pair; the live enlarger controls (Brightness, Y/M, Pre-flash) move
  the light through the negative *before* the table, through the kernel's
  epilogue at mid-grey, exactly as the macOS node does (`minilab_enlarger`).
  The catalog is hash-pinned against the profile files in this repository: a
  changed profile or a corrupt table is a named error, never a silent optical
  substitution. The staged resources already match the pins (the paper profile
  differs from the *Python* reference only by the EDR tone map the macOS 2.x
  line carries; the FNV hash the index pins is this repository's file).
- **Tone Mask wins over minilab** (Windows-side decision): the mask's epilogue
  is the enlarger's integral plus the mask gain on paper exposure, and the
  table was qualified at the enlarger's rest. Rather than let a catalogued pair
  silently swallow the mask, an active mask (`contrast_mask_wanted()`) falls
  back to the optical print for that frame. The macOS line leaves the mask
  inert on a catalogued pair; this port does not.
- **The lens pass** is one pass on the tier's source in linear light, in the
  macOS order: diffusion filter → spherical glow → aberrations, before
  `geometry` and before the film chain. Positions are the frame's own centre and
  half-diagonal; the pitch is the format's at the source's long edge, so every
  tier shows the same physical lens. **This port runs the aberrations on the
  whole frame**, where the macOS engine chunks rows with their reach (memory:
  whole-frame keeps two extra planes alive; a 33 MP full-tier export with the
  lens on is the case to watch if VRAM is tight — the chunked path is the later
  optimisation, not a correctness gap).
- **Diffusion filter domain**: the public reference applies it to the film's
  raw exposure (`runtime/stages/filming.py`); the macOS engine and this port
  apply it to the source in linear light, before the film chain — the lens is
  in front of the film, and the API-SPEC §21.5 pass is defined that way. This
  is why there is no through-the-film parity case for it: the tables are held
  against the oracle instead (`tests/diffusion_psf.cpp`, every p_s, every
  exponential's λ and per-channel weight for Black Pro-Mist 1/2, unit mass,
  spatial scale, halo warmth).
- **Application path**: the macOS engine applies the diffusion filter through a
  Gaussian pyramid + core FIR (29 ms at 48 MP on an M3 Max). This port applies
  the same components as a full-resolution Gaussian mixture
  (`Blur::exponential_components` + `Blur::mixture`), like the macOS "exact"
  reference path. That is the one performance item left on the table: the
  pyramid is a later optimisation, not a correctness gap. The aberrations'
  gathers are the macOS algorithm line for line (tent pyramid, LOD variance
  matching, the comet's CDF cell masses and Jacobian, the cross-line tap pair).

## Not ported (and why)

| Feature | Why not, and where it stands |
|---|---|
| **Scene layers (RFC-052)** | Not a mechanical port, unlike the rest: the macOS ABI takes the mask planes as **Metal device buffers** (`gpu::borrow`, `spk_open_device`, both refused on Vulkan), and the kernel's coordinate map is `spk_geometry_source_px`, a Metal-only double-precision geometry inverse. A Windows port needs (1) a new plane-entry ABI that takes host memory (the engine has no device-buffer path), (2) a GLSL port of the geometry inverse, and (3) a mask-painting UI, which the Windows app does not have (its local adjustments are a different stage, after the print). The engine half alone would be invisible to users, so it is deferred as a design item rather than half-shipped. |
| **120 ks65 perforations, date-back data layout/leader, richer leak kinds** | Host geometry and text layout in `overscan.cpp` (the two trees' overscan files have diverged well beyond these fields; Windows is an older layout). The falloff above was the self-contained one; these need the layout merged field by field and their own visual checks. |
| **HDR scan + Enable HDR** (`scan_hdr`, `hdr_curves`, Apple gain-map export) | Depends on the macOS HDR display/gain-map stack; the Windows app would need its own HDR output path (gain map is Apple-specific). |

## Verification (this branch, Windows / Vulkan / RTX 4070 Laptop)

```
cmake --build build/port-macos2x -j16        # clean
ctest --test-dir build/port-macos2x           # 60/60 passed (adds spk_diffusion_psf)
engine/tests/parity_upstream.py --size 256    # 22/22, 0 failed (new features pinned off)
engine/tests/negative_hue_checks.py           # all checks passed: hue 0.58-0.85 deg vs 7.6-11.8 optical,
                                              #   |dL| <= 0.0014, greys bit-identical, determinism
engine/tests/minilab_engine_checks.py         # all checks passed: catalogued pair prints/deterministic,
                                              #   non-catalogued pair unchanged, missing catalog refuses,
                                              #   corrupt table refuses by name
engine/tests/diffusion_engine_checks.py       # all checks passed: off is identity, grey invariant to 0 codes,
                                              #   impulse centre -> halo, monotone strength, families differ,
                                              #   unknown family refused
engine/tests/lens_aberrations_engine_checks.py
                                              # all checks passed: off/zeros identity, deterministic; red CA
                                              #   +0.45 px outward and blue -0.43 px inward with green still;
                                              #   corner HF 80349 -> 34 with the centre unchanged; coma pushes
                                              #   a point's light outward; purple LoCA puts its halo in R/B
                                              #   (3.9x/3.2x vs G 1.7x) and green in G (2.8x vs 1.5x/1.4x);
                                              #   glow spreads to the ring (3.4-4.1x); combined pass runs
engine/tests/decode_curve_engine_checks.py    # all checks passed: "" is byte-exact, a diagonal table is
                                              #   the same bits, brightening/darkening bend tone, +0.02 on the
                                              #   luma row is exactly +0.32 stop of exposure (0 codes), and
                                              #   Film Exposure +1 moves the notch one stop down the input;
                                              #   malformed tables are refused by name
engine/tests/overscan_falloff_engine_checks.py
                                              # all checks passed: inert without the film edge, 0 is the
                                              #   edge's own render, the centre keeps 0.999x while the deepest
                                              #   loss is 0.858x at 0.83 of the half-diagonal, deterministic,
                                              #   monotone in the amount
host end-to-end                               # hello -> open -> render minilab pair -> set lens aberrations
                                              #   -> render: engine 80 ms -> 139 ms at 2560x1440
desktop: vitest run                           # targeted suites pass (params + imaging); the full suite's
                                              #   pre-existing Filmstrip timing case needs a quiet machine
                                              #   (it takes ~12 s alone and times out at 15 s when another
                                              #   build is competing for the CPU)
```

The comparisons that decide "did the port change the picture" are in the test
logs under `film-validation/port-macos-2x/` on the audit machine; the shipping
defaults are now macOS 2.x's: negative hue on for colour negatives, the minilab
table for Portra 400 → Portra Endura, and the lens pass off until the user turns
it on.

## Building

The engine's Vulkan backend needs the MinGW runtime DLLs beside the engine DLL
when it is loaded through ctypes (Python ≥ 3.8 does not use `PATH` for a
dependency's own DLLs); the shipping build links them statically
(`-DSPEKTRALAB_STATIC_RUNTIME=ON`). The test commands above were run with
`libgcc_s_seh-1.dll`, `libstdc++-6.dll`, `libwinpthread-1.dll` copied next to
`spektrafilm_engine.dll`, or with `deps/mingw64/bin` on `PATH`.
