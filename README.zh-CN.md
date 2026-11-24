# SpektraLab Windows

[English](README.md) · [下载 Windows x64 安装包](https://github.com/Markhhyu/SpektraLab-Windows/releases/latest) · [版本记录](RELEASES.md)

用数码相机的 RAW 体验从胶片曝光到相纸放大的过程。你可以用同一张照片比较换卷、增感显影或更换相纸的效果，再把选好的设置用在一组照片上。

这是由 [Markhhyu](https://github.com/Markhhyu) 独立维护的 Windows 版本，起点是上游的 [SpektraLab Windows v1.3.4-beta.3](https://github.com/JamesQiu2005/SpektraLab/releases/tag/spektralab-windows-v1.3.4-beta.3)。本仓库独立发布，持续改进不同胶片的曝光响应、RAW 高光处理和 Windows 下的选片修图体验。

## 安装并处理第一张照片

1. 打开[最新 Windows 版](https://github.com/Markhhyu/SpektraLab-Windows/releases/latest)，下载 `SpektraLab-Windows-Markhhyu-<版本号>-x64-setup.exe`。同名的 `.sha256` 文件用于校验下载内容。
2. 运行安装程序。需要 Windows 10 或 11 x64，以及支持 Vulkan 1.1 的显卡驱动。安装程序尚未签名，缺少 Microsoft Edge WebView2 时会提示或尝试联网安装。
3. 从图库打开一张 RAW，先选胶片。使用负片时，再挑相纸并调整曝光。放大到 100% 查看颗粒和明暗交界处，最后导出 JPEG 或 16 位 TIFF。[RAW 格式与相机支持情况](RAW-SUPPORT-20261029.md)

## 这个版本改进了什么

| 修图时遇到的场景 | 本项目的处理方式 |
| --- | --- |
| 给 50D 或 E100 确定曝光 | 自动曝光保护采用各自的胶片特性曲线。E100 还用日光灰阶的分层密度检查曝光响应。 |
| 用 CineStill 800T 处理路灯或霓虹灯 | 对支持的 Bayer RAW，先检查白平衡之前哪些传感器通道已经饱和，再决定哪些灯芯需要补偿，减少对仍有细节的亮部的干预。 |
| 放大观察颗粒和细节 | 各款 VISION3 分别校准颗粒。50D 的细节扩散还参考柯达公布的红、绿、蓝三通道调制传递函数（MTF）。 |
| 处理一整组照片 | 在图库中评星、标旗，用蒙版做局部调整，再批量导出。编辑记录单独保存，可以重新打开继续修改。 |

目前的校准依据是厂商资料和合成测试图。例如，在未参与 E100 拟合的日光灰阶上，蓝通道密度的均方根误差从 0.170 D 降至 0.041 D。它衡量的是这一组灰阶上的密度响应，整张照片的胶片质感仍待同场景实拍对照。[测量结果与适用条件](RELEASES.md#cn-1.10.0) · [与上游的差异](DIFFERENCES.md)

## 构建与反馈

桌面界面使用 Tauri 和 React，渲染由 C++20/Vulkan 引擎完成。构建时可以依次查阅 [Windows 引擎指南](engine/WINDOWS.md)、[桌面安装包指南](desktop/docs/WINDOWS-INSTALLER.md)和[版本发布说明](RELEASES.md)。

Windows 版的问题和建议请提交到[本仓库的 Issues](https://github.com/Markhhyu/SpektraLab-Windows/issues)。反馈成像问题时，请附上软件版本、显卡、输入格式、片种和关键参数，方便复现同一帧。

## 来源与许可

- 胶片与相纸模拟桌面应用源自 [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab)。项目代码使用 [GPL-3.0-or-later](license/LICENSE)。
- 摄影过程模型及胶片、相纸配置来自 Andrea Volpato 的 [spektrafilm](https://github.com/andreavolpato/spektrafilm)。其中的配置、LUT 及其直接衍生数据使用 [CC BY-SA 4.0](license/SPEKTRAFILM_LICENSE.txt)。黑白胶片配置由 Hanze Qiu 贡献。
- 随安装包分发的 Windows 依赖见[第三方许可清单](license/windows-runtime-notices.json)。
