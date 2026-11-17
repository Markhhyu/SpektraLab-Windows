// The host's resident-editor budget (P0-3).
//
// Every open editor keeps its source, its cached negative and its last view on
// the device. Measured on an 8 GB RTX 4070 Laptop: five open photographs held
// 5.38 GB and 6846 MiB of device memory, and opening one degraded from
// 1.5-2.2 s to 8.4-8.9 s. The fix is a cap: editors past it go to their
// on-disk residency snapshot (`spk::view::suspend`) and come back on the next
// request that touches them, so the cap moves work and never pixels.
//
// The policy itself touches no GPU, which is what lets it be tested on its own
// (`tests/host_residency.cpp`). The host owns the actual suspend calls.
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <vector>

namespace spkhost {

// One open editor as the budget sees it.
struct EditorResidency {
    // Recency stamp; larger is more recent. The host bumps it on every request
    // that reaches the editor.
    uint64_t last_used = 0;
    // Already off the device (its bytes are the residency snapshot on disk).
    bool suspended = false;
};

// Indices of the editors to suspend, oldest first, so that at most `limit`
// editors stay resident. Suspended editors are already off the device: they
// are neither counted against the limit nor returned again. A limit of 0
// suspends every resident editor -- the next request that touches one resumes
// it, which is what makes 0 legal for a batch run that wants the device empty.
//
// Ties on `last_used` break by index so the same registry always yields the
// same victims; the tests pin that.
inline std::vector<std::size_t> editors_to_suspend(const std::vector<EditorResidency>& editors,
                                                   std::size_t limit) {
    std::vector<std::size_t> resident;
    resident.reserve(editors.size());
    for (std::size_t i = 0; i < editors.size(); ++i)
        if (!editors[i].suspended) resident.push_back(i);
    if (resident.size() <= limit) return {};
    std::stable_sort(resident.begin(), resident.end(), [&](std::size_t a, std::size_t b) {
        if (editors[a].last_used != editors[b].last_used) return editors[a].last_used < editors[b].last_used;
        return a < b;
    });
    // `resident` is now oldest first; keep the `limit` newest.
    resident.resize(resident.size() - limit);
    return resident;
}

// How many editors stay resident. Two keeps a frame flip and its neighbour
// warm on an 8 GB card; a machine with more device memory can raise it, and
// the environment override exists so tests and batch runs can pin 0 or 1.
inline std::size_t resident_editor_limit() {
    static const std::size_t limit = [] {
        const char* text = std::getenv("SPEKTRAFILM_HOST_RESIDENT_EDITORS");
        if (!text) return std::size_t(2);
        char* end = nullptr;
        const long value = std::strtol(text, &end, 10);
        return end != text && value >= 0 ? std::size_t(value) : std::size_t(2);
    }();
    return limit;
}

}  // namespace spkhost
