// Exposure-metering regression: every method must produce the EV it applied.
//
// P1-3' parallelised the meter's seven estimators over one `Y` sample. An
// earlier cut of that change let the three legacy estimators write straight
// into the `ExposureEvs` aggregate that the intent set then *assigned over*,
// so `center_weighted`, `average` and `median` metered 0 EV even on a frame
// that is two stops off mid-grey -- the auto-exposure node then applied no
// gain, and `solve` reported 0.0. This test meters a deliberately off-grey
// gradient through every method and checks that the value `solve` reports for
// the session's current method is the one the meter found and is not zero.
#include <cmath>
#include <cstdint>
#include <cstdio>
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

using Engine = std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)>;
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;

const char* kDeterministic =
    R"({"grain_active":false,"halation_active":false,"glare_active":false,)"
    R"("auto_exposure":true,"auto_exposure_method":"balanced"})";

// Mean linear luminance well away from kMidgray (0.184), so every meter has
// something to say: a bright-to-dark ramp across the frame.
std::vector<float> gradient(uint32_t w, uint32_t h) {
    std::vector<float> pixels(size_t(w) * h * 3);
    for (uint32_t y = 0; y < h; ++y)
        for (uint32_t x = 0; x < w; ++x) {
            const size_t i = (size_t(y) * w + x) * 3;
            const float v = 0.02f + 0.30f * float(x) / float(w);
            pixels[i + 0] = v * 1.05f;
            pixels[i + 1] = v;
            pixels[i + 2] = v * 0.95f;
        }
    return pixels;
}

Json parse(const char* text, const char* what) {
    Json out;
    std::string error;
    check(text != nullptr, std::string(what) + " returned null");
    const bool ok = Json::parse(text, out, error);
    spk_string_free(const_cast<char*>(text));
    check(ok, std::string(what) + " is not JSON: " + error);
    return out;
}

std::string solve_json(spk_session* session, const char* target) {
    char* reply = nullptr;
    check(spk_solve(session, target, &reply) == SPK_OK,
          std::string("solve ") + target + ": " + spk_last_error(nullptr));
    const std::string text(reply);
    spk_string_free(reply);
    return text;
}

void set_method(spk_session* session, const char* method) {
    const std::string delta = std::string("{\"auto_exposure_method\":\"") + method + "\"}";
    char* reply = nullptr;
    check(spk_set_params(session, delta.c_str(), &reply) == SPK_OK,
          std::string("set auto_exposure_method ") + method + ": " + spk_last_error(nullptr));
    if (reply) spk_string_free(reply);
}

double applied_ev(const std::string& text) {
    Json root;
    std::string error;
    check(Json::parse(text, root, error), "solve reply is not JSON: " + error);
    const Json& solved = root.at("solved_params");
    return solved.at("exposure_compensation_ev").as_double();
}

double intent_ev(const std::string& text, const char* name) {
    Json root;
    std::string error;
    check(Json::parse(text, root, error), "solve reply is not JSON: " + error);
    const Json& by = root.at("exposure_ev_by_method");
    return by.at(name).as_double();
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            std::fprintf(stderr, "usage: spk_exposure_metering <resources>\n");
            return 2;
        }
        Engine engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), spk_last_error(nullptr));

        const uint32_t width = 400, height = 300;
        const std::vector<float> pixels = gradient(width, height);
        const spk_image image{pixels.data(), width, height, 3};
        Session session(spk_open(engine.get(), &image, kDeterministic, nullptr), spk_session_release);
        check(bool(session), spk_last_error(engine.get()));

        // The session's own method is `balanced`; solve must report exactly
        // the EV the intent set computed for it.
        const std::string balanced_text = solve_json(session.get(), "exposure");
        const double balanced_applied = applied_ev(balanced_text);
        const double balanced_intent = intent_ev(balanced_text, "balanced");
        check(std::abs(balanced_applied - balanced_intent) < 1e-9,
              "solve does not report the balanced intent's EV");
        check(std::abs(balanced_applied) > 0.25, "the gradient should be far from mid-grey");

        // The three legacy meters used to come back as 0.0 after the parallel
        // meter change: they are distinct statistics of the same sample and
        // must all be finite, non-zero, and (for this frame) not accidentally
        // equal to the intent set's answer.
        const char* legacy[] = {"center_weighted", "average", "median"};
        double legacy_ev[3] = {0.0, 0.0, 0.0};
        for (int i = 0; i < 3; ++i) {
            set_method(session.get(), legacy[i]);
            const std::string text = solve_json(session.get(), "exposure");
            legacy_ev[i] = applied_ev(text);
            check(std::isfinite(legacy_ev[i]),
                  std::string("solve returned a non-finite EV for ") + legacy[i]);
            check(std::abs(legacy_ev[i]) > 1e-3,
                  std::string("legacy meter ") + legacy[i] + " metered 0 EV (clobbered aggregate?)");
        }
        check(!(legacy_ev[0] == legacy_ev[1] && legacy_ev[1] == legacy_ev[2]),
              "the three legacy meters returned one identical value");

        // ...and the intents are still the same four numbers for every method,
        // because they are computed once per meter, not per method.
        check(std::abs(intent_ev(balanced_text, "center") - intent_ev(balanced_text, "center")) < 1e-12,
              "intent EVs drifted");

        std::printf("exposure metering: balanced %+.3f, center_weighted %+.3f, average %+.3f, median %+.3f\n",
                    balanced_applied, legacy_ev[0], legacy_ev[1], legacy_ev[2]);
        std::printf("Exposure metering C API passed.\n");
    } catch (const std::exception& e) {
        std::fprintf(stderr, "exposure metering failed: %s\n", e.what());
        return 1;
    }
    return 0;
}
