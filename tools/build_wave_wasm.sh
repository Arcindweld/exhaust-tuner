#!/usr/bin/env bash
# Builds rust/et_wave to WebAssembly and embeds it in web/index.html (the WAVE_WASM_B64 line), so the page carries
# the Rust wave model with no extra file. Paths are remapped so the build does not depend on where it ran.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/rust/et_wave"
RUSTFLAGS="--remap-path-prefix=$ROOT=. --remap-path-prefix=$HOME/.cargo=~/.cargo --remap-path-prefix=$HOME/.rustup=~/.rustup" \
  cargo build --release --target wasm32-unknown-unknown ${CARGO_OFFLINE:+--offline}
python3 - "$ROOT/web/index.html" "$ROOT/rust/et_wave/target/wasm32-unknown-unknown/release/et_wave.wasm" <<'PY'
import base64, re, sys
page, wasm = sys.argv[1], sys.argv[2]
s = open(page, encoding='utf-8').read()
b64 = base64.b64encode(open(wasm, 'rb').read()).decode()
line = "const WAVE_WASM_B64='" + b64 + "';"
new, n = re.subn(r"const WAVE_WASM_B64='[A-Za-z0-9+/=]*';", lambda m: line, s)
if n != 1:
    sys.exit('web/index.html needs exactly one WAVE_WASM_B64 line (found %d)' % n)
open(page, 'w', encoding='utf-8', newline='\n').write(new)
print('embedded %d bytes of WebAssembly (%d base64 characters)' % (len(base64.b64decode(b64)), len(b64)))
PY
