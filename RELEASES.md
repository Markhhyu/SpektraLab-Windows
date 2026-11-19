# Releases

This repository ships Windows installers only. Release notes are written in
**both Chinese and English** and list what changed in that build.

**Cadence.** Small changes land as commits on `main`; do not cut a Release for
each one. Build the installer and publish a Release when a batch of work is
worth shipping, keeping the version bump and the asset name in step.

- Tag scheme: `v<major>.<minor>.<patch>` on this repository's own semantic
  version line (the first release is `v1.0.0`). Builds published before the
  switch used `v<upstream version>-win.<n>` (`v1.3.4-beta.3-win.1`, `-win.2`);
  they stay online as history but are superseded by the new line.
- Assets: the NSIS installer and a `.sha256` file next to it.

## Release process (for the next update)

1. **Build the host** (static runtime, so the shipped binary needs only system
   DLLs):

   ```powershell
   cmake --build build/win-host -j
   cmake --build build/win-tag -j
   ctest --test-dir build/win-tag --output-on-failure
   ```

   Then run `engine/tests/parity_upstream.py` and the desktop suite
   (`cd desktop && npx vitest run`) — a release does not go out on a red test.

2. **Stage the bundle.** Copy `build/win-host/host/spektralab-host.exe` to
   `desktop/src-tauri/binaries/spektralab-host-x86_64-pc-windows-gnu.exe`, copy
   `build/win-host/resources` to `desktop/src-tauri/host-staging/engine`, then
   `cd desktop && npm run build:web`.

3. **Build the installer** (production: per-machine NSIS; a per-user
   `tauri.test.json` exists only for install verification):

   ```bash
   npx tauri build --config src-tauri/tauri.bundle.json --bundles nsis
   ```

4. **Verify the installed layout.** Silent-install the per-user test build to a
   scratch directory and check the host from it: `hello` lists `warm_up`, no
   `unsupported_features`, `params_schema` contains the new fields, then open a
   RAW and render one live frame.

5. **Publish.** Copy the installer to the release, write the notes below in
   Chinese and English, compute the checksum, and attach both:

   ```bash
   sha256sum SpektraLab_<version>_x64-setup.exe > SpektraLab_<version>_x64-setup.exe.sha256
   gh release create v<version> \
       --title "v<version> — <short title>" \
       --notes-file release-notes.md \
       <installer> <installer>.sha256
   ```

   The notes file is the bilingual block from `RELEASES.md`'s history entry —
   keep the two in sync.

## History

### v1.9.3 — 颗粒按各自片种重新标定 / Grain calibrated per stock

<h4 id="cn-1.9.3">新增功能</h4>

- 四个 VISION3 电影负片（50D、250D、200T、500T）的颗粒按各自 datasheet 的 diffuse rms 颗粒度分别标定；此前所有片种共用一组全局参数。

#### 问题修复

- 修正红色颗粒锚点被读在颗粒曲线末端的问题。按资料自身的读数规则（密度 1.0 → 特性曲线 → 颗粒曲线）重读后，蓝色颗粒最粗、红色最细，与实际彩色负片一致。

<h4 id="en-1.9.3">New Features</h4>

- Calibrate the grain of the four VISION3 stocks (50D, 250D, 200T, 500T) to each film's published diffuse-rms granularity; every stock previously shared one global setting.

#### Bug Fixes

- Fix the red grain anchor being taken at the far end of the granularity curve. Read by the sheet's own rule (density 1.0, then the characteristic curve, then the granularity curve), blue grain is the coarsest and red the finest, as on a real colour negative.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.9.2...v1.9.3

### v1.9.2 — 颗粒按真实胶片标定、显影进入颗粒密度轴 / Grain calibrated to real film, development folded into the grain axis

<h4 id="cn-1.9.2">新增功能</h4>

- 颗粒模型以 VISION3 50D 的 diffuse rms 颗粒度曲线为锚重新标定（48 µm 孔径、ECN-2、Status M、净密度 1.0），红/绿/蓝逐通道解到 2.6 / 5.3 / 10.2（datasheet 2.6 / 5.3 / 10.5）。
- 显影推拉现在同时作用在颗粒的密度轴与层密度表上：同一密度下 2 档 push 约 +34–43%，1 档 +16–21%，1 档 pull −5…−17%。

#### 问题修复

- 修正颗粒通道强度全局共用一组 `particle_scale` 的问题——旧模型里红比蓝还粗 2.3 倍，现在红最细、蓝最粗，与彩色负片一致；锚点、方法与偏离理由写在源码注释里。
- 复核"显影 morph 与颗粒幅度重复计数"的疑虑：把幅度乘子归零后实测 morph 表对同密度 σD 的影响 <±5%，push→颗粒的响应仍全部来自幅度项，故系数保留原值。

#### 体验优化

- 新增可复现的真实感度量工具链：datasheet 数字化、参考实现的真实密度取样、逐通道标定、push sweep 同密度比较、分辨率与预览一致性检查。

#### 构建与验证

