#pragma once
#include <functional>
// pipeline.h: YuE2 generation pipeline
//
// Turns one request into tracks: a symbolic plan, a semantic token stream,
// the acoustic flow matching solved from the AR prefix cache, and the VAE
// decode to 48 kHz stereo, for every song of the batch and every noise
// variation of a song.
//
// The modules come from a ModelStore: the AR half for the two token stages,
// the NAR half and the VAE for the synthesis, required per stage and
// released after it, so the store can keep one half in VRAM at a time. The
// KV cache belongs to the pipeline: the NAR reads the cache the AR decode
// left complete, end token included, so a generated song that fits one
// chunk never prefills, and the cache outlives both halves. It lives for
// one generate under the strict policy, so the GPU is empty between
// requests, and stays under --keep-loaded.

#include "generate.h"
#include "model-store.h"
#include "nar.h"
#include "request.h"
#include "score-check.h"
#include "score-sanity.h"
#include "lyric-schedule.h"
#include "song-ending.h"
#include "timer.h"
#include "torch-cpu-rng.h"
#include "vae.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <string>
#include <vector>

#define YUE2_SAMPLE_RATE 48000
#define YUE2_FRAME_RATE  25
#define YUE2_LATENT_DIM  64
#define YUE2_HOP         1920

// VRAM and compatibility knobs. The store policy decides which half stays
// resident; max_seq and max_batch size the cache, which the pipeline owns
// and never evicts.
struct Yue2PipelineParams {
    int  max_seq    = 0;              // 0 = model context, the whole 24576
    int  max_batch  = 1;              // song batch limit, one KV set per song, two under guidance
    bool no_fa      = false;          // disable flash attention
    bool clamp_fp16 = false;          // clamp hidden states on sub-Ampere CUDA
    int  vae_core   = 512;            // VAE tile core frames
    int  vae_halo   = 16;             // VAE tile halo frames

    const char * dump_dir = nullptr;  // probe dumps of the first track for the cossim harness
};

struct Yue2Pipeline {
    std::function<void(const char *, int, int)> progress;
    ModelStore *       store = nullptr;   // borrowed, owned by the tool
    std::string        model_path;        // the backbone GGUF, both halves and the tokenizer
    std::string        vae_path;
    std::string        transcriber_path;  // the SheetSage2 GGUF, empty without one
    Yue2PipelineParams params;
    DebugDumper        dumper;

    // The cache, bound at configure to its config and to the shared backend,
    // held for the process lifetime. Each stage sizes it to what the request
    // needs, never past context: the model context or the max_seq override.
    Qw3lmKvCache kv;
    BackendPair  kv_backend;
    int          context    = 0;
    bool         configured = false;
};

struct Yue2Song {
    std::string        score;      // ABC of the plan, empty in off mode
    std::vector<int>   tokens;     // semantic stream, codec values
    std::vector<float> latents;    // acoustic latents, [T_lat, 64] time major
    std::vector<float> audio;      // planar stereo, [2, T_audio]
    int                T_audio;    // samples per channel
    int                T_lat;      // semantic frames
    bool               truncated;  // a stage hit its budget before its end token
    std::string        ending_warning;
};

// Parses the CSV interchange of a semantic stream
static bool pipeline_parse_tokens(const std::string & csv, std::vector<int> * out) {
    out->clear();
    const char * p = csv.c_str();
    while (*p) {
        while (*p == ',' || *p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') {
            p++;
        }
        if (!*p) {
            break;
        }
        char * end   = nullptr;
        long   value = strtol(p, &end, 10);
        if (end == p || value < 0 || value >= YUE2_CODEC_SIZE) {
            fprintf(stderr, "[Pipeline] FATAL: semantic token outside [0, %d)\n", YUE2_CODEC_SIZE);
            return false;
        }
        out->push_back((int) value);
        p = end;
    }
    return !out->empty();
}

// Writes the CSV interchange of a semantic stream
static std::string pipeline_format_tokens(const std::vector<int> & tokens) {
    std::string csv;
    for (size_t i = 0; i < tokens.size(); i++) {
        csv += (i ? "," : "") + std::to_string(tokens[i]);
    }
    return csv;
}

