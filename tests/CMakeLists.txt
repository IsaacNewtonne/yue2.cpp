# test-vae: Oobleck VAE decoder parity harness against the torch reference.
add_executable(test-song-ending test-song-ending.cpp ${CMAKE_SOURCE_DIR}/src/request.cpp)
target_include_directories(test-song-ending PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(test-song-ending PRIVATE yyjson)

add_executable(test-score-check test-score-check.cpp)
target_include_directories(test-score-check PRIVATE ${CMAKE_SOURCE_DIR}/src)

add_executable(test-vae test-vae.cpp)
link_ggml_backends(test-vae)

# test-lm: backbone AR path parity harness against the torch reference.
add_executable(test-lm test-lm.cpp)
link_ggml_backends(test-lm)

# test-nar: backbone NAR path parity harness against the torch reference.
add_executable(test-nar test-nar.cpp)
link_ggml_backends(test-nar)

# test-bpe: frozen tokenizer parity harness, pure CPU, no ggml.
add_executable(test-bpe test-bpe.cpp)
link_ggml_backends(test-bpe)

# test-sampling: AR sampling distribution parity harness, pure CPU, no ggml.
add_executable(test-sampling test-sampling.cpp)
target_include_directories(test-sampling PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-rng: PyTorch CPU generator parity harness, pure CPU, no ggml.
add_executable(test-rng test-rng.cpp)
target_include_directories(test-rng PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-draw: token draw parity harness, pure CPU, no ggml.
add_executable(test-draw test-draw.cpp)
target_include_directories(test-draw PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-sheetsage: SheetSage2 transcriber parity harness against the torch reference.
add_executable(test-sheetsage test-sheetsage.cpp)
target_link_libraries(test-sheetsage PRIVATE yyjson)
link_ggml_backends(test-sheetsage)

# test-flow-solver: the flow matching steppers on analytic fields, pure CPU, no ggml.
# Ported from timoncool/yue2.cpp (c8516db), MIT.
add_executable(test-flow-solver test-flow-solver.cpp)
target_include_directories(test-flow-solver PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-score-sanity: a planned score nothing can be sung from, pure CPU, no ggml.
# Ported from timoncool/yue2.cpp (f429e9e), MIT.
add_executable(test-score-sanity test-score-sanity.cpp)
target_include_directories(test-score-sanity PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-lyric-schedule: the lyric schedule builder, pure CPU, no ggml.
# Cases after timoncool/YuE2-Studio score/schedule.rs (MIT).
add_executable(test-lyric-schedule test-lyric-schedule.cpp)
target_include_directories(test-lyric-schedule PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-harmony: chord variety and section order of the planned score, pure CPU, no ggml.
# Ported from timoncool/yue2.cpp (1e21e63), MIT.
add_executable(test-harmony test-harmony.cpp)
target_include_directories(test-harmony PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-request-studio-ports: opt-in request fields from the studio-ports port, pure CPU.
add_executable(test-request-studio-ports test-request-studio-ports.cpp ${CMAKE_SOURCE_DIR}/src/request.cpp)
target_include_directories(test-request-studio-ports PRIVATE ${CMAKE_SOURCE_DIR}/src)
target_link_libraries(test-request-studio-ports PRIVATE yyjson)