- 安装包 37.60 MiB，sha256 `4b9551b72fae1c7007cc80b36725c8c486e2af0da4ff08d3ea5c6c5231c5c0be`。
- `ctest` 56/56，上游 parity 22/22，前端 541 通过 / 2 跳过；打包宿主实测红/绿粒度比 0.795。

<h4 id="en-1.9.2">New Features</h4>

- Grain is recalibrated against the VISION3 50D diffuse-rms granularity curves (48 µm aperture, ECN-2, Status M, net density 1.0), solving red/green/blue to 2.6 / 5.3 / 10.2 against the sheet's 2.6 / 5.3 / 10.5.
- Development push/pull now also moves the grain density axis and the layer density tables: at matched density two stops of push is about +34–43%, one stop +16–21%, and one stop of pull −5…−17%.

#### Bug Fixes

- Fix the grain channel strengths sharing one global `particle_scale` — the old model made red 2.3x coarser than blue; red is now the finest and blue the coarsest, as on a real colour negative, with the anchor, method and divergence recorded in the source.
- Audit the suspected double counting between the development morph and the grain amplitude: with the multiplier zeroed the morph tables move sigma-D by under ±5% at matched density, so the coefficient is unchanged and the whole push → grain response still comes from the amplitude term.

#### Improvements

- Add reproducible realism tooling: datasheet digitisation, real-density sampling from the reference implementation, per-channel calibration, push sweeps compared at matched density, and resolution/preview consistency checks.

#### Build and verification

- Installer 37.60 MiB, sha256 `4b9551b72fae1c7007cc80b36725c8c486e2af0da4ff08d3ea5c6c5231c5c0be`.
- `ctest` 56/56, upstream parity 22/22, 541 frontend tests passed / 2 skipped; the packaged host reports a red/green granularity ratio of 0.795.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.9.1...v1.9.2

### v1.9.1 — 局部调整接线修复、影调蒙版重标定、成像链面板 / Local-adjustment wiring, tone-mask recalibration and the imaging-path panel

<h4 id="cn-1.9.1">新增功能</h4>

- 新增「成像链细节」面板，把引擎早已支持、界面却没有入口的 7 个观感参数接出来：相机滤镜 W8–W58、镜头模糊（µm）、密度曲线 gamma、扫描黑白点校正、扫描镜头模糊、片夹（none/black/open）。
- 场景置位在回拉越过中灰时给出"再拉会把整幅画面压平"的提示，滑块停在仍可用的最后一档。

#### 问题修复

- 修复 v1.8.0 的局部调整层在界面上完全无效的问题（界面写 `adjustments.local`，宿主只读 `adjustments.localAdjustments`）：预览、缩略图、导出与试印现在共用同一映射，实测预览改变 69%、导出改变 96% 像素，旧键仍与"无图层"逐字节相同。
- 影调蒙版高光侧按本帧实测可达范围重标定，`highlights=1` 从肉眼不可见变为可见（640 px 高光带均值 3.3 → 555.9 码值，最大 36 → 4675），且 1 → 2 → 3 单调。
- 场景置位的 `minimum_pull_back` 改为报告真正可用的值（0.9922 → 1.0182），按旧值拖动会被 `room_below_minimum` 拒绝。
- 修复全量静态构建失败：静态 OpenMP 的 `libgomp.a` 通过 MinGW 的 `dl` shim 解析 dlopen/dlerror，该 shim 现已挂到 LibRaw 的链接接口上。
- 修正 `host_proof.py` 对 TIFF 编码列表的精确断言（v1.9.0 加入 Deflate 后必红），改为子集判断。

#### 构建与验证

- 安装包 37.63 MiB，sha256 `0725d1a231c2eb3d493adbed52f0def6aff8b9b8e5563417ef22c29c56c5259a`。
- `ctest` 56/56，上游 parity 22/22，前端 541 通过 / 2 跳过；包内宿主无 `unsupported_features`、`params_schema` 105 字段、打开 4688×7028 RAW 并渲染通过。
- 带局部图层的 Cineon DI 导出现在会明确报错，而不是悄悄丢掉图层；`enlarger.illuminant` 仍不暴露（中性滤色片数据只有 TH-KG3）。

<h4 id="en-1.9.1">New Features</h4>

- New "Imaging path" panel exposes seven look parameters the engine already supported but no panel reached: camera filters W8–W58, lens blur in µm, density-curve gamma, scanner white/black point correction, scanner lens blur, and the carrier (none/black/open).
- Scene Placement now warns that pulling further would flatten the whole frame once the knee crosses mid-grey, and the slider stops at the last usable step.

#### Bug Fixes

- Fix the local-adjustment layers added in v1.8.0 having no effect: the UI wrote `adjustments.local` while the host reads only `adjustments.localAdjustments`, and unknown keys are ignored silently. Preview, thumbnails, exports and proofs now share one mapping — the same two layers change 69% of preview and 96% of export pixels, while the old key stays byte-identical to "no layers".
- Recalibrate the Tone Mask highlight side against the reach measured in the frame: `highlights=1` goes from invisible to visible (top 2% band mean 3.3 → 555.9 code values, max 36 → 4675) and 1 → 2 → 3 is monotonic.
- Scene Placement's `minimum_pull_back` now reports the value that actually works (0.9922 → 1.0182); the old value is refused with `room_below_minimum`.
- Fix the full static build: the static `libgomp.a` resolves dlopen/dlerror through the MinGW `dl` shim, which is now attached to LibRaw's link interface.
- Fix `host_proof.py` asserting an exact TIFF codec list (it could not pass once v1.9.0 added Deflate); it now checks for a subset.

