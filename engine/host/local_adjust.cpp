// local_adjust.cpp -- masked local grades (see local_adjust.hpp).

#include "local_adjust.hpp"

#include <algorithm>
#include <cmath>

namespace spkhost {
using spk::Json;

namespace {

constexpr double kMaxLayers = 16.0;
constexpr double kMidGrey = 0.18;

double clamp01(double v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

double smooth01(double v) {
    const double t = clamp01(v);
    return t * t * (3.0 - 2.0 * t);
}

double number_field(const Json& layer, const char* key, double fallback, double lo, double hi, std::string& error,
                    const char* layer_name) {
    const Json& v = layer.at(key);
    if (v.is_null()) return fallback;
    if (!v.is_number()) {
        error = std::string("localAdjustments: '") + layer_name + "." + key + "' must be a number";
        return fallback;
    }
    return std::min(hi, std::max(lo, v.as_double()));
}

bool bool_field(const Json& layer, const char* key, bool fallback, std::string& error, const char* layer_name) {
    const Json& v = layer.at(key);
    if (v.is_null()) return fallback;
    if (!v.is_bool()) {
        error = std::string("localAdjustments: '") + layer_name + "." + key + "' must be a boolean";
        return fallback;
    }
    return v.as_bool();
}

double luminance(const float* rgb) {
    // Rec. 2020 luma weights are close enough for mask shaping; the grade itself
    // stays channel-wise in linear light.
    return 0.2627 * rgb[0] + 0.6780 * rgb[1] + 0.0593 * rgb[2];
}

double linear_weight(const LocalLayer& layer, double x, double y) {
    const double dx = layer.x1 - layer.x0;
    const double dy = layer.y1 - layer.y0;
    const double len2 = dx * dx + dy * dy;
    // A degenerate gradient is a hard half-frame split at x0.
    const double t = len2 < 1e-9 ? (x >= layer.x0 ? 1.0 : 0.0) : ((x - layer.x0) * dx + (y - layer.y0) * dy) / len2;
    // `feather` is the width of the transition band as a fraction of the
    // gradient; tiny values collapse it to a hard edge at the midpoint.
    const double fe = std::min(1.0, std::max(layer.feather, 0.02));
    return smooth01((t - (1.0 - fe) / 2.0) / fe);
}

double radial_weight(const LocalLayer& layer, double x, double y, double aspect) {
    const double dx = x - layer.cx;
    const double dy = (y - layer.cy) * (layer.radius_y > 0.0 ? layer.radius / layer.radius_y : aspect);
    const double d = std::sqrt(dx * dx + dy * dy) / std::max(layer.radius, 1e-3);
    const double edge = std::max(layer.feather * 0.5, 1e-3);
    return smooth01((1.0 - d) / edge);
}

double mask_weight(const LocalLayer& layer, uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    const double nx = (double(x) + 0.5) / double(w);
    const double ny = (double(y) + 0.5) / double(h);
    const double aspect = double(w) / double(h);
    double weight = layer.kind == 1 ? radial_weight(layer, nx, ny, aspect) : linear_weight(layer, nx, ny);
    return layer.invert ? 1.0 - weight : weight;
}

void grade_pixel(float* rgb, const LocalLayer& layer, double weight) {
    if (weight <= 1e-6) return;
    const double w = weight;

    if (layer.exposure_ev != 0.0) {
        const float gain = float(std::exp2(layer.exposure_ev * w));
        rgb[0] *= gain; rgb[1] *= gain; rgb[2] *= gain;
    }
    if (layer.temperature != 0.0 || layer.tint != 0.0) {
        const double t = layer.temperature / 100.0 * w;
        const double g = layer.tint / 100.0 * w;
        rgb[0] = float(double(rgb[0]) * (1.0 + 0.25 * t) * (1.0 + 0.05 * g));
        rgb[1] = float(double(rgb[1]) * (1.0 - 0.20 * g));
        rgb[2] = float(double(rgb[2]) * (1.0 - 0.25 * t) * (1.0 + 0.05 * g));
    }
    if (layer.contrast != 0.0) {
        const double factor = 1.0 + layer.contrast / 100.0 * w;
        for (int c = 0; c < 3; ++c) rgb[c] = float(kMidGrey + (double(rgb[c]) - kMidGrey) * factor);
    }
    if (layer.highlights != 0.0 || layer.shadows != 0.0) {
        const double luma = luminance(rgb);
        const double highlight = clamp01((luma - kMidGrey) / (1.0 - kMidGrey));
        const double shadow = 1.0 - clamp01(luma / kMidGrey);
        const double factor = (1.0 + layer.highlights / 100.0 * w * highlight) *
                              (1.0 + layer.shadows / 100.0 * w * shadow);
        for (int c = 0; c < 3; ++c) rgb[c] = float(double(rgb[c]) * factor);
    }
    if (layer.saturation != 0.0) {
        const double luma = luminance(rgb);
        const double factor = 1.0 + layer.saturation / 100.0 * w;
        for (int c = 0; c < 3; ++c) rgb[c] = float(luma + (double(rgb[c]) - luma) * factor);
    }
    // Linear light tolerates small overshoot; clamp only outright negatives.
    for (int c = 0; c < 3; ++c)
        if (rgb[c] < 0.0f) rgb[c] = 0.0f;
}

}  // namespace

bool parse_local_layers(const Json& adjustments, std::vector<LocalLayer>& out, std::string& error) {
    out.clear();
    if (!adjustments.is_object()) {
        error = "adjustments must be an object";
        return false;
    }
    const Json& list = adjustments.at("localAdjustments");
    if (list.is_null()) return true;
    if (!list.is_array()) {
        error = "localAdjustments must be an array";
        return false;
    }
    if (list.items().size() > size_t(kMaxLayers)) {
        error = "localAdjustments supports at most 16 layers";
        return false;
    }
    for (size_t i = 0; i < list.items().size(); ++i) {
        const Json& raw = list.items()[i];
        if (!raw.is_object()) {
            error = "localAdjustments[" + std::to_string(i) + "] must be an object";
            return false;
        }
        LocalLayer layer;
        const std::string name = "localAdjustments[" + std::to_string(i) + "]";
        const Json& kind = raw.at("kind");
        if (kind.is_string()) {
            const std::string& text = kind.as_string();
            if (text == "linear") layer.kind = 0;
            else if (text == "radial") layer.kind = 1;
            else {
                error = name + ".kind must be 'linear' or 'radial'";
                return false;
            }
        } else if (kind.is_number()) {
            layer.kind = kind.as_int() == 1 ? 1 : 0;
        } else {
            error = name + ".kind must be 'linear' or 'radial'";
            return false;
        }
        layer.x0 = number_field(raw, "x0", 0.5, -1.0, 2.0, error, name.c_str());
        layer.y0 = number_field(raw, "y0", 0.0, -1.0, 2.0, error, name.c_str());
        layer.x1 = number_field(raw, "x1", 0.5, -1.0, 2.0, error, name.c_str());
        layer.y1 = number_field(raw, "y1", 1.0, -1.0, 2.0, error, name.c_str());
        layer.cx = number_field(raw, "cx", 0.5, -1.0, 2.0, error, name.c_str());
        layer.cy = number_field(raw, "cy", 0.5, -1.0, 2.0, error, name.c_str());
        layer.radius = number_field(raw, "radius", 0.5, 0.01, 2.0, error, name.c_str());
        if (raw.has("radiusY")) layer.radius_y = number_field(raw, "radiusY", 0.5, 0.02, 2.0, error, name.c_str());
        layer.feather = number_field(raw, "feather", 0.35, 0.0, 2.0, error, name.c_str());
        layer.invert = bool_field(raw, "invert", false, error, name.c_str());
        layer.exposure_ev = number_field(raw, "exposure", 0.0, -4.0, 4.0, error, name.c_str());
        layer.contrast = number_field(raw, "contrast", 0.0, -100.0, 100.0, error, name.c_str());
        layer.saturation = number_field(raw, "saturation", 0.0, -100.0, 100.0, error, name.c_str());
        layer.temperature = number_field(raw, "temperature", 0.0, -100.0, 100.0, error, name.c_str());
        layer.tint = number_field(raw, "tint", 0.0, -100.0, 100.0, error, name.c_str());
        layer.highlights = number_field(raw, "highlights", 0.0, -100.0, 100.0, error, name.c_str());
        layer.shadows = number_field(raw, "shadows", 0.0, -100.0, 100.0, error, name.c_str());
        if (!error.empty()) return false;
        out.push_back(layer);
    }
    return true;
}

void apply_local_layers(float* rgb, uint32_t w, uint32_t h, const std::vector<LocalLayer>& layers) {
    if (layers.empty() || w == 0 || h == 0) return;
    for (uint32_t y = 0; y < h; ++y) {
        float* row = rgb + size_t(y) * w * 3;
        for (uint32_t x = 0; x < w; ++x) {
            float* pixel = row + size_t(x) * 3;
            for (const LocalLayer& layer : layers) grade_pixel(pixel, layer, mask_weight(layer, x, y, w, h));
        }
    }
}

}  // namespace spkhost
