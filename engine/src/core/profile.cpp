#include "profile.hpp"
#include "file_path.hpp"
#include "trix_d76.hpp"

#include <algorithm>

#include <cmath>
#include <cstdio>
#include <fstream>
#include <sstream>

namespace spk {

namespace {

bool read_file(const std::string& path, std::string& out, std::string& error) {
    std::ifstream in(file_path(path), std::ios::binary);
    if (!in) { error = "cannot open " + path; return false; }
    std::ostringstream ss;
    ss << in.rdbuf();
    out = ss.str();
    return true;
}

bool want_vec(const Json& parent, const char* key, Vec& out, size_t expect, std::string& error) {
    if (!json_to_vec(parent.at(key), out)) { error = std::string(key) + ": expected a list of numbers"; return false; }
    if (expect && out.size() != expect) {
        error = std::string(key) + ": expected " + std::to_string(expect) + " values, got " + std::to_string(out.size());
        return false;
    }
    return true;
}

bool want_mat(const Json& parent, const char* key, Vec& out, size_t rows, size_t cols, std::string& error) {
    size_t r = 0, c = 0;
    if (!json_to_mat(parent.at(key), out, r, c)) { error = std::string(key) + ": expected a 2-D list of numbers"; return false; }
    if ((rows && r != rows) || (cols && c != cols)) {
        error = std::string(key) + ": expected (" + std::to_string(rows) + ", " + std::to_string(cols) +
                "), got (" + std::to_string(r) + ", " + std::to_string(c) + ")";
        return false;
    }
    return true;
}

std::string str_or(const Json& j, const char* key, const std::string& fallback) {
    const Json& v = j.at(key);
    return v.is_string() ? v.as_string() : fallback;
}

}  // namespace

bool Profile::from_json(const Json& root, std::string& error) {
    const Json& in = root.at("info");
    if (!in.is_object()) { error = "profile has no 'info' object"; return false; }
    info.stock = str_or(in, "stock", "");
    info.name = str_or(in, "name", info.stock);
    info.type = str_or(in, "type", "negative");
    info.support = str_or(in, "support", "film");
    info.stage = str_or(in, "stage", "filming");
    info.use = str_or(in, "use", "still");
    info.antihalation = str_or(in, "antihalation", "weak");
    info.target_print = str_or(in, "target_print", "");
    info.channel_model = str_or(in, "channel_model", "color");
    info.densitometer = str_or(in, "densitometer", "status_M");
    info.log_sensitivity_density_over_min = in.at("log_sensitivity_density_over_min").as_double(0.2);
    info.reference_illuminant = str_or(in, "reference_illuminant", "D55");
    info.viewing_illuminant = str_or(in, "viewing_illuminant", "D50");
    if (info.type != "negative" && info.type != "positive") {
        error = "profile '" + info.stock + "': type is '" + info.type + "', expected negative or positive";
        return false;
    }

    const Json& d = root.at("data");
    if (!d.is_object()) { error = "profile '" + info.stock + "' has no 'data' object"; return false; }

    if (!want_vec(d, "wavelengths", data.wavelengths, 0, error)) return false;
    const size_t nw = data.wavelengths.size();
    if (nw != 81) {
        error = "profile '" + info.stock + "': " + std::to_string(nw) +
                " wavelengths; this build is built for 81 (380..780 at 5 nm)";
        return false;
    }
    if (!want_mat(d, "log_sensitivity", data.log_sensitivity, nw, 3, error)) return false;
    if (!want_mat(d, "channel_density", data.channel_density, nw, 3, error)) return false;
    if (!want_vec(d, "base_density", data.base_density, nw, error)) return false;
    if (d.has("midscale_neutral_density") && !want_vec(d, "midscale_neutral_density", data.midscale_neutral_density, nw, error))
        return false;

    if (!want_vec(d, "log_exposure", data.log_exposure, 0, error)) return false;
    data.n_exposure = data.log_exposure.size();
    if (data.n_exposure < 2) { error = "profile '" + info.stock + "': log_exposure needs at least two points"; return false; }
    if (!want_mat(d, "density_curves", data.density_curves, data.n_exposure, 3, error)) return false;

    if (d.has("density_curves_layers")) {
        size_t d0 = 0, d1 = 0, d2 = 0;
        if (!json_to_3d(d.at("density_curves_layers"), data.density_curves_layers, d0, d1, d2)) {
            error = "profile '" + info.stock + "': density_curves_layers is not a 3-D list";
            return false;
        }
        if (d0 != data.n_exposure || d1 != 3 || d2 != 3) {
            error = "profile '" + info.stock + "': density_curves_layers is (" + std::to_string(d0) + ", " +
                    std::to_string(d1) + ", " + std::to_string(d2) + "), expected (" +
                    std::to_string(data.n_exposure) + ", 3, 3)";
            return false;
        }
    }

    // Hanatos adaptation. Both are optional: paper profiles carry neither.
    if (d.has("hanatos2025_adaptation_window_params"))
        json_to_vec(d.at("hanatos2025_adaptation_window_params"), data.adaptation_window_params);
    if (d.has("hanatos2025_adaptation_surface_params")) {
        size_t r = 0, c = 0;
        if (json_to_mat(d.at("hanatos2025_adaptation_surface_params"), data.adaptation_surface_params, r, c)) {
            data.adaptation_surface_rows = r;
            data.adaptation_surface_cols = c;
        }
    }
    if (!data.adaptation_window_params.empty() &&
        data.adaptation_window_params.size() != 4 && data.adaptation_window_params.size() != 8) {
        error = "profile '" + info.stock + "': the spectral bandpass window has " +
                std::to_string(data.adaptation_window_params.size()) + " parameters; erf4 wants 4 and logiflex8 wants 8";
        return false;
    }

    const Json& m = d.at("density_curves_model");
    if (m.is_object()) {
        data.model.model_type = str_or(m, "model_type", "cdfs");
        size_t r = 0, c = 0;
        if (json_to_mat(m.at("centers"), data.model.centers, r, c)) {
            data.model.n_channels = r;
            data.model.n_layers = c;
        }
        size_t r2 = 0, c2 = 0;
        if (!json_to_mat(m.at("amplitudes"), data.model.amplitudes, r2, c2) || r2 != r || c2 != c) {
            error = "profile '" + info.stock + "': density_curves_model.amplitudes does not match centers";
            return false;
        }
        if (!json_to_mat(m.at("sigmas"), data.model.sigmas, r2, c2) || r2 != r || c2 != c) {
            error = "profile '" + info.stock + "': density_curves_model.sigmas does not match centers";
            return false;
        }
    }

    const Json& edr = d.at("edr_tone_map");
    if (edr.is_object()) {
        data.edr_tone_map.version = int(edr.at("version").as_double(0));
        Vec domain;
        if (!want_vec(edr, "domain_log2_y", domain, 2, error)) return false;
        data.edr_tone_map.domain_log2_y[0] = domain[0];
        data.edr_tone_map.domain_log2_y[1] = domain[1];
        data.edr_tone_map.toe_y = edr.at("toe_y").as_double(0.0);
        data.edr_tone_map.shoulder_y = edr.at("shoulder_y").as_double(1.0);
        if (!want_vec(edr, "target_log2_y", data.edr_tone_map.target_log2_y, 0, error)) return false;
        if (data.edr_tone_map.version != 1 || data.edr_tone_map.target_log2_y.size() < 2 ||
            !(data.edr_tone_map.domain_log2_y[1] > data.edr_tone_map.domain_log2_y[0]) ||
            !(data.edr_tone_map.toe_y > 0.0) ||
            !(data.edr_tone_map.shoulder_y > data.edr_tone_map.toe_y)) {
            error = "profile '" + info.stock + "': invalid edr_tone_map";
            return false;
        }
        for (double v : data.edr_tone_map.target_log2_y) {
            if (!std::isfinite(v)) {
                error = "profile '" + info.stock + "': edr_tone_map contains a non-finite value";
                return false;
            }
        }
    }

    // `density_curves - nanmin(density_curves, axis=0)`, and the nanmax of
    // that. Every stage that touches the curves starts from these.
    normalized_curves.assign(data.density_curves.size(), 0.0);
    for (int c = 0; c < 3; ++c) {
        density_min[c] = nanmin(data.density_curves.data() + c, data.n_exposure, 3);
        for (size_t k = 0; k < data.n_exposure; ++k)
            normalized_curves[3 * k + size_t(c)] = data.density_curves[3 * k + size_t(c)] - density_min[c];
        density_max[c] = nanmax(normalized_curves.data() + c, data.n_exposure, 3);
    }
    return true;
}

void Profile::apply_trix_d76(int minutes) {
    if (info.stock != "kodak_tri_x_400" || minutes == 0) return;
    const auto& curve = kTriXGrossDensity.at(static_cast<size_t>((minutes - 6) / 2));
    const double base = curve.front();
    const double step = (kTriXLogHLast - kTriXLogHFirst) / (curve.size() - 1);
    // The stock's relative logE=0 is log10(0.8/400)+1 in Kodak's log lux-seconds.
    const auto gross = [&](double log_e) {
        const double position = (log_e + std::log10(0.8 / 400) + 1 - kTriXLogHFirst) / step;
        if (position <= 0) return base;
        const size_t last = curve.size() - 1;
        const size_t left = std::min(static_cast<size_t>(position), last - 1);
        // Last-segment slope above the chart, capped at the profile's 3 D ceiling.
        return std::min(3.0, curve[left] + (position - left) * (curve[left + 1] - curve[left]));
    };
    for (size_t i = 0; i < data.n_exposure; ++i) {
        const double net = gross(data.log_exposure[i]) - base;
        for (size_t c = 0; c < 3; ++c) {
            data.density_curves[i * 3 + c] = normalized_curves[i * 3 + c] = net;
            // Retain the stock's estimated sublayer fractions at this exposure.
            // F-4017 only measures total visual density, not individual layers.
            if (!data.density_curves_layers.empty()) {
                double* layer = data.density_curves_layers.data() + 9 * i + c;
                const double sum = layer[0] + layer[3] + layer[6];
                for (size_t j = 0; j < 3; ++j)
                    layer[3 * j] = sum > 0 ? net * layer[3 * j] / sum : (j == 0 ? net : 0.0);
            }
        }
    }
    std::fill_n(density_min, 3, 0.0);
    std::fill_n(density_max, 3, normalized_curves.back());
    std::fill(data.base_density.begin(), data.base_density.end(), base);
    std::fill(data.midscale_neutral_density.begin(), data.midscale_neutral_density.end(), gross(0));
}

bool Profile::load(const std::string& path, std::string& error) {
    std::string text;
    if (!read_file(path, text, error)) return false;
    Json root;
    std::string parse_error;
    if (!Json::parse(text, root, parse_error)) { error = path + ": " + parse_error; return false; }
    return from_json(root, error);
}

namespace {

// A stock name reaches here straight off the wire (and a base name out of a
// file). Restricting it to the characters a stock id actually uses is what
// stops `film_stock: "../../etc/passwd"` from being a file read.
bool valid_stock_name(const std::string& stock, std::string& error) {
    if (stock.empty() || stock.size() > 96) { error = "bad stock name"; return false; }
    for (char c : stock) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') || c == '_' || c == '-';
        if (!ok) { error = "bad stock name '" + stock + "'"; return false; }
    }
    return true;
}

bool read_json(const std::string& path, Json& root, std::string& error) {
    std::string text;
    if (!read_file(path, text, error)) return false;
    std::string parse_error;
    if (!Json::parse(text, root, parse_error)) { error = path + ": " + parse_error; return false; }
    return true;
}

// The alias's own `info` keys, laid over the base's: the strings and the one
// number `from_json` reads. Anything else in the alias is documentation.
void override_info(const Json& in, ProfileInfo& info) {
    const auto take = [&](const char* key, std::string& slot) {
        const Json& v = in.at(key);
        if (v.is_string()) slot = v.as_string();
    };
    take("name", info.name);
    take("type", info.type);
    take("support", info.support);
    take("stage", info.stage);
    take("use", info.use);
    take("antihalation", info.antihalation);
    take("target_print", info.target_print);
    take("channel_model", info.channel_model);
    take("densitometer", info.densitometer);
    take("reference_illuminant", info.reference_illuminant);
    take("viewing_illuminant", info.viewing_illuminant);
    if (in.has("log_sensitivity_density_over_min"))
        info.log_sensitivity_density_over_min =
            in.at("log_sensitivity_density_over_min").as_double(info.log_sensitivity_density_over_min);
}

}  // namespace

