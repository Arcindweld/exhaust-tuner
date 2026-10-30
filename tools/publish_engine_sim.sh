#!/bin/bash
# Copies the newest successful Windows build of Arcindweld/engine-sim (main) onto this repository's
# engine-sim-build branch, where the installer build (.github/workflows/windows.yml) picks it up.
# Run after the fork changes. Needs gh with read access to engine-sim and push access here.
set -euo pipefail
run=$(gh run list -R Arcindweld/engine-sim --workflow "Windows build" --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
sha=$(gh run view "$run" -R Arcindweld/engine-sim --json headSha --jq .headSha)
tmp=$(mktemp -d)
gh run download "$run" -R Arcindweld/engine-sim -n engine-sim-windows-x64 -D "$tmp/pkg"
test -f "$tmp/pkg/engine-sim-arcindweld/bin/engine-sim-headless.exe"
(cd "$tmp/pkg" && zip -qr "$tmp/engine-sim-windows-x64.zip" .)
git clone -q --depth 1 --branch engine-sim-build https://github.com/Arcindweld/exhaust-tuner "$tmp/b"
cp "$tmp/engine-sim-windows-x64.zip" "$tmp/b/"
printf "Windows build of Arcindweld/engine-sim (Engine Simulator fork with the 1-D exhaust and the headless runner)\ncommit %s\nUsed by the Exhaust Tuner installer build (.github/workflows/windows.yml). MIT licence: LICENSE inside the zip.\nRefresh with tools/publish_engine_sim.sh on main.\n" "$sha" > "$tmp/b/README.txt"
cd "$tmp/b" && git add -A && git commit -q -m "Engine Simulator Windows build ${sha:0:7}" && git push -q origin engine-sim-build
echo "published engine-sim ${sha:0:7}"
