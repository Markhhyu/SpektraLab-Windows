// spk_diffusion_psf -- the diffusion filter's host tables against the oracle.
//
// Ported from the macOS 2.x line (`core/diffusion_psf.cpp` is a literal port of
// `spektrafilm/model/diffusion.py`). The goldens below were computed from the
// public reference package: `_strength_to_scatter` for the four families, and
// `_resolve_family_cfg` / `_expand_group` / `_halo_channel_weights` composed the
// same way `build_psf` composes them (the macOS `diffusion_checks.py` holds the
// same numbers to 1e-12 against the oracle).
//
// What is checked, and why each one can fail:
//
//   strength -> p_s   every family's deflected-photon fraction, the model's only
//                     scalar: a wrong table changes how strong "1/2 Black Mist"
//                     is, on every picture.
//   the PSF           one full configuration (black_pro_mist 1/2): every
//                     exponential's lambda and per-channel weight, and the group
//                     order the application reads. A typo in any table shows up.
//   unit mass         each channel's weights sum to 1, so the scatter conserves
//                     energy and a grey field is unchanged by the filter.
//   spatial scale     doubles every lambda and nothing else.
//   warmth            the energy-conserving redistribution: at the outer halo,
//                     +1 makes red stronger and blue weaker; every channel still
//                     sums to 1.
//   off / bad input   inactive or zero strength is the identity (p_s = 0, no
//                     exponentials); an unknown family is a named error.
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "diffusion_psf.hpp"

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::printf("%s%s\n", ok ? "ok   " : "FAIL ", what.c_str());
    if (!ok) ++failures;
}

bool near(double a, double b, double tolerance = 1e-12) {
    return std::fabs(a - b) <= tolerance * std::max({1.0, std::fabs(a), std::fabs(b)});
}

spk::DiffusionFilterParams params(const char* family, double strength = 0.5, double scale = 1.0,
                                  double warmth = 0.0) {
    spk::DiffusionFilterParams p;
    p.active = true;
    p.filter_family = family;
    p.strength = strength;
    p.spatial_scale = scale;
    p.halo_warmth = warmth;
    return p;
}

}  // namespace

