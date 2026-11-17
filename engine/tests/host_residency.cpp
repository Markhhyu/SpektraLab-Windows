// P0-3: the host's resident-editor budget.
//
// Two things are checked. The policy (`host/residency.hpp`) is pure, so its
// cases are exact. The engine contract the policy leans on is not pure: a real
// Vulkan session goes through suspend -> resume, and its pixels must come back
// bit-identical while the memory report moves the holding to `suspended_bytes`
// and back.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "json.hpp"
#include "pipeline/view.hpp"
#include "residency.hpp"
#include "spektrafilm/spk_engine.h"

using namespace spk;

namespace {

void check(bool ok, const std::string& why) {
    if (!ok) throw std::runtime_error(why);
}

using Engine = std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)>;
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;

Json report(spk_engine* engine) {
    Json out;
    std::string error;
    check(Json::parse(spk_memory_report(engine), out, error), "memory report is not JSON: " + error);
    return out;
}

std::vector<uint16_t> render_live(spk_session* session, uint32_t& width, uint32_t& height,
                                  uint32_t& stride) {
    spk_result result{};
    check(spk_render(session, "live", &result) == SPK_OK,
          std::string("live render: ") + spk_last_error(nullptr));
    std::vector<uint16_t> pixels;
    if (result.rgba16) {
        width = result.width;
        height = result.height;
        stride = result.row_stride_px;
        pixels.resize(size_t(width) * height * 4);
        for (uint32_t y = 0; y < height; ++y)
            std::memcpy(pixels.data() + size_t(y) * width * 4,
                        result.rgba16 + size_t(y) * stride * 4,
                        size_t(width) * 4 * sizeof(uint16_t));
    }
    spk_result_free(&result);
    return pixels;
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

void policy_cases() {
    using spkhost::EditorResidency;
    // Empty and under-limit registries suspend nothing.
    check(spkhost::editors_to_suspend({}, 2).empty(), "empty registry");
    check(spkhost::editors_to_suspend({{1, false}, {2, false}}, 2).empty(),
          "two resident editors fit a cap of two");
    // Over the cap: exactly the excess, oldest first.
    const std::vector<std::size_t> victims =
        spkhost::editors_to_suspend({{9, false}, {3, false}, {7, false}, {1, false}}, 2);
    check(victims.size() == 2 && victims[0] == 3 && victims[1] == 1, "LRU order");
    // Already-suspended editors neither count against the cap nor come back.
    const std::vector<std::size_t> mixed =
        spkhost::editors_to_suspend({{1, true}, {2, false}, {3, false}}, 1);
    check(mixed.size() == 1 && mixed[0] == 1, "suspended editor ignored");
    // A cap of zero drains the device, oldest first.
    const std::vector<std::size_t> all =
        spkhost::editors_to_suspend({{5, false}, {1, false}, {3, false}}, 0);
    check(all.size() == 3 && all[0] == 1 && all[1] == 2 && all[2] == 0, "cap zero drains all");
    // Ties are stable by index, so the same registry always gives one answer.
    const std::vector<std::size_t> ties =
        spkhost::editors_to_suspend({{4, false}, {4, false}, {4, false}}, 1);
    check(ties.size() == 2 && ties[0] == 0 && ties[1] == 1, "tie break is stable");
    std::printf("residency policy: 6 cases passed\n");
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            std::fprintf(stderr, "usage: spk_host_residency <resources>\n");
            return 2;
        }
        policy_cases();

        Engine engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), spk_last_error(nullptr));
        const uint32_t width = 640, height = 480;
        const std::vector<float> pixels = gradient(width, height);
        const spk_image image{pixels.data(), width, height, 3};
        // Deterministic by construction: both stochastic stages off, no meter.
        const char* delta =
            R"({"grain_active":false,"halation_active":false,"glare_active":false,"auto_exposure":false})";
        Session first(spk_open(engine.get(), &image, delta, nullptr), spk_session_release);
        check(bool(first), spk_last_error(engine.get()));
        Session second(spk_open(engine.get(), &image, delta, nullptr), spk_session_release);
        check(bool(second), spk_last_error(engine.get()));

        uint32_t rw = 0, rh = 0, stride = 0;
        const std::vector<uint16_t> before = render_live(first.get(), rw, rh, stride);
        check(!before.empty(), "live render returned no pixels");
        const Json resident = report(engine.get());
        const double source_before = resident.at("persistent").at("source_bytes").as_double();
        check(source_before > 0, "the source is not resident before suspend");

        std::string why;
        check(!spk::view::suspended(first.get()), "a fresh session starts resident");
        check(spk::view::suspend(first.get(), why), "suspend: " + why);
        check(spk::view::suspended(first.get()), "suspend did not set the flag");
        const Json suspended = report(engine.get());
        check(suspended.at("suspended_bytes").as_double() > 0, "suspended bytes not reported");
        check(suspended.at("persistent").at("source_bytes").as_double() < source_before,
              "suspend did not release the resident source");

        check(spk::view::resume(first.get(), why), "resume: " + why);
        check(!spk::view::suspended(first.get()), "resume did not clear the flag");
        check(report(engine.get()).at("suspended_bytes").as_double() == 0,
              "the residency snapshot survived resume");
        uint32_t rw2 = 0, rh2 = 0, stride2 = 0;
        const std::vector<uint16_t> after = render_live(first.get(), rw2, rh2, stride2);
        check(rw == rw2 && rh == rh2 && stride == stride2, "resume changed the render geometry");
        check(after.size() == before.size() && after == before,
              "resume did not restore the exact pixels");

        // The policy against two real sessions: a cap of one makes the older
        // one the victim and leaves the newer one on the device.
        const std::vector<spkhost::EditorResidency> editors{
            {1, spk::view::suspended(first.get())}, {2, spk::view::suspended(second.get())}};
        const std::vector<std::size_t> victims = spkhost::editors_to_suspend(editors, 1);
        check(victims.size() == 1 && victims[0] == 0, "policy picked the wrong resident editor");
        check(spk::view::suspend(first.get(), why), "policy victim suspend: " + why);
        check(spk::view::suspended(first.get()) && !spk::view::suspended(second.get()),
              "policy left the wrong session resident");
        std::printf("residency engine: %ux%u session suspended, resumed and re-rendered exactly\n", rw, rh);
        return 0;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "host residency failed: %s\n", error.what());
        return 1;
    }
}
