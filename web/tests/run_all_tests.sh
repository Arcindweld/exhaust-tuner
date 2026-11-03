#!/bin/bash
# Runs every page test against web/index.html. Needs node + playwright (npm i playwright; npx playwright install chromium).
# Usage: web/tests/run_all_tests.sh        Exit code = number of failing tests.
#
# A test FAILS when any of these happens:
#   - node exits non-zero (a crash, an assertion that sets the exit code, or the 900 s timeout, exit 124);
#   - it prints FAIL / FAILS / FAILED / PAGEERROR / Error: ;
#   - it prints one of the problem markers the screenshot-style tests use: " BAD ", "overflow <n>", "panel looks empty".
# A test that prints a line "skipped" (it needs a program or solver that is not here) is reported as SKIP, and a check
# inside a test that could not run (a line starting "SKIP:") is listed under its test, so a quiet pass never hides either.
cd "$(dirname "$0")/.." || exit 1
fails=0; skips=0
for t in tests/*_ui.js tests/h621.js tests/bmep_check.js tests/hw_compare.js tests/wave_wasm.js; do
  n=$(basename "$t" .js)
  out=$(timeout 900 node "$t" index.html 2>&1); rc=$?
  bad=$(echo "$out" | grep -E "^FAIL|FAILS|FAILED|PAGEERROR|Error:| BAD |overflow [0-9]|panel looks empty" | head -5)
  part=$(echo "$out" | grep -E "^ *SKIP:" | head -5)
  if [ $rc -ne 0 ] || [ -n "$bad" ]; then
    why=""; [ $rc -eq 124 ] && why=" (timed out)"; [ $rc -ne 0 ] && [ $rc -ne 124 ] && why=" (exit $rc)"
    printf "%-14s FAIL%s\n" "$n" "$why"
    [ -n "$bad" ] && echo "$bad" | sed 's/^/    /'
    fails=$((fails+1))
  elif echo "$out" | grep -qx "skipped"; then
    printf "%-14s SKIP  %s\n" "$n" "$(echo "$out" | head -1 | cut -c1-110)"; skips=$((skips+1))
  else
    printf "%-14s ok\n" "$n"
  fi
  [ -n "$part" ] && echo "$part" | sed 's/^ */    /'
done
echo "failing tests: $fails, skipped: $skips"; exit $fails