int main() {
    // --- strength -> p_s, from the oracle's `_strength_to_scatter` ------------
    struct Row { const char* family; double p_s[4]; };
    const Row rows[] = {
        {"glimmerglass", {0.13, 0.2275, 0.3575, 0.4875}},
        {"black_pro_mist", {0.15, 0.2625, 0.4125, 0.5625}},
        {"pro_mist", {0.21, 0.3675, 0.5775, 0.7875}},
        {"cinebloom", {0.20, 0.35, 0.55, 0.75}},
    };
    const double strengths[4] = {0.25, 0.5, 1.0, 2.0};
    for (const Row& row : rows) {
        if (!spk::diffusion::family_shape(row.family)) {
            check(false, std::string("family '") + row.family + "' exists");
            continue;
        }
        for (int i = 0; i < 4; ++i) {
            const double got = spk::diffusion::strength_to_scatter(strengths[i], row.family);
            check(near(got, row.p_s[i]),
                  std::string(row.family) + " strength " + std::to_string(strengths[i]) +
                      " -> p_s " + std::to_string(got));
        }
    }

    std::string error;
    {
        spk::diffusion::Psf psf;
        check(!spk::diffusion::build_psf(params("no_such_filter"), psf, error),
              "unknown family is refused: " + error);
    }
    {
        spk::DiffusionFilterParams off = params("black_pro_mist");
        off.active = false;
        spk::diffusion::Psf psf;
        check(spk::diffusion::build_psf(off, psf, error) && psf.p_s == 0.0 && psf.exps.empty(),
              "inactive is the identity (p_s 0, no components)");
        spk::DiffusionFilterParams zero = params("black_pro_mist", 0.0);
        check(spk::diffusion::build_psf(zero, psf, error) && psf.p_s == 0.0 && psf.exps.empty(),
              "zero strength is the identity");
    }

    // --- one full configuration, the oracle's numbers -------------------------
    struct Exp { double lambda_um, w[3]; int group; };
    const Exp golden[] = {
        {10.666666666666668, {0.20000000000000001, 0.20000000000000001, 0.20000000000000001}, 0},
        {24.000000000000004, {0.20000000000000001, 0.20000000000000001, 0.20000000000000001}, 0},
        {47.499999999999993, {0.02428333333333332, 0.14139166666666667, 0.30432500000000001}, 1},
        {95, {0.15666666666666665, 0.15666666666666668, 0.15666666666666668}, 1},
        {190, {0.28904999999999997, 0.17194166666666666, 0.0090083333333333335}, 1},
        {152, {0.08004926108374387, 0.08004926108374387, 0.08004926108374387}, 2},
        {279.98639389666948, {0.032019704433497526, 0.032019704433497526, 0.032019704433497526}, 2},
        {515.73934715303221, {0.012807881773399017, 0.012807881773399017, 0.012807881773399017}, 2},
        {950.00000000000011, {0.0051231527093596055, 0.0051231527093596055, 0.0051231527093596055}, 2},
    };
    {
        spk::diffusion::Psf psf;
        const bool built = spk::diffusion::build_psf(params("black_pro_mist"), psf, error);
        check(built, "black_pro_mist 1/2 builds: " + error);
        if (built) {
            check(near(psf.p_s, 0.2625), "p_s 0.2625");
            check(psf.exps.size() == sizeof(golden) / sizeof(golden[0]),
                  "nine exponentials (2 core + 3 halo + 4 bloom)");
            bool matched = true;
            for (size_t i = 0; i < psf.exps.size() && i < sizeof(golden) / sizeof(golden[0]); ++i) {
                const spk::diffusion::Exponential& e = psf.exps[i];
                matched = matched && near(e.lambda_um, golden[i].lambda_um) &&
                          e.group == golden[i].group;
                for (int c = 0; c < 3; ++c) matched = matched && near(e.weight[c], golden[i].w[c]);
            }
            check(matched, "every lambda, weight and group matches the oracle");
            for (int c = 0; c < 3; ++c) {
                double sum = 0.0;
                for (const auto& e : psf.exps) sum += e.weight[c];
                check(near(sum, 1.0), "channel " + std::to_string(c) + " is unit mass");
            }
        }
    }

    // --- spatial scale and warmth ---------------------------------------------
    {
        spk::diffusion::Psf one, two;
        spk::diffusion::build_psf(params("black_pro_mist", 0.5, 1.0), one, error);
        spk::diffusion::build_psf(params("black_pro_mist", 0.5, 2.0), two, error);
        bool scaled = one.exps.size() == two.exps.size() && !one.exps.empty();
        for (size_t i = 0; scaled && i < one.exps.size(); ++i)
            scaled = near(two.exps[i].lambda_um, 2.0 * one.exps[i].lambda_um);
        check(scaled, "spatial_scale 2 doubles every lambda");
    }
    {
        spk::diffusion::Psf neutral, warm;
        spk::diffusion::build_psf(params("black_pro_mist"), neutral, error);
        spk::diffusion::build_psf(params("black_pro_mist", 0.5, 1.0, 1.0), warm, error);
        // The outer halo is the exponential at lambda 190 um (index 4).
        check(neutral.exps.size() == warm.exps.size() && neutral.exps.size() > 4,
              "warmth keeps the component list");
        if (neutral.exps.size() > 4 && warm.exps.size() > 4) {
            const double dr = warm.exps[4].weight[0] - neutral.exps[4].weight[0];
            const double db = warm.exps[4].weight[2] - neutral.exps[4].weight[2];
            check(dr > 0.0 && db < 0.0, "warmth +1: the outer halo is redder, less blue");
            for (int c = 0; c < 3; ++c) {
                double sum = 0.0;
                for (const auto& e : warm.exps) sum += e.weight[c];
                check(near(sum, 1.0), "warmth channel " + std::to_string(c) + " stays unit mass");
            }
        }
    }

    if (failures == 0) std::printf("\nall checks passed\n");
    else std::printf("\n%d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