#### Build and verification

- Installer 37.63 MiB, sha256 `0725d1a231c2eb3d493adbed52f0def6aff8b9b8e5563417ef22c29c56c5259a`.
- `ctest` 56/56, upstream parity 22/22, 541 frontend tests passed / 2 skipped; the packaged host reports no `unsupported_features`, a 105-field `params_schema`, and opens the 4688×7028 RAW and renders a frame.
- A Cineon DI export carrying local layers now fails loudly instead of dropping them; `enlarger.illuminant` stays hidden because the neutral-filter data has only a TH-KG3 illuminant.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.9.0...v1.9.1

### v1.9.0 — 两段解码、渲染池与图库升级 / Two-stage decode, render pool and Library upgrades

<h4 id="cn-1.9.0">新增功能</h4>

- RAW 打开改为两段解码：先半分辨率出首帧（32.95 MP 参考图约 0.45 s，原约 1.12 s），首帧上屏后自动补齐全分辨率。
- 批量导出可用后台渲染池（最多 4 个宿主）：3 张 32.95 MP TIFF 实测顺序 18.1 s → 并发 5.8 s（3.1×），额外宿主仅在导出期间存在。
- 图库导入 8 张以上时通过渲染池读相机预览，可取消、带失败列表与重试。
- 图库新增拍摄时间排序、缩略图尺寸滑杆与就地重命名；胶片条可批量评级/旗标/颜色（键盘 0-5 / P / X / U）。

#### 体验优化

- TIFF Deflate 导出改为并行压缩（约 2.9 s → 0.96 s，像素与无压缩一致）。
- 图库/修改/导出统一模块栏与术语，窄窗口侧栏收窄，画布加载骨架，直方图可折叠，保存状态圆点，Camera 区补配光说明。

#### 构建与验证

- 安装包 37.60 MiB，sha256 `2d0f1144bd525bf4c748dcc1611880e75b00aa3e1487025406dc436d4b8144ba`。
- `ctest` 43/43，前端 531 通过 / 2 跳过；host 探针覆盖两段解码（2344×3514 → 4688×7028）、渲染池 3.1×、池化导入与集合/标记。

<h4 id="en-1.9.0">New Features</h4>

- RAW opens are two-stage: a half-resolution first look (~0.45 s instead of ~1.12 s for the 32.95 MP reference) followed by an automatic full-resolution re-decode.
- Batch export can use the background render pool (up to four hosts): three 32.95 MP TIFF exports went from 18.1 s sequential to 5.8 s (3.1×), and the extra hosts exist only during the run.
- Library imports of 8+ files read camera previews through the pool, cancellable and with a failure list plus retry.
- The Library gains capture-time sorting, a thumbnail-size slider and in-place rename; the filmstrip can rate, flag and label picked frames (0-5 / P / X / U).

#### Improvements

- Deflate TIFF export compresses strips in parallel (~2.9 s → 0.96 s, pixels identical to uncompressed).
- One module bar for Library/Develop/Export with unified terminology, narrower rails on small windows, a canvas loading skeleton, a foldable histogram, the save-state dot, and a note that Solve only suggests an exposure.

#### Build and verification

- Installer 37.60 MiB, sha256 `2d0f1144bd525bf4c748dcc1611880e75b00aa3e1487025406dc436d4b8144ba`.
- `ctest` 43/43, 531 frontend tests passed / 2 skipped; host probes cover the two-stage decode (2344×3514 → 4688×7028), the 3.1× pool, pooled imports and the Library marks.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.8.0...v1.9.0

### v1.8.0 — 局部调整 / Local adjustments

<h4 id="cn-1.8.0">新增功能</h4>

- 参数右栏新增「局部调整」：线性渐变与径向蒙版，每层可调曝光、对比度、高光、阴影、饱和度、色温、色调、羽化与反转，每张照片最多 16 层。
- 蒙版定位在成片画面（裁剪与旋转之后），由宿主在印片渲染完成后于线性光下施加、叠加在 Layer 2 上，空蒙版为精确旁路。

#### 体验优化

- 蒙版设置写入照片 sidecar，属于可撤销编辑。

#### 构建与验证

- 安装包 37.55 MiB，sha256 `328a03868d57bcbe1a7c457d8561d7da40227377e522c49874b6a3453c6234f3`。
- `ctest` 43/43，前端 511 通过 / 2 跳过；host 探针覆盖蒙版、旁路与非法层拒绝。

<h4 id="en-1.8.0">New Features</h4>

