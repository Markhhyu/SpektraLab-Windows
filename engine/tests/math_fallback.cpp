// Vulkan fast-math fallback: P1-12 compatibility gate.
//
// The Windows backend accepts a device only after `spk_math_probe` shows that
// a fused multiply-add can be reproduced exactly. Devices/drivers that fold
// the product (or use GLSL.std.450 Fma loosely) fall back to the Dekker split
// product, which `spk_split_probe` then validates word-for-word. That path is
// normally only reached on hardware the maintainers do not own, so this test
// forces it with SPEKTRAFILM_VULKAN_FORCE_SPLIT=1 *before* engine creation and
// checks that (a) the engine still starts, (b) `capabilities.backend.math_mode`
// reports the split product rather than the fused one, and (c) a real render
// still produces pixels. It keeps the fallback from rotting on CI where no
// failing GPU is available.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "json.hpp"
#include "spektrafilm/spk_engine.h"

using namespace spk;

namespace {

void check(bool ok, const std::string& why) {
    if (!ok) throw std::runtime_error(why);
}

void set_env(const char* name, const char* value) {
#ifdef _WIN32
    _putenv_s(name, value);
#else
    setenv(name, value, 1);
#endif
}

using Engine = std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)>;
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;

Json parse(const char* text, const char* what) {
    Json out;
    std::string error;
    check(text != nullptr, std::string(what) + " returned null");
    const bool ok = Json::parse(text, out, error);
    check(ok, std::string(what) + " is not JSON: " + error);
    return out;
}

// spk_capabilities returns engine-owned JSON (valid until the next engine
// call): unlike the session/reply strings, it must not be freed.
Json parse_engine_owned(const char* text, const char* what) {
    return parse(text, what);
}

std::vector<float> gradient(uint32_t w, uint32_t h) {
    std::vector<float> pixels(size_t(w) * h * 3);
    for (uint32_t y = 0; y < h; ++y)
        for (uint32_t x = 0; x < w; ++x) {
            const size_t i = (size_t(y) * w + x) * 3;
            pixels[i + 0] = 0.02f + 0.90f * float(x) / float(w);
            pixels[i + 1] = 0.02f + 0.90f * float(y) / float(h);
            pixels[i + 2] = 0.02f + 0.90f * float(x + y) / float(w + h);
        }
    return pixels;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            std::fprintf(stderr, "usage: spk_math_fallback <resources>\n");
            return 2;
        }
        // Engine creation runs the probe, so the switch has to be in place
        // before spk_engine_create.
        set_env("SPEKTRAFILM_VULKAN_FORCE_SPLIT", "1");
        Engine engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), std::string("engine with forced split product: ") + spk_last_error(nullptr));

        const std::string caps_text(spk_capabilities(engine.get()));
        const Json caps = parse_engine_owned(caps_text.c_str(), "capabilities");
        const std::string math = caps.at("backend").at("math_mode").as_string();
        check(math.find("Dekker split product") != std::string::npos,
              "math_mode does not report the split-product fallback: " + math);
        check(math.find("forced split for validation") != std::string::npos,
              "math_mode does not name the forcing switch: " + math);
        check(math.find("fused fma") == std::string::npos,
              "math_mode still claims fused fma under the forced fallback: " + math);

        const uint32_t width = 384, height = 256;
        const std::vector<float> pixels = gradient(width, height);
        const spk_image image{pixels.data(), width, height, 3};
        const char* delta =
            R"({"grain_active":false,"halation_active":false,"glare_active":false,)"
            R"("auto_exposure":true,"auto_exposure_method":"balanced"})";
        Session session(spk_open(engine.get(), &image, delta, nullptr), spk_session_release);
        check(bool(session), spk_last_error(engine.get()));

        spk_result result{};
        const spk_status render_status = spk_render(session.get(), "live", &result);
        check(render_status == SPK_OK,
              std::string("live render on the fallback path: ") + spk_last_error(nullptr));
        check(result.width > 0 && result.height > 0, "render returned an empty frame");
        // The frame must not be a flat fill: the gradient has to survive the
        // whole film/print/scan chain, otherwise "the engine started" is all
        // this test would prove. The headless Vulkan result carries RGBA16.
        check(result.rgba16 != nullptr, "render returned no pixels");
        const uint32_t out_width = result.width, out_height = result.height;
        uint32_t minimum = 255, maximum = 0;
        for (uint32_t y = 0; y < out_height; ++y)
            for (uint32_t x = 0; x < out_width; ++x) {
                const uint8_t v = uint8_t(result.rgba16[size_t(y) * result.row_stride_px * 4 + size_t(x) * 4 + 1] >> 8);
                if (v < minimum) minimum = v;
                if (v > maximum) maximum = v;
            }
        check(maximum > minimum + 8,
              "the rendered frame is flat (" + std::to_string(minimum) + ".." + std::to_string(maximum) +
                  "): the fallback path did not run the film chain");
        spk_result_free(&result);

        std::printf("Vulkan math fallback passed: %s; render %ux%u, green %u..%u\n",
                    math.c_str(), out_width, out_height, minimum, maximum);
        return 0;
    } catch (const std::exception& e) {
        std::fprintf(stderr, "spk_math_fallback: %s\n", e.what());
        return 1;
    }
}
