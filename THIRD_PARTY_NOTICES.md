# Third-party notices

Code in this repository adapted from other projects, and the notices their
licences ask for. Nothing here is under the AGPL or another copyleft licence.

## timoncool/yue2.cpp (MIT)

https://github.com/timoncool/yue2.cpp, branch `companion`, fork of the same
yue2.cpp project this repository is built on and under the same licence text
as `LICENSE` ("Copyright (c) 2023-2026 The yue2.cpp authors").

Ported on the `studio-ports` branch, by upstream commit:

| Upstream | What | Where here |
|---|---|---|
| 61cd731 | per-stage KV cache sizing | `src/pipeline.h`, `src/qwen3-lm.h` |
| c8516db | ab2 Adams-Bashforth flow solver (opt-in, `"solver": "ab2"`) | `src/flow-solver.h`, `src/nar.h`, `tests/test-flow-solver.cpp` (verbatim) |
| 70583e5 | NAR flash-attention KV padding to 256 | `src/nar.h` |
| f429e9e | unsingable planned score fail-fast | `src/score-sanity.h`, `tests/test-score-sanity.cpp` (renamed from `score-check.h` / `test-score-check.cpp`) |
| 7de5308 | context-fit report (log line only; this studio keeps its clamp) | `src/pipeline.h` |
| 21b3831 | lyric schedule tied to the score clock (opt-in) | `src/generate.h`, `src/qwen3-lm.h`, `src/pipeline.h`, `src/request.*` |
| 1e21e63 | harmony steering of the planned score (opt-in) | `src/harmony.h`, `tests/test-harmony.cpp` (verbatim), `src/bpe.h`, `src/generate.h`, `src/pipeline.h`, `src/request.*`, `tools/yue-plan.cpp` |
| 7c46a5e | ggml: flash-attention mask scan broadcast fix | `ggml` submodule, cherry-picked from timoncool/ggml 06024424 (MIT, the ggml authors) |

## timoncool/YuE2-Studio (MIT)

https://github.com/timoncool/YuE2-Studio. `src/lyric-schedule.h` is a C++
port of `crates/music-server/src/score/schedule.rs` (the lyric schedule
builder) and `tests/test-lyric-schedule.cpp` reuses its test cases.
`tools/webui/src/lib/harmony.ts` ports its lyric tag to section name
mapping (`label_of`, `section_labels`); the web UI's structure and harmony
hint texts follow its wording.

## Credits without copied code

- HOT-Step-CPP: the C6 lyric schedule design and its default bias of -4, as
  ported by timoncool/yue2.cpp 21b3831.
- Yeufonic: the harmony controls, reimplemented from its description by
  timoncool/yue2.cpp 1e21e63.

The MIT licence text of timoncool/yue2.cpp:

```
MIT License

Copyright (c) 2023-2026 The yue2.cpp authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

timoncool/YuE2-Studio:

```
MIT License

Copyright (c) 2025-2026 Ilya Timonin (Nerual Dreming)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
