# CI task progress (agent3/ci; removed in the final commit)

## Done
- Reviewed the inherited WIP (e5402ff): runner, skip.js, skip signalling in 13 tests, autocfd_ui timing.
- Runner: glob discovery (parity/layouts/crates), skip kinds (skip|part), no-openfoam, test_native on the core,
  test_router_native, EXCLUDED (layouts_test_bundle_mode: stale Fusion stub), --merge, results.md,
  cargo_test_rust without EXHAUST_TUNER_OPENWAM + cargo_test_rust_real_openwam (router cancel tests fail with the
  env set: paths.rs reads it before the stand-in -- test isolation bug in rust/et_host/tests/core.rs, report).
- autocfd_ui: holdCancel set before the edits; passes alone and under 3 busy loops on 2 cores.
- desktop_ui: OpenFOAM part -> skipPart.

## In progress
- Full run started (bg, test-results/, scratchpad full.out) with the runner as of 77ecb0a + no env split
  (so cargo_test_rust FAILs there: rerun targeted after).
- Writing .github/workflows/tests.yml.

## Next
- expected_skips.txt from the run, targeted reruns (cargo_test_rust*, anything failing), docs, final commit.

## Results so far
- build/fusion/parity: all pass except layouts_test_bundle_mode (stale, excluded). test_native 233 s.
