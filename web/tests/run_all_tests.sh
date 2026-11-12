#!/bin/bash
# Runs every page test (web/tests/*.js) through tools/run_all_tests.py --suite web, the runner for the whole suite:
# the same failure markers this script always used (a non-zero exit, FAIL / FAILS / FAILED / PAGEERROR / Error: /
# " BAD " / "overflow <n>" / "panel looks empty", or past the time limit), the page path for the tests that take it,
# and every skip counted with its reason ("TEST SKIPPED: <why>" for a whole test, "SKIP: <why>" for a part) against
# tests/expected_skips.txt. Builds exhaust-tuner-host first when cargo is here (desktop_ui, update_ui need it).
# Needs node + playwright (npm i playwright; npx playwright install chromium).
# Usage: web/tests/run_all_tests.sh [runner options, e.g. --only wam --no-build]   Exit code 0 = all passed.
cd "$(dirname "$0")/../.." || exit 1
exec python3 tools/run_all_tests.py --suite web "$@"