// Record the paths and the knobs, load the tokenizer, read the backbone
// config the cache is sized from. No GPU module loads here, the first
// generate requires them and allocates the cache.
static bool pipeline_configure(Yue2Pipeline *             p,
                               const char *               model_path,
                               const char *               vae_path,
                               const Yue2PipelineParams & params) {
    p->model_path = model_path;
    p->vae_path   = vae_path;
    p->params     = params;
    debug_init(&p->dumper, params.dump_dir);
    if (params.no_fa) {
        fprintf(stderr, "[Pipeline] Flash attention disabled\n");
    }
    if (params.clamp_fp16) {
        fprintf(stderr, "[Pipeline] FP16 clamp enabled\n");
    }
    if (!store_bpe(p->store, model_path)) {
        return false;
    }

    Qwen3LMConfig cfg;
    if (!qw3lm_read_config(model_path, &cfg)) {
        return false;
    }
    if (params.max_seq > 0) {
        cfg.max_seq_len = params.max_seq;
    }
    p->context    = cfg.max_seq_len;
    p->kv_backend = backend_init("KV");
    qw3lm_kv_init(&p->kv, cfg, p->kv_backend.backend);
    p->configured = true;
    return true;
}

static void pipeline_free(Yue2Pipeline * p) {
    if (!p->configured) {
        return;
    }
    qw3lm_kv_free(&p->kv);
    backend_release(p->kv_backend.backend, p->kv_backend.cpu_backend);
    p->configured = false;
}

// Require helpers: one place builds the store key of each module from the
// configured paths, and applies the runtime knobs after every require
// (idempotent on cache hits). The NAR bakes them into its graph at build
// time, the LM reads them at every forward.
static Qwen3LM * require_lm(Yue2Pipeline * p) {
    ModelKey  k = { MODEL_LM, p->model_path };
    Qwen3LM * m = store_require_lm(p->store, k);
    if (m) {
        m->use_flash_attn = m->use_flash_attn && !p->params.no_fa;
        m->clamp_fp16     = p->params.clamp_fp16;
    }
    return m;
}

static Yue2NAR * require_nar(Yue2Pipeline * p) {
    ModelKey  k = { MODEL_NAR, p->model_path };
    Yue2NAR * m = store_require_nar(p->store, k);
    if (m) {
        m->use_flash_attn = m->use_flash_attn && !p->params.no_fa;
        m->clamp_fp16     = p->params.clamp_fp16;
    }
    return m;
}

static VAEGGML * require_vae(Yue2Pipeline * p) {
    ModelKey k = { MODEL_VAE, p->vae_path };
    return store_require_vae(p->store, k);
}

static SheetSage2 * require_ss2(Yue2Pipeline * p) {
    ModelKey     k = { MODEL_SS2, p->transcriber_path };
    SheetSage2 * m = store_require_ss2(p->store, k);
    if (m) {
        m->use_flash_attn = m->use_flash_attn && !p->params.no_fa;
    }
    return m;
}

// A recording to its ABC score, the chord symbols dropped when only the
// melody is wanted. The transcriber holds the GPU for the call and steps
// aside after it like the other stages.
static bool pipeline_transcribe(Yue2Pipeline * p,
                                const float *  audio,
                                int            n_samples,
                                bool           melody_only,
                                std::string *  abc,
                                std::string *  error) {
    SheetSage2 * m = require_ss2(p);
    if (!m) {
        *error = "transcriber unavailable";
        return false;
    }
    ModelHandle hold(p->store, m);
    return ss2_transcribe(m, audio, n_samples, melody_only, abc, error, &p->dumper);
}

// Size the cache for a stage that prefills from position 0. The capacity is
// padded like the attention window, so every padded read spans what it did
// over the full context and the output does not change.
static void pipeline_kv_capacity(Yue2Pipeline * p, int need) {
    int padded = (int) GGML_PAD(need, 256);
    qw3lm_kv_capacity(&p->kv, padded < p->context ? padded : p->context);
}

// The cache of one generate: the stages grow it to the sets they need, a
// replay to the one set its prefill fills. Freed on every exit under the
// strict policy, kept under the other.
struct KvScope {
    Yue2Pipeline * p;

    ~KvScope() {
        if (store_policy(p->store) == EVICT_STRICT) {
            qw3lm_kv_free(&p->kv);
        }
    }
};

// Renders lm_batch_size songs times synth_batch_size variations, song-major:
// track song * M + variation. Song i draws its tokens with lm_seed + i in
// KV set i, variation j draws its noise with seed + j, and the M variations
// of a song solve in one NAR graph over the set the AR left complete.
// Byte offset of codepoint cp in UTF-8 text, or -1 past its end.
// (lyric schedule, timoncool/yue2.cpp 21b3831, MIT)
static int64_t pipeline_cp_to_byte(const std::string & text, int64_t cp) {
    int64_t n = 0;
    size_t  i = 0;
    while (n < cp && i < text.size()) {
        const unsigned char c = (unsigned char) text[i];
        i += c < 0x80 ? 1 : c < 0xE0 ? 2 : c < 0xF0 ? 3 : 4;
        n++;
    }
    return n == cp && i <= text.size() ? (int64_t) i : -1;
}

