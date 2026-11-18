# v1.5.0 — 影调工具视觉优化 / Readable tone tools

**中文**

宽容度曲线与照片直方图这两个最常看的影调工具，视觉上重做了一版：

- **宽容度**：从一条 240×60 的窄条改成 260×96 的直方图式图表——平滑后的场景分布用渐变面积表示，可印放的中等曝光带（阴影/高光 EV）着色并标注，坐标轴带 EV 刻度与边界标签。
- 图表下方新增芯片行：保留档数、低于/范围内/高于百分比一眼可读。
- 新增「应用建议置位」按钮：当测光给出建议时，一键把阴影/高光回拉量应用到场景置位。
- **照片直方图**：从 150×44 的细线改为 176×58 的平滑 RGB + 亮度叠加，带网格、坐标轴、亮度均值和两端裁剪标记，深色画布上更清楚。

验证：桌面端 491 项测试通过（2 项跳过），typecheck / lint 通过；安装包 37.53 MiB。

**English**

A visual pass over the two tone tools you look at most:

- **Latitude plot**: from a 240×60 strip to a 260×96 histogram-style chart —
  a smoothed, gradient-filled scene distribution; the printable medium band
  (shadow/highlight EV) shaded and labelled; EV ticks and boundary labels on
  the axis.
- A stat row below the plot reports the held stops and the below / within /
  above shares at a glance.
- A **suggested placement** button applies the measured highlight/shadow
  pull-back in one click when metering offers advice.
- **On-canvas histogram**: from 150×44 thin lines to a 176×58 smoothed RGB +
  luma overlay with grid, axis, mean level and clipping markers.

Verified: 491 desktop tests passed (2 skipped); typecheck / lint clean;
installer 37.53 MiB.
