# Releases

This repository ships Windows installers only. Release notes are written in
**both Chinese and English** and list what changed in that build.

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

### v1.4.0 — 图库快捷入口与胶片条筛选 / Library shortcut and filmstrip filters

安装包：`SpektraLab_1.4.0_x64-setup.exe`（NSIS，37.55 MiB），sha256
`fd9889cde62e7d4dfe81b171ea2c845d2dae4fca361f0ca30cb648cfb82fd3d6`。

**中文**

- 编辑器右侧参数栏顶部新增「图库 / 修改」模块切换，点「图库」直接进入图库；图库页顶部仍可切回修改。
- 修改模式的胶片条新增筛选：按最低星级、旗标（保留/废弃/无）、颜色标签筛选当前胶片条；缩略图角上显示星级、旗标与颜色点；筛选只影响显示，不改变工作台顺序。
- 验证：桌面端 487 项测试通过（2 项跳过），typecheck / lint 通过。

**English**

- The editor's right rail now has a Library / Develop module switch; clicking
  Library opens the grid, and the library page switches back to Develop.
- In Develop the filmstrip can be filtered by minimum star rating, flag
  (pick / reject / unflagged) and colour label; each cell shows its stars, flag
  and colour dot. Filtering only changes what is drawn, never the roll order.
- Verified: 487 desktop tests passed (2 skipped); typecheck / lint clean.

### v1.3.0 — 完整图库 / Full library

安装包：`SpektraLab_1.3.0_x64-setup.exe`（NSIS，37.65 MiB），sha256
`c8598b787697f7e139077cddb72e91cf2e77c02eecca6e012780b4945b435801`。

**中文**

- 图库升级为完整图库：新增「图库 / 修改」双模块工作区、带引用说明与进度显示的导入对话框。
- 新增集合（手动分组，可把所选加入/移出）与智能集合（把当前筛选保存为预设），以及颜色标签筛选。
- 新增元数据面板：编辑标题、说明、关键字；批量设置星级/旗标/颜色标签；「同步修改设置」把锚点照片的修改复制到所有所选照片。
- 打开照片自动登记进图库，缺失缩略图在后台补齐；从图库打开的整页进入编辑器胶片条。
- 集合重命名改为应用内内联输入，不再依赖系统弹窗。
- 验证：桌面端 483 项测试通过（2 项跳过），typecheck / lint 通过；引擎 CTest 43/43。

**English**

- The library becomes a full library: a Library / Develop two-module workspace,
  plus an import dialog with an explicit references-only note and progress.
- Collections (manual groups; add/remove the current selection) and Smart
  Collections (saved filter presets), with colour-label filtering.
- Metadata panel: edit title/caption/keywords, apply rating/flag/label in bulk,
  and **Sync Settings** copies the anchor photo's develop sidecar to every
  selected photo.
- Photos opened normally are registered automatically and missing thumbnails
  are filled in the background; opening from the library loads the whole
  visible page into the editor filmstrip.
- Collection renaming is now an inline in-app input instead of a system prompt.
- Verified: 483 desktop tests passed (2 skipped), typecheck / lint clean,
  43/43 engine CTest.

### v1.2.1 — 稳定性、兼容性验证与文档同步 / Stability, compatibility checks and docs

安装包：`SpektraLab_1.2.1_x64-setup.exe`（NSIS，37.55 MiB），sha256
`2268737ed3f8d24b2cd25fe42555135bb3f1b43b5a02c7d7c8add215bd28caca`。

**中文**

- 关闭窗口时先向渲染宿主发送 shutdown 请求并等待其自行退出（最多 700 ms），
  不再直接强杀；正常关闭降为 INFO，异常退出仍按预算自动重启并上报。
- 新增强制 Dekker split CTest（`spk_math_fallback`）与 Windows CI 编译门
  （MSYS2 MinGW，无 GPU 仅编译）。
- 兼容矩阵/能力/移植文档同步到实现：51 个 Vulkan kernel、43 个 CTest；
  scene latitude、overscan/片边、date back、Cineon DI 均已支持并测试。
