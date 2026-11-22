# SpektraLab for Windows — differences from the macOS app

This tree started as the upstream macOS app at tag `9ceca33`
(v1.3.4-beta.3) and was turned into a Windows product: the Metal renderer
became a Vulkan one, the SwiftUI interface became a Tauri/React desktop app, and
the film path gained features the macOS app does not have. This page is the
one-stop overview of what differs; the per-release history lives in
[`RELEASES.md`](RELEASES.md) and the measurement detail in
[`WINDOWS-PORT.md`](WINDOWS-PORT.md).

## Platform and build

- **Vulkan renderer.** Every Metal node (film, printing, grain, glare, halation,
  DIR couplers, gamut mapping, the debug LUT) was ported to Vulkan compute, with
  whole-image parity against the public `spektrafilm` reference at the 3e-5 bar.
- **Tone Mask on Vulkan.** The macOS contrast-mask node was made
  platform-neutral and two compute kernels were added, so the host no longer
  reports `contrast_mask` as unsupported and the panel works.
- **Tauri/React GUI instead of SwiftUI**, sharing the parameters rail with the
  macOS layout but built on a web frontend plus a native Rust shell.
- **Static host.** The shipped `spektralab-host.exe` links the runtime
  statically and needs only system DLLs, so the installer carries no toolchain
  DLLs.
- **Parity and regression harnesses that run on Windows**, including
  `engine/tests/parity_upstream.py` (22 whole-image cases against the public
  Python package) and `engine/tests/calibration_sweep.py`.

## Performance

- First live frame on a 32.95 MP RAW: about 260 ms → 180 ms, because
  `spk_warm_up` runs while the RAW decodes.
- Two-stage open: a half-resolution LibRaw decode puts the first frame on
  screen in about 0.45 s instead of 1.12 s, then the full decode follows.
- Unified export path: `tiff16` 2079 → 217 ms and `jpeg` 1849 → 243 ms at
  32.95 MP.
- TIFF Deflate with predictor: about 11% smaller 16-bit exports, lossless; strip
  compression is parallel, about 2.9 s → 0.96 s.
- Batch export render pool (up to four hosts): three 32.95 MP TIFF exports
  measured 18.1 s → 5.8 s (3.1×), with the extra hosts alive only during the run.
- **Cheapest sufficient embedded preview (`v1.9.4`).** The host used to unpack the
  camera's full-resolution preview for every thumbnail (220 ms for 320 px on an
  A7M4 ARW, which also stores a 1616×1080 and a 160×120 preview); it now picks the
  smallest preview that still covers the request, so 320 px takes 18 ms and a
  2048 px preview 36 ms. A preview is never upscaled to reach the request.
- **Filmstrip keeps what it decoded (`v1.9.4`).** Opening a photo from the library
  no longer resets the thumbnail cache, and unloaded cells fall back to the JPEG
  the library cached at import, so revisiting the same page costs no host round
  trips.

## Film simulation

- **Per-stock grain (`v1.9.3`).** Each VISION3 stock (50D, 250D, 200T, 500T)
  now carries its own grain, calibrated to that film's published diffuse-rms
  granularity; before this all stocks shared one global setting. The macOS app
  keeps the global model.
- **Grain calibrated to datasheets (`v1.9.2`)**, using the VISION3 50D
  granularity curves (48 µm aperture, ECN-2, Status M, at net density 1.0) as
  the anchor: red/green/blue now solve to 2.6 / 5.3 / 10.2 against the sheet's
  2.6 / 5.3 / 10.5, so red is the finest grain and blue the coarsest.
- **Development moved into the grain tables (`v1.9.2`).** Push/pull now moves
  the grain density axis as well as the curves, so grain coarsens with density
  the way a real negative does instead of only scaling with the push slider.
