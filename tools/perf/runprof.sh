#!/bin/sh
# tools/perf/runprof.sh OLD NEW OUT : the per-tab profile tables (prof.js) for two pages, one after the other
for t in hangers intake mufflers four-stroke headers sound; do for f in "$1" "$2"; do echo "== $f $t"; node "$(dirname "$0")/prof.js" "$f" "$t" ${THR:-1}; done; done > "$3" 2>&1
