# v1.1.1 — 图库入口与自动登记 / Library entry and auto-registration

**中文**

- 工具栏新增带文字的「图库」按钮，文件菜单新增 **图库…**（`Ctrl+Shift+L`），不再只是一个图标。
- 通过「打开文件夹 / 打开照片 / 拖放 / 启动参数」打开的照片会自动登记进图库（只记录引用，原文件不复制、不改写），重启软件后仍能在图库中找到。
- 打开图库时，缺少预览的条目会在后台补齐缩略图，不阻塞浏览。
- 文档与发布说明统一使用中性名称「图库 / 持久图库」。
- 质量门禁：472 项桌面测试通过、typecheck/lint 干净；引擎未改动。

**English**

- A labelled **Library** button in the toolbar and **File → Library…** (`Ctrl+Shift+L`); it is no longer an icon-only entry.
- Photos opened through Open Folder / Open Photographs / drag-and-drop / launch arguments are registered in the catalog automatically (references only; originals are never copied or modified), so they are still listed after a restart.
- When the library opens, entries without previews get their thumbnails filled in the background; browsing is not blocked.
- Documentation and release notes now use the neutral name "library / catalog".
- Gates: 472 desktop tests pass, typecheck/lint clean; the engine is unchanged.