- 帧缓存 LRU 复核确认已具备（默认 16 GiB，按 mtime 清理，设置页可调）。
- 测试：引擎 43/43 CTest，`cargo check` 通过，桌面 474 项通过。

**English**

- Graceful host shutdown (send `shutdown`, wait up to 700 ms, then kill),
  clean close logged at INFO, unexpected exits still restart within budget.
- New forced-Dekker CTest and a Windows CI compile gate (MSYS2 MinGW,
  compile-only on a GPU-less runner).
- Compatibility matrix and port docs now match the implementation: 51 Vulkan
  kernels, 43 CTests; scene latitude, overscan/film edge, date back and Cineon DI
  are supported and tested.
- Frame cache LRU reviewed: 16 GiB default cap, mtime trim, adjustable in Settings.
- Tests: engine 43/43 CTests, `cargo check` clean, 474 desktop tests passing.

### v1.2.0 — 图库到修改的胶片条连续浏览 / Library-to-filmstrip browsing

安装包：`SpektraLab_1.2.0_x64-setup.exe`（NSIS，37.55 MiB），sha256
`efe0f571d14f1cd3195a2eb8d7027493e217961de30490f55d18fb2558226e9c`。

**中文**

- 从图库双击（或 Enter）打开照片时，编辑器底部胶片条会装入**当前筛选/排序后的整页照片**，
  可直接点缩略图或用方向键切换，不必先返回图库再选。
- 编辑器工具栏的「图库」按钮现在会**把当前正在修改的照片带回图库并选中**，
  在图库与修改之间来回操作时不会丢失位置。
- 从图库进入修改、编辑、返回图库、再换下一张，形成连续的浏览-编辑循环。
- 测试：474 项桌面测试通过（新增 2 项“图库开片时胶片条装入整页”用例）、typecheck/lint 干净；引擎未改动。

**English**

- Double-clicking (or Enter) a photo in the library now loads the **whole
  filtered/sorted page** into the editor's filmstrip; switch frames by clicking
  a thumbnail or with the arrow keys, without returning to the grid.
- The editor's Library button now **reopens the grid with the photo being
  edited selected**, so moving between the grid and the editor keeps place.
- Editing becomes a continuous browse-edit loop: grid → editor → grid → next.
- Gates: 474 desktop tests pass (including 2 new cases for the filmstrip
  collection), typecheck/lint clean; the engine is unchanged.

### v1.1.1 — 图库入口与自动登记 / Library entry and auto-registration

安装包：`SpektraLab_1.1.1_x64-setup.exe`（NSIS，37.54 MiB），sha256
`5a848d2331f28c3728b47887909560a81ce628441bd94046fe298f5e6c5b7e7a`。

**中文**

- 图库入口更明确：工具栏新增带文字的「图库」按钮，文件菜单新增 **图库…**（`Ctrl+Shift+L`）。
- 通过「打开文件夹 / 打开照片 / 拖放 / 启动参数」打开的照片会自动登记进图库
  （只记录引用，原文件不动），关闭软件再打开后可在图库中直接找到。
- 图库缺缩略图的条目会在打开图库时后台补齐预览，不阻塞浏览。
- 内部说明与发布文档统一使用中性名称「图库 / 持久图库」，不再引用其他软件名称。
- 测试：472 项桌面测试通过、typecheck/lint 干净；引擎未改动。

**English**

- Clearer library entry point: a labelled **Library** button in the toolbar and
  **File → Library…** (`Ctrl+Shift+L`).
- Photos opened through Open Folder / Open Photographs / drag-and-drop / launch
  arguments are registered in the catalog automatically (references only; the
  originals are untouched), so they are there after a restart.
- Entries without previews get their thumbnails filled in the background when
  the library is opened; browsing is never blocked.
- Documentation now uses the neutral name "library / catalog" and no longer
  references other software by name.
- Gates: 472 desktop tests pass, typecheck/lint clean; the engine is unchanged.

### v1.1.0 — 图库 / Library