// The prompt rows of every scheduled lyric section. The prompt opens with EOD,
// then the request text, whose lyrics end one newline before its end; a token's
// bytes come from decoding it alone, byte-level BPE making them add up to the text.
static bool pipeline_lyric_mask(const BPETokenizer * tok, const Yue2Request & r, Yue2Cot cot,
                                const std::vector<Yue2LyricSection> & sections, Yue2PromptMask * out) {
    const Yue2LyricSchedule & sc   = r.lyric_schedule;
    const std::string         text = yue2_request_text(cot, r.style, r.lyrics);
    const std::vector<int>    ids  = bpe_encode(tok, text);
    std::vector<int64_t>      ends(ids.size());
    int64_t                   at = 0;
    for (size_t k = 0; k < ids.size(); k++) {
        at += (int64_t) bpe_decode(tok, { ids[k] }).size();
        ends[k] = at;
    }
    if (at != (int64_t) text.size()) {
        fprintf(stderr, "[Pipeline] FATAL: lyric_schedule: the prompt tokens do not add up to its text\n");
        return false;
    }
    const int64_t lyrics_at = (int64_t) (text.size() - r.lyrics.size() - 1);
    out->start_sec.clear();
    out->rows.clear();
    for (size_t s = 0; s < sections.size(); s++) {
        const int64_t b0 = pipeline_cp_to_byte(r.lyrics, sections[s].lyric_c0);
        const int64_t b1 = pipeline_cp_to_byte(r.lyrics, sections[s].lyric_c1);
        if (b0 < 0 || b1 <= b0) {
            fprintf(stderr, "[Pipeline] FATAL: lyric_schedule: section %zu lies outside the lyrics\n", s);
            return false;
        }
        int64_t first = -1, last = -1, begin = 0;
        for (size_t k = 0; k < ids.size(); k++) {
            if (begin < lyrics_at + b1 && ends[k] > lyrics_at + b0) {
                if (first < 0) {
                    first = (int64_t) k;
                }
                last = (int64_t) k;
            }
            begin = ends[k];
        }
        out->start_sec.push_back(sections[s].start_sec);
        out->rows.push_back(first < 0 ? std::make_pair<int64_t, int64_t>(1, 1) : std::make_pair(first + 1, last + 2));
        fprintf(stderr, "[Pipeline] Lyric schedule: section %zu from %.2f s, prompt rows [%lld, %lld)\n", s,
                sections[s].start_sec, (long long) out->rows.back().first, (long long) out->rows.back().second);
    }
    out->bias      = sc.bias;
    out->lead_sec  = sc.lead_sec;
    out->behind    = sc.behind;
    out->frame_sec = 1.0 / (double) YUE2_FRAME_RATE;
    return true;
}

