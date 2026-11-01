#pragma once
// lyric-schedule.h: time the lyric sections of a request on a score's clock
//
// The builder behind lyric_schedule "auto": each sung lyric block ([Verse 1],
// [Chorus], ...) is tied to the first Vocal note of the score section of the
// same kind, matched in order, so the semantic stage keeps a section's words
// out of sight until the score reaches them (lyric_schedule, generate.h).
//
// A C++ port of score/schedule.rs from timoncool/YuE2-Studio (MIT,
// Copyright (c) 2026 timoncool), after HOT-Step-CPP's C6 lyric schedule (MIT).
// Its strict ABC dialect parser is replaced by a tolerant reader: every bar
// lasts its meter (Z, Z2.. count whole bars), repeats are not unrolled, and
// only the note runs before the first sung note of a section are measured.

#include "request.h"

#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <regex>
#include <string>
#include <vector>

// The bias on the rows of a section not yet due: soft, HOT-Step's default.
static const float YUE2_LYRIC_SCHEDULE_BIAS = -4.0f;

static std::string yue2_schedule_lower(const std::string & label) {
    std::string out;
    for (size_t i = 0; i < label.size(); i++) {
        const unsigned char c = (unsigned char) label[i];
        if (c == '_') {
            out += '-';
        } else if (c == 0xE2 && i + 2 < label.size() && (unsigned char) label[i + 1] == 0x80 &&
                   ((unsigned char) label[i + 2] == 0x93 || (unsigned char) label[i + 2] == 0x94)) {
            out += '-';  // en and em dash
            i += 2;
        } else {
            out += (char) std::tolower(c);
        }
    }
    return out;
}

// The kind a section label names: verse, chorus, pre-chorus, bridge, intro,
// outro, interlude, else the label itself, lowered and trimmed.
static std::string yue2_schedule_kind(const std::string & label) {
    const std::string  normalized = yue2_schedule_lower(label);
    static const std::regex pre("\\bpre[ -]?chorus\\b");
    static const std::regex kind("\\b(verse|chorus|bridge|intro|outro|interlude)\\b");
    if (std::regex_search(normalized, pre)) {
        return "pre-chorus";
    }
    std::smatch found;
    if (std::regex_search(normalized, found, kind)) {
        return found[1].str();
    }
    size_t a = normalized.find_first_not_of(" \t");
    size_t b = normalized.find_last_not_of(" \t");
    return a == std::string::npos ? std::string() : normalized.substr(a, b - a + 1);
}

static bool yue2_schedule_instrumental(const std::string & label) {
    static const std::regex played("\\b(instrumental|solo|break|interlude)\\b");
    return std::regex_search(yue2_schedule_lower(label), played);
}

static int64_t yue2_schedule_codepoints(const std::string & text) {
    int64_t n = 0;
    for (unsigned char c : text) {
        n += (c & 0xC0) != 0x80;
    }
    return n;
}

struct Yue2ScheduleBlock {
    std::string label;
    int64_t     start = 0;  // codepoints
    int64_t     end   = 0;  // codepoints, the tag line of the next block
    int64_t     close = 0;  // end without its trailing whitespace
    bool        sung  = false;
};

