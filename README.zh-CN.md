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

12. **图库与集合（`v1.3.0`）**——持久的照片目录，配「图库 / 修改」双模块工作区。
    从工具栏的「图库」按钮或 **文件 → 图库…**（`Ctrl+Shift+L`）打开。导入文件夹或照片时
    只登记引用（原文件不复制、不改写），通过普通打开方式打开的照片也会自动登记，
    缩略图在后台补齐。支持按文件夹/关键字/星级/旗标/颜色标签/搜索筛选，并可用
    **集合**（手动分组，可把当前所选加入或移出）与**智能集合**（保存的筛选预设）管理。
    目录保存在 `<AppData>\app.spektralab.desktop\Catalog\catalog.json`，缩略图在
    `...\Catalog\thumbs\`。元数据面板可编辑标题/说明/关键字、批量设置星级/旗标/颜色，
    **同步修改设置**可把锚点照片的修改 sidecar 复制到所有选中照片。编辑器右侧参数栏
    顶部有「图库 / 修改」切换；修改模式的胶片条支持按星级、旗标、颜色标签筛选
    （缩略图上显示标记），筛选只影响显示、不改变工作台顺序。从图库打开会把
    当前筛选/排序后的整页照片装进编辑器胶片条，可直接在下方点缩略图切换；编辑器里的
    图库按钮会带着当前照片回到图库。编辑仍以每图 sidecar 非破坏性保存，原图不变。

13. **更易读的影调工具（`v1.5.0`）**——宽容度曲线改为 260×96 的直方图式图表：
    平滑后的场景分布用渐变面积表示，可印放的中等曝光带（阴影/高光 EV）着色并标注，
    坐标轴带 EV 刻度与边界标签，下方芯片行给出保留档数与低于/范围内/高于的百分比；
    「应用建议置位」按钮可一键应用测得的阴影/高光回拉量。画布右上角的照片直方图改为
    176×58 的平滑 RGB+亮度叠加图，带网格、坐标轴与两端裁剪标记。

14. **工作流打磨（`v1.6.0`）**——新增影调蒙版面板，直接暴露引擎的高光/阴影/核心/半径
    参数（此前因宿主能力未接通而隐藏）；按 `?` 打开快捷键速查表（帮助菜单 → 键盘快捷键
    也可打开）；顶栏分组加入视觉分隔并以帮助按钮结尾；导出完成后可直接回到图库；
    胶片与相纸列表新增搜索框和最近使用；macOS 的 ⌘ 文案统一改为 Windows 的 Ctrl。

15. **历史与预设（`v1.7.0`）**——每次修改现在都可回溯：按 `Ctrl+H` 打开历史面板，
    按步骤列出每次撤销（最新在上），并自动生成说明（换胶片/相纸、显影、影调蒙版、
    曝光、色彩调整、裁剪、白平衡等）；点击任意一行可把当前照片跳回该快照，之后仍可用
    重做向前重放。参数右栏新增「预设」区，可把当前胶片参数与色彩调整保存为预设（存于
    应用数据），在其他照片上一键应用——应用本身就是一次可撤销的编辑；预设支持重命名与删除。

16. **局部调整（`v1.8.0`）**——参数右栏新增「局部调整」：支持线性渐变与径向蒙版，
    每层可调曝光、对比度、高光、阴影、饱和度、色温、色调、羽化与反转（最多 16 层）。
    蒙版定位在成片画面（裁剪与旋转之后），由宿主在印片渲染完成后于线性光下施加，
    因此叠加在 Layer 2 之上，不改动负片与相纸曲线。蒙版及其设置写入照片 sidecar，
    属于正常的可撤销编辑；不合法的层会被明确拒绝。另：直方图与宽容度图改为平滑绘制，
    增加裁剪提示、EV 刻度与「应用建议置位」等控件。

17. **RAW 两段解码与一批流程升级（`v1.9.0`）**——打开 RAW 现在先用半分辨率
    LibRaw 解码出首帧（32.95 MP 参考图约 0.45 s，原约 1.12 s），首帧上屏后自动
    补齐全分辨率解码，打开等待约减半。文件夹导入 8 张以上时通过渲染池读取相机
    预览（可取消、失败列表与重试）。批量导出可用最多 4 个后台渲染宿主
    （设置 → 渲染 → 批量渲染），3 张 32.95 MP TIFF 实测快 3.1 倍；额外宿主只在
    导出期间存在。图库新增拍摄时间排序、缩略图尺寸滑杆与就地重命名；胶片条可
    批量评级/旗标/颜色（键盘 0-5 / P / X / U）。TIFF Deflate 导出改为并行压缩
    （约 2.9 s → 0.96 s，像素逐一相同）。图库、修改、导出统一到一条模块栏；
    术语统一（修改 / 配光 / 测光与配光）；窄窗口下侧栏自动收窄；画布加载骨架、
    直方图可折叠、保存状态可见，Camera 区注明配光只给建议、不会自动改曝光。

## 打包与 Releases

- 发布用的 host 为**静态链接**（`-DSPEKTRALAB_STATIC_RUNTIME=ON`），只依赖系统 DLL
  （ADVAPI32、KERNEL32、SHELL32、USER32、WS2_32、ole32、UCRT），与原 Windows 测试版一致。
- Release 说明**中英文各写一份**，列出本次构建的改动。发布流程与历史见 [`RELEASES.md`](RELEASES.md)。
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
