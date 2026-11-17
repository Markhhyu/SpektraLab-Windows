// P1-8: the scan and viewing illuminants.
//
// Both fields default to the empty string, which is the stock profile's own
// viewing illuminant -- the colour path every version before P1-8 baked. What
// needs checking is the contract: the schema exposes two print-layer strings
// with the empty default, the empty default is a byte-exact bypass, naming a
// light visibly moves the render (a colder scan light or a warmer viewing
// light), and an unknown name is refused with the parameter named.
#include <cstdint>
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
            std::fprintf(stderr, "usage: spk_illuminants <resources>\n");
            return 2;
        }
        Engine engine(spk_engine_create(argv[1], nullptr), spk_engine_destroy);
        check(bool(engine), spk_last_error(nullptr));

        // The parameter surface: two print-layer strings, empty default.
        Json schema;
        std::string parse_error;
        check(Json::parse(spk_params_schema(engine.get()), schema, parse_error),
              "params schema is not JSON: " + parse_error);
        const Json* scan = nullptr;
        const Json* view = nullptr;
        for (const Json& f : schema.at("fields").items()) {
            const std::string& name = f.at("name").as_string();
            if (name == "scan_illuminant") scan = &f;
            if (name == "viewing_illuminant") view = &f;
        }
        check(scan && view, "illuminant parameters are missing from the schema");
        for (const Json* f : {scan, view}) {
            check(f->at("type").as_string() == "str", "illuminant field is not a string");
            check(f->at("layer").as_string() == "print", "illuminant field is not print-layer");
            check(f->at("default").as_string().empty(), "illuminant default is not empty");
            check(!f->at("live").as_bool(), "illuminant field should rebuild the frame");
        }

        const uint32_t width = 320, height = 240;
        const std::vector<float> pixels = gradient(width, height);
        const spk_image image{pixels.data(), width, height, 3};

        Session baseline(spk_open(engine.get(), &image, kDeterministic, nullptr),
                         spk_session_release);
        check(bool(baseline), spk_last_error(engine.get()));
        const std::vector<uint16_t> base = render_live(baseline.get());

        auto illum_session = [&](const std::string& extra) {
            const std::string delta = std::string(kDeterministic).substr(0, std::string(kDeterministic).size() - 1) +
                                      "," + extra + "}";
            Session session(spk_open(engine.get(), &image, delta.c_str(), nullptr), spk_session_release);
            check(bool(session), spk_last_error(engine.get()));
            return render_live(session.get());
        };

        // Empty is the profile's own light: byte-exact bypass.
        const std::vector<uint16_t> explicit_empty =
            illum_session(R"("scan_illuminant":"","viewing_illuminant":"")");
        check(explicit_empty == base, "empty illuminants are not the exact old output");

        // A colder scan light and a warmer viewing light both move the print.
        const std::vector<uint16_t> scan_d65 = illum_session(R"("scan_illuminant":"D65")");
        const std::vector<uint16_t> scan_a = illum_session(R"("scan_illuminant":"A")");
        const std::vector<uint16_t> view_a = illum_session(R"("viewing_illuminant":"A")");
        check(mean_abs_diff(base, scan_d65) > 1.0, "scan D65 does not change the print");
        check(mean_abs_diff(base, scan_a) > 1.0, "scan A does not change the print");
        check(mean_abs_diff(base, view_a) > 1.0, "viewing A does not change the print");
        check(mean_abs_diff(scan_d65, view_a) > 1.0, "scan and viewing light do the same thing");

        // Two different bodies agree: `BB<kelvin>` is accepted and moves too.
        const std::vector<uint16_t> black_body = illum_session(R"("scan_illuminant":"BB3400")");
        check(mean_abs_diff(base, black_body) > 1.0, "BB3400 does not change the print");

        // Unknown light names are refused at the wire boundary, named.
        Session probe(spk_open(engine.get(), &image, kDeterministic, nullptr), spk_session_release);
        check(bool(probe), spk_last_error(engine.get()));
        char* reply = nullptr;
        check(spk_set_params(probe.get(), R"({"scan_illuminant":"XYZ"})", &reply) != SPK_OK,
              "scan_illuminant XYZ was accepted");
        std::string error = spk_last_error(engine.get());
        check(error.find("scan_illuminant") != std::string::npos,
              "invalid-light error does not name the parameter: " + error);
        check(spk_set_params(probe.get(), R"({"viewing_illuminant":"D66"})", &reply) != SPK_OK,
              "viewing_illuminant D66 was accepted");
        error = spk_last_error(engine.get());
        check(error.find("viewing_illuminant") != std::string::npos,
              "invalid-light error does not name the parameter: " + error);

        std::printf("illuminants: schema, exact empty bypass, scan/view changes, named refusal\n");
        return 0;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "illuminants failed: %s\n", error.what());
        return 1;
    }
}