// The tagged blocks of the lyrics, their spans in codepoints
static std::vector<Yue2ScheduleBlock> yue2_schedule_blocks(const std::string & lyrics) {
    static const std::regex tag("^\\[\\s*([^\\]]*?)\\s*\\]$");
    std::vector<Yue2ScheduleBlock> found;
    const int64_t length = yue2_schedule_codepoints(lyrics);
    int64_t offset = 0;
    int64_t last_ink = 0;  // codepoint just past the last non-space character
    size_t  pos = 0;
    while (pos <= lyrics.size()) {
        size_t nl = lyrics.find('\n', pos);
        if (nl == std::string::npos) {
            nl = lyrics.size();
        }
        const std::string line = lyrics.substr(pos, nl - pos);
        size_t a = line.find_first_not_of(" \t\r");
        size_t b = line.find_last_not_of(" \t\r");
        const std::string trimmed = a == std::string::npos ? std::string() : line.substr(a, b - a + 1);
        std::smatch m;
        if (std::regex_match(trimmed, m, tag)) {
            if (!found.empty()) {
                found.back().end   = offset;
                found.back().close = std::max(found.back().start, last_ink);
            }
            Yue2ScheduleBlock block;
            block.label = m[1].str();
            block.start = offset;
            block.end   = length;
            found.push_back(block);
        } else if (!found.empty()) {
            for (unsigned char c : line) {
                if (std::isalnum(c) || c >= 0x80) {
                    found.back().sung = true;
                    break;
                }
            }
        }
        // the last non-space character so far, for trimming a block's end
        int64_t at = offset;
        for (size_t i = 0; i < line.size(); i++) {
            const unsigned char c = (unsigned char) line[i];
            if ((c & 0xC0) != 0x80) {
                at++;
                if (!std::isspace(c)) {
                    last_ink = at;
                }
            }
        }
        offset += yue2_schedule_codepoints(line) + 1;
        if (nl == lyrics.size()) {
            break;
        }
        pos = nl + 1;
    }
    if (!found.empty()) {
        found.back().close = std::max(found.back().start, last_ink);
    }
    return found;
}

// A rational-free length in quarter notes
static bool yue2_schedule_fraction(const std::string & text, double * out) {
    const size_t slash = text.find('/');
    if (slash == std::string::npos) {
        return false;
    }
    const int num = std::atoi(text.substr(0, slash).c_str());
    const int den = std::atoi(text.substr(slash + 1).c_str());
    if (num <= 0 || den <= 0) {
        return false;
    }
    *out = 4.0 * num / den;
    return true;
}

static double yue2_schedule_meter(std::string value) {
    size_t a = value.find_first_not_of(" \t");
    value = a == std::string::npos ? std::string() : value.substr(a);
    if (value.rfind("C|", 0) == 0) {
        return 4.0;
    }
    if (value.rfind("C", 0) == 0) {
        return 4.0;
    }
    double q;
    return yue2_schedule_fraction(value, &q) ? q : 4.0;
}

// The duration suffix of a note, in units of L: ("", "2", "/", "3/2", "//")
static double yue2_schedule_duration(const std::string & s, size_t * i) {
    size_t  start = *i;
    double  num = 1.0;
    while (*i < s.size() && std::isdigit((unsigned char) s[*i])) {
        (*i)++;
    }
    if (*i > start) {
        num = std::atof(s.substr(start, *i - start).c_str());
    }
    double den = 1.0;
    while (*i < s.size() && s[*i] == '/') {
        (*i)++;
        size_t d0 = *i;
        while (*i < s.size() && std::isdigit((unsigned char) s[*i])) {
            (*i)++;
        }
        den *= *i > d0 ? std::atof(s.substr(d0, *i - d0).c_str()) : 2.0;
    }
    return den > 0.0 ? num / den : num;
}

struct Yue2ScoreSection {
    std::string label;
    double      first_note = -1.0;  // quarter notes, -1 when nothing is sung
};