- **Development panel (`P1-7`, not in the macOS app).** Push/pull −3…+3 stops in
  1/3 stops and developer temperature 18–24 °C; the density curve is bent by a
  three-parameter family fitted to the measured Portra 800 push profiles
  (~2.6% mean difference), temperature folds in at about 1/6 stop per °C, and
  `Off` is a byte-exact bypass.
- **Lighting panel (`P1-8`, not in the macOS app).** Scan light and viewing light
  are selectable; scan constants rebake for the named light and a different
  viewing light is a CAT02 soft proof that takes over the glare tint. Leaving
  both on the stock default reproduces the pre-P1-8 rendering.
- **Tone Mask recalibrated (`v1.9.1`).** Each side is calibrated against the
  reach actually available on that paper instead of a fixed four-stop anchor, so
  `highlights=1` became visible (top 2% band mean 3.3 → 555.9 code values at
  640 px) and 1 → 2 → 3 is monotonic.
- **Scene Placement guidance (`v1.9.1`).** `minimum_pull_back` reports the value
  that actually works (0.9922 → 1.0182 on the highlight side), and pulling past
  the point where the knee crosses mid-grey stops with a "would flatten the
  whole frame" hint.

## Application features

- **Library and collections (`v1.3.0`)** — persistent catalog, collections and
  smart collections, metadata editing, bulk marks, anchor-photo settings sync,
  non-destructive sidecars, and filmstrip hand-off when opening from the grid.
- **Imaging path panel (`v1.9.1`)** — seven look parameters the engine already
  supported now have controls: camera filters (W8/W11/W12/W15/W21/W25/W47/W58),
  lens blur in µm, density-curve gamma, scanner white/black point correction,
  scanner lens blur and the carrier (none/black/open, once film edges are on).
- **History and presets (`v1.7.0`)** — `Ctrl+H` lists every undo step with a
  generated label and jumps back to it; the parameters rail saves and applies
  presets as normal undoable edits.
- **Local adjustments (`v1.8.0`)** — linear and radial masked grades (exposure,
  contrast, highlights, shadows, saturation, temperature, tint, feather,
  invert; up to 16 layers) applied by the host in linear light after the print.
- **Readable tone tools (`v1.5.0`)** — histogram-style latitude plot, printable
  band shading, held-stops readout and one-click suggested placement.
- **Workflow polish (`v1.6.0`, `v1.9.0`)** — Tone Mask panel, shortcut sheet,
  searches and recent picks for stocks, module bar, EXIF sorting, thumbnail-size
  slider, in-place rename, filmstrip rating/flagging and a two-stage open.
- **Rebuilt interface (`v1.9.4`)** — a dark theme with shared tokens, a redesigned
  gallery toolbar, sidebar, grid and metadata panel, real rating/flag/label
  controls (set from the card on hover, mixed state on multi-select), toggles,
  sliders and switches throughout, and an empty state for an unimported library.

## Deliberate divergences and known limits

- Whole-image parity covers the shared 28 stock profiles; the handful of
  fork-only product stocks is covered by `parity_product_stocks.py`.
- Grain is now deliberately calibrated to datasheets instead of the upstream
  defaults, so `engine/tests/parity_grain.py` records a documented divergence;
  the 22 whole-image parity cases run with grain off and stay green.
- `halation_amount` is an area multiplier here and `dir_couplers_amount` above
  about 1.736 leaves the reference's interpolation domain; both are asserted as
  expected divergences rather than failures.
- A Cineon DI export carrying local-adjustment layers now fails with a clear
  error instead of silently dropping them.
- `enlarger.illuminant` is not exposed in the UI: the neutral-filter data only
  has a TH-KG3 entry, so any other value would shift colour silently.
- The P1-8 paper-surface half (BRDF, 2°/10° observers) is not implemented; only
  the illuminant half is.
- This tree is based on upstream `v1.3.4-beta.3`; macOS-only work added upstream
  after that snapshot is not included.
- The GUI is the Tauri/React port, not the macOS SwiftUI interface.

# 与上游 macOS 版的差异