- New Local Adjustments section: linear gradients and radial masks with exposure, contrast, highlights, shadows, saturation, temperature, tint, feather and invert, up to 16 layers per photo.
- Masks are evaluated in the finished frame and applied by the native host in linear light after the print is rendered, on top of Layer 2; the negative and paper curve are untouched and an empty mask list is an exact bypass.

#### Improvements

- Settings are stored in the sidecar as undoable edits.

#### Build and verification

- Installer 37.55 MiB, sha256 `328a03868d57bcbe1a7c457d8561d7da40227377e522c49874b6a3453c6234f3`.
- `ctest` 43/43, 511 frontend tests (2 skipped); a host probe covers masks, bypass and malformed-layer rejection.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.7.0...v1.8.0

### v1.7.0 — 历史与预设 / History and presets

<h4 id="cn-1.7.0">新增功能</h4>

- 历史面板：`Ctrl+H` 按步骤列出每次撤销（最新在上）并自动生成说明，点击任意一行可跳回该快照，之后仍可用重做向前重放。
- 预设：修改右栏新增「预设」区，把当前胶片参数与色彩调整保存为预设（存于应用数据），可在其他照片上一键应用。

#### 体验优化

- 应用预设是一次可撤销编辑，预设支持重命名与删除。

#### 构建与验证

- 安装包 `SpektraLab_1.7.0_x64-setup.exe`，39,363,927 B，sha256 `e8f7004710b7bbfd5da414bb4aaa0ccaca2bca4d739633d210ad6cecfdcb5266`；需 Vulkan 1.1+ 与 WebView2。
- 前端 506 通过 / 2 跳过（77 个测试文件）。

<h4 id="en-1.7.0">New Features</h4>

- History panel: `Ctrl+H` lists every undo step (newest first) with a generated label (film/paper change, development, tone mask, exposure, adjustments, crop, white balance, …); clicking a row jumps the open frame back to that snapshot while Redo still replays forward.
- Presets: the parameters rail saves the current film parameters and adjustment layers as a preset in app data and applies it to other photographs.

#### Improvements

- Applying a preset is a normal undoable edit, and presets can be renamed and deleted.

#### Build and verification

- Installer `SpektraLab_1.7.0_x64-setup.exe`, 39,363,927 B, sha256 `e8f7004710b7bbfd5da414bb4aaa0ccaca2bca4d739633d210ad6cecfdcb5266`; needs Vulkan 1.1+ and WebView2.
- 506 frontend tests passed / 2 skipped (77 files).

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.6.0...v1.7.0

### v1.6.0 — 工作流打磨 / Workflow polish

<h4 id="cn-1.6.0">新增功能</h4>

- 影调蒙版面板：引擎已支持的 Tone Mask（高光/阴影/核心/半径，Gaussian 方案）可从修改右栏直接调整，导出与 sidecar 保存都已接通。
- 快捷键速查：按 `?` 或 Ctrl+/ 打开，也可从 帮助 → 键盘快捷键 打开，Esc 关闭。
- 导出完成后的对话框新增「回到图库」，可直接接着挑下一张。
- 胶片/相纸列表新增搜索框与最近使用（本次会话内），34 个 stock 不再靠滚动查找。

#### 问题修复

- 修正 Windows 上的 macOS 快捷键文案（⌘ → Ctrl、⇧⌘ → Ctrl+Shift）。

#### 体验优化

- 顶栏分组加了分隔线与帮助按钮，界面层级更清晰。

#### 构建与验证

- 前端 494 通过 / 2 跳过（74 个测试文件）。

<h4 id="en-1.6.0">New Features</h4>

- Tone Mask panel: the engine-side Tone Mask (highlights/shadows/core/radius, Gaussian scheme) is editable in the Develop rail, with export and sidecar persistence wired through.
- Keyboard shortcut sheet: press `?` or Ctrl+/, or Help → Keyboard Shortcuts; Esc closes it.
- The finished-export dialog can hand straight back to the Library.
- Film and paper lists gained a search box plus recent picks (session memory), so 34 stocks no longer require scrolling.

#### Bug Fixes

- Replace macOS ⌘ wording with Windows Ctrl chords.

#### Improvements

- The top bar groups are visually separated and end with a help button.

#### Build and verification

- 494 frontend tests passed / 2 skipped (74 files).

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.5.0...v1.6.0

### v1.5.0 — 影调工具视觉优化 / Readable tone tools

<h4 id="cn-1.5.0">新增功能</h4>

- 宽容度曲线重做为 260×96 直方图式图表：平滑面积 + 渐变填充，可印放中等曝光带着色并标注阴影/高光 EV，坐标轴带 EV 刻度与边界标签。
- 宽容度下方新增芯片行，保留档数与低于/范围内/高于百分比一眼可读。
- 新增「应用建议置位」按钮，把测得的阴影/高光回拉量一键应用到场景置位。

#### 体验优化

- 画布右上角照片直方图升级为 176×58 平滑 RGB + 亮度叠加，带网格、坐标轴、亮度均值与两端裁剪标记。

#### 构建与验证

