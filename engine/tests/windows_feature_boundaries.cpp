// Exercise Windows feature refusals through the exported DLL boundary.
#include "spektrafilm/spk_engine.h"

#include <array>
#include <cstdint>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

std::string params(spk_session* session) {
    char* json = nullptr;
    require(spk_get_params(session, &json) == SPK_OK && json, "get_params failed");
    std::string result(json);
    spk_string_free(json);
    return result;
}

void render(spk_engine* engine, spk_session* session) {
    spk_result result{};
    const spk_status status = spk_render(session, "full", &result);
    const bool valid = status == SPK_OK && result.rgba16 && result.texture &&
                       result.width == 36 && result.height == 24;
    const std::string error = spk_last_error(engine);
    spk_result_free(&result);
    require(valid, "default render failed after a refused request: " + error);
}

// FNV-1a over the RGB halfwords, row by row with the result's own row pitch.
// Rendering through this covers the tier and the whole frame rather than a
// single node, so a stale print cache or an off-by-one dimension shows up.
uint64_t render_digest(spk_engine* engine, spk_session* session,
                       uint32_t* out_width = nullptr, uint32_t* out_height = nullptr) {
    spk_result result{};
    const spk_status status = spk_render(session, "full", &result);
    const std::string error = spk_last_error(engine);
    const bool valid = status == SPK_OK && result.rgba16 && result.texture;
    require(valid, "full render failed: " + error);
    uint64_t hash = 1469598103934665603ull;
    for (uint32_t row = 0; row < result.height; ++row) {
        const uint16_t* line = result.rgba16 + std::size_t(row) * result.row_stride_px;
        for (uint32_t col = 0; col < result.width; ++col) {
            for (int channel = 0; channel < 3; ++channel) {
                hash ^= line[std::size_t(col) * 4 + channel];
                hash *= 1099511628211ull;
            }
        }
    }
    if (out_width) *out_width = result.width;
    if (out_height) *out_height = result.height;
    spk_result_free(&result);
    return hash;
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2) { std::cerr << "usage: spk_windows_feature_boundaries resources_dir\n"; return 2; }
    try {
        std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)> engine(
            spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        require(bool(engine), std::string("engine creation failed: ") + spk_last_error(nullptr));
        const char* capabilities = spk_capabilities(engine.get());
        require(capabilities != nullptr, "Windows capabilities were null");
        // RFC-024's contrast mask is ported to the Vulkan backend, so the
        // backend must stop advertising it as unported. An absent key and an
        // empty array both mean "nothing hidden"; what is forbidden is naming
        // it.
        require(std::string(capabilities).find("contrast_mask") == std::string::npos,
                "Windows capabilities still hide the ported contrast mask");

        std::vector<float> pixels(36 * 24 * 3);
        // A deliberately wide range: the headroom effects (scene latitude,
        // overscan canvas masks) need real shadows and highlights to act on.
        for (size_t i = 0; i < pixels.size(); ++i) pixels[i] = 0.02f + float(i % 31) * 0.25f;
        const spk_image input{pixels.data(), 36, 24, 3};
        std::unique_ptr<spk_session, decltype(&spk_session_release)> session(
            spk_open(engine.get(), &input, nullptr, nullptr), spk_session_release);
        require(bool(session), std::string("default open failed: ") + spk_last_error(engine.get()));
        render(engine.get(), session.get());
        const std::string before = params(session.get());

        // The mask is now a supported effect: an explicit request applies
        // rather than being refused before mutation, and the analysis returns
        // a non-empty field.
        const std::string mask_delta =
            "{\"contrast_mask_active\":true,\"contrast_mask_highlights\":1.0,"
            "\"contrast_mask_shadows\":1.0,\"contrast_mask_scale\":0.02,"
            "\"print_exposure\":1.25}";
        require(spk_set_params(session.get(), mask_delta.c_str(), nullptr) == SPK_OK,
                std::string("contrast mask was refused: ") + spk_last_error(engine.get()));
        const std::string after = params(session.get());
        require(after != before, "contrast mask delta did not mutate params");
        require(after.find("\"print_exposure\":1.25") != std::string::npos,
                "contrast mask delta was only partially applied");
        render(engine.get(), session.get());

        {
            const float* mask = nullptr;
            uint32_t width = 0, height = 0;
            const spk_status status =
                spk_contrast_mask_field(session.get(), "full", &mask, &width, &height);
            const bool non_empty = mask && width > 0 && height > 0;
            require(status == SPK_OK && non_empty,
                    "enabled contrast mask must have a non-empty field");
        }

        // Opening a session with the mask already on must be accepted too --
        // the refusal path had two doors and both were checked.
        {
            spk_session* opened = spk_open(engine.get(), &input, mask_delta.c_str(), nullptr);
            require(opened != nullptr,
                    std::string("open refused a supported contrast mask: ") + spk_last_error(engine.get()));
            spk_session_release(opened);
        }
        require(spk_set_params(session.get(),
                               "{\"contrast_mask_active\":false,\"print_exposure\":1.0}",
                               nullptr) == SPK_OK,
                "could not disable the contrast mask");

        // The mask block above changed the params on purpose; the DI and
        // latitude calls are checked against the state they open with.
        const std::string before_di = params(session.get());

        spk_result di{};
        char* di_json = nullptr;
        const spk_status di_status = spk_render_digital_intermediate(session.get(), &di, &di_json);
        const std::string di_error = spk_last_error(engine.get());
        const bool valid_di = di.texture && di.rgba16 && di_json &&
            std::string(di_json).find("cineon") != std::string::npos;
        spk_result_free(&di);
        spk_string_free(di_json);
        require(di_status == SPK_OK && valid_di, "Cineon DI API failed: " + di_error);
        require(params(session.get()) == before_di, "DI export mutated the session");
        render(engine.get(), session.get());

        const float* mask = nullptr;
        uint32_t width = 0, height = 0;
        require(spk_contrast_mask_field(session.get(), "full", &mask, &width, &height) == SPK_OK &&
                !mask && width == 0 && height == 0, "disabled contrast mask must have an empty field");

        // Latitude analysis remains non-mutating after the mapping kernel is
        // ported. The dedicated latitude test covers applying the returned curve.
        char* latitude_json = nullptr;
        const spk_status latitude_status = spk_scene_latitude(session.get(), nullptr, &latitude_json);
        const std::string latitude_error = spk_last_error(engine.get());
        const bool latitude_valid = latitude_json &&
            std::string(latitude_json).find("\"medium\"") != std::string::npos &&
            std::string(latitude_json).find("\"scene\"") != std::string::npos;
        spk_string_free(latitude_json);
        require(latitude_status == SPK_OK && latitude_valid, "latitude analysis failed: " + latitude_error);
        require(params(session.get()) == before_di, "latitude analysis mutated the session");
        render(engine.get(), session.get());

        // The digests below need a deterministic frame: grain is a stochastic
        // draw, and auto exposure would move the whole-image level. Everything
        // else keeps its default so the effects under test are the only
        // difference between the digests.
        require(spk_set_params(session.get(),
                               "{\"grain_active\":false,\"halation_active\":false,"
                               "\"glare_active\":false,\"auto_exposure\":false,"
                               "\"print_exposure\":1.0}",
                               nullptr) == SPK_OK,
                std::string("could not pin the deterministic frame: ") + spk_last_error(engine.get()));
        render(engine.get(), session.get());

        // Applying the scene-latitude mapping (RFC-023) is an effect now:
        // turning it on changes the frame, turning it off restores it.
        const uint64_t plain_digest = render_digest(engine.get(), session.get());
        const std::string scene_delta =
            "{\"scene_latitude_active\":true,\"scene_latitude_norm\":\"y\","
            "\"scene_latitude_shadow_room\":3.0,\"scene_latitude_highlight_room\":3.0}";
        require(spk_set_params(session.get(), scene_delta.c_str(), nullptr) == SPK_OK,
                std::string("scene latitude mapping was refused: ") + spk_last_error(engine.get()));
        const uint64_t lifted_digest = render_digest(engine.get(), session.get());
        require(lifted_digest != plain_digest, "scene latitude mapping did not change the frame");
        require(spk_set_params(session.get(), "{\"scene_latitude_active\":false}", nullptr) == SPK_OK,
                "could not disable the scene-latitude mapping");
        require(render_digest(engine.get(), session.get()) == plain_digest,
                "disabling scene latitude did not restore the plain frame");

        // Overscan and its film edge (RFC-031/032): an active canvas changes
        // the rendered dimensions instead of being refused.
        require(spk_set_params(session.get(),
                               "{\"overscan_active\":true,\"overscan_format\":\"135\"}", nullptr) == SPK_OK,
                std::string("overscan was refused: ") + spk_last_error(engine.get()));
        uint32_t framed_width = 0;
        uint32_t framed_height = 0;
        render_digest(engine.get(), session.get(), &framed_width, &framed_height);
        require(framed_width > 32 && framed_height > 0, "overscan canvas did not widen the frame");
        require(spk_set_params(session.get(), "{\"overscan_active\":false}", nullptr) == SPK_OK,
                "could not disable overscan");

        // The printed date back (RFC-032) is accepted and echoed; its visual
        // gate on a 36 x 24 synthetic frame is covered by the full-scale host
        // probe (the glyphs are laid out in millimetres on the film edge).
        require(spk_set_params(session.get(),
                               "{\"date_imprint_active\":true,\"date_imprint_text\":\"2026 11 17\"}",
                               nullptr) == SPK_OK,
                std::string("date imprint was refused: ") + spk_last_error(engine.get()));
        require(params(session.get()).find("\"date_imprint_active\":true") != std::string::npos,
                "date imprint was not applied to the session params");
        require(spk_set_params(session.get(), "{\"date_imprint_active\":false}", nullptr) == SPK_OK,
                "could not disable the date imprint");

        std::cout << "Windows feature boundaries passed (contrast mask on/off, Cineon DI, latitude "
                     "analysis and mapping, overscan canvas, date back)\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
