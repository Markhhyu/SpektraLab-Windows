// P1-7: the parametric development model (push/pull and temperature).
//
// The model bends the measured density curve with `D_push = a * D(g * logE + s)`
// and folds developer temperature into an equivalent push. What needs checking
// is the contract around it: the parameter surface exists with the right
// ranges, `active = false` is a byte-exact bypass, a push actually changes the
// print in the expected direction, and temperature is exactly the documented
// push equivalent.
#include <cmath>
#include <cstdint>
#include "core/profile.hpp"
#include <cstdio>
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

using Engine = std::unique_ptr<spk_engine, decltype(&spk_engine_destroy)>;
using Session = std::unique_ptr<spk_session, decltype(&spk_session_release)>;

const char* kDeterministic =
    R"({"grain_active":false,"halation_active":false,"glare_active":false,"auto_exposure":false})";

std::vector<float> gradient(uint32_t w, uint32_t h) {
    std::vector<float> pixels(size_t(w) * h * 3);
    for (uint32_t y = 0; y < h; ++y)
        for (uint32_t x = 0; x < w; ++x) {
            const size_t i = (size_t(y) * w + x) * 3;
            pixels[i + 0] = 0.05f + 0.90f * float(x) / float(w);
            pixels[i + 1] = 0.05f + 0.90f * float(y) / float(h);
            pixels[i + 2] = 0.05f + 0.90f * float(x + y) / float(w + h);
        }
    return pixels;
}

std::vector<uint16_t> render_live(spk_session* session) {
    spk_result result{};
    check(spk_render(session, "live", &result) == SPK_OK,
          std::string("live render: ") + spk_last_error(nullptr));
    std::vector<uint16_t> pixels;
    if (result.rgba16) {
        pixels.resize(size_t(result.width) * result.height * 4);
        for (uint32_t y = 0; y < result.height; ++y)
            std::memcpy(pixels.data() + size_t(y) * result.width * 4,
                        result.rgba16 + size_t(y) * result.row_stride_px * 4,
                        size_t(result.width) * 4 * sizeof(uint16_t));
    }
    spk_result_free(&result);
    return pixels;
}

double mean_rgb(const std::vector<uint16_t>& pixels) {
    check(!pixels.empty(), "render returned no pixels");
    double sum = 0.0;
    size_t n = 0;
    for (size_t i = 0; i + 3 < pixels.size(); i += 4) {
        sum += double(pixels[i]) + double(pixels[i + 1]) + double(pixels[i + 2]);
        n += 3;
    }
    return sum / double(n);
}