// Sections of a YuE2 score ("% label" comments before the voices), with the
// first sung Vocal note of each on the quarter-note clock, and its tempo.
static bool yue2_schedule_score(const std::string & score, std::vector<Yue2ScoreSection> * sections, double * bpm) {
    sections->clear();
    double meter = 4.0;       // quarter notes per bar
    double unit  = 4.0 / 8;   // quarter notes per L: unit
    *bpm = 120.0;
    bool   body     = false;  // past K:
    bool   vocal    = false;  // the current voice is Vocal
    double time     = 0.0;    // Vocal clock, quarter notes
    std::vector<std::string> pending;
    bool   opened   = false;  // the current section saw its first Vocal line
    size_t pos      = 0;
    while (pos < score.size()) {
        size_t nl = score.find('\n', pos);
        if (nl == std::string::npos) {
            nl = score.size();
        }
        std::string line = score.substr(pos, nl - pos);
        pos = nl + 1;
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.rfind("%", 0) == 0) {
            size_t a = line.find_first_not_of("% \t");
            if (a != std::string::npos) {
                pending.push_back(line.substr(a, line.find_last_not_of(" \t") - a + 1));
                opened = false;
            }
            continue;
        }
        if (line.size() >= 2 && std::isalpha((unsigned char) line[0]) && line[1] == ':') {
            const char        field = line[0];
            const std::string value = line.substr(2);
            if (field == 'M') {
                meter = yue2_schedule_meter(value);
            } else if (field == 'L') {
                double q;
                if (yue2_schedule_fraction(value, &q)) {
                    unit = q;
                }
            } else if (field == 'Q') {
                const size_t eq = value.find('=');
                if (eq == std::string::npos) {
                    const double n = std::atof(value.c_str());
                    if (n > 0) {
                        *bpm = n;
                    }
                } else {
                    double beat;
                    const double n = std::atof(value.substr(eq + 1).c_str());
                    if (n > 0) {
                        *bpm = yue2_schedule_fraction(value.substr(0, eq), &beat) ? n * beat : n;
                    }
                }
            } else if (field == 'K') {
                body = true;
            } else if (field == 'V') {
                std::string name = value;
                size_t a = name.find_first_not_of(" \t");
                name = a == std::string::npos ? std::string() : name.substr(a);
                vocal = name.rfind("Vocal", 0) == 0 || name.rfind("vocal", 0) == 0 || name.rfind("1", 0) == 0;
            }
            continue;
        }
        if (!body || !vocal) {
            continue;
        }
        if (!opened && (!pending.empty() || sections->empty())) {
            Yue2ScoreSection s;
            s.label = pending.empty() ? std::string() : pending.back();
            sections->push_back(s);
        }
        pending.clear();
        opened = true;
        Yue2ScoreSection & current = sections->back();
        // walk the bars of the line
        double offset = 0.0;  // within the bar
        bool   filled = false;
        size_t i = 0;
        while (i < line.size()) {
            const char c = line[i];
            if (c == '|' || c == ':') {
                if (filled) {
                    time += std::max(meter, offset);
                }
                offset = 0.0;
                filled = false;
                i++;
                while (i < line.size() && (std::isdigit((unsigned char) line[i]) || line[i] == ']')) {
                    i++;  // endings and thick bars
                }
                continue;
            }
            if (c == '"') {
                size_t e = line.find('"', i + 1);
                i = e == std::string::npos ? line.size() : e + 1;
                continue;
            }
            if (c == '!' || c == '+') {
                size_t e = line.find(c, i + 1);
                i = e == std::string::npos ? line.size() : e + 1;
                continue;
            }
            if (c == '[' && i + 2 < line.size() && std::isalpha((unsigned char) line[i + 1]) && line[i + 2] == ':') {
                size_t e = line.find(']', i);
                const std::string inner = line.substr(i + 3, (e == std::string::npos ? line.size() : e) - i - 3);
                if (line[i + 1] == 'M') {
                    meter = yue2_schedule_meter(inner);
                } else if (line[i + 1] == 'L') {
                    double q;
                    if (yue2_schedule_fraction(inner, &q)) {
                        unit = q;
                    }
                }
                i = e == std::string::npos ? line.size() : e + 1;
                continue;
            }
            if (c == '[' && i + 1 < line.size() && std::isdigit((unsigned char) line[i + 1])) {
                i += 2;  // a numbered ending
                continue;
            }
            if (c == 'Z' || c == 'X') {
                i++;
                size_t d0 = i;
                while (i < line.size() && std::isdigit((unsigned char) line[i])) {
                    i++;
                }
                const int bars = i > d0 ? std::atoi(line.substr(d0, i - d0).c_str()) : 1;
                time += meter * std::max(1, bars);
                offset = 0.0;
                filled = false;
                // the barline after a whole-bar rest closes no further bar
                while (i < line.size() && line[i] == ' ') {
                    i++;
                }
                if (i < line.size() && line[i] == '|') {
                    i++;
                }
                continue;
            }
            if (c == 'z' || c == 'x') {
                i++;
                offset += yue2_schedule_duration(line, &i) * unit;
                filled = true;
                continue;
            }
            if (c == '[' || c == '^' || c == '_' || c == '=' || (c >= 'A' && c <= 'G') || (c >= 'a' && c <= 'g')) {
                // a note or a chord of notes: the first sung event of the section
                if (current.first_note < 0.0) {
                    current.first_note = time + offset;
                }
                double length = 0.0;
                if (c == '[') {
                    size_t e = line.find(']', i);
                    size_t j = i + 1;
                    while (j < (e == std::string::npos ? line.size() : e) && !(std::isalpha((unsigned char) line[j]))) {
                        j++;
                    }
                    if (j < line.size()) {
                        j++;
                        while (j < line.size() && (line[j] == '\'' || line[j] == ',')) {
                            j++;
                        }
                        length = yue2_schedule_duration(line, &j);
                    }
                    i = e == std::string::npos ? line.size() : e + 1;
                    length *= yue2_schedule_duration(line, &i);
                } else {
                    while (i < line.size() && (line[i] == '^' || line[i] == '_' || line[i] == '=')) {
                        i++;
                    }
                    if (i < line.size()) {
                        i++;  // the letter
                    }
                    while (i < line.size() && (line[i] == '\'' || line[i] == ',')) {
                        i++;
                    }
                    length = yue2_schedule_duration(line, &i);
                }
                offset += length * unit;
                filled = true;
                continue;
            }
            i++;  // ties, slurs, spaces, broken rhythm and tuplet marks
        }
        if (filled) {
            time += std::max(meter, offset);  // a line that ends without its barline
        }
    }
    return !sections->empty() && *bpm > 0.0;
}

