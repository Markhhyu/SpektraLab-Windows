// RFC-024's contrast mask, Vulkan kernels against an independent double
// oracle: the analysis half (`spk_mask_reduce`) and the application half
// (`spk_mask_epilogue`), including the striped band path the executor uses for
// half-frame pairs. The oracle is a straight transcription of
// `src/shaders/contrast_mask.metal`, written in double and deliberately not
// sharing code with the shaders.
//
// Usage: spk_vulkan_mask <resources_dir> [--api]
//   default : kernel parity (this file's `kernel_tests`)
//   --api   : the public C surface (enabled mask renders, exact bypass off)
#include "gpu/gpu.hpp"
#include "gpu_vulkan_read.hpp"
#include "spektrafilm/spk_engine.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void check(bool ok, const std::string& why) { if (!ok) throw std::runtime_error(why); }

using spk::gpu::Arg;
using spk::gpu::BufferRef;
using spk::gpu::Gpu;

constexpr double kLog2Floor = -20.0;
constexpr double kLog10Of2 = 0.30102999566398119521;
constexpr double kLog10OfE = 0.4342944819032518;

struct Case {
    uint32_t W = 137, H = 79, gw = 23, gh = 13, nl = 81;
    std::vector<float> cmy;        // 3 * W * H
    std::vector<float> chd;        // 3 * nl   (print channel density)
    std::vector<float> base;       // nl       (base density)
    std::vector<float> ixs;        // 3 * nl   (enlarger illuminant x sensitivity)
    std::array<float, 16> p{};
};

std::array<float, 3> image_exposure(const Case& c, size_t pixel, const std::array<float, 3>& gain) {
    double a[3] = {0, 0, 0};
    const double c0 = c.cmy[3 * pixel], c1 = c.cmy[3 * pixel + 1], c2 = c.cmy[3 * pixel + 2];
    for (uint32_t l = 0; l < c.nl; ++l) {
        const double d = c0 * c.chd[3 * l] + c1 * c.chd[3 * l + 1] + c2 * c.chd[3 * l + 2] + c.base[l];
        const double t = std::pow(10.0, -d);
        for (int ch = 0; ch < 3; ++ch) a[ch] += t * c.ixs[3 * l + ch];
    }
    return {float(a[0] * gain[0]), float(a[1] * gain[1]), float(a[2] * gain[2])};
}

double mask_x(const std::array<float, 3>& a, const Case& c) {
    double s = 0.0;
    for (int ch = 0; ch < 3; ++ch) {
        const double r = std::max(double(a[ch]) * double(c.p[3 + ch]), 0.0);
        s += std::max(std::log2(r), kLog2Floor);
    }
    return s / 3.0;
}

double mask_g(double d, double h) { return d * h / std::sqrt(h * h + d * d); }

double mask_delta(double b, const std::array<float, 16>& p) {
    double delta = 0.0;
    if (p[11] != 0.0f && b < double(p[9])) {
        const double d = double(p[9]) - b;
        delta = d - mask_g(d, double(p[10]));
    } else if (p[14] != 0.0f && b > double(p[12])) {
        const double d = b - double(p[12]);
        delta = mask_g(d, double(p[13])) - d;
    }
    const double lim = double(p[15]);
    return delta * lim / std::sqrt(lim * lim + delta * delta);
}

std::vector<double> oracle_reduce(const Case& c) {
    const std::array<float, 3> gain{c.p[0], c.p[1], c.p[2]};
    std::vector<double> grid(size_t(c.gw) * c.gh, 0.0);
    for (uint32_t cy = 0; cy < c.gh; ++cy) {
        uint32_t y0 = (cy * c.H) / c.gh;
        uint32_t y1 = std::max(((cy + 1) * c.H) / c.gh, y0 + 1);
        y1 = std::min(y1, c.H);
        for (uint32_t cx = 0; cx < c.gw; ++cx) {
            uint32_t x0 = (cx * c.W) / c.gw;
            uint32_t x1 = std::max(((cx + 1) * c.W) / c.gw, x0 + 1);
            x1 = std::min(x1, c.W);
            double acc = 0.0;
            for (uint32_t y = y0; y < y1; ++y)
                for (uint32_t x = x0; x < x1; ++x)
                    acc += mask_x(image_exposure(c, size_t(y) * c.W + x, gain), c);
            grid[size_t(cy) * c.gw + cx] = acc / double((x1 - x0) * (y1 - y0));
        }
    }
    return grid;
}

