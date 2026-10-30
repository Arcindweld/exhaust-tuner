# Exhaust Tuner

Exhaust and intake design software for real builds: sizing from published methods, 1-D gas-dynamic simulation
(OpenWAM), steady CFD (OpenFOAM), sound prediction checked against recordings, and a Fusion add-in that lays the
tubes out in the car's scanned bay.

Standing rules for every change: results must come from real computation, every number from a cited source or a
stated estimate, and limits are written down plainly next to the result they affect.

## What is here

| Folder | What it is |
|---|---|
| `web/` | The calculator (`index.html`, one self-contained page) and its browser tests. The page is also the Fusion add-in's panel (`make_palette.py` wraps it). |
| `fusion-addin/` | The Fusion add-in (`ExhaustTuner.py`, `cadtools.py`, `router.py`, `templates.py`): measure, keep-outs, clearance, auto-routing (single pipe, headers, equal or unequal length, parts in line), the 180-degree V8 template. `tests/` has the router tests (no Fusion needed). |
| `openwam/` | Writes OpenWAM 2.2 cases from the page's design (`make_wam.py` and its byte-identical JavaScript port `wam_export.js`), reads the results back. `node test_py_js.js` checks both writers agree. |
| `cfd/` | OpenFOAM v2412 case generator for intake tracts and exhaust parts (`intake_cfd.py`, JavaScript port `intake_cfd.js`), validation against Blair & Cahoon and handbook loss coefficients (`validation/`, `NOTES.md`). |
| `sound/` | Sound from simulation and from recordings: `wam_sound.py` (tailpipe monopole from OpenWAM outflow), `rpm_track.py` and `order_spectrum.py` (engine speed and order spectrum of a recording), `order_compare.py` (model vs recording). |
| `enginesim/` | Exporter for Engine Simulator files (the Arcindweld fork with the 1-D exhaust lives in its own repository, `Arcindweld/engine-sim`). |
| `validation/` | Measured vehicles: 2004 Subaru Outback 2.5i and 2026 Aprilia RS 660 (recordings, order spectra, model comparisons, research). |
| `layouts/` | Worked systems, e.g. the LS3 180-degree headers-back layout used to build the template. |
| `docs/` | Project status and open items (`STATUS.md`). |

## Running the checks

```
# page tests (Node 18+ and Playwright: npm i playwright && npx playwright install chromium)
web/tests/run_all_tests.sh

# OpenWAM writers agree (Python 3 + Node)
cd openwam && node test_py_js.js

# router (Python 3, no Fusion)
cd fusion-addin/tests && python3 test_header.py && python3 test_header_uel.py
cd layouts/ls3-180 && python3 test_template.py
```

## Coming next

A single Windows program (C#/.NET + WebView2) that hosts the calculator, runs OpenWAM, Engine Simulator and OpenFOAM
locally and reads their results back, installs the Fusion add-in, and ships as one installer built by GitHub Actions.
See `docs/STATUS.md`.

## Third-party software

OpenWAM (CMT-Motores Térmicos, Universitat Politècnica de València) and OpenFOAM (ESI-OpenCFD) are GPL-3.0 programs.
They are run as separate programs; their source is at https://github.com/CMT-UPV/OpenWAM and
https://develop.openfoam.com/Development/openfoam. Engine Simulator is MIT-licensed (Ange Yaghi).
