# SpektraLab for Windows（Windows 版）

[English](README.md) · **简体中文**

这是 [SpektraLab](https://github.com/JamesQiu2005/SpektraLab) 的 **Windows / Vulkan 构建**：源自原项目最后一个
Windows 测试版 **v1.3.4-beta.3**（tag `9ceca33`）。Windows 版使用自己独立的版本线，当前为 **v1.0.0**，
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

完整清单与实测数据在 [`WINDOWS-PORT.md`](WINDOWS-PORT.md)（英文），速览：

#### 正确性与健壮性（P0）

1. **Vulkan 后端的 Tone Mask**——把 macOS 的对比度蒙版节点平台化，并新增两个 compute kernel；
   host 不再把 `contrast_mask` 列为不支持，UI 因此可用。
2. **整图 parity 基线**——对公开 Python 参考包 `engine/tests/parity_upstream.py`：22 个 case 全部落在 3e-5 误差线内，
   已有记录的语义分歧单独断言。
3. **编辑会话驻留预算**——最多 2 个编辑会话缓存常驻，更旧的挂起到磁盘并释放显存
   （`SPEKTRAFILM_HOST_RESIDENT_EDITORS` 可调）。
4. **首帧延迟**——在引擎 open 之前先显示相机内嵌预览；host 增加 `warm_up`；测光计算不再对 170 万个 double 排序。

#### 性能（P1）

5. 首帧预热：RAW 解码期间循环调用 `spk_warm_up`；冷启动 live 首帧约 260 ms → 180 ms。
6. TIFF **Deflate + predictor** 选项（`tiff_compression: "deflate"`）：16-bit 导出约小 11%，
   无损（已用 libtiff/OIIO 交叉验证）。
7. 统一导出路径：`export_image` 复用 GPU 渲染 + 流式编码器——32.95 MP 下 `tiff16` 2079 → 217 ms、
   `jpeg` 1849 → 243 ms。
8. 标定扫描 harness（`engine/tests/calibration_sweep.py`）：对参考实现的 DIR 耦合、光晕、颗粒单调性检查，
   13 个采样点 0 失败。
9. 解码分段计时（`SPEKTRAFILM_DECODE_TIMINGS`）与 16-bit→float 打包并行；两段解码已记录为产品决策项。

#### 原生扩展（macOS 版没有）

10. **显影面板（P1-7）**——推拉 −3…+3 档（1/3 档步进）与显影温度 18–24 °C。实测密度曲线由拟合
    Portra 800 push1/push2 profile 的三参数族弯曲；温度按 1 °C ≈ 1/6 档折算，颗粒随推档增强。
    关闭时是**逐字节精确旁路**。该模型是实测推档曲线的近似（平均差约 2.6%），不是逐 stock 的替代品。
11. **光源面板（P1-8）**——扫描光源与观看光源可选
    （`D50/D55/D65/D75/E/A/Incandescent/Kinoton 75P/TH-KG3/BB<色温>`）。
    扫描常量按命名光源重新烘焙；观看光源经 CAT02 做软打样并接管 glare 染色。
    两个字段都保持默认（空串）时，输出与 P1-8 之前完全一致。

## 打包与 Releases

- 发布用的 host 为**静态链接**（`-DSPEKTRALAB_STATIC_RUNTIME=ON`），只依赖系统 DLL
  （ADVAPI32、KERNEL32、SHELL32、USER32、WS2_32、ole32、UCRT），与原 Windows 测试版一致。
- Release 说明**中英文各写一份**，列出本次构建的改动。发布流程与历史见 [`RELEASES.md`](RELEASES.md)。
- 每次代码更新都会重新构建安装包并发布新的 Release；tag 使用本仓库自己的语义化版本
  `v<主>.<次>.<修订>`（首个版本为 `v1.0.0`），安装包文件名与应用/安装器属性版本保持一致。

## 从源码构建

Windows + MinGW-w64 GCC + CMake。完整依赖（Vulkan headers + glslang、LibRaw、导出编解码器、
OpenEXR/lcms/heif、lensfun + 静态 GLib）与 configure 命令见 [`WINDOWS-PORT.md`](WINDOWS-PORT.md)（英文）
与 [`engine/WINDOWS.md`](engine/WINDOWS.md)。简要步骤：

```powershell
# host + engine（Vulkan）、资源、测试
cmake -S engine -B build/win-host -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
cmake --build build/win-host -j
ctest --test-dir build/win-host --output-on-failure     # 41 项测试
```

桌面应用（Tauri + Rust + Node）：

```bash
cd desktop && npm ci
node scripts/package.mjs win      # 暂存 host、构建前端并产出 NSIS 安装包
```

## 测试

- `ctest`——41 项引擎/host 测试，包括 mask kernel oracle、驻留策略、显影模型与光源测试。
- `engine/tests/parity_upstream.py`——对公开上游 Python 包的整图 parity
  （需要装好 numpy/scipy/numba/colour-science 的 Python 环境）。
- `engine/tests/calibration_sweep.py`——DIR/光晕/颗粒单调性。
- `cd desktop && npx vitest run`——464 项前端测试。

## 已知限制

- 本仓库基于上游 **v1.3.4-beta.3**：macOS 应用后续新增的功能（新 UI、局部调整等）不在本仓库中。
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
