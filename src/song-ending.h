#pragma once
#include <algorithm>
#include <cmath>

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
