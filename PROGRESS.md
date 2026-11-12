# PROGRESS (agent6/heat) — delete in the final commit

Task: replace the tuned eta 0.72 by chemistry heat release (formation enthalpies), check Woschni, add cited fmep and
brake torque, validate against real engine ratings (LS3, LS7, LT1), fuel-vapour experiment, docs.

## State
- [ ] sources verified by fetch (Heywood LHV/CH1.87, comb. eff., fmep eq., Woschni, fuel vapour cp, GRI a6, JANAF dHf)
- [ ] BEFORE real-engine table (current code)
- [ ] JS heat release from formation enthalpies (gas mode only; const mode bit-identical)
- [ ] Rust twin + WASM rebuild + parity
- [ ] friction + brake display
- [ ] fuel vapour experiment
- [ ] AFTER table, sensitivity
- [ ] tests extended, full suite
- [ ] docs (addendum part 2, STATUS, method text)

## Notes
