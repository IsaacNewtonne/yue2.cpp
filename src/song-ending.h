#pragma once
#include <algorithm>
#include <cmath>
#include <string>

static std::string song_limit_reason(float duration, int requested, int context, int prefix) {
    const int duration_frames = (int) ((duration > 0.0f ? duration : 600.0f) * 25.0f);
    const int available = context - prefix - 1;
    std::string reason;
    auto add = [&](const char * text) { if (!reason.empty()) reason += " and "; reason += text; };
    if (duration_frames <= requested && duration_frames <= available)
        add(duration > 0.0f ? "the selected duration limit" : "Auto duration's 10-minute limit");
    if (requested < duration_frames && requested <= available) add("the performance token limit");
    if (available <= duration_frames && available <= requested) add("the model context limit");
    return reason;
}

static std::string song_ending_warning(bool score_cut, bool performance_cut, const std::string & limit, bool automatic) {
    if (!score_cut && !performance_cut) return "";
    std::string warning;
    if (score_cut) warning = "Composition reached its token or context limit before completing the score. ";
    if (performance_cut) warning += "Performance reached " + limit + " before its natural ending. ";
    warning += "This take may be incomplete. ";
    if (automatic) warning += "Auto duration was enabled, but model and length limits still apply. ";
    else if (performance_cut) warning += "Try Auto duration. ";
    warning += "Try shorter lyrics and a fresh composition.";
    return warning;
}

// Duration is a ceiling, not a target to fill. Auto lets the model emit its
// natural end token, bounded by ten minutes, the caller's budget and context.
static int song_frame_budget(float duration, int requested, int context, int prefix) {
    const int seconds_budget = (int) ((duration > 0.0f ? duration : 600.0f) * 25.0f);
    return std::max(0, std::min({requested, seconds_budget, context - prefix - 1}));
}

// De-click only: leave the composition and its decay intact. This cannot turn
// an incomplete performance into a musical ending or remove generated noise.
// Apply to planar stereo before export, including the float WAV path.
static void song_declick_end(float * audio, int samples, int rate) {
    if (!audio || samples <= 0 || rate <= 0) return;
    const int count = std::min(samples, std::max(2, rate / 12)); // ~83 ms
    for (int i = 0; i < count; ++i) {
        const float x = count > 1 ? (float) i / (float) (count - 1) : 1.0f;
        const float gain = 0.5f * (1.0f + std::cos(3.14159265358979323846f * x));
        const int at = samples - count + i;
        audio[at] *= gain;
        audio[samples + at] *= gain;
    }
}
