// test-lyric-schedule: the lyric schedule builder (lyric-schedule.h), pure CPU.
// The first cases are YuE2-Studio's score/schedule.rs tests (timoncool, MIT).

#include "lyric-schedule.h"

#include <cstdio>
#include <string>

static int failures = 0;

static void check(bool ok, const char * what) {
    if (!ok) {
        fprintf(stderr, "[ERROR] %s\n", what);
        failures++;
    }
}

static std::string span(const std::string & text, int64_t c0, int64_t c1) {
    std::string out;
    int64_t     n = -1;
    for (size_t i = 0; i < text.size(); i++) {
        if (((unsigned char) text[i] & 0xC0) != 0x80) {
            n++;
        }
        if (n >= c0 && n < c1) {
            out += text[i];
        }
    }
    return out;
}

static const std::string SCORE =
    "X:1\nT:\nM:4/4\nL:1/16\nQ:1/4=120\nV: Vocal clef=treble name=\"Vocal Melody\" snm=\"Vocal\"\n"
    "V: Ins clef=treble name=\"Ins Melody\" snm=\"Inst.\"\nK:C\n% intro\nV: Vocal\nz16|z16|\nV: Ins\nC16|C16|\n"
    "% verse\nV: Vocal\nz8C8|D16|\nV: Ins\nZ2|\n% chorus\nV: Vocal\nE16|F16|\nV: Ins\nZ2|\n";

int main() {
    {
        const std::string lyrics = "[Intro]\n\n[Verse 1]\nline one\nline two\n\n[Chorus]\nsing it\n";
        std::vector<Yue2LyricSection> timed;
        check(yue2_lyric_schedule_build(SCORE, lyrics, &timed), "a schedule");
        check(timed.size() == 2, "two sung sections");
        if (timed.size() == 2) {
            // verse: bar 3 at 120 BPM is 4 s in, its first note half a bar later
            check(timed[0].start_sec == 5.0, "verse at 5 s");
            check(timed[1].start_sec == 8.0, "chorus at 8 s");
            check(span(lyrics, timed[0].lyric_c0, timed[0].lyric_c1) == "[Verse 1]\nline one\nline two", "verse span");
            check(span(lyrics, timed[1].lyric_c0, timed[1].lyric_c1) == "[Chorus]\nsing it", "chorus span");
        }
    }
    {
        const std::string lyrics = "[\xd0\x9a\xd1\x83\xd0\xbf\xd0\xbb\xd0\xb5\xd1\x82]\n\xd0\xbf\xd0\xb5\xd1\x80\xd0\xb2\xd0\xb0\xd1\x8f\n[Chorus]\n\xd0\xbf\xd1\x80\xd0\xb8\xd0\xbf\xd0\xb5\xd0\xb2";
        std::vector<Yue2LyricSection> timed;
        check(yue2_lyric_schedule_build(SCORE, lyrics, &timed), "the chorus is timed");
        check(timed.size() == 1, "only the chorus matches");
        if (timed.size() == 1) {
            check(span(lyrics, timed[0].lyric_c0, timed[0].lyric_c1) == "[Chorus]\n\xd0\xbf\xd1\x80\xd0\xb8\xd0\xbf\xd0\xb5\xd0\xb2",
                  "codepoint span");
        }
        check(!yue2_lyric_schedule_build(SCORE, "no tags at all", &timed), "no tags, no schedule");
        check(!yue2_lyric_schedule_build("X:1\nnot a score", "[Verse]\nwords", &timed), "no score, no schedule");
    }
    {
        // the model's own dialect: repeats, chords, inline keys, Z rests, L:1/32
        const std::string score =
            "X:1\nT:\nM:2/4\nL:1/32\nQ:1/4=60\nV: Vocal clef=treble name=\"Vocal Melody\" snm=\"Vocal\"\n"
            "V: Ins clef=treble name=\"Ins Melody\" snm=\"Inst.\"\nK:Em\n% intro\nV: Vocal\n"
            "z12\"Em\"z4|\"Em\"z16|\nV: Ins\nZ2|\n% verse\nV: Vocal\n|:\"Em\"z8b8|\"C\"e8a4f4:|\nV: Ins\nZ2|\n"
            "% pre-chorus\nV: Vocal\nZ|[K:G]\"G\"g16|\nV: Ins\nZ2|\n% chorus\nV: Vocal\n[GB]16|g16|\nV: Ins\nZ2|\n";
        const std::string lyrics = "[Verse]\na b\n\n[Pre-Chorus]\nc d\n\n[Chorus]\ne f";
        std::vector<Yue2LyricSection> timed;
        check(yue2_lyric_schedule_build(score, lyrics, &timed), "native dialect schedules");
        check(timed.size() == 3, "three sung sections");
        if (timed.size() == 3) {
            // 2/4 at 60 BPM: a bar is 2 s; verse opens bar 3 (4 s) plus a quarter
            check(timed[0].start_sec == 5.0, "verse after its rest");
            check(timed[1].start_sec == 10.0, "pre-chorus after a whole-bar rest");
            check(timed[2].start_sec == 12.0, "chorus on its downbeat");
        }
    }
    check(yue2_schedule_kind("Pre_Chorus 2") == "pre-chorus", "pre-chorus kind");
    check(yue2_schedule_kind("Verse 2") == "verse", "verse kind");
    check(yue2_schedule_instrumental("Guitar Solo"), "a solo is played");
    if (failures) {
        fprintf(stderr, "[ERROR] %d checks failed\n", failures);
        return 1;
    }
    fprintf(stderr, "[OK] test-lyric-schedule\n");
    return 0;
}
