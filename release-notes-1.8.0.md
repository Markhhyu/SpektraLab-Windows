# v1.8.0 — 局部调整 / Local adjustments

**中文**

- 参数右栏新增「局部调整」：线性渐变与径向蒙版，每层可调曝光、对比度、高光、阴影、
  饱和度、色温、色调、羽化与反转；每张照片最多 16 层。
- 蒙版定位在成片画面（裁剪与旋转之后），由宿主在印片渲染完成后于线性光下施加，
  叠加在 Layer 2 之上，不改动负片或相纸曲线；空蒙版为精确旁路。
- 蒙版与参数写入照片 sidecar，属于正常的可撤销编辑；非法层返回 bad_request。
- 安装包：`SpektraLab_1.8.0_x64-setup.exe`，37.55 MiB，
  sha256 `328a03868d57bcbe1a7c457d8561d7da40227377e522c49874b6a3453c6234f3`。
- 验证：引擎/host `ctest` 43/43；前端 511 通过 / 2 跳过；host 探针验证径向/线性蒙版、
  空数组精确旁路、非法层拒绝与导出文件差异。

**English**

- New Local Adjustments section in the parameters rail: linear gradients and
  radial masks with exposure, contrast, highlights, shadows, saturation,
  temperature, tint, feather and invert controls (up to 16 layers per photo).
- Masks live in the finished frame (after crop and rotation) and are applied by
  the native host in linear light after the print is rendered, on top of Layer 2
  and without touching the negative or the paper curve; an empty list is an
  exact bypass.
- Layers and their settings are stored in the photograph's sidecar as normal
  undoable edits; malformed layers are rejected as bad requests.
- Installer: `SpektraLab_1.8.0_x64-setup.exe`, 37.55 MiB,
  sha256 `328a03868d57bcbe1a7c457d8561d7da40227377e522c49874b6a3453c6234f3`.
- Verified with 43/43 engine/host `ctest`, 511 frontend tests (2 skipped), and a
  host probe covering radial/linear masks, the empty-list bypass, malformed
  layer rejection and a differing export.