- 安装包 `SpektraLab_1.5.0_x64-setup.exe`（NSIS，37.53 MiB），sha256 `76eb6b0d79135fc279dc82ac165707f4c8b63863d8fd1e2a5c9d18359e2af246`。
- 桌面端 491 项测试通过（2 项跳过），typecheck / lint 通过。

<h4 id="en-1.5.0">New Features</h4>

- The latitude plot is now a 260×96 histogram-style chart: a smoothed, gradient-filled scene distribution with the printable medium band shaded and shadow/highlight EV labels.
- A stat row below the plot reports the held stops and the below / within / above shares at a glance.
- A suggested-placement button applies the measured highlight/shadow pull-back with one click.

#### Improvements

- The on-canvas histogram is now a 176×58 smoothed RGB + luma overlay with a grid, axis, mean level and clipping markers.

#### Build and verification

- Installer `SpektraLab_1.5.0_x64-setup.exe` (NSIS, 37.53 MiB), sha256 `76eb6b0d79135fc279dc82ac165707f4c8b63863d8fd1e2a5c9d18359e2af246`.
- 491 desktop tests passed (2 skipped); typecheck / lint clean.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.4.0...v1.5.0

### v1.4.0 — 图库快捷入口与胶片条筛选 / Library shortcut and filmstrip filters

<h4 id="cn-1.4.0">新增功能</h4>

- 编辑器右侧参数栏顶部新增「图库 / 修改」模块切换，点「图库」直接进入图库，图库页顶部可切回修改。
- 修改模式的胶片条新增筛选：按最低星级、旗标（保留/废弃/无）、颜色标签筛选；缩略图角上显示星级、旗标与颜色点。

#### 体验优化

- 筛选只影响显示，不改变工作台顺序。

#### 构建与验证

- 安装包 `SpektraLab_1.4.0_x64-setup.exe`（NSIS，37.55 MiB），sha256 `fd9889cde62e7d4dfe81b171ea2c845d2dae4fca361f0ca30cb648cfb82fd3d6`。
- 桌面端 487 项测试通过（2 项跳过），typecheck / lint 通过。

<h4 id="en-1.4.0">New Features</h4>

- The editor's right rail now has a Library / Develop module switch; clicking Library opens the grid, and the library page switches back to Develop.
- The Develop filmstrip can be filtered by minimum star rating, flag (pick / reject / unflagged) and colour label; each cell shows its stars, flag and colour dot.

#### Improvements

- Filtering only changes what is drawn, never the roll order.

#### Build and verification

- Installer `SpektraLab_1.4.0_x64-setup.exe` (NSIS, 37.55 MiB), sha256 `fd9889cde62e7d4dfe81b171ea2c845d2dae4fca361f0ca30cb648cfb82fd3d6`.
- 487 desktop tests passed (2 skipped); typecheck / lint clean.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.3.0...v1.4.0

### v1.3.0 — 完整图库 / Full library

<h4 id="cn-1.3.0">新增功能</h4>

- 图库升级为完整图库：新增「图库 / 修改」双模块工作区，以及带引用说明与进度显示的导入对话框。
- 新增集合（手动分组，可把所选加入/移出）与智能集合（把当前筛选保存为预设），并支持颜色标签筛选。
- 新增元数据面板：编辑标题、说明、关键字，批量设置星级/旗标/颜色标签，「同步修改设置」把锚点照片的修改复制到所有所选照片。
- 打开照片自动登记进图库，缺失缩略图在后台补齐；从图库打开的整页进入编辑器胶片条。

#### 体验优化

- 集合重命名改为应用内内联输入，不再依赖系统弹窗。

#### 构建与验证

- 安装包 `SpektraLab_1.3.0_x64-setup.exe`（NSIS，37.65 MiB），sha256 `c8598b787697f7e139077cddb72e91cf2e77c02eecca6e012780b4945b435801`。
- 桌面端 483 项测试通过（2 项跳过），typecheck / lint 通过；引擎 CTest 43/43。

<h4 id="en-1.3.0">New Features</h4>

- The library becomes a full library: a Library / Develop two-module workspace plus an import dialog with an explicit references-only note and progress.
- Collections (manual groups; add/remove the current selection) and Smart Collections (saved filter presets), with colour-label filtering.
- Metadata panel: edit title/caption/keywords, apply rating/flag/label in bulk, and Sync Settings copies the anchor photo's develop sidecar to every selected photo.
- Photos opened normally are registered automatically and missing thumbnails are filled in the background; opening from the library loads the visible page into the editor filmstrip.

#### Improvements

- Collection renaming is now an inline in-app input instead of a system prompt.

#### Build and verification

- Installer `SpektraLab_1.3.0_x64-setup.exe` (NSIS, 37.65 MiB), sha256 `c8598b787697f7e139077cddb72e91cf2e77c02eecca6e012780b4945b435801`.
- 483 desktop tests passed (2 skipped), typecheck / lint clean, 43/43 engine CTest.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.2.1...v1.3.0

### v1.2.1 — 稳定性与文档同步 / Stability, compatibility checks and docs

<h4 id="cn-1.2.1">问题修复</h4>

