# v1.2.0 — 图库到修改的胶片条连续浏览 / Library-to-filmstrip browsing

**中文**

- 从图库双击（或 Enter）打开照片时，编辑器底部胶片条会装入当前筛选/排序后的整页照片，可直接点缩略图或方向键切换，不必返回图库。
- 编辑器工具栏「图库」按钮会把当前正在修改的照片带回图库并选中。
- 图库 → 修改 → 图库 → 下一张，形成连续循环。
- 质量门禁：474 项桌面测试通过（新增 2 项）、typecheck/lint 干净；引擎未改动。

**English**

- Double-clicking (or Enter) a photo in the library loads the whole filtered/sorted page into the editor filmstrip; switch frames by clicking a thumbnail or with the arrow keys, without returning to the grid.
- The editor's Library button reopens the grid with the photo being edited selected.
- Continuous browse-edit loop: grid → editor → grid → next.
- Gates: 474 desktop tests pass (including 2 new cases), typecheck/lint clean; the engine is unchanged.
