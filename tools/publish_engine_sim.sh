#!/bin/bash
# Copies the newest successful Windows build of Arcindweld/engine-sim (main) into a release of
# Arcindweld/exhaust-tuner, where the installer build picks it up. Run after the fork changes.
# Needs gh with read access to engine-sim and write access to exhaust-tuner.
set -euo pipefail
run=$(gh run list -R Arcindweld/engine-sim --workflow "Windows build" --branch main --status success --limit 1 --json databaseId,headSha --jq '.[0].databaseId')
sha=$(gh run view "$run" -R Arcindweld/engine-sim --json headSha --jq .headSha)
tag="engine-sim-${sha:0:7}"
tmp=$(mktemp -d)
gh run download "$run" -R Arcindweld/engine-sim -n engine-sim-windows-x64 -D "$tmp/pkg"
test -f "$tmp/pkg/engine-sim-arcindweld/bin/engine-sim-headless.exe"
(cd "$tmp/pkg" && zip -qr "$tmp/engine-sim-windows-x64.zip" .)
gh release create "$tag" "$tmp/engine-sim-windows-x64.zip" -R Arcindweld/exhaust-tuner --target main \
  --title "Engine Simulator build $tag" \
  --notes "Windows build of Arcindweld/engine-sim at $sha (workflow run $run), with the headless runner. Used by the installer build; not a release of Exhaust Tuner. MIT licence (LICENSE inside)."
echo "published $tag"
