# Exhaust Tuner

Exhaust and intake design software for real builds: sizing from published methods, 1-D gas-dynamic simulation
(OpenWAM), steady CFD (OpenFOAM), sound prediction checked against recordings, and a Fusion add-in that lays the
tubes out in the car's scanned bay.

**To install it:** download [ExhaustTuner-Setup.exe](https://github.com/Arcindweld/exhaust-tuner/releases/latest/download/ExhaustTuner-Setup.exe)
and open it. [INSTALL.md](INSTALL.md) has the steps (including the "Windows protected your PC" screen), the Fusion
add-in, updates and uninstalling.

Standing rules for every change: results must come from real computation, every number from a cited source or a
stated estimate, and limits are written down plainly next to the result they affect.

## What is here

| Folder | What it is |
|---|---|
| `web/` | The calculator (`index.html`, one self-contained page) and its browser tests. The page is also the Fusion add-in's panel (`make_palette.py` wraps it). |
| `fusion-addin/` | The Fusion add-in (`ExhaustTuner.py`, `cadtools.py`, `router.py`, `templates.py`, `jig.py`, `hangers.py`, `merge.py`, `native.py`): measure, keep-outs, clearance, auto-routing (single pipe, headers, equal or unequal length, parts in line), the 180-degree V8 template, 3D-printed fabrication jigs under routed tubes (`jig.py`: separate cradles, a base frame, a plate, continuous saddles or a flange frame; as drawn or laid flat; free-standing or bolted to a System 16/28 fixture table; flange locators, weld gaps, print-bed check), hangers and brackets from the page's Hangers tab put square to the tube where it is clicked, pointing at a picked mount (`hangers.py`), merge collectors and Y merges as one welded part (slip sleeve, merge plate with a bore-size hole per tube, cone and centre spike) with their cut files (`merge.py`), and the drone fixes: J-pipes capped and coped to the main pipe, and Helmholtz cans on a coped neck. `native.py` loads the router's Rust core when it is installed beside the add-in. `tests/` has the router and geometry tests, the Rust core against the Python (`test_native.py`), a run of the builders against a stand-in for Fusion's API (no Fusion needed), and `fusion_live_*.py` scripts to run inside Fusion. |
| `rust/et_core/` | The router's Rust core (stage 1 of the move to Rust): the scan and tube distance queries, the clearance fields, route()'s lattice search, Levenberg-Marquardt fit and clearance check, and the scan fit's cost, written line for line from `router.py` so both give the same numbers (the same routes, unless the slower Python run is stopped by the route's time limit first). A C interface the add-in loads with ctypes (Fusion add-ins are Python); every call is checked, and if the core fails the add-in carries on in Python. No dependencies. |
| `rust/et_host/` | The Windows program's request handling (stage 2), ported from the C# program: runs OpenWAM, Engine Simulator and OpenFOAM for the page, case files, the Fusion add-in install, updates from GitHub releases (the token kept with DPAPI), the CFD case generator for 3-D designs (`cfd_gen.rs`, intake_cfd.py's generate_case with its own text templates in `cfd_templates.rs`, made by `cfd/gen_rust_templates.py`) and the case report and convergence watchdog (`cfd_report.rs`), all writing the Python's files byte for byte (`cfd/gen_rs_vs_py.py`, `cfd/report_rs_vs_py.py`), and `exhaust-tuner-host` (the same requests over stdin/stdout, for the tests and the installer; `--cfd-generate design.json DIR`, `--cfd-report DIR`). No Python is bundled. No Windows-only code outside DPAPI, so its tests run anywhere. |
| `rust/et_app/` | The Windows program's window (`ExhaustTuner.exe`): the page in WebView2 (wry and tao), served from the program's folder at `https://app.exhaust-tuner/`, with folder and save dialogs (rfd). |
| `openwam/` | Writes OpenWAM 2.2 cases from the page's design (`make_wam.py` and its byte-identical JavaScript port `wam_export.js`; two-strokes `make_wam2t.py` and `wam2t_export.js`), reads the results back. Besides the engine and headers: mufflers as volumes with several exits, J-pipe and Helmholtz side branches, parallel paths between two junctions (tube bundles, augers), merge losses from the CFD, measured valve lift profiles, and for two-strokes a reed with a lift stop. `node test_py_js.js` and `node test_py_js_2t.js` check the writers agree. `patches/` holds the one change made to OpenWAM before it is built (the reed lift stop); every other input runs as on a stock OpenWAM 2.2. |
| `cfd/` | OpenFOAM v2412 case generator for intake tracts and exhaust parts (`intake_cfd.py`, JavaScript port `intake_cfd.js`), validation against Blair & Cahoon and handbook loss coefficients (`validation/`, `NOTES.md`). |
| `sound/` | Sound from simulation and from recordings: `wam_sound.py` (tailpipe monopole from OpenWAM outflow), `rpm_track.py` and `order_spectrum.py` (engine speed and order spectrum of a recording), `order_compare.py` (model vs recording). |
| `enginesim/` | Exporter for Engine Simulator files (the Arcindweld fork with the 1-D exhaust lives in its own repository, `Arcindweld/engine-sim`). |
| `validation/` | Measured vehicles: 2004 Subaru Outback 2.5i and 2026 Aprilia RS 660 (recordings, order spectra, model comparisons, research). |
| `layouts/` | Worked systems, e.g. the LS3 180-degree headers-back layout used to build the template. |
| `app/` | The former Windows program (C#/.NET 8: WPF window, `ExhaustTuner.Core`, `ExhaustTuner.HostCli`). No longer built or shipped: `rust/` replaced it. Kept as the reference the Rust port was checked against until the Rust program has run on a PC, then removed. |
| `installer/` | Inno Setup script for the per-user installer. |
| `tools/openfoam/` | Builds OpenFOAM v2412 for Windows from ESI's source release (MinGW-w64 cross build, one small patch) and checks it against the Linux results before it can ship. |
| `cad/` | Rough parametric models of bought parts for laying out around (Holley 105 mm throttle body; K&N round tapered filter). |
| `docs/` | Project status and open items (`STATUS.md`). |

## Running the tests

Everything at once, from a clean checkout on Linux (or macOS): Node 18+ with Playwright (`npm i playwright && npx
playwright install chromium`), Python 3.12+ with numpy and scipy, and Rust (cargo, `rustup target add
wasm32-unknown-unknown`) for the Rust parts; what is missing is skipped and says why.

```
python3 tools/run_all_tests.py                 # everything, one test at a time (30-45 min); -j 2 runs two at a time
python3 tools/run_all_tests.py --list          # the plan: every test, its folder and command line
python3 tools/run_all_tests.py --only 'wam|cfd' --no-build      # some of them, with the programs as built
python3 tools/run_all_tests.py --skip-slow     # a quick local run: leaves out test_header_uel and test_native (minutes each)
EXHAUST_TUNER_OPENWAM=/path/to/OpenWAM python3 tools/run_all_tests.py   # with the OpenWAM tests too
```

It builds exhaust-tuner-host, the router core and the wave model (WebAssembly) when cargo is here, then runs `cargo
test` for every crate under `rust/`, every `web/tests/*.js` (with `index.html` for the ones that take the page path),
every `fusion-addin/tests/test_*.py`, and the parity checks (`cfd/*_vs_py.*`, `openwam/test_*.js`, `sound/test_*.py`,
`layouts/*/test_*.py`, the generator's templates, the embedded OpenWAM writer). New test files there are picked up
without editing anything. Results: `test-results/results.txt` (the table: test, PASS / FAIL / SKIP / PASS+SKIP /
FLAKY, seconds, why), `results.json`, `results.md` and a log per test in `test-results/logs/`; the exit code is 0 only
when nothing failed and every skip was expected.

- A test that cannot run says so: `TEST SKIPPED: <why>` for the whole test, `SKIP: <why>` for a part
  (`web/tests/skip.js`; the Python tests print the same line). Run on its own such a test still exits 0.
- `tests/expected_skips.txt` lists the skips allowed and when (`name kind condition reason`, e.g. `desktop_ui part
  no-openfoam ...`); any other skip fails the run, so a test that stops running is noticed.
- `tests/flaky.txt` lists the tests run a second time after a failure, each with its reason (empty: a timing-sensitive
  test is fixed by waiting on its condition instead).
- `--skip-slow` leaves out the tests in `SLOW` in `tools/run_all_tests.py` (test_header_uel, about 230 s, and
  test_native: the router runs to its node and iteration limits with no clock limit, so they are deterministic but long);
  the table's footer names them as not run. It is for quick local runs only: CI and a plain run include them.
- Page tests that read the page right after changing an input use `web/tests/settle.js`: `reads(page)` makes
  `page.$eval` / `$$eval` one call that first waits until the page has stopped re-rendering (`window.__renderCount`,
  bumped by every render), so a read never lands on a node a re-render has just replaced.
- `.github/workflows/tests.yml` runs it on every push and pull request, in shards balanced on `tools/test_timings.json`
  (refresh with `--write-timings`), with the table in the job summary.

The pieces one at a time:

```
# page tests (Node 18+ and Playwright: npm i playwright && npx playwright install chromium); the runner's web suite
web/tests/run_all_tests.sh

# OpenWAM writers agree (Python 3 + Node)
cd openwam && node test_py_js.js && node test_py_js_2t.js

# router (Python 3, no Fusion): on the Rust core when EXHAUST_TUNER_NATIVE_DIR points at the built library (or it sits
# beside the add-in), on the Python otherwise
cd fusion-addin/tests && python3 test_router.py && python3 test_header.py && python3 test_header_uel.py && python3 test_header_triy.py && python3 test_jig.py && python3 test_fabjig.py && python3 test_hangers.py && python3 test_merge.py

# the Rust core (Rust 1.78+): its own tests, then everything it does against the Python router, number for number
# (--require: fail, not skip, when the built core does not load)
cargo test --release --manifest-path rust/et_core/Cargo.toml && cargo build --release --manifest-path rust/et_core/Cargo.toml
cd fusion-addin/tests && EXHAUST_TUNER_NATIVE_DIR=../../rust/et_core/target/release python3 test_native.py --require
cd fusion-addin/tests && python3 test_drone_parts.py && python3 test_drone_fusion_mock.py && python3 test_cfd_stl.py
# inside Fusion (Utilities > Scripts, or the Fusion connector): fusion-addin/tests/fusion_live_drone_parts.py
cd layouts/ls3-180 && python3 test_template.py

# the CFD case writer in the browser writes the same files as the Python generator
node cfd/cfd_js_vs_py.js

# the program's request handling (Rust 1.88+, for the crates it locks); with EXHAUST_TUNER_OPENWAM /
# EXHAUST_TUNER_OPENFOAM set it also runs the real solvers. The window builds only for Windows (on Linux a stand-in
# that exits); cargo check --target x86_64-pc-windows-msvc --no-default-features type-checks it from Linux.
cargo test --release --manifest-path rust/Cargo.toml

# the page inside the program, end to end (needs the built host and the solvers; see the file header)
node web/tests/desktop_ui.js

# updates inside the program: the menu, the host's update requests and a stand-in GitHub (needs the built host)
node web/tests/update_ui.js
```

## The Windows program

One installer (built by `.github/workflows/windows.yml`) puts the calculator in its own window and runs the solvers on
the PC: OpenWAM (built from CMT-UPV's source), Engine Simulator (the fork's headless runner), and OpenFOAM v2412
(built for Windows by `.github/workflows/openfoam-windows.yml` and bundled only after it reproduces the Linux results
on the 2-D validation cases of the generator version it ships with; the 3-D snappyHexMesh path is not part of that
check yet). The CFD case generator, report and convergence watchdog are in the program (Rust), so no Python is
installed. It installs the Fusion add-in too, set to start with Fusion. The installer is one click: opening it installs per user,
without administrator rights or questions, with a desktop shortcut and (when Fusion is on the PC) the add-in, then
opens the program; [INSTALL.md](INSTALL.md) is the
user's guide. Runs go to
`%LOCALAPPDATA%\ExhaustTuner\runs`. See `docs/STATUS.md` for where each piece stands.

### Updates

Every push to `windows-app` that passes the Windows build's tests becomes a GitHub release, `v0.1.<run number>`,
carrying the installer and `SHA256SUMS.txt`; its notes list the commits since the previous release, and the newest 6
releases are kept (the `release` job in `windows.yml`). The installed program looks for a newer release a few seconds
after it starts and every 6 hours, downloads it in the background, checks its size and SHA-256, and shows
"Restart and update" in its menu (the button gets a dot). That runs the installer silently over the same folder with
the same choices (the Fusion add-in too, when it is installed); the installer waits for the program to close and opens
it again. A run in progress blocks the update until it ends. Builds on a PC are version 0.1.0, so they always see the
newest release.

After an update, the first start shows what changed (the release notes saved with the download), once.

The repository is public, so updates need no token. Each release also carries the installer as
`ExhaustTuner-Setup.exe` (no version in the name), which `releases/latest/download/ExhaustTuner-Setup.exe` always
fetches; the update check only takes the versioned name. If the repository is made private again, the program needs a
GitHub token that can read it, saved once under Updates in its menu: a fine-grained personal access token with Repository access limited to `exhaust-tuner` and Permissions,
Contents: Read-only. The menu's link opens GitHub's new-token form already filled in (name, owner, a year, Contents
read-only; GitHub's documented `settings/personal-access-tokens/new` parameters), so only the repository is picked
by hand. GitHub reports the token's expiry date with every reply (`GitHub-Authentication-Token-Expiration`); from two
weeks before it, the menu button gets a dot and the Updates section says when it stops working. It is
stored in `%LOCALAPPDATA%\ExhaustTuner\update-token.bin`, encrypted for the Windows user (DPAPI), never handed back
to the page, and sent only with requests to api.github.com, not with the redirects to GitHub's download storage.
Code: `rust/et_host/src/updater.rs`; tests: `rust/et_host/tests/updater.rs`, `web/tests/update_ui.js`, and the installer step in
`windows.yml` that updates the installed program the same way and checks that it opens again.

## Third-party software

OpenWAM (CMT-Motores Térmicos, Universitat Politècnica de València) and OpenFOAM (ESI-OpenCFD) are GPL-3.0 programs.
They are run as separate programs; their source is at https://github.com/CMT-UPV/OpenWAM and
https://develop.openfoam.com/Development/openfoam (the Windows build's patch and scripts are in `tools/openfoam/` and
ship next to it). Engine Simulator is MIT-licensed (Ange Yaghi).
`licenses/NOTICE.txt` is what the installer shows.