- 关闭窗口时先向渲染宿主发送 shutdown 请求并等待其自行退出（最多 700 ms），不再直接强杀；正常关闭降为 INFO，异常退出仍按预算自动重启并上报。

#### 体验优化

- 新增强制 Dekker split CTest（`spk_math_fallback`）与 Windows CI 编译门（MSYS2 MinGW，无 GPU 仅编译）。
- 兼容矩阵、能力与移植文档同步到实现：51 个 Vulkan kernel、43 个 CTest；scene latitude、overscan/片边、date back、Cineon DI 均已支持并测试。
- 复核帧缓存 LRU：默认 16 GiB，按 mtime 清理，设置页可调。

#### 构建与验证

- 安装包 `SpektraLab_1.2.1_x64-setup.exe`（NSIS，37.55 MiB），sha256 `2268737ed3f8d24b2cd25fe42555135bb3f1b43b5a02c7d7c8add215bd28caca`。
- 引擎 43/43 CTest，`cargo check` 通过，桌面 474 项通过。

<h4 id="en-1.2.1">Bug Fixes</h4>

- Closing the window now sends `shutdown` to the render host and waits up to 700 ms for it to exit instead of killing it; clean closes log at INFO, and unexpected exits still restart within budget.

#### Improvements

- New forced-Dekker CTest and a Windows CI compile gate (MSYS2 MinGW, compile-only on a GPU-less runner).
- Compatibility matrix and port docs now match the implementation: 51 Vulkan kernels, 43 CTests; scene latitude, overscan/film edge, date back and Cineon DI are supported and tested.
- Frame cache LRU reviewed: 16 GiB default cap, mtime trim, adjustable in Settings.

#### Build and verification

- Installer `SpektraLab_1.2.1_x64-setup.exe` (NSIS, 37.55 MiB), sha256 `2268737ed3f8d24b2cd25fe42555135bb3f1b43b5a02c7d7c8add215bd28caca`.
- Engine 43/43 CTests, `cargo check` clean, 474 desktop tests passing.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.2.0...v1.2.1

### v1.2.0 — 图库到修改的胶片条连续浏览 / Library-to-filmstrip browsing

<h4 id="cn-1.2.0">新增功能</h4>

- 从图库双击（或 Enter）打开照片时，编辑器底部胶片条会装入当前筛选/排序后的整页照片，可直接点缩略图或用方向键切换。
- 编辑器工具栏的「图库」按钮会把当前正在修改的照片带回图库并选中。

#### 体验优化

- 从图库进入修改、编辑、返回图库、再换下一张，形成连续的浏览-编辑循环。

#### 构建与验证

- 安装包 `SpektraLab_1.2.0_x64-setup.exe`（NSIS，37.55 MiB），sha256 `efe0f571d14f1cd3195a2eb8d7027493e217961de30490f55d18fb2558226e9c`。
- 474 项桌面测试通过（新增 2 项"图库开片时胶片条装入整页"用例），typecheck / lint 干净；引擎未改动。

<h4 id="en-1.2.0">New Features</h4>

- Double-clicking (or Enter) a photo in the library loads the whole filtered/sorted page into the editor's filmstrip; switch frames by clicking a thumbnail or with the arrow keys.
- The editor's Library button reopens the grid with the photo being edited selected.

#### Improvements

- Editing becomes a continuous browse-edit loop: grid → editor → grid → next.

#### Build and verification

- Installer `SpektraLab_1.2.0_x64-setup.exe` (NSIS, 37.55 MiB), sha256 `efe0f571d14f1cd3195a2eb8d7027493e217961de30490f55d18fb2558226e9c`.
- 474 desktop tests pass (including 2 new filmstrip-collection cases); typecheck / lint clean; the engine is unchanged.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.1.1...v1.2.0

### v1.1.1 — 图库入口与自动登记 / Library entry and auto-registration

<h4 id="cn-1.1.1">新增功能</h4>

- 工具栏新增带文字的「图库」按钮，文件菜单新增「图库…」（`Ctrl+Shift+L`）。
- 通过「打开文件夹 / 打开照片 / 拖放 / 启动参数」打开的照片会自动登记进图库（只记录引用，原文件不动）。

#### 体验优化

- 图库缺缩略图的条目会在打开图库时后台补齐，不阻塞浏览。
- 内部说明与发布文档统一使用中性名称「图库 / 持久图库」。

#### 构建与验证

- 安装包 `SpektraLab_1.1.1_x64-setup.exe`（NSIS，37.54 MiB），sha256 `5a848d2331f28c3728b47887909560a81ce628441bd94046fe298f5e6c5b7e7a`。
- 472 项桌面测试通过，typecheck / lint 干净；引擎未改动。

<h4 id="en-1.1.1">New Features</h4>

- A labelled Library button in the toolbar and File → Library… (`Ctrl+Shift+L`).
- Photos opened through Open Folder / Open Photographs / drag-and-drop / launch arguments are registered in the catalog automatically (references only; originals untouched).

#### Improvements