安装包：`SpektraLab_1.1.0_x64-setup.exe`（NSIS，37.54 MiB），sha256
`eec29bb665ef9cf60ec0d74d34d1c33ccc4f3b0ace4d25a5e019d30009fe33c8`。

**中文**

- 新增持久图库：导入文件夹或单张照片（只登记引用，不复制、不改原图），
  带缩略图、0–5 星评分、Pick/Reject 旗标、关键字和“已编辑”标记。
- 目录持久化在 `%AppData%\app.spektralab.desktop\Catalog\catalog.json`，缩略图在同目录
  `thumbs/`；关闭软件再打开会自动回到图库。
- 图库视图：搜索，按文件夹/关键字/评分/旗标/仅已编辑筛选，按导入时间/名称/文件夹/评分/
  日期排序，单击选中、Shift 范围选择、Ctrl/Cmd 多选，双击或 Enter 进入修改。
- 快捷键：方向键浏览、Enter 打开、0–5 评分、P/X/U 旗标、Delete 移出图库（原图不动）、
  Ctrl/Cmd+A 全选、Esc 返回修改。
- 非破坏性保持：所有调整仍写在每图 sidecar 中，原图永不改写。
- 质量门禁：desktop 472 项测试通过、typecheck/lint 干净；引擎未改动。

**English**

- New persistent library: import folders or single photos by reference
  (originals are never copied or modified), with thumbnails, 0–5 star ratings,
  pick/reject flags, keywords and an edited marker.
- The catalog persists at `%AppData%\app.spektralab.desktop\Catalog\catalog.json`
  with thumbnails under `thumbs/`; reopening the app returns to the library.
- Library view: search; filter by folder/keyword/rating/flag/edited-only; sort by
  import time/name/folder/rating/date; click to select, Shift for a range,
  Ctrl/Cmd to toggle; double-click or Enter opens the frame in the editor.
- Shortcuts: arrows to browse, Enter to open, 0–5 to rate, P/X/U to flag,
  Delete to remove from the catalog (originals untouched), Ctrl/Cmd+A to select
  all, Esc to return to the editor.
- Edits remain non-destructive per-image sidecars; originals are never rewritten.
- Gates: 472 desktop tests pass, typecheck/lint clean; the engine is unchanged.

### v1.0.0 — 独立版本线与命名统一 / Independent version line

安装包：`SpektraLab_1.0.0_x64-setup.exe`（NSIS，37.54 MiB），sha256
`ac0dd67502be75e537d8624235bef68f73a5745b9d67bbd0bd2e46c4c638aa41`。

**中文**

- Windows 版改用独立语义化版本号，首个版本为 **1.0.0**，不再沿用上游 `1.3.4-beta.3`，避免与 macOS 版本混淆。
- 安装包文件名、NSIS 安装器属性、应用可执行文件的 `FileVersion`/`ProductVersion` 全部统一为 1.0.0。
- 应用内“检查更新”改为读取本仓库 Releases，按 `v<主>.<次>.<修订>` 与 `SpektraLab_<version>_x64-setup.exe` 匹配。
- 功能与 win.2 相同：Tone Mask、整图 parity、会话驻留、首帧预热、测光回归修复、TIFF Deflate、显影与光源面板。

**English**

- The Windows edition now uses its own semantic version line (starting at **1.0.0**) rather than the upstream `1.3.4-beta.3` number.
- Installer filename, NSIS installer properties and the app executable's `FileVersion`/`ProductVersion` all report 1.0.0.
- The in-app release check now reads this repository's Releases and matches `v<major>.<minor>.<patch>` / `SpektraLab_<version>_x64-setup.exe`.
- The feature set is unchanged from win.2: Tone Mask, whole-image parity, editor residency, warm first frame, metering regression fix, TIFF Deflate, development and lighting panels.

### v1.3.4-beta.3-win.2 — 测光回归修复 / Metering regression fix

安装包：`SpektraLab_1.3.4-beta.3_x64-setup.exe`（NSIS，37.5 MiB），sha256
`f47a48f419766bde3cdeaf61d0534c542cae553cd3ea50318b644eecfb0c38c1`。

