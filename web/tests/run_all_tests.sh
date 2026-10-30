#!/bin/bash
# Runs every page test against web/index.html. Needs node + playwright (npm i playwright; npx playwright install chromium).
# Usage: web/tests/run_all_tests.sh        Exit code = number of failing tests.
cd "$(dirname "$0")/.." || exit 1
fails=0
for t in tests/*_ui.js tests/h621.js tests/bmep_check.js tests/hw_compare.js; do
  n=$(basename "$t" .js)
  out=$(timeout 900 node "$t" index.html 2>&1)
  if echo "$out" | grep -qE "^FAIL|FAILS|FAILED|PAGEERROR|Error:"; then
    printf "%-14s FAIL\n" "$n"; echo "$out" | grep -E "^FAIL|FAILS|FAILED|PAGEERROR|Error:" | head -5 | sed 's/^/    /'; fails=$((fails+1))
  else printf "%-14s ok\n" "$n"; fi
done
echo "failing tests: $fails"; exit $fails
