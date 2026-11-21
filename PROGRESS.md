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