bool load_profile(const std::string& resources_dir, const std::string& stock,
                  Profile& out, std::string& error) {
    if (!valid_stock_name(stock, error)) return false;
    Json root;
    if (!read_json(resources_dir + "/profiles/" + stock + ".json", root, error)) {
        error = "no profile '" + stock + "' (" + error + ")";
        return false;
    }
    if (!root.at("derived_from").is_string()) {
        if (!out.from_json(root, error)) {
            error = "no profile '" + stock + "' (" + error + ")";
            return false;
        }
        return true;
    }

    // An alias: the base's data whole, then the alias's `info` over it.
    const std::string base_stock = root.at("derived_from").as_string();
    if (!valid_stock_name(base_stock, error)) {
        error = "profile '" + stock + "': derived_from: " + error;
        return false;
    }
    Json base_root;
    if (!read_json(resources_dir + "/profiles/" + base_stock + ".json", base_root, error)) {
        error = "profile '" + stock + "' is derived from '" + base_stock + "', which does not load (" + error + ")";
        return false;
    }
    if (base_root.at("derived_from").is_string()) {
        error = "profile '" + stock + "' is derived from '" + base_stock + "', itself an alias";
        return false;
    }
    if (!out.from_json(base_root, error)) {
        error = "profile '" + stock + "' (base '" + base_stock + "'): " + error;
        return false;
    }
    override_info(root.at("info"), out.info);
    out.info.stock = stock;   // addressed by its own name, whatever its info says
    out.info.base_stock = base_stock;
    if (out.info.type != "negative" && out.info.type != "positive") {
        error = "profile '" + stock + "': type is '" + out.info.type + "', expected negative or positive";
        return false;
    }
    return true;
}

}  // namespace spk
