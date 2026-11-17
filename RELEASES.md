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
