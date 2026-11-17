# v1.2.1 — 稳定性、兼容性验证与文档同步 / Stability, compatibility checks and docs

安装包：`SpektraLab_1.2.1_x64-setup.exe`（NSIS，37.55 MiB），sha256
`2268737ed3f8d24b2cd25fe42555135bb3f1b43b5a02c7d7c8add215bd28caca`。

**中文**

- 关闭窗口时先向渲染宿主发送 shutdown 请求并等待其自行退出（最多 700 ms），
  不再直接强杀进程；正常关闭不再被记录为 WARN，异常退出仍会按预算自动重启并上报。
- 新增「强制 Dekker split」CTest（`spk_math_fallback`）：在无 fused-FMA 的 GPU 上
  验证回退路径的数学与渲染；新增 Windows CI 编译门（MSYS2 MinGW，无 GPU 只编译）。
- 兼容矩阵、能力文档与移植文档同步到当前实现：51 个 Vulkan kernel、43 个 CTest，
  此前文档中“被拒绝”的 scene latitude / overscan / date back / Cineon DI 实际均已支持，
  已由 C ABI 测试与全幅探针验证；唯一保留的拒绝项是 Metal-only 的 device 输入接口。
- 帧缓存容量/LRU 复核确认已具备（默认 16 GiB 上限、按 mtime 清理、设置页可调），
  本次仅更正文档描述。
- 测试：引擎 CTest **43/43** 通过；`cargo check` 通过；桌面测试 474 项通过。
- 说明：胶片/相纸新增覆盖、镜头 PSF/快门、互易律/老化需要实测标定数据，本轮未生成；
  黑白暗房调色与批处理并行属较大特性，已在优化报告中记录为后续项。

**English**

- Closing the window now asks the render host to shut down and waits up to
  700 ms for it to exit on its own instead of terminating it; a clean close is
  logged at INFO, unexpected exits still restart within budget and are reported.
- New forced-Dekker CTest (`spk_math_fallback`) covers the unfused-FMA fallback,
  and a Windows CI compile gate (MSYS2 MinGW, compile-only on a GPU-less runner)
  guards clean-checkout builds.
- Compatibility matrix and port docs now match the implementation: 51 Vulkan
  kernels, 43 CTests; scene latitude, overscan/film edge, date back and Cineon DI
  are supported and covered by C-ABI tests plus full-resolution probes. Only the
  Metal-only device-input entry point stays unsupported.
- Frame cache capacity/LRU was reviewed and already exists (16 GiB default cap,
  mtime-based trim, adjustable in Settings); only the docs were corrected.
- Tests: engine CTest **43/43**, `cargo check` clean, 474 desktop tests passing.
- Notes: broader stock coverage, lens PSF/shutter and reciprocity/ageing need
  measured data; B&W darkroom toning and parallel batch export are larger
  features tracked in the optimisation report.
