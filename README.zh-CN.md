# SpektraLab for Windows（Windows 版）

[English](README.md) · **简体中文**

这是 [SpektraLab](https://github.com/JamesQiu2005/SpektraLab) 的 **Windows / Vulkan 构建**：源自原项目最后一个
Windows 测试版 **v1.3.4-beta.3**（tag `9ceca33`）。Windows 版使用自己独立的版本线，当前为 **v1.9.3**，
并包含 Windows 移植修复、性能优化和两个原生扩展（见下）。

胶片过程模型、28 个实测胶片/相纸 profile 与打印 LUT 来自
[spektrafilm](https://github.com/andreavolpato/spektrafilm)。原项目是 macOS 产品（SwiftUI + Metal）；
本仓库保留其 C++20 引擎，并新增 Vulkan host 在 Windows 上驱动它。

> **这是衍生项目，不是上游。** macOS 应用的问题请提给
> [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab)；本 Windows 构建的问题提到本仓库。

## 下载与安装

安装包见 **[Releases](https://github.com/Markhhyu/SpektraLab-Windows/releases)**：`SpektraLab_<version>_x64-setup.exe`（NSIS，约 38 MB）。

- Windows 10/11 64 位。
- 需要可用的 Vulkan 1.1+ 显卡驱动（参考机为 RTX 4070 Laptop / 8 GB；近年的 AMD、Intel、NVIDIA 显卡均可）。
- WebView2 运行时（安装包缺少时会自动下载）。
- 安装包**未做代码签名**，SmartScreen 会提示"Windows 已保护你的电脑"——选择"更多信息 → 仍要运行"。
- 默认按"所有用户"安装，需要管理员权限；与原 Windows 测试版行为一致。

首次使用：打开一张 RAW（LibRaw 支持），选胶片与相纸后即可编辑。右侧栏是参数，左侧栏是胶片/相纸选择。
在参考机上，32.95 MP 的 Sony ARW 打开约 1.2 秒，首帧实时预览约 0.2 秒。

## 本构建新增了什么

这不是简单重新编译：渲染器从 Metal 移植到 Vulkan，界面重做成 Tauri/React 应用，
胶片链路还加上了 macOS 版没有的能力。完整清单与实测数据见
[`DIFFERENCES.md`](DIFFERENCES.md)（与上游差异）、[`RELEASES.md`](RELEASES.md)
（逐版本历史）与 [`WINDOWS-PORT.md`](WINDOWS-PORT.md)（移植工程细节）。

速览：

- **胶片**——按 datasheet 标定的逐片种颗粒、带显影温度的推拉、可选的扫描与观看
  光源、重新标定的影调蒙版，以及场景置位提示。
- **性能**——首帧前预热、RAW 两段解码、预览与导出共用一条导出路径、并行 Deflate，
  以及最多 4 个宿主的批量导出渲染池。
- **工作流**——带集合的图库、历史面板、预设、蒙版式局部调整，以及相机/扫描控制的
  成像链细节面板。

## 打包与 Releases

- 发布用的 host 为**静态链接**（`-DSPEKTRALAB_STATIC_RUNTIME=ON`），只依赖系统 DLL
  （ADVAPI32、KERNEL32、SHELL32、USER32、WS2_32、ole32、UCRT），与原 Windows 测试版一致。
- Release 说明为中英双语，内容直接取自 [`RELEASES.md`](RELEASES.md) 的对应版本条目。
- 小改动以**提交**形式进入 `main`；攒成一批值得发布的改动后，才重新构建安装包并发 Release。
  tag 使用本仓库自己的语义化版本 `v<主>.<次>.<修订>`（首个版本为 `v1.0.0`），安装包文件名与
  应用/安装器属性版本保持一致。发布检查单见 [`RELEASES.md`](RELEASES.md)。

## 从源码构建

Windows + MinGW-w64 GCC + CMake。完整依赖（Vulkan headers + glslang、LibRaw、导出编解码器、
OpenEXR/lcms/heif、lensfun + 静态 GLib）与 configure 命令见 [`WINDOWS-PORT.md`](WINDOWS-PORT.md)（英文）
与 [`engine/WINDOWS.md`](engine/WINDOWS.md)。简要步骤：

```powershell
# host + engine（Vulkan）、资源、测试
cmake -S engine -B build/win-host -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build/win-host -j
ctest --test-dir build/win-host --output-on-failure     # 43 项测试
```

桌面应用（Tauri + Rust + Node）：

```bash
cd desktop && npm ci
node scripts/package.mjs win      # 暂存 host、构建前端并产出 NSIS 安装包
```

## 测试

- `ctest`——43 项引擎/host 测试，包括 mask kernel oracle、驻留策略、显影模型与光源测试。
- `engine/tests/parity_upstream.py`——对公开上游 Python 包的整图 parity
  （需要装好 numpy/scipy/numba/colour-science 的 Python 环境）。
- `engine/tests/calibration_sweep.py`——DIR/光晕/颗粒单调性。
- `cd desktop && npx vitest run`——531 项前端测试（2 项跳过）。
- GitHub Actions——`Build`（上游 macOS 干净检出构建）与
  `Windows build`（MSYS2 MinGW 引擎编译门）。

## 已知限制

- 本仓库基于上游 **v1.3.4-beta.3**：macOS 应用后续新增的功能（新 UI 等）不在本仓库中；
  局部调整由本仓库的 Windows 宿主侧实现（面板滑块方式，暂不支持画布拖拽手柄）。
- P1-8 的相纸表面/光泽部分（纸面 BRDF、2°/10° 观察者）未实现，只做了光源部分。
- 整图 parity 对公开 `spektrafilm` 包验证；其余 `parity_*.py` 依赖的 macOS 私有 Python 参考在这里不可用，
  因此 fork 专属 stock 只由 `parity_product_stocks.py` 覆盖。
- GUI 是 Windows 的 Tauri/React 移植，不是 macOS 的 SwiftUI 界面。

## 致谢与许可

- 原项目：[JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab)（GPL-3.0-or-later），快照 tag `9ceca33`。
- 胶片过程模型、profile 与 LUT：[spektrafilm](https://github.com/andreavolpato/spektrafilm)，
  作者 Andrea Volpato（profiles 为 CC BY-SA 4.0）。
- 黑白 profile：Hanze Qiu。

| | |
|---|---|
| 应用与引擎 | GPL-3.0-or-later — [`license/LICENSE`](license/LICENSE) |
| 胶片/相纸 profile、打印 LUT | CC BY-SA 4.0 — [`license/SPEKTRAFILM_LICENSE.txt`](license/SPEKTRAFILM_LICENSE.txt) |
| 第三方声明 | `license/windows-runtime-notices.json` |
