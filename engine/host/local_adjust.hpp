// local_adjust.hpp -- local adjustments (masked grades) for the Windows host.
//
// The engine's Layer 2 grade (white balance, exposure, curves, colour balance,
// vignette) is applied on the GPU inside spk::view::render. Local adjustments
// are a host-side pass on the rendered pixels: the host decodes the finished
// frame to linear light, evaluates one mask per adjustment, applies the grade
// with that mask's weight, and re-encodes. Keeping the pass here means the
// engine ABI, the parameter schema and the macOS behaviour stay untouched.
//
// Coordinates are normalised over the rendered frame (after crop, rotation and
// pair layout), so a mask follows the output picture, not the sensor.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "json.hpp"

namespace spkhost {

struct LocalLayer {
    int kind = 0;  // 0 = linear gradient, 1 = radial
    // Linear gradient: the mask ramps from 0 at (x0,y0) to 1 at (x1,y1).
    double x0 = 0.5, y0 = 0.0, x1 = 0.5, y1 = 1.0;
    // Radial: centre and radius (fractions of the frame's short edge).
    double cx = 0.5, cy = 0.5, radius = 0.5;
    // Feather softens the mask edge; 0 is a hard edge.
    double feather = 0.35;
    bool invert = false;
    // Grades. Exposure is in EV; the rest are -100..100 UI units.
    double exposure_ev = 0.0;
    double contrast = 0.0;
    double saturation = 0.0;
    double temperature = 0.0;  // positive = warmer
    double tint = 0.0;         // positive = magenta
    double highlights = 0.0;
    double shadows = 0.0;
};

// Parses `adjustments.localAdjustments`. An absent/empty array yields an empty
// list (the caller then skips the pass). Malformed layers are a bad request.
bool parse_local_layers(const spk::Json& adjustments, std::vector<LocalLayer>& out, std::string& error);

// Applies the layers to a w*h*3 linear-light RGB buffer in place.
void apply_local_layers(float* rgb, uint32_t w, uint32_t h, const std::vector<LocalLayer>& layers);

}  // namespace spkhost
