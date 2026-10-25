#pragma once
// score-check.h: pre-render quality gate for the composed ABC score.
//
// The score the model writes is the plan the performance follows. When it
// carries no vocal melody, or no chorus although the lyrics have one, the
// render cannot recover: the take sings over a looping accompaniment or never
// reaches a recognizable hook. These helpers inspect a score before the long
// semantic stage, so the pipeline can draw a new one, and copy the melody of
// the first chorus into its later returns so every chorus sounds the same.
// Pure string work, no model state: covered by tests/test-score-check.cpp.

#include <algorithm>
#include <cctype>
#include <cmath>
#include <set>
#include <string>
#include <vector>

// ---------------------------------------------------------------- lyrics --

static std::string score_trim(const std::string & s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char) s[a])) a++;
    while (b > a && std::isspace((unsigned char) s[b - 1])) b--;
    return s.substr(a, b - a);
}

static std::string score_lower(std::string s) {
    for (char & c : s) c = (char) std::tolower((unsigned char) c);
    return s;
}

static std::vector<std::string> score_lines(const std::string & text) {
    std::vector<std::string> lines;
    size_t start = 0;
    for (;;) {
        size_t end = text.find('\n', start);
        std::string line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(line);
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return lines;
}

// A section heading line: "[Chorus]", "## [Verse 2]". Fills the inner label.
static bool score_label_line(const std::string & raw, std::string * label) {
    std::string line = score_trim(raw);
    size_t i = 0;
    while (i < line.size() && line[i] == '#') i++;
    line = score_trim(line.substr(i));
    if (line.size() < 3 || line.front() != '[' || line.back() != ']') return false;
    if (label) *label = score_trim(line.substr(1, line.size() - 2));
    return true;
}

static bool score_label_is_chorus(const std::string & label) {
    const std::string l = score_lower(label);
    const bool chorus = l.find("chorus") != std::string::npos || l.find("hook") != std::string::npos ||
                        l.find("refrain") != std::string::npos;
    if (!chorus) return false;
    for (const char * prefix : { "pre-chorus", "pre chorus", "prechorus", "post-chorus", "post chorus", "postchorus",
                                 "pre-hook", "pre hook", "post-hook", "post hook" }) {
        if (l.find(prefix) != std::string::npos) return false;
    }
    return true;
}

struct LyricShape {
    int                      lines    = 0;     // performed lines, labels excluded
    float                    words    = 0.0f;  // latin words, CJK characters weighted as 0.6 word
    int                      choruses = 0;     // chorus sections that carry words
    std::vector<std::string> chorus_bodies;    // lowercased words of each chorus
    bool                     vocal = false;    // any performed word at all
};

// Counts words of one line: latin runs split on whitespace, each CJK/kana/
// hangul code point a syllable worth 0.6 of a word.
static float score_line_words(const std::string & line) {
    float words = 0.0f;
    bool  in_word = false;
    for (size_t i = 0; i < line.size();) {
        unsigned char c = (unsigned char) line[i];
        if (c >= 0xE0 && c <= 0xEF && i + 2 < line.size()) {
            // three-byte UTF-8: U+0800..U+FFFF, which holds CJK, kana and hangul
            unsigned cp = ((c & 0x0F) << 12) | (((unsigned char) line[i + 1] & 0x3F) << 6) |
                          ((unsigned char) line[i + 2] & 0x3F);
            if ((cp >= 0x3040 && cp <= 0x30FF) || (cp >= 0x3400 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF)) {
                words += 0.6f;
                in_word = false;
            } else if (!in_word) {
                in_word = true;
                words += 1.0f;
            }
            i += 3;
            continue;
        }
        if (std::isspace(c)) {
            in_word = false;
        } else if (!in_word) {
            in_word = true;
            words += 1.0f;
        }
        i++;
    }
    return words;
}

static LyricShape score_lyric_shape(const std::string & lyrics) {
    LyricShape  shape;
    bool        in_chorus = false;
    std::string body;
    auto close = [&]() {
        if (in_chorus && !score_trim(body).empty()) {
            shape.choruses++;
            shape.chorus_bodies.push_back(score_lower(body));
        }
        body.clear();
    };
    for (const std::string & line : score_lines(lyrics)) {
        std::string label;
        if (score_label_line(line, &label)) {
            close();
            in_chorus = score_label_is_chorus(label);
            continue;
        }
        const std::string text = score_trim(line);
        if (text.empty()) continue;
        shape.lines++;
        shape.words += score_line_words(text);
        if (in_chorus) body += text + "\n";
    }
    close();
    shape.vocal = shape.lines > 0;
    return shape;
}

// Seconds a lyric sheet needs at about 140 sung words a minute, plus 30 s of
// intro, breaks and outro. Section labels are not sung. 0 for no lyrics.
static float score_estimate_seconds(const std::string & lyrics) {
    const LyricShape shape = score_lyric_shape(lyrics);
    if (shape.words <= 0.0f) return 0.0f;
    return std::clamp(shape.words / 140.0f * 60.0f + 30.0f, 30.0f, 600.0f);
}

// Word overlap of two chorus bodies, 0..1.
static float score_text_similarity(const std::string & a, const std::string & b) {
    auto words = [](const std::string & s) {
        std::set<std::string> out;
        std::string w;
        for (char c : s) {
            if (std::isalnum((unsigned char) c) || (unsigned char) c >= 0x80 || c == '\'') w += c;
            else if (!w.empty()) { out.insert(w); w.clear(); }
        }
        if (!w.empty()) out.insert(w);
        return out;
    };
    const auto x = words(a), y = words(b);
    if (x.empty() && y.empty()) return 1.0f;
    size_t common = 0;
    for (const auto & w : x) common += y.count(w);
    const size_t all = x.size() + y.size() - common;
    return all ? (float) common / (float) all : 0.0f;
}

// ----------------------------------------------------------------- score --

struct ScoreSection {
    std::string name;        // lowercased text after '%', "chorus", "verse"
    size_t      begin = 0;   // byte offset of the '%' line
    size_t      end   = 0;   // byte offset of the next section, or the end
    int         vocal_bars = 0;
    bool        meter_change = false;
};

struct ScoreReport {
    std::vector<ScoreSection> sections;
    int  vocal_bars            = 0;
    int  chorus_sections       = 0;
    int  chorus_vocal_sections = 0;
    bool has_vocal_voice       = false;
    bool meter_change          = false;
};

static bool score_voice_is_vocal(const std::string & id) {
    return score_lower(id).rfind("voc", 0) == 0;
}

// True when one bar of a vocal voice line holds a pitched note, not only
// rests: quoted chord symbols and !decorations! are ignored.
static bool score_bar_has_note(const std::string & bar) {
    bool quoted = false, decoration = false;
    for (char c : bar) {
        if (c == '"') { quoted = !quoted; continue; }
        if (!quoted && c == '!') { decoration = !decoration; continue; }
        if (quoted || decoration) continue;
        if ((c >= 'a' && c <= 'g') || (c >= 'A' && c <= 'G')) return true;
    }
    return false;
}

static ScoreReport score_inspect(const std::string & abc) {
    ScoreReport report;
    std::string voice;
    bool        body = false;
    size_t      offset = 0;
    for (const std::string & raw : score_lines(abc)) {
        const size_t here = offset;
        offset += raw.size() + 1;
        const std::string line = score_trim(raw);
        if (line.empty()) continue;
        if (line[0] == '%') {
            if (!report.sections.empty()) report.sections.back().end = here;
            ScoreSection s;
            s.name  = score_lower(score_trim(line.substr(1)));
            s.begin = here;
            s.end   = abc.size();
            report.sections.push_back(s);
            body = true;
            continue;
        }
        if (line.size() >= 2 && line[1] == ':' && std::isalpha((unsigned char) line[0])) {
            if (line[0] == 'V') {
                std::string rest = score_trim(line.substr(2));
                voice = rest.substr(0, rest.find_first_of(" \t"));
                if (score_voice_is_vocal(voice)) report.has_vocal_voice = true;
            } else if (line[0] == 'M' && body) {
                report.meter_change = true;
                if (!report.sections.empty()) report.sections.back().meter_change = true;
            }
            continue;
        }
        if (!body || !score_voice_is_vocal(voice)) continue;
        size_t start = 0;
        for (;;) {
            size_t bar_end = line.find('|', start);
            const std::string bar = line.substr(start, bar_end == std::string::npos ? std::string::npos : bar_end - start);
            if (score_bar_has_note(bar)) {
                report.vocal_bars++;
                if (!report.sections.empty()) report.sections.back().vocal_bars++;
            }
            if (bar_end == std::string::npos) break;
            start = bar_end + 1;
        }
    }
    for (const ScoreSection & s : report.sections) {
        if (s.name == "chorus") {
            report.chorus_sections++;
            if (s.vocal_bars >= 2) report.chorus_vocal_sections++;
        }
    }
    return report;
}

// Sung bars a score needs for its lyric sheet: about one bar per two lines,
// at least 8 and at most 32, so short songs and dense raps both pass.
static int score_required_vocal_bars(const LyricShape & shape) {
    return std::clamp((int) std::lround(shape.lines * 0.5), 8, 32);
}

// Rejects a score that would render without its vocal melody or chorus.
// Instrumentals, empty lyrics and scores without a vocal voice always pass.
static bool score_acceptable(const ScoreReport & s, const LyricShape & shape, bool truncated, std::string * why) {
    if (truncated) {
        if (why) *why = "the score was cut off before it finished";
        return false;
    }
    if (!shape.vocal || !s.has_vocal_voice) return true;
    const int need = score_required_vocal_bars(shape);
    if (s.vocal_bars < need) {
        if (why) *why = "the score has " + std::to_string(s.vocal_bars) + " sung bars for " +
                        std::to_string(shape.lines) + " lyric lines (needs " + std::to_string(need) + ")";
        return false;
    }
    const int choruses = std::min(2, shape.choruses);
    if (s.chorus_vocal_sections < choruses) {
        if (why) *why = "the score has " + std::to_string(s.chorus_vocal_sections) + " sung chorus section" +
                        (s.chorus_vocal_sections == 1 ? "" : "s") + " but the lyrics have " +
                        std::to_string(shape.choruses);
        return false;
    }
    return true;
}

// Ranks rejected attempts so the best one renders when every retry fails.
static int score_quality(const ScoreReport & s, bool truncated) {
    return std::min(s.vocal_bars, 64) + 24 * std::min(s.chorus_vocal_sections, 2) - (truncated ? 40 : 0);
}

// Copies the first sung chorus block of the score over its later chorus
// blocks, so every return shares one melody. Skipped when the score changes
// meter mid-song (a copied block would leave the wrong meter behind) or when
// the lyric choruses differ in their words. Returns the score, *copied the
// number of chorus blocks replaced.
static std::string score_lock_choruses(const std::string & abc, const LyricShape & shape, int * copied) {
    if (copied) *copied = 0;
    if (shape.choruses < 2) return abc;
    const ScoreReport report = score_inspect(abc);
    if (report.meter_change || report.chorus_vocal_sections < 2) return abc;
    std::vector<const ScoreSection *> choruses;
    for (const ScoreSection & s : report.sections)
        if (s.name == "chorus") choruses.push_back(&s);
    const ScoreSection * source = nullptr;
    for (const ScoreSection * s : choruses)
        if (s->vocal_bars >= 2) { source = s; break; }
    if (!source) return abc;
    const bool paired = (int) choruses.size() == shape.choruses;
    std::vector<bool> lock(choruses.size(), false);
    size_t source_index = 0;
    for (size_t i = 0; i < choruses.size(); i++) if (choruses[i] == source) source_index = i;
    for (size_t i = source_index + 1; i < choruses.size(); i++) {
        if (choruses[i]->vocal_bars < 1) continue;  // an instrumental chorus stays one
        const std::string & ref = shape.chorus_bodies[paired ? source_index : 0];
        bool same = true;
        if (paired) same = score_text_similarity(ref, shape.chorus_bodies[i]) >= 0.6f;
        else for (const auto & b : shape.chorus_bodies) same = same && score_text_similarity(ref, b) >= 0.6f;
        lock[i] = same;
    }
    std::string block = abc.substr(source->begin, source->end - source->begin);
    if (!block.empty() && block.back() != '\n') block += '\n';
    std::string out;
    size_t at = 0;
    int n = 0;
    for (size_t i = 0; i < choruses.size(); i++) {
        if (!lock[i]) continue;
        const ScoreSection * s = choruses[i];
        out += abc.substr(at, s->begin - at);
        std::string piece = block;
        if (s->end == abc.size() && (abc.empty() || abc.back() != '\n') && !piece.empty()) piece.pop_back();
        out += piece;
        at = s->end;
        n++;
    }
    if (!n) return abc;
    out += abc.substr(at);
    if (copied) *copied = n;
    return out;
}
