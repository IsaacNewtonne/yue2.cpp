#pragma once
// audio-polish.h: optional vocal polish and loudness stage through FFmpeg.
//
// "mix" runs a gentle chain over the whole mix: rumble high-pass, a small
// mud cut around 280 Hz, a presence lift around 3.2 kHz, a de-esser and 2:1
// compression. "stems" separates the take with BS-RoFormer (the same local
// audio-separator the vocal balance uses), runs a stronger chain on the
// vocal stem only and remixes it over the untouched instrumental. Either is
// followed by EBU R128 loudness (-14 or -23 LUFS) when a mastering profile is
// set, or a peak limiter otherwise. The dry take is kept by the caller for A/B.

#include "audio-master.h"
#include "audio-vocal-balance.h"

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

static const char * AUDIO_POLISH_MIX_CHAIN =
    "highpass=f=28,"
    "equalizer=f=280:t=q:w=1.1:g=-1.5,"
    "equalizer=f=3200:t=q:w=1.0:g=1.5,"
    "deesser=i=0.35:m=0.5:f=0.5:s=o,"
    "acompressor=threshold=0.125:ratio=2:attack=15:release=220:makeup=1.4:knee=4";

static const char * AUDIO_POLISH_VOCAL_CHAIN =
    "highpass=f=90,"
    "equalizer=f=250:t=q:w=1.2:g=-2,"
    "equalizer=f=3500:t=q:w=1.0:g=2.5,"
    "deesser=i=0.5:m=0.5:f=0.5:s=o,"
    "acompressor=threshold=0.1:ratio=3:attack=8:release=160:makeup=1.6:knee=4";

// The loudness or limiter tail of the chain, then exact length restored.
static std::string audio_polish_tail(const std::string & profile, int sample_rate, int samples) {
    std::string tail;
    if (profile == "streaming") tail = "loudnorm=I=-14:LRA=11:TP=-1";
    else if (profile == "broadcast") tail = "loudnorm=I=-23:LRA=11:TP=-1";
    else tail = "alimiter=limit=0.97:latency=1";
    const std::string rate = std::to_string(sample_rate);
    return tail + ",aresample=" + rate + ",apad=whole_len=" + std::to_string(samples) + ",atrim=end_sample=" +
           std::to_string(samples) + ",asetpts=PTS-STARTPTS";
}

static bool audio_polish_master(const float * audio, int samples, int sample_rate, const std::string & polish,
                                const std::string & profile, std::vector<float> * out, std::string * note,
                                std::string * error) {
    if (!audio || samples <= 0 || !out) {
        if (error) *error = "no audio to polish";
        return false;
    }
    if (polish != "mix" && polish != "stems") {
        if (error) *error = "vocal_polish must be off, mix or stems";
        return false;
    }
    namespace fs = std::filesystem;
    static std::atomic<uint64_t> serial{0};
    const uint64_t stamp = (uint64_t) std::chrono::steady_clock::now().time_since_epoch().count();
    fs::path dir;
    try {
        dir = fs::temp_directory_path() / ("yue2-polish-" + std::to_string(stamp) + "-" + std::to_string(serial.fetch_add(1)));
        fs::create_directories(dir);
    } catch (const std::exception & e) {
        if (error) *error = std::string("cannot create temporary paths: ") + e.what();
        return false;
    }
    struct Cleanup {
        fs::path path;
        ~Cleanup() { std::error_code ec; fs::remove_all(path, ec); }
    } cleanup{dir};
    auto write = [](const fs::path & path, const std::string & data) {
        std::ofstream file(path, std::ios::binary);
        file.write(data.data(), (std::streamsize) data.size());
        return (bool) file;
    };
    const fs::path mix = dir / "mix.wav", output = dir / "polished.wav";
    if (!write(mix, audio_encode_wav_f32(audio, samples, sample_rate))) {
        if (error) *error = "could not write temporary audio for vocal polish";
        return false;
    }
    const std::string rate = std::to_string(sample_rate), tail = audio_polish_tail(profile, sample_rate, samples);
    std::vector<std::string> args;
    bool stems = false;
    if (polish == "stems") {
        std::vector<float> unused;
        std::string vocal, backing, separation_error;
        if (audio_vocal_balance_ffmpeg(audio, samples, sample_rate, 0.0f, false, &unused, nullptr, &separation_error,
                                       &vocal, &backing) &&
            write(dir / "vocals.wav", vocal) && write(dir / "instrumental.wav", backing)) {
            stems = true;
            args = { "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
                     "-i", (dir / "instrumental.wav").string(), "-i", (dir / "vocals.wav").string(),
                     "-filter_complex", std::string("[1:a]") + AUDIO_POLISH_VOCAL_CHAIN +
                         "[v];[0:a][v]amix=inputs=2:duration=longest:normalize=0," + tail + "[out]",
                     "-map", "[out]", "-ar", rate, "-c:a", "pcm_f32le", output.string() };
        } else if (note) {
            *note = "Stem vocal polish was unavailable (" + separation_error + "); the whole-mix polish was used. ";
        }
    }
    if (!stems) {
        args = { "ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", mix.string(),
                 "-af", std::string(AUDIO_POLISH_MIX_CHAIN) + "," + tail, "-ar", rate, "-c:a", "pcm_f32le",
                 output.string() };
    }
    const int status = audio_vocal_run("ffmpeg", args);
    if (status != 0) {
        if (error) *error = status == -1 ? "FFmpeg was not found on PATH" : "FFmpeg vocal polish failed";
        return false;
    }
    int got_samples = 0, got_rate = 0;
    float * decoded = audio_io_read_wav(output.string().c_str(), &got_samples, &got_rate);
    if (!decoded) {
        if (error) *error = "FFmpeg did not produce readable polished audio";
        return false;
    }
    if (got_samples != samples || got_rate != sample_rate) {
        free(decoded);
        if (error) *error = "polished audio format changed unexpectedly";
        return false;
    }
    out->assign(decoded, decoded + (size_t) got_samples * 2);
    free(decoded);
    return true;
}
