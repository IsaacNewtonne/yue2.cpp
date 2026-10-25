// test-score-check: score quality gate, lyric-fit estimate and chorus lock.
#include "score-check.h"
#include "song-ending.h"

#include <cstdio>
#include <cstdlib>
#include <string>

static void check(bool ok, const char * message) {
    if (!ok) { std::fprintf(stderr, "FAIL: %s\n", message); std::exit(1); }
}

static const char * HEADER =
    "X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=100\n"
    "V: Vocal clef=treble name=\"Vocal Melody\" snm=\"Vocal\"\n"
    "V: Ins clef=treble name=\"Ins Melody\" snm=\"Inst.\"\nK:C\n";

static std::string section(const char * name, const char * vocal, const char * ins = "c8e8g8c'8|c8e8g8c'8|") {
    return std::string("% ") + name + "\nV: Vocal\n" + vocal + "\nV: Ins\n" + ins + "\n";
}

int main() {
    const std::string lyrics =
        "Title of the song\n\n[Verse]\nwalking down the empty road tonight\nevery light is fading out of sight\n"
        "[Chorus]\nhold on hold on\nwe will rise again\n\n[Verse]\nsecond verse has other words\nstill the same old town\n"
        "[Chorus]\nhold on hold on\nwe will rise again\n";
    const LyricShape shape = score_lyric_shape(lyrics);
    check(shape.lines == 9 && shape.choruses == 2, "labels are not lines, two sung choruses");
    check(shape.vocal, "lyrics are vocal");
    check(!score_lyric_shape("[Intro]\n\n[Instrumental]\n").vocal, "labels alone are instrumental");
    check(score_label_is_chorus("Final Chorus - Voice 2") && score_label_is_chorus("Hook"), "chorus aliases");
    check(!score_label_is_chorus("Pre-Chorus") && !score_label_is_chorus("Post Chorus"), "pre/post excluded");

    // 140 words a minute plus 30 s, labels excluded
    std::string long_lyrics = "[Verse]\n";
    for (int i = 0; i < 140; i++) long_lyrics += "word ";
    check(std::fabs(score_estimate_seconds(long_lyrics) - 90.0f) < 0.01f, "140 words is one minute plus 30 s");
    check(score_estimate_seconds("") == 0.0f, "no lyrics, no estimate");
    check(song_auto_ceiling(90.0f) == 123.0f, "ceiling is 1.2x estimate + 15 s");
    check(song_auto_ceiling(560.0f) == 600.0f && song_auto_ceiling(0.0f) == 600.0f, "ceiling capped at ten minutes");

    const char * sung = "c4d4e4f4g8z8|g4f4e4d4c8z8|c4c4d4d4e8z8|e4d4c4d4c8z8|";
    const char * hook = "g8g8e8c8|a8g8e8z8|g8g8e8c8|d8d8c8z8|";
    const char * rest = "z32|z32|z32|z32|";

    // An official-shaped score passes
    std::string good = std::string(HEADER) + section("intro", rest) + section("verse", sung) + section("chorus", hook) +
                       section("verse", sung) + section("chorus", "a8a8f8d8|b8a8f8z8|a8a8f8d8|e8e8d8z8|") +
                       section("outro", rest);
    ScoreReport report = score_inspect(good);
    check(report.has_vocal_voice && report.vocal_bars == 16, "sung bars counted in the vocal voice only");
    check(report.chorus_sections == 2 && report.chorus_vocal_sections == 2, "sung choruses counted");
    std::string why;
    check(score_acceptable(report, shape, false, &why), "good score accepted");

    // The degenerate shape seen in failed takes: intro/verse only, vocal rests
    std::string loop = std::string(HEADER) + section("intro", rest) + section("verse", rest) + section("verse", rest);
    report = score_inspect(loop);
    check(report.vocal_bars == 0, "rests are not sung bars");
    check(!score_acceptable(report, shape, false, &why) && why.find("sung bars") != std::string::npos,
          "vocal-free score rejected");

    // Sung but chorus-free
    std::string nochorus = std::string(HEADER) + section("verse", sung) + section("verse", sung) + section("verse", sung);
    check(!score_acceptable(score_inspect(nochorus), shape, false, &why) && why.find("chorus") != std::string::npos,
          "chorus-free score rejected when lyrics have choruses");
    check(!score_acceptable(score_inspect(good), shape, true, &why), "truncated score rejected");
    check(score_acceptable(score_inspect(loop), score_lyric_shape(""), false, &why), "instrumental passes");
    check(score_quality(score_inspect(good), false) > score_quality(score_inspect(nochorus), false), "ranking");

    // Chord symbols and decorations are not notes
    check(!score_bar_has_note("\"Am\"z8\"G\"z8!f!z16"), "chords over rests are not sung");

    // Chorus lock copies the first chorus melody over the later one
    int copied = 0;
    std::string locked = score_lock_choruses(good, shape, &copied);
    check(copied == 1, "one later chorus locked");
    ScoreReport lr = score_inspect(locked);
    check(lr.sections.size() == 6 && lr.vocal_bars == 16, "structure preserved by the lock");
    const ScoreSection & a = lr.sections[2], & b = lr.sections[4];
    check(locked.substr(a.begin, a.end - a.begin) == locked.substr(b.begin, b.end - b.begin), "choruses identical");
    check(locked.find("a8a8f8d8") == std::string::npos, "old chorus melody replaced");
    check(locked.substr(0, a.begin) == good.substr(0, a.begin), "text before the chorus untouched");

    // Different chorus words: no lock
    const LyricShape varied = score_lyric_shape(
        "[Chorus]\nhold on hold on\nwe will rise again\n[Verse]\nx y z\n[Chorus]\ncompletely different words here\nnothing alike at all\n");
    score_lock_choruses(good, varied, &copied);
    check(copied == 0, "different chorus lyrics are not locked");

    // Meter changes anywhere in the body: no lock
    std::string meter = good;
    meter.insert(meter.find("% outro") + 8, "M:2/4\n");
    score_lock_choruses(meter, shape, &copied);
    check(copied == 0, "meter change disables the lock");

    // Final chorus without a trailing newline keeps the text shape
    std::string tail = std::string(HEADER) + section("verse", sung) + section("chorus", hook) + section("verse", sung) +
                       section("chorus", "a8a8f8d8|b8a8f8z8|");
    tail.pop_back();
    locked = score_lock_choruses(tail, shape, &copied);
    check(copied == 1 && locked.back() != '\n', "last block replaced without adding a newline");

    std::puts("PASS: lyric shape, lyric-fit ceiling, score gate, chorus lock");
}