本仓库从上游 macOS 版 `9ceca33`（v1.3.4-beta.3）出发改造成 Windows 产品：Metal
渲染器换成了 Vulkan，SwiftUI 界面换成了 Tauri/React 桌面应用，胶片链路还加上了
macOS 版没有的能力。本文件集中说明这些差异；逐版本历史见
[`RELEASES.md`](RELEASES.md)，实测细节见 [`WINDOWS-PORT.md`](WINDOWS-PORT.md)。

## 平台与构建

- **Vulkan 渲染器**：Metal 的每个节点（胶片、印片、颗粒、眩光、光晕、DIR 耦合、
  色域映射、调试 LUT）都移植为 Vulkan compute，整图 parity 对公开 `spektrafilm`
  参考包保持在 3e-5 误差线内。
- **Vulkan 后端的 Tone Mask**：把 macOS 的对比度蒙版节点平台化并新增两个 compute
  kernel，host 不再把 `contrast_mask` 列为不支持，面板因此可用。
- **Tauri/React 界面替代 SwiftUI**：参数右栏沿用 macOS 的组织方式，但界面基于 Web
  前端加 Rust 原生外壳。
- **静态宿主**：出货的 `spektralab-host.exe` 静态链接运行库，只依赖系统 DLL，
  安装包里不再附带工具链 DLL。
- **可在 Windows 上运行的回归与 parity 套装**，包括对公开 Python 包的 22 个整图
  parity case（`engine/tests/parity_upstream.py`）与
  `engine/tests/calibration_sweep.py`。

## 性能

- 32.95 MP RAW 的 live 首帧约 260 ms → 180 ms：`spk_warm_up` 在 RAW 解码期间预热。
- 两段打开：先半分辨率 LibRaw 解码（首帧约 0.45 s，原约 1.12 s），随后自动补齐全分辨率。
- 统一导出路径：32.95 MP 下 `tiff16` 2079 → 217 ms，`jpeg` 1849 → 243 ms。
- TIFF Deflate + predictor：16-bit 导出约小 11% 且无损；条带并行压缩，约 2.9 s → 0.96 s。
- 批量导出渲染池（最多 4 个宿主）：3 张 32.95 MP TIFF 实测 18.1 s → 5.8 s（3.1 倍），
  额外宿主只在导出期间存在。
- **挑最小够用的嵌入预览（`v1.9.4`）**：此前每张缩略图都去解相机里那张全尺寸预览
  （A7M4 的 ARW 里另存着 1616×1080 与 160×120 两张，320 px 缩略图却要 220 ms）；
  现在按目标尺寸挑最小的够用预览，320 px 降到 18 ms、2048 px 预览 36 ms，且从不放大。
- **胶片条保留已解码的缩略图（`v1.9.4`）**：从图库打开照片不再清空缩略图缓存；还没
  进过队列的格子回退到导入时缓存的 JPEG，所以重进同一页不再产生宿主往返。

## 胶片模拟

- **逐片种颗粒（`v1.9.3`）**：四个 VISION3 电影负片（50D、250D、200T、500T）各自
  按该片种 datasheet 的 diffuse rms 颗粒度标定；此前所有片种共用一组全局参数。
  macOS 版仍是全局模型。
- **颗粒按 datasheet 重标定（`v1.9.2`）**：以 VISION3 50D 的颗粒度曲线为锚
  （48 µm 孔径、ECN-2、Status M、净密度 1.0），红/绿/蓝解到 2.6 / 5.3 / 10.2
  （datasheet 2.6 / 5.3 / 10.5），红色最细、蓝色最粗。
- **显影进入颗粒密度轴（`v1.9.2`）**：推拉现在同时改变颗粒的密度轴与曲线，颗粒
  随密度变粗，而不是只随推拉滑块线性缩放。
- **显影面板（`P1-7`，macOS 版没有）**：推拉 −3…+3 档（1/3 档步进）与显影温度
  18–24 °C；密度曲线由拟合 Portra 800 实测推档 profile 的三参数族弯曲（平均差约
  2.6%），温度按 1 °C ≈ 1/6 档折算，关闭时是逐字节精确旁路。