double bilinear(const std::vector<double>& coef, uint32_t gw, uint32_t gh, double u, double v) {
    u = std::clamp(u, 0.0, double(gw - 1));
    v = std::clamp(v, 0.0, double(gh - 1));
    const auto u0 = uint32_t(std::floor(u)), v0 = uint32_t(std::floor(v));
    const uint32_t u1 = std::min(u0 + 1, gw - 1), v1 = std::min(v0 + 1, gh - 1);
    const double tu = u - u0, tv = v - v0;
    const double c00 = coef[2 * (size_t(v0) * gw + u0)], c01 = coef[2 * (size_t(v0) * gw + u1)];
    const double c10 = coef[2 * (size_t(v1) * gw + u0)], c11 = coef[2 * (size_t(v1) * gw + u1)];
    return (c00 * (1 - tu) + c01 * tu) * (1 - tv) + (c10 * (1 - tu) + c11 * tu) * tv;
}

double bilinear_b(const std::vector<double>& coef, uint32_t gw, uint32_t gh, double u, double v) {
    u = std::clamp(u, 0.0, double(gw - 1));
    v = std::clamp(v, 0.0, double(gh - 1));
    const auto u0 = uint32_t(std::floor(u)), v0 = uint32_t(std::floor(v));
    const uint32_t u1 = std::min(u0 + 1, gw - 1), v1 = std::min(v0 + 1, gh - 1);
    const double tu = u - u0, tv = v - v0;
    const double c00 = coef[2 * (size_t(v0) * gw + u0) + 1], c01 = coef[2 * (size_t(v0) * gw + u1) + 1];
    const double c10 = coef[2 * (size_t(v1) * gw + u0) + 1], c11 = coef[2 * (size_t(v1) * gw + u1) + 1];
    return (c00 * (1 - tu) + c01 * tu) * (1 - tv) + (c10 * (1 - tu) + c11 * tu) * tv;
}

// The whole-frame oracle for the application half, for one band.
std::vector<double> oracle_epilogue(const Case& c, const std::vector<double>& coef, uint32_t row0,
                                    uint32_t rows) {
    const std::array<float, 3> gain{c.p[0], c.p[1], c.p[2]};
    const std::array<float, 3> offset{c.p[6], c.p[7], c.p[8]};
    std::vector<double> out(size_t(c.W) * rows * 3);
    for (uint32_t y = 0; y < rows; ++y) {
        for (uint32_t x = 0; x < c.W; ++x) {
            const uint32_t py = row0 + y;
            const auto a = image_exposure(c, size_t(py) * c.W + x, gain);
            const double u = (double(x) + 0.5) * double(c.gw) / double(c.W) - 0.5;
            const double v = (double(py) + 0.5) * double(c.gh) / double(c.H) - 0.5;
            const double base = bilinear(coef, c.gw, c.gh, u, v) * mask_x(a, c) +
                                bilinear_b(coef, c.gw, c.gh, u, v);
            const double k = std::exp2(mask_delta(base, c.p));
            for (int ch = 0; ch < 3; ++ch) {
                const double e = std::max(k * double(a[ch]) + double(offset[ch]), 0.0) + 1e-10;
                out[3 * (size_t(y) * c.W + x) + ch] = std::log10(e);
            }
        }
    }
    return out;
}

void require_close(double got, double want, double tol, const std::string& what) {
    const double err = std::abs(got - want) / std::max(1.0, std::abs(want));
    check(err <= tol, what + ": got " + std::to_string(got) + " want " + std::to_string(want) +
                          " (rel " + std::to_string(err) + ")");
}