**中文**

- 修复一个自动测光回归（win.1 引入）：`center_weighted`、`average`、`median` 三种测光方法在测光器并行化后
  恒返回 0 EV，选择这些方法时自动曝光不施加增益、配光读数显示 0.000。现已修复并新增回归测试。
- 质量门禁：engine 42/42 CTest（新增 `spk_exposure_metering`）、上游 parity 22/22。
- 其余功能与 win.1 相同（Tone Mask、整图 parity、会话驻留、首帧预热、TIFF Deflate、显影与光源面板）。

**English**

- Fixes an auto-exposure regression introduced in win.1: after the meter was parallelised,
  `center_weighted`, `average` and `median` always returned 0 EV, so choosing one applied no
  exposure gain and the Process reading showed 0.000. Fixed, with a new regression test.
- Gates: engine 42/42 CTest (new `spk_exposure_metering`), upstream parity 22/22.
- Everything else is unchanged from win.1.

### v1.3.4-beta.3-win.1 — Windows port, P0/P1 optimisations, development and lighting

安装包：`SpektraLab_1.3.4-beta.3_x64-setup.exe`（NSIS，37.5 MiB）。基于上游
v1.3.4-beta.3（tag `9ceca33`）快照。

**中文**

- 修复 Windows/Vulkan 后端的 Tone Mask（对比度蒙版），前端 Tone Mask 面板随之可用。
- 建立整图 parity 基线：对公开上游 Python 参考包 22 个 case 全部通过（默认路径）。
- 编辑会话显存预算：最多 2 个会话常驻，其余挂起到磁盘；多图打开不再线性吃满显存。
- 首帧体验：打开 RAW 时先显示相机内嵌预览；解码期间预热引擎；测光不再排序 170 万个数，
  冷启动实时首帧约 260 → 180 ms。
- 导出：新增 TIFF Deflate（含 predictor，16-bit 约小 11%，无损）；`export_image` 统一到 GPU 导出路径，
  32.95 MP 下 TIFF16 2079 → 217 ms、JPEG 1849 → 243 ms。
- 新增显影面板：推拉 −3…+3 档、显影温度 18–24 °C（由实测 Portra 800 push1/push2 标定的近似模型；
  关闭时为精确旁路）。
- 新增光源面板：扫描光源与观看光源可选（D50/D55/D65/D75/A/TH-KG3 及自定义色温黑体），
  观看光源为 CAT02 软打样并接管 glare 染色；保持默认时输出与旧版逐字节一致。
- 质量门禁：engine 41/41 CTest、上游 parity 22/22、desktop 464 项测试通过。

**English**

- Tone Mask now works on the Windows/Vulkan backend (platform-neutral macOS node + two new
  compute kernels), so the frontend's Tone Mask panel is enabled.
- Whole-image parity baseline against the public upstream Python package: 22 cases, all within
  the 3e-5 bar on the default path.
- Editor residency budget: at most two editor caches stay resident, older ones suspend to disk;
  opening many images no longer grows GPU usage linearly.
- First-view experience: the embedded camera preview paints before the engine open; the engine
  warms up while the RAW decodes; meter no longer sorts 1.7 M doubles — cold live first frame
  ~260 → 180 ms.
- Export: TIFF Deflate with predictor (16-bit ~11 % smaller, lossless); `export_image` now reuses
  the GPU export path — 32.95 MP `tiff16` 2079 → 217 ms, `jpeg` 1849 → 243 ms.
- New Development panel: push/pull −3…+3 stops and developer temperature 18–24 °C (a fitted
  approximation of the measured Portra 800 push1/push2 profiles; off is a byte-exact bypass).
- New Lighting panel: scan and viewing lights are selectable (D50/D55/D65/D75/A/TH-KG3 and
  arbitrary black-body temperature). A different viewing light is a CAT02 soft proof and takes
  over the glare tint; the default output is byte-identical to the previous build.
- Gates: engine 41/41 CTest, upstream parity 22/22, desktop 464 tests passing.
