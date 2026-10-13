#include "song-ending.h"
#include "request.h"
#include <cstdlib>
#include <cstdio>
#include <vector>

static void check(bool ok, const char * message) {
    if (!ok) { std::fprintf(stderr, "FAIL: %s\n", message); std::exit(1); }
}

int main() {
    Yue2Request r;
    request_init(&r);
    check(r.semantic_sampling.max_tokens == 15000, "default permits ten minutes");
    check(r.abc_sampling.max_tokens == 8192, "score has room to finish");
    check(song_frame_budget(0, 15000, 24576, 7000) == 15000, "auto has no estimated cutoff");
    check(song_frame_budget(600, 15000, 24576, 7000) == 15000, "ten minutes is not six minutes");
    check(song_frame_budget(30, 15000, 24576, 7000) == 750, "explicit duration respected");
    check(song_frame_budget(0, 2000, 24576, 7000) == 2000, "custom token ceiling respected");
    check(song_frame_budget(0, 15000, 24576, 12000) == 12575, "context reserves end token");
    check(song_frame_budget(0, 15000, 100, 100) == 0, "full context rejected");
    r.generation_warning = "Incomplete take";
    check(request_to_json(&r).find("Incomplete take") != std::string::npos, "warning survives output");
    check(request_parse_json(&r, "{\"duration\":0,\"semantic_sampling\":{\"max_tokens\":1200}}"), "parse request");
    check(r.duration == 0 && r.semantic_sampling.max_tokens == 1200, "manual budget preserved");
    check(r.generation_warning.empty(), "input cannot forge an output warning");
    for (int n : {1, 2, 40, 48000}) {
        std::vector<float> audio((size_t) n * 2);
        for (int i = 0; i < n; ++i) { audio[i] = 0.5f; audio[n+i] = -0.25f; }
        song_declick_end(audio.data(), n, 48000);
        check(audio[n-1] == 0 && audio[2*n-1] == 0, "both channels finish at zero");
        for (int i = 0; i < n; ++i) {
            check(std::isfinite(audio[i]) && audio[i] >= 0 && audio[i] <= 0.5f, "bounded finite fade");
            check(audio[n+i] == -0.5f * audio[i], "stereo image preserved");
            if (i < n - 4000) check(audio[i] == 0.5f, "earlier music unchanged");
        }
    }
    song_declick_end(nullptr, 0, 48000);
    std::puts("PASS: automatic/manual/context budgets, warning metadata, stereo end de-click");
}