static bool pipeline_generate(Yue2Pipeline *          p,
                              const Yue2Request &     r,
                              std::vector<Yue2Song> * songs,
                              bool (*cancelled)(void *) = nullptr,
                              void * cancel_data        = nullptr) {
    Timer   total_timer;
    Yue2Cot cot;
    if (!yue2_cot_parse(r.cot, &cot)) {
        fprintf(stderr, "[Pipeline] FATAL: cot must be full, melody or off\n");
        return false;
    }
    if (r.steps < 1 || r.lm_batch_size < 1 || r.synth_batch_size < 1) {
        fprintf(stderr, "[Pipeline] FATAL: steps and batch sizes must be positive\n");
        return false;
    }
    if (!yue2_sampling_valid(r.abc_sampling, "abc") || !yue2_sampling_valid(r.semantic_sampling, "semantic")) {
        return false;
    }
    if (!r.invalid.empty()) {
        fprintf(stderr, "[Pipeline] FATAL: %s\n", r.invalid.c_str());
        return false;
    }
    Yue2Solver solver;
    if (!yue2_solver_parse(r.solver, &solver)) {
        fprintf(stderr, "[Pipeline] FATAL: solver must be \"midpoint\" or \"ab2\", not \"%s\"\n", r.solver.c_str());
        return false;
    }

    KvScope kv_scope = { p };

    BPETokenizer * tok    = store_bpe(p->store, p->model_path.c_str());
    auto           encode = [tok](const std::string & text) {
        return bpe_encode(tok, text);
    };

    // A supplied stream is one song, the batch counter has nothing to draw
    bool replay = !r.semantic_tokens.empty();
    if (replay && r.lm_batch_size > 1) {
        fprintf(stderr, "[Pipeline] Replay: lm_batch_size ignored\n");
    }
    const int B = replay ? 1 : r.lm_batch_size;
    const int M = r.synth_batch_size;

    // Score per song: supplied by the caller, planned by the model, or absent
    std::vector<std::vector<int>> abc_ids(B);
    std::vector<std::string>      scores(B);
    std::vector<bool>             truncated(B, false);
    std::vector<std::string>      score_warnings(B);
    bool                          has_score = cot != YUE2_COT_OFF;
    bool                          planned   = has_score && r.abc.empty();

    // The AR half holds the GPU for the plan and the semantic stage, then
    // steps aside for the synthesis
    std::optional<ModelHandle> lm_hold;
    Qwen3LM *                  lm = nullptr;
    if (planned || !replay) {
        lm = require_lm(p);
        if (!lm) {
            return false;
        }
        lm_hold.emplace(p->store, lm);
    }
    if (has_score && !r.abc.empty()) {
        abc_ids.assign(B, encode(r.abc));
        scores.assign(B, r.abc);
    } else if (has_score) {
        if(p->progress) p->progress("Composing score",0,0);
        std::vector<int>            open = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, nullptr);
        std::vector<Yue2Generation> plans;
        Yue2Sampling score_sampling = r.abc_sampling;
        // Leave room for the score terminator and a usable performance prefix.
        score_sampling.max_tokens = std::min(score_sampling.max_tokens, p->context - (int) open.size() - 4);
        if (score_sampling.max_tokens < 1) return false;
        score_sampling.min_tokens = std::min(score_sampling.min_tokens, score_sampling.max_tokens - 1);
        pipeline_kv_capacity(p, (int) open.size() + score_sampling.max_tokens + 1);
        // Harmony steering of the plan, opt-in (timoncool/yue2.cpp 1e21e63)
        std::vector<std::string> texts;
        Yue2HarmonyPlan          harmony;
        if (r.harmony.active()) {
            texts   = bpe_decode_each(tok, YUE2_EOD);
            harmony = yue2_harmony_plan(r.harmony, &texts, YUE2_ABC_END);
            fprintf(stderr,
                    "[Harmony] %s strength=%.2f window=%d hold=%d outside=%.2f/%.2f section=%.2f/%d follow=%zu\n",
                    r.harmony.by_root ? "root" : "spelling", (double) r.harmony.strength, r.harmony.window,
                    r.harmony.hold_limit, (double) r.harmony.outside_bonus, (double) r.harmony.outside_limit,
                    (double) r.harmony.section_strength, r.harmony.section_open, r.harmony.follow.size());
        }
        const Yue2HarmonyPlan * steer = r.harmony.active() ? &harmony : nullptr;
        if (!yue2_generate(lm, &p->kv, std::vector<std::vector<int>>(B, open), {}, 1.0f, score_sampling, r.lm_seed,
                           YUE2_PHASE_ABC, &plans, cancelled, cancel_data,
                           [p](int done,int total){if(p->progress)p->progress("Composing score",done,total);},
                           nullptr, steer)) {
            return false;
        }
        for (int i = 0; i < B; i++) {
            abc_ids[i]   = plans[i].tokens;
            scores[i]    = bpe_decode(tok, abc_ids[i]);
            truncated[i] = plans[i].truncated;
        }
        // Pre-render quality gate: a score without its vocal melody or its
        // chorus renders a vocal-free loop, so draw a new one before the long
        // performance stage. The best attempt renders if every retry fails.
        const LyricShape shape = score_lyric_shape(r.lyrics);
        for (int i = 0; i < B; i++) {
            ScoreReport report = score_inspect(scores[i]);
            std::string why;
            bool        ok   = score_acceptable(report, shape, truncated[i], &why);
            int         best = score_quality(report, truncated[i]);
            // A plan nothing can be sung from (no M:/L:/K:, no voice with
            // bars, colons in the note runs) is never accepted and ranks
            // below every singable one (timoncool/yue2.cpp f429e9e).
            std::string problem = yue2_score_problem(scores[i]);
            if (!problem.empty()) {
                ok   = false;
                why  = "the score cannot be sung: " + problem;
                best = -100000;
            }
            fprintf(stderr, "[Score] Song %d: %d sung bars, %d/%d sung choruses, %d lyric lines, %d lyric choruses: %s\n",
                    i, report.vocal_bars, report.chorus_vocal_sections, report.chorus_sections, shape.lines,
                    shape.choruses, ok ? "accepted" : why.c_str());
            int attempt = 0;
            for (attempt = 1; !ok && attempt <= r.score_retries; attempt++) {
                if (cancelled && cancelled(cancel_data)) return false;
                Yue2Sampling retry_sampling = score_sampling;
                // A slightly stronger penalty discourages the one-bar rest loop.
                retry_sampling.repetition_penalty = std::max(retry_sampling.repetition_penalty, 1.02f);
                std::vector<Yue2Generation> retry;
                if(p->progress) p->progress("Composing score",0,0);
                if (!yue2_generate(lm, &p->kv, std::vector<std::vector<int>>(1, open), {}, 1.0f, retry_sampling,
                                   r.lm_seed + i + 7919LL * attempt, YUE2_PHASE_ABC, &retry, cancelled, cancel_data,
                                   [p](int done,int total){if(p->progress)p->progress("Composing score",done,total);},
                                   nullptr, steer)) {
                    return false;
                }
                const std::string text = bpe_decode(tok, retry[0].tokens);
                report = score_inspect(text);
                ok = score_acceptable(report, shape, retry[0].truncated, &why);
                int quality = score_quality(report, retry[0].truncated);
                const std::string retry_problem = yue2_score_problem(text);
                if (!retry_problem.empty()) {
                    ok      = false;
                    why     = "the score cannot be sung: " + retry_problem;
                    quality = -100000;
                }
                fprintf(stderr, "[Score] Song %d retry %d/%d: %d sung bars, %d sung choruses: %s\n", i, attempt,
                        r.score_retries, report.vocal_bars, report.chorus_vocal_sections, ok ? "accepted" : why.c_str());
                if (ok || quality > best) {
                    best         = quality;
                    scores[i]    = text;
                    abc_ids[i]   = retry[0].tokens;
                    truncated[i] = retry[0].truncated;
                }
            }
            // Fail fast: an unsingable plan after every retry would spend
            // minutes in the semantic stage on garbage.
            problem = yue2_score_problem(scores[i]);
            if (!problem.empty()) {
                fprintf(stderr, "[Pipeline] score of song %d as written:\n%s\n", i + 1,
                        yue2_score_excerpt(scores[i], 800).c_str());
                fprintf(stderr, "[Pipeline] FATAL: the score the model wrote for song %d cannot be sung: %s. Draw another seed.\n",
                        i + 1, problem.c_str());
                return false;
            }
            if (!ok) {
                score_warnings[i] = "Score check: " + why + (r.score_retries > 0 ? " after " + std::to_string(r.score_retries) +
                                    " retr" + (r.score_retries == 1 ? "y" : "ies") : std::string()) +
                                    "; vocals or the chorus may be missing. Shorter lyrics with standard [Verse]/[Chorus] labels help. ";
            }
            if (r.chorus_lock) {
                int copied = 0;
                const std::string locked = score_lock_choruses(scores[i], shape, &copied);
                if (copied > 0) {
                    scores[i]  = locked;
                    abc_ids[i] = encode(locked);
                    fprintf(stderr, "[Score] Song %d: chorus lock copied the first chorus melody into %d later chorus%s\n",
                            i, copied, copied == 1 ? "" : "es");
                }
            }
        }
    }

    std::vector<std::vector<int>> prefixes(B);
    for (int i = 0; i < B; i++) {
        prefixes[i] = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, has_score ? &abc_ids[i] : nullptr);
    }
    fprintf(stderr, "[Prompt] cot=%s, songs=%d, variations=%d, %zu tracks\n", r.cot.c_str(), B, M, (size_t) B * M);

    float                         guidance = r.cfg_scale < 0.0f ? yue2_default_guidance(cot) : r.cfg_scale;
    std::vector<std::vector<int>> negatives;
    if (guidance != 1.0f) {
        negatives.resize(B);
        for (int i = 0; i < B; i++) {
            negatives[i] = yue2_build_negative_ids(encode, cot, has_score ? &abc_ids[i] : nullptr);
        }
    }

    std::vector<Yue2Generation> codes(B);
    std::string performance_limit;
    if (replay) {
        std::vector<int> values;
        if (!pipeline_parse_tokens(r.semantic_tokens, &values)) {
            return false;
        }
        codes[0].tokens.reserve(values.size());
        for (size_t i = 0; i < values.size(); i++) {
            codes[0].tokens.push_back(values[i] + YUE2_CODEC_OFFSET);
        }
        codes[0].truncated = false;
        fprintf(stderr, "[Pipeline] Replay: %zu frames supplied\n", codes[0].tokens.size());
        pipeline_kv_capacity(p, (int) prefixes[0].size() + 2 * (int) values.size() + 3);
    } else {
        if(p->progress) p->progress("Composing performance",0,0);
        // A word-count estimate is not an audio boundary. Auto must retain the
        // model's natural EOS, with only explicit and resource safety ceilings.
        Yue2Sampling semantic = r.semantic_sampling;
        int longest = 0;
        for (const auto & prefix : prefixes) longest = std::max(longest, (int) prefix.size());
        for (const auto & negative : negatives) longest = std::max(longest, (int) negative.size());
        // Auto duration keeps the natural end token, under a lyric-fit
        // ceiling of 1.2x the lyric estimate plus 15 s instead of ten minutes.
        float ceiling = r.duration;
        if (r.duration <= 0.0f) {
            const float estimate = r.duration_estimate > 0.0f ? r.duration_estimate : score_estimate_seconds(r.lyrics);
            if (estimate > 0.0f) {
                ceiling = song_auto_ceiling(estimate);
                fprintf(stderr, "[Pipeline] Auto duration: lyric estimate %.0f s, ceiling %.0f s\n", estimate, ceiling);
            }
        }
        performance_limit = song_limit_reason(ceiling, semantic.max_tokens, p->context, longest);
        if (r.duration <= 0.0f && ceiling > 0.0f) {
            const std::string manual = "the selected duration limit";
            const size_t at = performance_limit.find(manual);
            if (at != std::string::npos)
                performance_limit.replace(at, manual.size(), "Auto duration's lyric-fit ceiling (" +
                                          std::to_string((int) ceiling) + " s)");
        }
        semantic.max_tokens = song_frame_budget(ceiling, semantic.max_tokens, p->context, longest);
        // Say how much song the context leaves beside the prompt and score
        // (after timoncool/yue2.cpp 7de5308, which refuses instead; this
        // studio keeps clamping with a warning).
        if (performance_limit.find("context") != std::string::npos) {
            const int room = p->context - longest - 1;
            fprintf(stderr, "[Pipeline] The prompt and the score take %d of the model's %d tokens, so a song can last %.0f s here\n",
                    longest, p->context, room > 0 ? room / (double) YUE2_FRAME_RATE : 0.0);
        }
        if (semantic.max_tokens < 1) {
            fprintf(stderr, "[Pipeline] FATAL: no context remains for the performance\n");
            return false;
        }
        semantic.min_tokens = std::min(semantic.min_tokens, semantic.max_tokens - 1);
        fprintf(stderr, "[Pipeline] %s: natural end token enabled; ceiling %d frames (%.1f s)\n",
                r.duration <= 0.0f ? "Auto duration" : "Duration limit", semantic.max_tokens,
                (double) semantic.max_tokens / YUE2_FRAME_RATE);
        // The sets outlive the stage: a song that fits takes its acoustic
        // chunk whole, the prefix, its frames twice over and three markers
        // (per-stage KV sizing, timoncool/yue2.cpp 61cd731)
        int need = 0;
        for (int i = 0; i < B; i++) {
            int longest_i = (int) prefixes[i].size();
            if (!negatives.empty() && (int) negatives[i].size() > longest_i) {
                longest_i = (int) negatives[i].size();
            }
            int semantic_need = longest_i + semantic.max_tokens + 1;
            int acoustic_need = (int) prefixes[i].size() + 2 * semantic.max_tokens + 3;
            need              = std::max(need, std::max(semantic_need, acoustic_need));
        }
        pipeline_kv_capacity(p, need);
        // Lyric schedule (opt-in): keep each section's words out of sight
        // until the score reaches it. "auto" times every song's own score.
        std::vector<Yue2PromptMask> lyric_masks;
        if (r.lyric_schedule.on) {
            const char * why = guidance != 1.0f ? "needs cfg_scale 1"
                               : !has_score     ? "needs a score (cot melody or full)"
                               : !r.lyric_schedule.automatic && r.abc.empty() ? "with explicit sections needs a supplied score"
                                                                           : nullptr;
            if (why) {
                fprintf(stderr, "[Pipeline] FATAL: lyric_schedule %s\n", why);
                return false;
            }
            for (int i = 0; i < (r.lyric_schedule.automatic ? B : 1); i++) {
                std::vector<Yue2LyricSection> sections = r.lyric_schedule.sections;
                if (r.lyric_schedule.automatic && !yue2_lyric_schedule_build(scores[i], r.lyrics, &sections)) {
                    fprintf(stderr, "[Pipeline] Lyric schedule: nothing to time in song %d (no tagged sung block matches a score section); left off\n", i);
                    sections.clear();
                }
                Yue2PromptMask mask;
                if (!sections.empty() && !pipeline_lyric_mask(tok, r, cot, sections, &mask)) {
                    return false;
                }
                lyric_masks.push_back(mask);
            }
        }
        if (!yue2_generate(lm, &p->kv, prefixes, negatives, guidance, semantic, r.lm_seed, YUE2_PHASE_SEMANTIC, &codes,
                           cancelled, cancel_data, [p](int done,int total){if(p->progress)p->progress("Composing performance",done,total);},
                           lyric_masks.empty() ? nullptr : &lyric_masks)) {
            return false;
        }
    }

    // Acoustic chunks: the context holds the prefix, the codes of the chunk
    // and their latent block twice over, once as tokens and once as frames
    const int context = p->kv.cfg.max_seq_len;
    int       row0, rows;
    yue2_phase_rows(YUE2_PHASE_SEMANTIC, &row0, &rows);
    std::vector<float> probe((size_t) rows);
    std::vector<int>   chunk_sizes(B);

    songs->assign((size_t) B * M, {});
    for (int i = 0; i < B; i++) {
        int T_lat = (int) codes[i].tokens.size();
        if (T_lat < 1) {
            fprintf(stderr, "[Pipeline] FATAL: empty semantic stream\n");
            return false;
        }
        chunk_sizes[i] = (context - (int) prefixes[i].size() - 3) / 2;
        if (chunk_sizes[i] < 1) {
            fprintf(stderr, "[Pipeline] FATAL: prefix %zu leaves no acoustic context in %d\n", prefixes[i].size(),
                    context);
            return false;
        }
        for (int j = 0; j < M; j++) {
            Yue2Song & song = (*songs)[(size_t) i * M + j];
            song.score      = scores[i];
            song.T_lat      = T_lat;
            song.truncated  = truncated[i] || codes[i].truncated;
            song.ending_warning = score_warnings[i] + song_ending_warning(truncated[i], codes[i].truncated, performance_limit, r.duration <= 0.0f);
            song.tokens.reserve(codes[i].tokens.size());
            for (size_t k = 0; k < codes[i].tokens.size(); k++) {
                song.tokens.push_back(codes[i].tokens[k] - YUE2_CODEC_OFFSET);
            }
            // The noise of a variation is drawn once for the whole song, each
            // chunk taking its view
            song.latents.assign((size_t) T_lat * YUE2_LATENT_DIM, 0.0f);
            torch_cpu_randn((uint64_t) (r.seed + j), song.latents.data(), (int64_t) song.latents.size());
        }
    }

    // A generated song spanning several chunks has its first one sealed while
    // the AR half still holds the GPU: the set carries the whole stream, the
    // end token takes the row that closes the chunk
    if (!replay) {
        for (int i = 0; i < B; i++) {
            if ((int) codes[i].tokens.size() > chunk_sizes[i]) {
                int end = YUE2_MUSIC_END;
                qw3lm_kv_trim(&p->kv, i, (int) prefixes[i].size() + chunk_sizes[i]);
                qw3lm_forward(lm, &p->kv, &end, 1, i, probe.data(), row0, rows);
            }
        }
    }
    lm_hold.reset();

    std::vector<float> block;
    DebugDumper        quiet;
    debug_init(&quiet, nullptr);

    // The NAR stays resident across songs and chunks, and steps aside for
    // the prefill of a chunk
    std::optional<ModelHandle> nar_hold;
    Yue2NAR *                  nar = nullptr;
    if (!qw3lm_kv_sets(&p->kv, 1)) {
        return false;
    }
    for (int i = 0; i < B; i++) {
        const int prefix_len = (int) prefixes[i].size();
        const int chunk_size = chunk_sizes[i];
        const int T_lat      = (int) codes[i].tokens.size();
        int       chunks     = (T_lat + chunk_size - 1) / chunk_size;
        if(p->progress) p->progress("Rendering audio",i,B);
        fprintf(stderr, "[NAR] Song %d: %d frames (%.1f s), prefix %d, %d chunk%s of %d, %d variation%s\n", i, T_lat,
                (float) T_lat / (float) YUE2_FRAME_RATE, prefix_len, chunks, chunks > 1 ? "s" : "", chunk_size, M,
                M > 1 ? "s" : "");
        for (int start = 0; start < T_lat; start += chunk_size) {
            if(p->progress) p->progress("Rendering audio chunks",(start/chunk_size)*r.steps,chunks*r.steps);
            Timer chunk_timer;
            int   frames = T_lat - start < chunk_size ? T_lat - start : chunk_size;
            int   ar_len = prefix_len + frames + 1;

            // The chunk sequence is the prefix, the codes of the chunk and the
            // end token. Its head already sits in the set, the whole prefix
            // from the second chunk on and the sealed sequence of a generated
            // song for the first one, so only the tail is forwarded and its
            // logits go nowhere.
            std::vector<int> sequence = prefixes[i];
            sequence.insert(sequence.end(), codes[i].tokens.begin() + start, codes[i].tokens.begin() + start + frames);
            sequence.push_back(YUE2_MUSIC_END);
            const int kept = start > 0 ? prefix_len : (replay ? 0 : ar_len);
            if (kept < ar_len) {
                nar_hold.reset();
                nar                = nullptr;
                Qwen3LM * lm_chunk = require_lm(p);
                if (!lm_chunk) {
                    return false;
                }
                ModelHandle lm_chunk_hold(p->store, lm_chunk);
                qw3lm_kv_trim(&p->kv, i, kept);
                qw3lm_forward(lm_chunk, &p->kv, sequence.data() + kept, ar_len - kept, i, probe.data(), row0, rows);
            }
            if (!nar) {
                nar = require_nar(p);
                if (!nar) {
                    return false;
                }
                nar_hold.emplace(p->store, nar);
            }

            // The first chunk of the first song feeds the cossim harness: the
            // sequence the latent block attends to, then the solver probes
            const DebugDumper * dbg = i == 0 && start == 0 ? &p->dumper : &quiet;
            if (dbg->enabled) {
                std::vector<float> ids(sequence.begin(), sequence.end());
                debug_dump_1d(dbg, "ar_ids", ids.data(), (int) ids.size());
            }

            // The M variations of the chunk solve side by side
            size_t span = (size_t) frames * YUE2_LATENT_DIM;
            block.resize(span * M);
            for (int j = 0; j < M; j++) {
                memcpy(block.data() + span * j,
                       (*songs)[(size_t) i * M + j].latents.data() + (size_t) start * YUE2_LATENT_DIM,
                       span * sizeof(float));
            }
            if (!nar_solve(nar, &p->kv, block.data(), frames, M, ar_len, i, r.steps, dbg, cancelled, cancel_data,
                           [p,start,chunk_size,chunks](int done,int total){if(p->progress)p->progress("Rendering audio chunks",(start/chunk_size)*total+done,chunks*total);},
                           solver)) {
                return false;
            }
            for (int j = 0; j < M; j++) {
                memcpy((*songs)[(size_t) i * M + j].latents.data() + (size_t) start * YUE2_LATENT_DIM,
                       block.data() + span * j, span * sizeof(float));
            }
            fprintf(stderr, "[NAR] Song %d chunk %d/%d: %d frames, cache %d rows, %d forwarded, %.1f s\n", i,
                    start / chunk_size + 1, chunks, frames, ar_len, ar_len - kept, chunk_timer.ms() / 1000.0);
        }
    }

    nar_hold.reset();
    if(p->progress) p->progress("Decoding audio",0,0);
    VAEGGML * vae = require_vae(p);
    if (!vae) {
        return false;
    }
    ModelHandle vae_hold(p->store, vae);
    for (size_t t = 0; t < songs->size(); t++) {
        Yue2Song & song        = (*songs)[t];
        int        max_T_audio = song.T_lat * YUE2_HOP;
        fprintf(stderr, "[VAE] Track %zu/%zu: song %zu variation %zu\n", t + 1, songs->size(), t / M, t % M);
        song.audio.assign((size_t) 2 * max_T_audio, 0.0f);
        song.T_audio = vae_ggml_decode_tiled(vae, song.latents.data(), song.T_lat, song.audio.data(), max_T_audio,
                                             p->params.vae_core, p->params.vae_halo, cancelled, cancel_data);
        if (song.T_audio < 0) {
            return false;
        }
        song.audio.resize((size_t) 2 * song.T_audio);
        if (t == 0 && p->dumper.enabled) {
            // Interleaved [T_audio, 2] like the torch reference dump
            std::vector<float> interleaved((size_t) 2 * song.T_audio);
            for (int k = 0; k < song.T_audio; k++) {
                interleaved[(size_t) 2 * k]     = song.audio[(size_t) k];
                interleaved[(size_t) 2 * k + 1] = song.audio[(size_t) song.T_audio + k];
            }
            debug_dump_2d(&p->dumper, "vae_audio", interleaved.data(), song.T_audio, 2);
        }
    }

    float seconds = 0.0f;
    for (size_t t = 0; t < songs->size(); t++) {
        seconds += (float) (*songs)[t].T_audio / (float) YUE2_SAMPLE_RATE;
    }
    fprintf(stderr, "[Pipeline] Done: %zu tracks, %.1f s of audio in %.1f s (%.1fx realtime)\n", songs->size(), seconds,
            total_timer.ms() / 1000.0, seconds / (float) (total_timer.ms() / 1000.0));
    return true;
}