Case make_case(uint32_t W, uint32_t H, uint32_t gw, uint32_t gh) {
    Case c;
    c.W = W; c.H = H; c.gw = gw; c.gh = gh;
    c.cmy.resize(size_t(W) * H * 3);
    for (size_t i = 0; i < size_t(W) * H; ++i) {
        const double t = double(i) / double(size_t(W) * H - 1);
        c.cmy[3 * i] = float(0.15 + 2.1 * t);
        c.cmy[3 * i + 1] = float(0.10 + 1.7 * (0.3 + 0.7 * std::sin(9.0 * t)));
        c.cmy[3 * i + 2] = float(0.60 + 1.2 * (1.0 - t));
    }
    c.chd.resize(3 * c.nl);
    c.base.resize(c.nl);
    c.ixs.resize(3 * c.nl);
    for (uint32_t l = 0; l < c.nl; ++l) {
        const double t = double(l) / double(c.nl - 1);
        c.base[l] = float(0.09 + 0.05 * t);
        for (int ch = 0; ch < 3; ++ch) {
            c.chd[3 * l + ch] = float((0.55 + 0.15 * ch) * (0.75 + 0.5 * std::sin(3.1 * t + ch)));
            c.ixs[3 * l + ch] = float((0.9 - 0.2 * ch) * std::exp(-3.0 * (t - 0.32 - 0.2 * ch) *
                                                                   (t - 0.32 - 0.2 * ch)));
        }
    }
    // print gain / inverse mid-grey reference, print offset, knees and rooms.
    c.p = {0.95f, 1.0f, 1.06f, 1.55f, 1.55f, 1.55f, 0.010f, 0.015f, 0.020f,
           -0.55f, 2.2f, 1.0f, 0.55f, 2.0f, 1.0f, 6.0f};
    return c;
}

std::vector<float> run_reduce(Gpu* gpu, const Case& c, std::string& e) {
    auto cmy = gpu->upload(c.cmy.data(), c.cmy.size() * 4, e);
    auto chd = gpu->upload(c.chd.data(), c.chd.size() * 4, e);
    auto base = gpu->upload(c.base.data(), c.base.size() * 4, e);
    auto ixs = gpu->upload(c.ixs.data(), c.ixs.size() * 4, e);
    auto params = gpu->upload(c.p.data(), c.p.size() * 4, e);
    auto grid = gpu->alloc(size_t(c.gw) * c.gh * 4, e);
    check(cmy && chd && base && ixs && params && grid, e);
    const uint32_t meta[5] = {c.W, c.H, c.gw, c.gh, c.nl};
    check(gpu->dispatch("spk_mask_reduce",
                        {Arg::buf(cmy), Arg::buf(chd), Arg::buf(base), Arg::buf(ixs), Arg::buf(params),
                         Arg::inline_bytes(meta, 5), Arg::buf(grid)},
                        size_t(c.gw) * c.gh, e) &&
              gpu->flush(e), e);
    std::vector<float> values;
    check(read_test_buffer(gpu, grid, values, e), e);
    values.resize(size_t(c.gw) * c.gh);
    return values;
}

std::vector<float> run_epilogue(Gpu* gpu, const Case& c, const std::vector<double>& coef, uint32_t row0,
                                uint32_t rows, std::string& e) {
    const size_t pixels = size_t(c.W) * rows;
    std::vector<float> in(c.cmy.begin() + size_t(row0) * c.W * 3,
                          c.cmy.begin() + size_t(row0 + rows) * c.W * 3);
    auto input = gpu->upload(in.data(), in.size() * 4, e);
    auto chd = gpu->upload(c.chd.data(), c.chd.size() * 4, e);
    auto base = gpu->upload(c.base.data(), c.base.size() * 4, e);
    auto ixs = gpu->upload(c.ixs.data(), c.ixs.size() * 4, e);
    auto params = gpu->upload(c.p.data(), c.p.size() * 4, e);
    std::vector<float> coef_f(coef.size());
    for (size_t i = 0; i < coef.size(); ++i) coef_f[i] = float(coef[i]);
    auto coef_buf = gpu->upload(coef_f.data(), coef_f.size() * 4, e);
    auto out = gpu->alloc(pixels * 3 * 4, e);
    check(input && chd && base && ixs && params && coef_buf && out, e);
    const uint32_t meta[7] = {uint32_t(pixels), c.nl, c.W, c.H, row0, c.gw, c.gh};
    check(gpu->dispatch("spk_mask_epilogue",
                        {Arg::buf(input), Arg::buf(chd), Arg::buf(base), Arg::buf(ixs), Arg::buf(params),
                         Arg::buf(coef_buf), Arg::inline_bytes(meta, 7), Arg::buf(out)},
                        pixels, e) &&
              gpu->flush(e), e);
    std::vector<float> values;
    check(read_test_buffer(gpu, out, values, e), e);
    values.resize(pixels * 3);
    return values;
}