double mean_abs_diff(const std::vector<uint16_t>& a, const std::vector<uint16_t>& b) {
    check(a.size() == b.size(), "renders have different geometry");
    double sum = 0.0;
    size_t n = 0;
    for (size_t i = 0; i + 3 < a.size(); i += 4) {
        for (int c = 0; c < 3; ++c) {
            sum += std::abs(double(a[i + size_t(c)]) - double(b[i + size_t(c)]));
            ++n;
        }
    }
    return sum / double(n);
}


}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            std::fprintf(stderr, "usage: spk_development_morph <resources>\n");
            return 2;
        }
        Engine engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), spk_last_error(nullptr));

        // The parameter surface: three fields, shoot layer, wired ranges.
        Json schema;
        std::string parse_error;
        check(Json::parse(spk_params_schema(engine.get()), schema, parse_error),
              "params schema is not JSON: " + parse_error);
        const Json& fields = schema.at("fields");
        const Json* active = nullptr;
        const Json* push = nullptr;
        const Json* temperature = nullptr;
        for (const Json& f : fields.items()) {
            const std::string& name = f.at("name").as_string();
            if (name == "development_active") active = &f;
            if (name == "development_push_stops") push = &f;
            if (name == "development_temperature_c") temperature = &f;
        }
        check(active && push && temperature, "development parameters are missing from the schema");
        check(active->at("type").as_string() == "bool", "development_active is not a bool");
        const std::vector<Json>& push_range = push->at("range").items();
        const std::vector<Json>& temperature_range = temperature->at("range").items();
        check(push_range.size() == 2 && push_range[0].as_double() == -3.0 &&
                  push_range[1].as_double() == 3.0,
              "development_push_stops range");
        check(temperature_range.size() == 2 && temperature_range[0].as_double() == 18.0 &&
                  temperature_range[1].as_double() == 24.0,
              "development_temperature_c range");

        const uint32_t width = 320, height = 240;
        const std::vector<float> pixels = gradient(width, height);
        const spk_image image{pixels.data(), width, height, 3};

        Session baseline(spk_open(engine.get(), &image, kDeterministic, nullptr),
                         spk_session_release);
        check(bool(baseline), spk_last_error(engine.get()));
        const std::vector<uint16_t> base = render_live(baseline.get());

        // Off is off, even with a push value sitting in the delta.
        Session off(spk_open(engine.get(), &image,
                             R"({"grain_active":false,"halation_active":false,"glare_active":false,)"
                             R"("auto_exposure":false,"development_active":false,)"
                             R"("development_push_stops":2.0,"development_temperature_c":23.0})",
                             nullptr),
                    spk_session_release);
        check(bool(off), spk_last_error(engine.get()));
        check(render_live(off.get()) == base, "inactive development is not an exact bypass");

        // A push raises density: the fixed-exposure print must get darker.
        auto push_session = [&](double stops, double temperature) {
            const std::string delta = std::string(kDeterministic).substr(0, std::string(kDeterministic).size() - 1) +
                                      ",\"development_active\":true,\"development_push_stops\":" +
                                      std::to_string(stops) + ",\"development_temperature_c\":" +
                                      std::to_string(temperature) + "}";
            Session session(spk_open(engine.get(), &image, delta.c_str(), nullptr), spk_session_release);
            check(bool(session), spk_last_error(engine.get()));
            return render_live(session.get());
        };
        const std::vector<uint16_t> push1 = push_session(1.0, 20.0);
        const std::vector<uint16_t> push2 = push_session(2.0, 20.0);
        const double m0 = mean_rgb(base), m1 = mean_rgb(push1), m2 = mean_rgb(push2);
        check(mean_abs_diff(base, push1) > 100.0, "push 1 does not change the print");
        check(m1 < m0, "push 1 did not raise density");
        check(m2 < m1, "push 2 is not stronger than push 1");

        // Temperature is folded in as one sixth of a stop per degree.
        const std::vector<uint16_t> warm = push_session(0.5, 20.0);
        const std::vector<uint16_t> warm_equiv = push_session(0.0, 23.0);
        check(mean_abs_diff(warm, warm_equiv) < 1.0,
              "23 C does not match +0.5 stop of development");

        // Independent chart reads at absolute logH = -2, -1, 0 (F-4017 p8).
        const double density[4][3] = {{0.542, 1.057, 1.581}, {0.713, 1.336, 1.929},
                                      {0.874, 1.599, 2.249}, {1.067, 1.890, 2.577}};
        const std::string tri = std::string(kDeterministic).substr(0, std::strlen(kDeterministic) - 1) +
            R"(,"film_stock":"kodak_tri_x_400","print_stock":"ilford_multigrade_iv_rc","scan_film":true)";
        Session changing(spk_open(engine.get(), &image, (tri + "}").c_str(), nullptr), spk_session_release);
        check(bool(changing), spk_last_error(engine.get()));
        const auto original = render_live(changing.get());
        auto previous = original;
        for (int i = 0; i < 4; ++i) {
            const int minutes = 6 + i * 2;
            Profile stock;
            std::string why;
            check(load_profile(argv[1], "kodak_tri_x_400", stock, why), why);
            stock.apply_trix_d76(minutes);
            Vec net(stock.data.n_exposure);
            for (size_t j = 0; j < net.size(); ++j) net[j] = stock.normalized_curves[j * 3];
            for (int j = 0; j < 3; ++j) {
                const double log_e = (-2.0 + j) - (std::log10(0.8 / 400) + 1);
                const double gross = stock.data.base_density[0] +
                    interp(log_e, stock.data.log_exposure.data(), net.data(), net.size());
                check(std::abs(gross - density[i][j]) < 0.006, "D-76 chart density mismatch");
            }
            const std::string field = "\"trix_d76_minutes\":" + std::to_string(minutes);
            check(spk_set_params(changing.get(), ("{" + field + "}").c_str(), nullptr) == SPK_OK,
                  spk_last_error(engine.get()));
            Session opened(spk_open(engine.get(), &image, (tri + "," + field + "}").c_str(), nullptr),
                           spk_session_release);
            check(bool(opened), spk_last_error(engine.get()));
            const auto frame = render_live(changing.get());
            check(frame == render_live(opened.get()), "changing D-76 time differs from reopening");
            check(mean_abs_diff(frame, previous) > 1, "D-76 time left the render unchanged");
            previous = frame;
        }
        check(spk_set_params(changing.get(), R"({"trix_d76_minutes":7})", nullptr) != SPK_OK,
              "accepted an unmeasured D-76 time");
        check(render_live(changing.get()) == previous, "invalid time changed render");
        check(spk_set_params(changing.get(), R"({"trix_d76_minutes":0})", nullptr) == SPK_OK,
              spk_last_error(engine.get()));
        check(render_live(changing.get()) == original, "stock curve was not restored");

        // Out-of-range values are rejected at the wire boundary.
        Session probe(spk_open(engine.get(), &image, kDeterministic, nullptr), spk_session_release);
        check(bool(probe), spk_last_error(engine.get()));
        char* reply = nullptr;
        check(spk_set_params(probe.get(), R"({"development_push_stops":4.0})", &reply) != SPK_OK,
              "push_stops 4 was accepted");
        std::string error = spk_last_error(engine.get());
        check(error.find("development_push_stops") != std::string::npos,
              "range error does not name the parameter: " + error);
        check(spk_set_params(probe.get(), R"({"development_temperature_c":30})", &reply) != SPK_OK,
              "temperature 30 was accepted");
        error = spk_last_error(engine.get());
        check(error.find("development_temperature_c") != std::string::npos,
              "temperature range error does not name the parameter: " + error);

        std::printf("development morph: schema, exact bypass, push direction, temperature equivalence\n");
        return 0;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "development morph failed: %s\n", error.what());
        return 1;
    }
}