- **光源面板（`P1-8`，macOS 版没有）**：扫描光源与观看光源可选；扫描常量按命名
  光源重新烘焙，观看光源经 CAT02 软打样并接管 glare 染色。两者保持默认时输出与
  P1-8 之前一致。
- **影调蒙版重标定（`v1.9.1`）**：每一侧按该相纸实际可达范围标定，不再用固定四档
  锚点，`highlights=1` 从不可见变为可见（640 px 下高光带 2% 像素均值 3.3 → 555.9），
  且 1 → 2 → 3 档单调。
- **场景置位提示（`v1.9.1`）**：`minimum_pull_back` 报告真正可用的值（高光侧
  0.9922 → 1.0182），回拉到膝点越过中灰时停止并提示"再拉会把整幅画面压平"。

## 应用功能

- **图库与集合（`v1.3.0`）**：持久目录、集合与智能集合、元数据编辑、批量标记、
  锚点照片设置同步、非破坏性 sidecar，以及从图库打开时把整页照片交给编辑器胶片条。
- **成像链细节面板（`v1.9.1`）**：引擎早已支持但界面没有入口的 7 个观感参数，现在
  都有控件——相机滤镜（W8/W11/W12/W15/W21/W25/W47/W58）、镜头模糊（µm）、
  密度曲线 gamma、扫描黑白点校正、扫描镜头模糊、片夹（none/black/open，
  需启用胶片边缘）。
- **历史与预设（`v1.7.0`）**：`Ctrl+H` 按步骤列出每次撤销并可跳回；参数右栏可把
  当前胶片参数与色彩调整存为预设，一键应用且可撤销。
- **局部调整（`v1.8.0`）**：线性渐变与径向蒙版（曝光、对比度、高光、阴影、饱和度、
  色温、色调、羽化、反转，最多 16 层），由宿主在印片完成后于线性光下施加。
- **更易读的影调工具（`v1.5.0`）**：直方图式宽容度图、可印放带着色、保留档数读数
  与一键建议置位。
- **工作流打磨（`v1.6.0`、`v1.9.0`）**：影调蒙版面板、快捷键速查、片种搜索与最近
  使用、统一模块栏、拍摄时间排序、缩略图尺寸、就地重命名、胶片条评级/旗标与两段打开。
- **界面重做（`v1.9.4`）**：带共享 token 的深色主题；图库工具栏、侧栏、网格与元数据
  面板重绘；星级/旗标/颜色标签换成真控件（卡片悬停即可标记，多选显示混合态）；
  开关、滑杆、分段控件全面统一；未导入的图库有空状态。

## 有意偏离与已知限制

- 整图 parity 覆盖共享的 28 个 stock profile；产品专属 stock 由
  `parity_product_stocks.py` 覆盖。
- 颗粒现在有意按 datasheet 标定而非上游默认值，因此
  `engine/tests/parity_grain.py` 记录的是有意的偏离；22 个整图 parity 用例默认关闭
  颗粒，仍然全绿。
- `halation_amount` 在这里是面积乘子，`dir_couplers_amount` 超过约 1.736 会离开参考
  实现的插值定义域；两项都作为预期偏离断言，而不是失败。
- 带局部调整层的 Cineon DI 导出现在会明确报错，而不是静默丢掉图层。
- 界面不暴露 `enlarger.illuminant`：中性滤色片数据只有 TH-KG3 一项，换成其它值会
  让偏色静默发生。
- P1-8 的相纸表面部分（BRDF、2°/10° 观察者）未实现，只做了光源部分。
- 本仓库基于上游 `v1.3.4-beta.3`，该快照之后上游新增的、仅属于 macOS 的功能没有包含。
- 界面是 Tauri/React 移植版，不是 macOS 的 SwiftUI 界面。