// The schedule of a score and the lyrics sung from it: false when there is
// nothing to time (no sections, no sung block matching a section with a sung
// note, a lyric carrying CR line ends).
static bool yue2_lyric_schedule_build(const std::string & score, const std::string & lyrics,
                                      std::vector<Yue2LyricSection> * out) {
    out->clear();
    if (lyrics.find('\r') != std::string::npos) {
        return false;
    }
    std::vector<Yue2ScoreSection> found;
    double                        bpm = 120.0;
    if (!yue2_schedule_score(score, &found, &bpm)) {
        return false;
    }
    const std::vector<Yue2ScheduleBlock> tags = yue2_schedule_blocks(lyrics);
    size_t next = 0;
    double last = 0.0;
    for (const Yue2ScoreSection & section : found) {
        if (yue2_schedule_instrumental(section.label)) {
            continue;
        }
        const std::string kind = yue2_schedule_kind(section.label);
        size_t matched = tags.size();
        for (size_t at = next; at < tags.size(); at++) {
            if (tags[at].sung && !yue2_schedule_instrumental(tags[at].label) && yue2_schedule_kind(tags[at].label) == kind) {
                matched = at;
                break;
            }
        }
        if (matched == tags.size()) {
            continue;
        }
        next = matched + 1;
        if (section.first_note < 0.0) {
            continue;
        }
        Yue2LyricSection timed;
        timed.start_sec = std::round(section.first_note * 60.0 / bpm * 1000.0) / 1000.0;
        timed.lyric_c0  = tags[matched].start;
        timed.lyric_c1  = tags[matched].close;
        if (timed.lyric_c1 <= timed.lyric_c0 || timed.start_sec < last) {
            continue;
        }
        last = timed.start_sec;
        out->push_back(timed);
    }
    return !out->empty();
}
