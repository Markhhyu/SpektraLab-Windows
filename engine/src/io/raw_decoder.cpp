#include "raw_decoder.hpp"
#include "raw_headroom.hpp"
#include "raw_camera.hpp"

#include <libraw/libraw.h>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <limits>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <thread>
#include <utility>

namespace spk::io {

#if SPEKTRALAB_RAW_OPENMP && !defined(LIBRAW_USE_OPENMP)
#error "RAW OpenMP requested but LibRaw parallel processing is disabled"
#endif

bool raw_openmp_enabled() noexcept {
#if SPEKTRALAB_RAW_OPENMP
    return true;
#else
    return false;
#endif
}

unsigned raw_worker_limit() {
    const unsigned available = std::max(1u, std::thread::hardware_concurrency());
    unsigned requested = std::min(8u, available);
    if (const char* value = std::getenv("SPEKTRALAB_RAW_THREADS")) {
        const char* end = value + std::strlen(value);
        const auto parsed = std::from_chars(value, end, requested);
        if (parsed.ec != std::errc{} || parsed.ptr != end || requested == 0)
            throw std::invalid_argument("SPEKTRALAB_RAW_THREADS must be a positive integer");
    }
    return raw_openmp_enabled() ? std::min(requested, available) : 1u;
}

RawDecodeThreadScope::RawDecodeThreadScope() : workers_(raw_worker_limit()) {
#if SPEKTRALAB_RAW_OPENMP
    previous_threads_ = omp_get_max_threads();
    previous_dynamic_ = omp_get_dynamic();
#if _OPENMP >= 200805
    previous_levels_ = omp_get_max_active_levels();
    omp_set_max_active_levels(1);
#else
    previous_levels_ = omp_get_nested();
    omp_set_nested(0);
#endif
    omp_set_dynamic(0);
    omp_set_num_threads(static_cast<int>(workers_));
#endif
}

RawDecodeThreadScope::~RawDecodeThreadScope() {
#if SPEKTRALAB_RAW_OPENMP
    omp_set_num_threads(previous_threads_);
#if _OPENMP >= 200805
    omp_set_max_active_levels(previous_levels_);
#else
    omp_set_nested(previous_levels_);
#endif
    omp_set_dynamic(previous_dynamic_);
#endif
}

namespace {

using Clock = std::chrono::steady_clock;

double elapsed_ms(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

bool libraw_ok(int status, const char* stage, std::string& error) {
    if (status == LIBRAW_SUCCESS) return true;
    error = std::string(stage) + ": " + LibRaw::strerror(status) +
            " (" + std::to_string(status) + ")";
    return false;
}

bool supported_compression(LibRaw& raw, std::string& error) {
    const char* decoder = raw.unpack_function_name();
    if (decoder && std::strstr(decoder, "nikon_he_load_raw") != nullptr) {
        const auto& model = raw.imgdata.idata.model;
        error = "RAW unpack (" +
            std::string(std::begin(model), std::find(std::begin(model), std::end(model), '\0')) +
            "): Nikon HE/HE* compression is not supported by bundled LibRaw " +
            LibRaw::version() +
            "; use a lossless-compressed NEF or externally converted RAW DNG";
        return false;
    }
    return true;
}


void configure_compatible(libraw_output_params_t& params, bool half_size = false) {
    params.user_qual = 3;  // AHD (LibRaw still selects its native X-Trans path).
    params.half_size = half_size ? 1 : 0;
    params.four_color_rgb = 0;
    params.output_color = 4;
    params.output_bps = 16;
    params.gamm[0] = params.gamm[1] = 1.0;
    params.no_auto_bright = 1;
    params.no_auto_scale = 0;
    params.adjust_maximum_thr = 0.0f;
    params.bright = 1.0f;
    params.use_camera_wb = 1;
    params.use_auto_wb = 0;
    params.use_camera_matrix = 1;
    std::fill(std::begin(params.user_mul), std::end(params.user_mul), 0.0f);
    params.user_black = -1;
    std::fill(std::begin(params.user_cblack), std::end(params.user_cblack), -1000001);
    params.user_sat = -1;
    params.user_flip = -1;
    params.highlight = 0;
    params.exp_correc = 0;
    params.exp_shift = 1.0f;
    params.exp_preser = 0.0f;
    params.threshold = 0.0f;
    params.med_passes = 0;
    params.fbdd_noiserd = 0;
    params.dcb_iterations = 0;
    params.dcb_enhance_fl = 0;
    params.no_interpolation = 0;
    params.output_profile = nullptr;
    params.camera_profile = nullptr;
}

bool capture_source_metadata(const LibRaw& raw, RawMetadata& metadata,
                             std::string& error) {
    const auto& data = raw.imgdata;
    // raw2image_start() restores this saved copy before postprocessing; rawpy
    // reads its source WB and white-level metadata from the same structure.
    const auto& color = data.rawdata.color;
    const auto& sizes = data.sizes;
    for (unsigned c = 0; c < 4; ++c) {
        const float wb = color.cam_mul[c];
        // LibRaw falls back to auto WB when red <= 1e-5, even if the value
        // is positive. Do not report that fallback as camera/as-shot WB.
        if (!std::isfinite(wb) || (c < 3 && wb <= 0.00001f)) {
            error = "RAW metadata: valid camera/as-shot RGB white balance is required";
            return false;
        }
        metadata.camera_whitebalance[c] = wb;
        const std::uint64_t black = std::uint64_t(color.black) + color.cblack[c];
        if (black > std::numeric_limits<std::uint32_t>::max()) {
            error = "RAW metadata: black level overflow";
            return false;
        }
        metadata.black_level_per_channel[c] = static_cast<std::uint32_t>(black);
        metadata.camera_white_level_per_channel[c] = color.linear_max[c];
    }
    metadata.libraw_version = LibRaw::version();
    metadata.libraw_capabilities = LibRaw::capabilities();
    metadata.make.assign(data.idata.make,
                         std::find(std::begin(data.idata.make), std::end(data.idata.make), '\0'));
    metadata.model.assign(data.idata.model,
                          std::find(std::begin(data.idata.model), std::end(data.idata.model), '\0'));
    metadata.sizes_before_postprocess = {
        sizes.raw_width, sizes.raw_height, sizes.width, sizes.height,
        sizes.iwidth, sizes.iheight, sizes.top_margin, sizes.left_margin,
        sizes.pixel_aspect};
    metadata.raw_flip = sizes.flip;
    metadata.colour_channels = data.idata.colors;
    for (unsigned row = 0; row < 3; ++row)
        for (unsigned col = 0; col < 3; ++col)
            metadata.camera_from_xyz[row * 3 + col] = color.cam_xyz[row][col];
    metadata.as_shot_wb_applied = color.as_shot_wb_applied != 0;
    metadata.black = color.black;
    metadata.white_level = color.maximum;
    metadata.black_pattern_rows = color.cblack[4];
    metadata.black_pattern_cols = color.cblack[5];
    const std::uint64_t pattern_size =
        std::uint64_t(color.cblack[4]) * color.cblack[5];
    constexpr std::size_t pattern_capacity = sizeof(color.cblack) / sizeof(color.cblack[0]) - 6;
    if (pattern_size > pattern_capacity) {
        error = "RAW metadata: repeated black-level pattern exceeds storage";
        return false;
    }
    metadata.black_pattern.assign(color.cblack + 6,
                                  color.cblack + 6 + static_cast<std::size_t>(pattern_size));
    return true;
}

bool supported_headroom_source(LibRaw& raw, std::string& error) {
    const auto& data = raw.imgdata;
    if (data.idata.colors != 3 || data.idata.filters <= 1000 ||
        data.idata.is_foveon || raw.is_floating_point() ||
        raw.is_sraw() || raw.is_nikon_sraw() ||
        data.rawdata.color.as_shot_wb_applied ||
        raw.is_fuji_rotated() || data.sizes.pixel_aspect != 1.0 ||
        data.idata.cdesc[0] != 'R' || data.idata.cdesc[1] != 'G' ||
        data.idata.cdesc[2] != 'B') {
        error = "RAW headroom: only conventional three-colour Bayer RAW with unapplied "
                "as-shot WB and square pixels is supported; use compatible16 for this source";
        return false;
    }
    unsigned counts[3] = {};
    for (int row = 0; row < 8; ++row) {
        for (int col = 0; col < 2; ++col) {
            const int c = raw.FC(row, col);
            if (c != raw.FC(row % 2, col)) {
                error = "RAW headroom: a nonstandard Bayer pattern is unsupported";
                return false;
            }
            if (row < 2) ++counts[c == 3 ? 1 : c];
        }
    }
    // Two greens must occupy opposite corners, as in the four Bayer layouts.
    const auto channel = [&raw](int row, int col) {
        const int c = raw.FC(row, col);
        return c == 3 ? 1 : c;
    };
    if (counts[0] != 1 || counts[1] != 2 || counts[2] != 1 ||
        (channel(0, 0) == 1) != (channel(1, 1) == 1)) {
        error = "RAW headroom: a nonstandard Bayer pattern is unsupported";
        return false;
    }
    return true;
}

// Work in unpacked sensor codes before white balance, demosaicing or RGB
// conversion can clip independently. Single-channel clipping retains colour
// information, so it does not justify extrapolating every channel.
void collect_clipped_pixels(LibRaw& raw, DecodedRaw& decoded, bool half_size) {
    const auto& data = raw.imgdata;
    const auto& s = data.sizes;
    std::string reason;
    if (!data.rawdata.raw_image || !supported_headroom_source(raw, reason) ||
        s.flip < 0 || s.flip > 7 || s.raw_pitch % sizeof(uint16_t) != 0 ||
        s.left_margin + s.width > s.raw_width || s.top_margin + s.height > s.raw_height ||
        s.raw_pitch < size_t(s.raw_width) * sizeof(uint16_t)) return;
    const auto& meta = decoded.metadata;
    const unsigned stride = s.raw_pitch / sizeof(uint16_t);
    const unsigned w = half_size ? (s.width + 1u) / 2 : s.width;
    const unsigned h = half_size ? (s.height + 1u) / 2 : s.height;
    decoded.width = (s.flip & 4) ? h : w;
    decoded.height = (s.flip & 4) ? w : h;
    uint32_t white[4];
    for (int dy = 0; dy < 2; ++dy) for (int dx = 0; dx < 2; ++dx) {
        const int c = raw.FC(dy, dx);
        uint32_t level = meta.camera_white_level_per_channel[c];
        if (!level && c == 3) level = meta.camera_white_level_per_channel[1];
        if (!level) level = meta.white_level;
        if (level <= meta.black_level_per_channel[c] || level > 65535) return;
        white[2*dy+dx] = level;
    }
    auto mark = [&](unsigned x, unsigned y) {
        if (s.flip & 1) x = w-1-x;
        if (s.flip & 2) y = h-1-y;
        if (s.flip & 4) std::swap(x, y);
        const size_t i = size_t(y) * decoded.width + x;
        decoded.clipped_pixels[i/32] |= uint32_t(1) << (i%32);
    };
    for (unsigned y = 0; y+1 < s.height; y += 2) {
        const auto* row = data.rawdata.raw_image + size_t(y+s.top_margin)*stride + s.left_margin;
        for (unsigned x = 0; x+1 < s.width; x += 2) {
            if (row[x] < white[0] || row[x+1] < white[1] ||
                row[stride+x] < white[2] || row[stride+x+1] < white[3]) continue;
            if (decoded.clipped_pixels.empty()) decoded.clipped_pixels.resize((size_t(w)*h+31)/32);
            if (half_size) mark(x/2, y/2);
            else { mark(x,y); mark(x+1,y); mark(x,y+1); mark(x+1,y+1); }
        }
    }
}

class CompatibleLibRaw final : public detail::CameraLibRaw {
public:
    CompatibleLibRaw() = default;
    std::array<float, 12> matrix{};
    bool calibrated = false;
protected:
    void convert_to_rgb_loop(float out_cam[3][4]) override {
        calibrated = !libraw_internal_data.internal_output_params.raw_color && imgdata.idata.colors == 3 && imgdata.image;
        if (!calibrated) return;
        if (!libraw_internal_data.internal_output_params.raw_color && imgdata.idata.colors == 3)
            for (unsigned row = 0; row < 3; ++row)
                for (unsigned col = 0; col < 4; ++col)
                    matrix[row * 4 + col] = out_cam[row][col];
        // Observe the boundary without changing LibRaw's conversion or pixels.
        LibRaw::convert_to_rgb_loop(out_cam);
    }
};

class HeadroomLibRaw final : public detail::CameraLibRaw {
public:
    HeadroomLibRaw() = default;

    std::vector<float> converted;
    std::uint32_t converted_width = 0, converted_height = 0;
    std::array<float, 12> matrix{};
    double exposure_restore = 1.0;
    double conversion_ms = 0.0;
    bool conversion_finished = false;
    std::string conversion_error;

protected:
    void convert_to_rgb_loop(float out_cam[3][4]) override {
        const auto start = Clock::now();
        if (libraw_internal_data.internal_output_params.raw_color ||
            imgdata.idata.colors != 3 || !imgdata.image) {
            conversion_error = "RAW headroom: no supported three-channel camera-to-ProPhoto transform";
            return;
        }
        std::array<float, 4> applied_wb{};
        std::copy(std::begin(imgdata.color.pre_mul), std::end(imgdata.color.pre_mul),
                  applied_wb.begin());
        if (!detail::headroom_exposure_restore(applied_wb, exposure_restore, conversion_error))
            return;
        for (unsigned row = 0; row < 3; ++row)
            for (unsigned col = 0; col < 4; ++col)
                matrix[row * 4 + col] = out_cam[row][col];
        const auto& sizes = imgdata.sizes;
        conversion_finished = detail::convert_camera_rgb_headroom(
            imgdata.image[0], std::size_t(sizes.width) * sizes.height,
            sizes.width, sizes.height, sizes.flip, matrix, exposure_restore,
            converted, converted_width, converted_height, conversion_error);
        conversion_ms = elapsed_ms(start);
        // dcraw_process may continue its bookkeeping; no clipped uint16 output
        // is subsequently used, and the supported square-pixel Bayer inputs
        // require no post-conversion geometric resampling.
    }
};

}  // namespace

bool decode_raw_compatible(const std::filesystem::path& source,
                           DecodedRaw& out, std::string& error, bool half_size) {
    return decode_raw_compatible(source, nullptr, out, error, half_size);
}

bool decode_raw_compatible(const std::filesystem::path& source, const std::array<float, 4>* user_mul,
                           DecodedRaw& out, std::string& error, bool half_size) {
    error.clear();
    const auto total_start = Clock::now();
    try {
        RawDecodeThreadScope thread_scope;
        if (source.empty()) {
            error = "RAW open: source path is empty";
            return false;
        }
        // LibRaw carries substantial metadata; keep it off the Windows stack.
        auto raw = std::make_unique<CompatibleLibRaw>();
        configure_compatible(raw->imgdata.params, half_size);
        if (user_mul) {
            // A caller-chosen white balance (the host's Temperature/Tint):
            // LibRaw's own user multipliers replace the as-shot ones, through
            // the same scale_colors() step.
            for (unsigned c = 0; c < 4; ++c) {
                if (!std::isfinite((*user_mul)[c]) || (*user_mul)[c] <= 0.0f) {
                    error = "RAW process: invalid user white-balance multiplier";
                    return false;
                }
                raw->imgdata.params.user_mul[c] = (*user_mul)[c];
            }
            raw->imgdata.params.use_camera_wb = 0;
        }
        DecodedRaw decoded;
        decoded.timings.openmp_enabled = raw_openmp_enabled();
        decoded.timings.workers = thread_scope.workers();
        auto start = Clock::now();
        // filesystem::path::value_type is wchar_t on Windows, selecting
        // LibRaw's Unicode filename overload without an ANSI conversion.
        const int open_status = raw->open_file(source.c_str());
        decoded.timings.open_ms = elapsed_ms(start);
        if (!libraw_ok(open_status, "RAW open", error)) return false;
        if (!supported_compression(*raw, error)) return false;

        start = Clock::now();
        const int unpack_status = raw->unpack();
        decoded.timings.unpack_ms = elapsed_ms(start);
        if (!libraw_ok(unpack_status, "RAW unpack", error)) return false;
        if (raw->error_count() != 0) {
            error = "RAW unpack: decoder reported corrupt data";
            return false;
        }
        if (!capture_source_metadata(*raw, decoded.metadata, error)) return false;
        collect_clipped_pixels(*raw, decoded, half_size);
        if (const char* name = raw->unpack_function_name()) decoded.metadata.decoder_name = name;

        start = Clock::now();
        const int process_status = raw->dcraw_process();
        decoded.timings.process_ms = elapsed_ms(start);
        if (!libraw_ok(process_status, "RAW process", error)) return false;
        if (!raw->calibrated) {
            error = "RAW compatible16: no supported three-channel camera-to-ProPhoto transform";
            return false;
        }
        if (raw->error_count() != 0) {
            error = "RAW process: decoder reported corrupt data";
            return false;
        }
        const auto& color = raw->imgdata.color;
        decoded.metadata.process_warnings = raw->imgdata.process_warnings;
        if (!user_mul && (decoded.metadata.process_warnings & LIBRAW_WARN_BAD_CAMERA_WB)) {
            error = "RAW process: LibRaw rejected camera/as-shot white balance";
            return false;
        }
        std::copy(std::begin(color.pre_mul), std::end(color.pre_mul),
                  decoded.metadata.post_scale_pre_mul.begin());
        for (unsigned c = 0; c < 4; ++c) {
            if (!std::isfinite(color.pre_mul[c]) || color.pre_mul[c] <= 0.0f) {
                error = "RAW process: invalid applied white-balance multiplier";
                return false;
            }
        }
        for (unsigned row = 0; row < 3; ++row)
            for (unsigned col = 0; col < 4; ++col)
                decoded.metadata.rgb_cam[row * 4 + col] = color.rgb_cam[row][col];
        decoded.metadata.postprocess_black = color.black;
        decoded.metadata.postprocess_maximum = color.maximum;
        decoded.metadata.camera_to_output = raw->matrix;

        // This also performs LibRaw's final orientation and identity gamma
        // lookup. Reading imgdata.image directly would omit those semantics.
        start = Clock::now();
        int image_status = LIBRAW_SUCCESS;
        using ImagePtr = std::unique_ptr<libraw_processed_image_t,
                                         decltype(&LibRaw::dcraw_clear_mem)>;
        ImagePtr image(raw->dcraw_make_mem_image(&image_status), &LibRaw::dcraw_clear_mem);
        if (!libraw_ok(image_status, "RAW output", error)) return false;
        if (!image || image->type != LIBRAW_IMAGE_BITMAP || image->bits != 16 ||
            image->colors != 3 || image->width == 0 || image->height == 0) {
            error = "RAW output: expected a non-empty 16-bit three-channel bitmap";
            return false;
        }
        const std::uint64_t samples = std::uint64_t(image->width) * image->height * 3;
        const double make_mem_ms = elapsed_ms(start);
        if (samples > std::numeric_limits<std::size_t>::max() / sizeof(float) ||
            samples * sizeof(std::uint16_t) != image->data_size) {
            error = "RAW output: inconsistent image byte count or unsupported dimensions";
            return false;
        }
        if (decoded.width != image->width || decoded.height != image->height)
            decoded.clipped_pixels.clear();
        decoded.width = image->width;
        decoded.height = image->height;
        // The oriented RGB16 output owns its allocation independently of
        // LibRaw, and all source metadata has been captured above. Release
        // LibRaw's sensor and four-channel image before allocating float RGB
        // so those full-size buffers do not overlap unnecessarily.
        raw.reset();
        decoded.rgb.resize(static_cast<std::size_t>(samples));
        // 99 M scalar samples at 32.95 MP: this copy is the one decode stage
        // that is pure elementwise work, and it is the stage that fits the
        // frame's OpenMP scope (P1-10). Each element keeps the exact double
        // division it had serially, so the converted values are unchanged.
        const auto* source_bytes = image->data;
        auto convert_range = [&](std::size_t begin, std::size_t end) {
            for (std::size_t i = begin; i < end; ++i) {
                std::uint16_t value;
                // LibRaw returns native-endian 16-bit samples. memcpy avoids
                // imposing alignment or aliasing assumptions on its byte array.
                std::memcpy(&value, source_bytes + i * sizeof(value), sizeof(value));
                decoded.rgb[i] = static_cast<float>(static_cast<double>(value) / 65535.0);
            }
        };
#if SPEKTRALAB_RAW_OPENMP
        const std::size_t chunk = 1u << 16;
        const std::size_t chunks = (decoded.rgb.size() + chunk - 1) / chunk;
#pragma omp parallel for schedule(static) num_threads(thread_scope.workers())
        for (std::int64_t job = 0; job < static_cast<std::int64_t>(chunks); ++job) {
            const std::size_t begin = static_cast<std::size_t>(job) * chunk;
            const std::size_t end = std::min(begin + chunk, decoded.rgb.size());
            convert_range(begin, end);
        }
#else
        convert_range(0, decoded.rgb.size());
#endif
        decoded.timings.convert_ms = elapsed_ms(start);
        if (std::getenv("SPEKTRAFILM_DECODE_TIMINGS")) {
            std::fprintf(stderr, "{\"decode_stage\":\"make_mem\",\"ms\":%.1f}\n"
                                 "{\"decode_stage\":\"pack_float\",\"ms\":%.1f}\n",
                         make_mem_ms, elapsed_ms(start) - make_mem_ms);
        }
        decoded.timings.total_ms = elapsed_ms(total_start);
        out = std::move(decoded);
        return true;
    } catch (const std::exception& exception) {
        error = std::string("RAW decode: ") + exception.what();
        return false;
    } catch (...) {
        error = "RAW decode: unknown decoder exception";
        return false;
    }
}

bool decode_raw_headroom(const std::filesystem::path& source,
                         DecodedRaw& out, std::string& error, bool half_size) {
    return decode_raw_headroom(source, nullptr, out, error, half_size);
}

bool decode_raw_headroom(const std::filesystem::path& source, const std::array<float, 4>* user_mul,
                         DecodedRaw& out, std::string& error, bool half_size) {
    error.clear();
    const auto total_start = Clock::now();
    try {
        RawDecodeThreadScope thread_scope;
        if (source.empty()) {
            error = "RAW open: source path is empty";
            return false;
        }
        auto raw = std::make_unique<HeadroomLibRaw>();
        configure_compatible(raw->imgdata.params, half_size);
        if (user_mul) {
            for (unsigned c = 0; c < 4; ++c) {
                if (!std::isfinite((*user_mul)[c]) || (*user_mul)[c] <= 0.0f) {
                    error = "RAW process: invalid user white-balance multiplier";
                    return false;
                }
                raw->imgdata.params.user_mul[c] = (*user_mul)[c];
            }
            raw->imgdata.params.use_camera_wb = 0;
        }
        // LibRaw's Ignore mode prevents WB multipliers above one, but does not
        // reconstruct sensor saturation and still uses uint16 intermediates.
        raw->imgdata.params.highlight = 1;
        DecodedRaw decoded;
        decoded.timings.openmp_enabled = raw_openmp_enabled();
        decoded.timings.workers = thread_scope.workers();
        auto start = Clock::now();
        const int open_status = raw->open_file(source.c_str());
        decoded.timings.open_ms = elapsed_ms(start);
        if (!libraw_ok(open_status, "RAW open", error)) return false;
        if (!supported_compression(*raw, error)) return false;

        start = Clock::now();
        const int unpack_status = raw->unpack();
        decoded.timings.unpack_ms = elapsed_ms(start);
        if (!libraw_ok(unpack_status, "RAW unpack", error)) return false;
        if (raw->error_count() != 0) {
            error = "RAW unpack: decoder reported corrupt data";
            return false;
        }
        if (!capture_source_metadata(*raw, decoded.metadata, error) ||
            !supported_headroom_source(*raw, error)) return false;
        collect_clipped_pixels(*raw, decoded, half_size);
        if (const char* name = raw->unpack_function_name()) decoded.metadata.decoder_name = name;

        start = Clock::now();
        const int process_status = raw->dcraw_process();
        const double process_and_conversion_ms = elapsed_ms(start);
        decoded.timings.process_ms = std::max(0.0, process_and_conversion_ms - raw->conversion_ms);
        decoded.timings.convert_ms = raw->conversion_ms;
        if (!libraw_ok(process_status, "RAW process", error)) return false;
        if (raw->error_count() != 0) {
            error = "RAW process: decoder reported corrupt data";
            return false;
        }
        decoded.metadata.process_warnings = raw->imgdata.process_warnings;
        if (!user_mul && (decoded.metadata.process_warnings & LIBRAW_WARN_BAD_CAMERA_WB)) {
            error = "RAW process: LibRaw rejected camera/as-shot white balance";
            return false;
        }
        if (!raw->conversion_finished) {
            error = raw->conversion_error.empty()
                ? "RAW headroom: float colour conversion did not run" : raw->conversion_error;
            return false;
        }
        const auto& color = raw->imgdata.color;
        std::copy(std::begin(color.pre_mul), std::end(color.pre_mul),
                  decoded.metadata.post_scale_pre_mul.begin());
        for (unsigned row = 0; row < 3; ++row)
            for (unsigned col = 0; col < 4; ++col)
                decoded.metadata.rgb_cam[row * 4 + col] = color.rgb_cam[row][col];
        decoded.metadata.postprocess_black = color.black;
        decoded.metadata.postprocess_maximum = color.maximum;
        decoded.metadata.headroom_enabled = true;
        decoded.metadata.white_balance_exposure_restore = raw->exposure_restore;
        decoded.metadata.camera_to_output = raw->matrix;
        if (decoded.width != raw->converted_width || decoded.height != raw->converted_height)
            decoded.clipped_pixels.clear();
        decoded.width = raw->converted_width;
        decoded.height = raw->converted_height;
        decoded.rgb = std::move(raw->converted);
        decoded.timings.total_ms = elapsed_ms(total_start);
        out = std::move(decoded);
        return true;
    } catch (const std::exception& exception) {
        error = std::string("RAW headroom decode: ") + exception.what();
        return false;
    } catch (...) {
        error = "RAW headroom decode: unknown decoder exception";
        return false;
    }
}

}  // namespace spk::io
