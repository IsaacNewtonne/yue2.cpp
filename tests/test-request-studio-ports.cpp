// test-request-studio-ports: the opt-in request fields ported from
// timoncool/yue2.cpp (solver, lyric_schedule, harmony) parse, refuse bad
// input through Yue2Request::invalid, stay off by default and round-trip.

#include "request.h"

#include <cstdio>
#include <string>

static int failures = 0;

static void check(bool ok, const char * what) {
    if (!ok) {
        fprintf(stderr, "[ERROR] %s\n", what);
        failures++;
    }
}

static Yue2Request parse(const char * json) {
    Yue2Request r;
    request_init(&r);
    request_parse_json(&r, json);
    return r;
}

int main() {
    Yue2Request d = parse("{}");
    check(d.solver == "midpoint", "midpoint by default");
    check(!d.lyric_schedule.on && !d.harmony.active() && d.invalid.empty(), "opt-ins off by default");
    check(request_to_json(&d).find("harmony") == std::string::npos, "sparse JSON leaves harmony out");
    check(request_to_json(&d).find("lyric_schedule") == std::string::npos, "sparse JSON leaves the schedule out");

    Yue2Request a = parse("{\"lyric_schedule\": \"auto\"}");
    check(a.lyric_schedule.on && a.lyric_schedule.automatic && a.lyric_schedule.bias == -4.0f, "auto schedule, bias -4");
    Yue2Request a2 = parse(request_to_json(&a).c_str());
    check(a2.lyric_schedule.on && a2.lyric_schedule.automatic && a2.lyric_schedule.bias == -4.0f, "auto round-trips");

    Yue2Request e = parse("{\"lyric_schedule\": {\"mode\": \"bias\", \"bias\": -2.5, \"lead_sec\": 1,"
                          " \"sections\": [{\"start_sec\": 4, \"lyric\": [0, 10]}, {\"start_sec\": 9, \"lyric\": [11, 20]}]}}");
    check(e.lyric_schedule.on && !e.lyric_schedule.automatic && e.lyric_schedule.sections.size() == 2, "explicit sections");
    Yue2Request e2 = parse(request_to_json(&e).c_str());
    check(e2.lyric_schedule.sections.size() == 2 && e2.lyric_schedule.sections[1].lyric_c0 == 11 &&
          e2.lyric_schedule.bias == -2.5f && e2.lyric_schedule.lead_sec == 1.0, "explicit sections round-trip");

    check(!parse("{\"lyric_schedule\": {\"mode\": \"bias\", \"bias\": 3, \"sections\": []}}").invalid.empty(),
          "a bad schedule is refused");
    check(!parse("{\"lyric_schedule\": {\"mode\": \"auto\", \"bias\": 1}}").invalid.empty(), "a positive bias is refused");

    Yue2Request h = parse("{\"harmony\": {\"follow\": [\"Intro\", \"verse\", \"CHORUS\"], \"strength\": 2}}");
    check(h.harmony.active() && h.harmony.follow.size() == 3 && h.harmony.follow[2] == "chorus", "follow lowercased");
    Yue2Request h2 = parse(request_to_json(&h).c_str());
    check(h2.harmony.follow == h.harmony.follow && h2.harmony.strength == 2.0f, "harmony round-trips");
    check(!parse("{\"harmony\": {\"strength\": 100}}").invalid.empty(), "out-of-bounds harmony is refused");
    check(!parse("{\"harmony\": {\"follow\": \"verse\"}}").invalid.empty(), "follow must be a list");
    check(parse("{\"solver\": 3}").solver != "midpoint", "a non-string solver stays invalid");

    if (failures) {
        fprintf(stderr, "[ERROR] %d checks failed\n", failures);
        return 1;
    }
    fprintf(stderr, "[OK] test-request-studio-ports\n");
    return 0;
}