- Entries without previews get their thumbnails filled in the background when the library opens; browsing is never blocked.
- Docs use the neutral name "library / catalog" and no longer reference other software by name.

#### Build and verification

- Installer `SpektraLab_1.1.1_x64-setup.exe` (NSIS, 37.54 MiB), sha256 `5a848d2331f28c3728b47887909560a81ce628441bd94046fe298f5e6c5b7e7a`.
- 472 desktop tests pass, typecheck / lint clean; the engine is unchanged.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.1.0...v1.1.1

### v1.1.0 — 图库 / Library

<h4 id="cn-1.1.0">新增功能</h4>

- 新增持久图库：导入文件夹或单张照片（只登记引用，不复制、不改原图），带缩略图、0–5 星评分、Pick/Reject 旗标、关键字和"已编辑"标记。
- 图库视图支持搜索，按文件夹/关键字/评分/旗标/仅已编辑筛选，按导入时间/名称/文件夹/评分/日期排序，支持范围与多选，双击或 Enter 进入修改。

#### 体验优化

- 目录持久化在 `%AppData%\\app.spektralab.desktop\\Catalog\\catalog.json`，缩略图在同目录 `thumbs/`，关闭再打开会自动回到图库。
- 快捷键：方向键浏览、Enter 打开、0–5 评分、P/X/U 旗标、Delete 移出图库（原图不动）、Ctrl/Cmd+A 全选、Esc 返回修改。
- 所有调整仍写在每图 sidecar 中，原图永不改写。

#### 构建与验证

- 安装包 `SpektraLab_1.1.0_x64-setup.exe`（NSIS，37.54 MiB），sha256 `eec29bb665ef9cf60ec0d74d34d1c33ccc4f3b0ace4d25a5e019d30009fe33c8`。
- 472 项桌面测试通过，typecheck / lint 干净；引擎未改动。

<h4 id="en-1.1.0">New Features</h4>

- New persistent library: import folders or single photos by reference (originals are never copied or modified), with thumbnails, 0–5 star ratings, pick/reject flags, keywords and an edited marker.
- Library view: search; filter by folder/keyword/rating/flag/edited-only; sort by import time/name/folder/rating/date; range and multi-select; double-click or Enter opens the frame.

#### Improvements

- The catalog persists at `%AppData%\\app.spektralab.desktop\\Catalog\\catalog.json` with thumbnails under `thumbs/`; reopening the app returns to the library.
- Shortcuts: arrows to browse, Enter to open, 0–5 to rate, P/X/U to flag, Delete to remove from the catalog (originals untouched), Ctrl/Cmd+A to select all, Esc to return.
- Edits remain non-destructive per-image sidecars; originals are never rewritten.

#### Build and verification

- Installer `SpektraLab_1.1.0_x64-setup.exe` (NSIS, 37.54 MiB), sha256 `eec29bb665ef9cf60ec0d74d34d1c33ccc4f3b0ace4d25a5e019d30009fe33c8`.
- 472 desktop tests pass, typecheck / lint clean; the engine is unchanged.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.0.0...v1.1.0

### v1.0.0 — 独立版本线与命名统一 / Independent version line

<h4 id="cn-1.0.0">新增功能</h4>

- Windows 版改用独立语义化版本号，首个版本为 1.0.0，不再沿用上游 `1.3.4-beta.3`，避免与 macOS 版本混淆。
- 应用内「检查更新」改为读取本仓库 Releases，按 `v<主>.<次>.<修订>` 与 `SpektraLab_<version>_x64-setup.exe` 匹配。

#### 体验优化

- 安装包文件名、NSIS 安装器属性、应用可执行文件的 `FileVersion`/`ProductVersion` 全部统一为 1.0.0。

#### 构建与验证

- 安装包 `SpektraLab_1.0.0_x64-setup.exe`（NSIS，37.54 MiB），sha256 `ac0dd67502be75e537d8624235bef68f73a5745b9d67bbd0bd2e46c4c638aa41`。
- 功能与 win.2 相同：Tone Mask、整图 parity、会话驻留、首帧预热、测光回归修复、TIFF Deflate、显影与光源面板。

<h4 id="en-1.0.0">New Features</h4>

- The Windows edition now uses its own semantic version line (starting at 1.0.0) rather than the upstream `1.3.4-beta.3` number, so it cannot be confused with the macOS release.
- The in-app release check reads this repository's Releases and matches `v<major>.<minor>.<patch>` and `SpektraLab_<version>_x64-setup.exe`.

#### Improvements

- Installer filename, NSIS installer properties and the executable's `FileVersion`/`ProductVersion` all report 1.0.0.

#### Build and verification

- Installer `SpektraLab_1.0.0_x64-setup.exe` (NSIS, 37.54 MiB), sha256 `ac0dd67502be75e537d8624235bef68f73a5745b9d67bbd0bd2e46c4c638aa41`.
- The feature set is unchanged from win.2: Tone Mask, whole-image parity, editor residency, warm first frame, metering regression fix, TIFF Deflate, development and lighting panels.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.3.4-beta.3-win.2...v1.0.0

