# v1.9.0 — 两段解码、渲染池与图库升级 / Two-stage decode, render pool and Library upgrades

**中文**
- RAW 打开两段解码：半分辨率首帧（32.95 MP 约 0.45 s，原约 1.12 s）→ 首帧上屏后
  自动补齐全分辨率；打开等待约减半。
- 批量导出渲染池（最多 4 个后台宿主，设置 → 渲染 → 批量渲染），3 张 32.95 MP TIFF
  18.1 s → 5.8 s（3.1×），额外宿主仅导出期间存在。
- 图库导入池化（8 张以上，可取消/失败重试）、EXIF 拍摄时间排序、缩略图尺寸滑杆、
  就地重命名；胶片条批量评级/旗标/颜色 + 键盘 0-5 / P / X / U。
- TIFF Deflate 并行压缩（~2.9 s → 0.96 s，像素一致）。
- 统一模块栏（图库/修改/导出）、术语统一、窄窗口侧栏收窄、画布加载骨架、直方图
  可折叠、保存状态圆点、配光说明。
- 安装包：37.60 MiB，sha256 `2d0f1144bd525bf4c748dcc1611880e75b00aa3e1487025406dc436d4b8144ba`。
- 验证：`ctest` 43/43；前端 531 通过 / 2 跳过。

**English**
- RAW opens in two stages: half-resolution first look (~0.45 s instead of ~1.12 s
  for the 32.95 MP reference), then an automatic full-resolution re-decode once
  the first frame is visible.
- Batch export render pool (up to four background hosts; Settings → Rendering →
  Batch rendering); three 32.95 MP TIFF exports 18.1 s → 5.8 s (3.1×).
- Pooled Library imports (8+ files, cancellable with retry), EXIF capture-time
  sorting, thumbnail-size slider and in-place rename; filmstrip batch rating,
  flags and colour labels (keyboard 0-5 / P / X / U).
- Deflate TIFF export compresses strips in parallel (~2.9 s → 0.96 s, pixels
  identical).
- One module bar for Library/Develop/Export, unified terminology, narrower rails
  on small windows, canvas loading skeleton, foldable histogram, save state dot
  and a Solve explainer.
- Installer: 37.60 MiB, sha256 `2d0f1144bd525bf4c748dcc1611880e75b00aa3e1487025406dc436d4b8144ba`.
- Verification: `ctest` 43/43; 531 frontend tests passed / 2 skipped.