void kernel_tests(const char* resources) {
    std::string e;
    std::unique_ptr<Gpu> gpu(Gpu::create_vulkan(std::string(resources) + "/vulkan", e));
    check(bool(gpu), e);
    check(gpu->check_math_mode(e), e);
    for (const auto shape : {std::array<uint32_t, 2>{137, 79}, std::array<uint32_t, 2>{79, 137}}) {
        const auto c = make_case(shape[0], shape[1], 23, 13);
        const auto grid = run_reduce(gpu.get(), c, e);
        const auto want_grid = oracle_reduce(c);
        double max_grid = 0.0;
        for (size_t i = 0; i < want_grid.size(); ++i) {
            const double err = std::abs(double(grid[i]) - want_grid[i]);
            max_grid = std::max(max_grid, err);
            check(err <= 2e-5, "mask analysis differs from the double oracle at cell " +
                                   std::to_string(i) + ": " + std::to_string(grid[i]) + " vs " +
                                   std::to_string(want_grid[i]));
        }
        // The mask's own base is a Gaussian of this grid; for the kernel test
        // use the grid itself as the coefficients (a = 1, b = 0 would make the
        // epilogue a no-op and test nothing). This exercises the bilinear
        // sample, the knee arithmetic and the gain on the image exposure.
        std::vector<double> coef(2 * want_grid.size());
        for (size_t i = 0; i < want_grid.size(); ++i) {
            coef[2 * i] = 0.85 + 0.03 * std::sin(double(i));
            coef[2 * i + 1] = 0.02 * std::cos(double(i) * 0.7);
        }
        const auto whole = run_epilogue(gpu.get(), c, coef, 0, c.H, e);
        const auto want_whole = oracle_epilogue(c, coef, 0, c.H);
        double max_pixel = 0.0;
        for (size_t i = 0; i < want_whole.size(); ++i) {
            require_close(double(whole[i]), want_whole[i], 3e-5, "mask epilogue pixel " + std::to_string(i));
            max_pixel = std::max(max_pixel, std::abs(double(whole[i]) - want_whole[i]));
        }
        // The striped executor hands the epilogue a band and the frame's
        // own frame_w/frame_h plus row0: the result must be identical to the
        // whole-frame dispatch row for row.
        const uint32_t row0 = 11, rows = 29;
        const auto band = run_epilogue(gpu.get(), c, coef, row0, rows, e);
        for (uint32_t y = 0; y < rows; ++y)
            for (uint32_t x = 0; x < c.W; ++x)
                for (int ch = 0; ch < 3; ++ch)
                    check(band[3 * (size_t(y) * c.W + x) + ch] ==
                              whole[3 * (size_t(y + row0) * c.W + x) + ch],
                          "mask epilogue band differs from whole frame at row " + std::to_string(y) +
                              " x " + std::to_string(x));
        // Branches off is an exact bypass: delta == 0 everywhere, so the
        // output is log10(image exposure + print offset).
        auto off = c;
        off.p[11] = 0.0f;
        off.p[14] = 0.0f;
        const auto bypass = run_epilogue(gpu.get(), off, coef, 0, off.H, e);
        const auto want_bypass = oracle_epilogue(off, coef, 0, off.H);
        for (size_t i = 0; i < want_bypass.size(); ++i)
            require_close(double(bypass[i]), want_bypass[i], 3e-5, "mask epilogue bypass pixel " + std::to_string(i));
        std::printf("contrast mask kernels: %ux%u grid %ux%u, max grid err %.3g, max pixel err %.3g\n",
                    c.W, c.H, c.gw, c.gh, max_grid, max_pixel);
    }
}