### v1.3.4-beta.3-win.2 — 测光回归修复 / Metering regression fix

<h4 id="cn-1.3.4-beta.3-win.2">问题修复</h4>

- 修复 win.1 引入的自动测光回归：`center_weighted`、`average`、`median` 三种测光方法在测光器并行化后恒返回 0 EV，选择它们时自动曝光不施加增益、配光读数显示 0.000。

#### 构建与验证

- 安装包 `SpektraLab_1.3.4-beta.3_x64-setup.exe`（NSIS，37.5 MiB），sha256 `f47a48f419766bde3cdeaf61d0534c542cae553cd3ea50318b644eecfb0c38c1`。
- 引擎 42/42 CTest（新增 `spk_exposure_metering`），上游 parity 22/22；其余功能与 win.1 相同。

<h4 id="en-1.3.4-beta.3-win.2">Bug Fixes</h4>

- Fix an auto-exposure regression introduced in win.1: after the meter was parallelised, `center_weighted`, `average` and `median` always returned 0 EV, so choosing one applied no exposure gain and the Process reading showed 0.000.

#### Build and verification

- Installer `SpektraLab_1.3.4-beta.3_x64-setup.exe` (NSIS, 37.5 MiB), sha256 `f47a48f419766bde3cdeaf61d0534c542cae553cd3ea50318b644eecfb0c38c1`.
- Engine 42/42 CTest (new `spk_exposure_metering`), upstream parity 22/22; everything else is unchanged from win.1.

Full Changelog: https://github.com/Markhhyu/SpektraLab-Windows/compare/v1.3.4-beta.3-win.1...v1.3.4-beta.3-win.2

### v1.3.4-beta.3-win.1 — Windows 移植、P0/P1 优化、显影与光源 / Windows port, P0/P1 optimisations, development and lighting

<h4 id="cn-1.3.4-beta.3-win.1">新增功能</h4>

- Windows/Vulkan 后端的 Tone Mask（对比度蒙版）修复，前端 Tone Mask 面板随之可用。
- 新增显影面板：推拉 −3…+3 档、显影温度 18–24 °C，由实测 Portra 800 push1/push2 标定的近似模型，关闭时为精确旁路。
- 新增光源面板：扫描光源与观看光源可选（D50/D55/D65/D75/A/TH-KG3 及自定义色温黑体），观看光源为 CAT02 软打样并接管 glare 染色，保持默认时输出与旧版逐字节一致。
- 建立整图 parity 基线：对公开上游 Python 参考包 22 个 case 在默认路径全部通过（3e-5 容差）。

#### 体验优化

- 编辑会话显存预算：最多 2 个会话常驻，其余挂起到磁盘，多图打开不再线性吃满显存。
- 首帧体验：打开 RAW 时先显示相机内嵌预览，解码期间预热引擎，测光不再排序 170 万个数，冷启动实时首帧约 260 → 180 ms。
- 导出新增 TIFF Deflate（含 predictor，16-bit 约小 11%，无损）；`export_image` 统一到 GPU 导出路径，32.95 MP 下 TIFF16 2079 → 217 ms、JPEG 1849 → 243 ms。

#### 构建与验证

- 安装包 `SpektraLab_1.3.4-beta.3_x64-setup.exe`（NSIS，37.5 MiB），基于上游 v1.3.4-beta.3（tag `9ceca33`）快照。
- 引擎 41/41 CTest，上游 parity 22/22，桌面 464 项测试通过。

<h4 id="en-1.3.4-beta.3-win.1">New Features</h4>

- Tone Mask now works on the Windows/Vulkan backend (platform-neutral macOS node plus two new compute kernels), so the frontend's Tone Mask panel is enabled.
- New Development panel: push/pull −3…+3 stops and developer temperature 18–24 °C, a fitted approximation of the measured Portra 800 push1/push2 profiles; off is a byte-exact bypass.
- New Lighting panel: scan and viewing lights are selectable (D50/D55/D65/D75/A/TH-KG3 and arbitrary black-body temperature). A different viewing light is a CAT02 soft proof and takes over the glare tint; the default output stays byte-identical to the previous build.
- Whole-image parity baseline against the public upstream Python package: 22 cases, all within the 3e-5 bar on the default path.

#### Improvements

- Editor residency budget: at most two editor caches stay resident, older ones suspend to disk; opening many images no longer grows GPU usage linearly.
- First-view experience: the embedded camera preview paints before the engine open, the engine warms up while the RAW decodes, and the meter no longer sorts 1.7 M doubles — cold live first frame ~260 → 180 ms.
- Export: TIFF Deflate with predictor (16-bit ~11% smaller, lossless); `export_image` now reuses the GPU export path — 32.95 MP `tiff16` 2079 → 217 ms, `jpeg` 1849 → 243 ms.

#### Build and verification

- Installer `SpektraLab_1.3.4-beta.3_x64-setup.exe` (NSIS, 37.5 MiB), built from the upstream v1.3.4-beta.3 snapshot (tag `9ceca33`).
- Engine 41/41 CTest, upstream parity 22/22, 464 desktop tests passing.
