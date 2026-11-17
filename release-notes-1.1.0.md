### v1.1.0 — 图库 / Library

安装包：`SpektraLab_1.1.0_x64-setup.exe`（NSIS，37.54 MiB），sha256
`eec29bb665ef9cf60ec0d74d34d1c33ccc4f3b0ace4d25a5e019d30009fe33c8`。

**中文**

- 新增 Lightroom 式图库：导入文件夹或单张照片（只登记引用，不复制、不改原图），
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

- New Lightroom-style library: import folders or single photos by reference
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