void api_tests(const char* resources) {
    std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)> engine(
        spk_engine_create(resources, nullptr), spk_engine_destroy);
    check(bool(engine), std::string("engine: ") + spk_last_error(nullptr));
    const char* caps = spk_capabilities(engine.get());
    check(caps && std::string(caps).find("contrast_mask") == std::string::npos,
          "capabilities still hide the ported contrast mask");
    const uint32_t w = 67, h = 131;
    std::vector<float> input(size_t(w) * h * 3);
    for (uint32_t y = 0; y < h; ++y)
        for (uint32_t x = 0; x < w; ++x)
            for (uint32_t c = 0; c < 3; ++c)
                input[(size_t(y) * w + x) * 3 + c] =
                    float(0.18 * std::exp2(-7.0 + 13.0 * x / (w - 1)) * (1.0 - 0.12 * c));
    spk_image image{input.data(), w, h, 3};
    const char* quiet =
        R"({"grain_active":false,"glare_active":false,"halation_active":false,)"
        R"("dir_couplers_active":false,"auto_exposure":false,"input_cctf_decoding":false})";
    std::unique_ptr<spk_session, decltype(&spk_session_release)> session(
        spk_open(engine.get(), &image, quiet, nullptr), spk_session_release);
    check(bool(session), std::string("open: ") + spk_last_error(engine.get()));
    auto set = [&](const char* delta) {
        const auto status = spk_set_params(session.get(), delta, nullptr);
        check(status == SPK_OK, std::string("set failed: ") + spk_last_error(engine.get()));
    };
    auto render = [&]() {
        spk_result r{};
        const auto status = spk_render(session.get(), "full", &r);
        if (status != SPK_OK) {
            spk_result_free(&r);
            throw std::runtime_error(std::string("render: ") + spk_last_error(engine.get()));
        }
        check(r.rgba16 && r.width == w && r.height == h, "render changed dimensions");
        std::vector<uint16_t> pixels(r.rgba16, r.rgba16 + size_t(w) * h * 4);
        spk_result_free(&r);
        return pixels;
    };
    const auto baseline = render();

    // Active with both branches off must be an exact bypass (the mask is not
    // wanted, so the pipeline does not even add its node).
    set(R"({"contrast_mask_active":true,"contrast_mask_highlights":0,"contrast_mask_shadows":0})");
    check(render() == baseline, "active mask with both branches off is not an exact bypass");

    // A real mask changes the print and the analysis returns a finite field
    // with at least one non-zero cell.
    set(R"({"contrast_mask_highlights":1.0,"contrast_mask_shadows":1.0,"contrast_mask_scale":0.02})");
    const auto masked = render();
    check(masked != baseline, "enabled mask did not change the print");
    size_t changed = 0;
    for (size_t i = 0; i < masked.size(); i += 4)
        if (masked[i] != baseline[i] || masked[i + 1] != baseline[i + 1] || masked[i + 2] != baseline[i + 2])
            ++changed;
    check(changed > (size_t(w) * h) / 100, "mask changed fewer than 1% of pixels");
    const float* field = nullptr;
    uint32_t gw = 0, gh = 0;
    check(spk_contrast_mask_field(session.get(), "full", &field, &gw, &gh) == SPK_OK && field && gw && gh,
          "enabled mask must have a non-empty field: " + std::string(spk_last_error(engine.get())));
    size_t nonzero = 0;
    double max_abs = 0.0;
    for (size_t i = 0; i < size_t(gw) * gh; ++i) {
        check(std::isfinite(field[i]), "mask field holds a non-finite delta");
        nonzero += field[i] != 0.0f ? 1 : 0;
        max_abs = std::max(max_abs, std::abs(double(field[i])));
    }
    check(nonzero > 0, "mask field is all zeros");
    check(max_abs <= 6.0 + 1e-6, "mask delta exceeds the gain bound: " + std::to_string(max_abs));

    // Turning it off restores the baseline bit for bit (the negative and the
    // print caches are invalidated by a print-layer change, so this also
    // checks the rebuild path).
    set(R"({"contrast_mask_active":false})");
    check(render() == baseline, "turning the mask off did not restore the baseline");
    char* state = nullptr;
    check(spk_get_params(session.get(), &state) == SPK_OK, "cannot read params");
    spk_string_free(state);

    // Open with the mask already on is accepted too.
    std::unique_ptr<spk_session, decltype(&spk_session_release)> opened(
        spk_open(engine.get(), &image,
                 R"({"contrast_mask_active":true,"contrast_mask_highlights":1,"contrast_mask_shadows":1})",
                 nullptr),
        spk_session_release);
    check(bool(opened), std::string("open refused a supported mask: ") + spk_last_error(engine.get()));
    std::puts("Contrast mask C API passed: exact bypass, real effect, bounded field, clean restore");
}

}  // namespace

int main(int argc, char** argv) {
    try {
        check(argc == 2 || argc == 3, "usage: spk_vulkan_mask resources_dir [--api]");
        if (argc == 3) {
            check(std::strcmp(argv[2], "--api") == 0, "unknown test mode");
            api_tests(argv[1]);
            return 0;
        }
        kernel_tests(argv[1]);
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
