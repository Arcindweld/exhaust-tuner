# PROGRESS (agent41/progress) — progress bars
Task: shared progress component + wire all long ops; tests web/tests/progress_ui.js; doc docs/PROGRESS_BARS_2026-11-21.md.
## Status
- [ ] inventory
- [ ] component (progHtml/progSet) + CSS
- [ ] wire call sites
- [ ] timing before/after (4-Stroke default wave sim, median of 3)
- [ ] tests + suite
- [ ] doc, screenshots reviewed
## Notes
- existing: .runstat + runPct (thin ::after bar parsed from "(n%)"/"n of m"), runClock elapsed+live region, hostStatAll for host runs, resvHtml reserved space, data-runcancel for sim/tsim/wsnd.
- [x] component + CSS + wiring (sim, tsim, wsnd, rec, hostRun kinds wam/tw/mdw/dyno/opt/es/cfd/autocfd/exh/fxcfd, fusionCall/hostCall waits, updater)
- [x] progress_ui.js ALL PASS (~1-2 min)
- next: run ui_ui, incremental_ui, staleness_ui, sim_ui, wsnd_ui, rec_ui, desktop_ui, multi_ui; timing; startup check; doc
- [x] all verification done; suite 141 pass / 0 fail / 7 expected skips; doc finished
