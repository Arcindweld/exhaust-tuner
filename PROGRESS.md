# PROGRESS (spec parity audit) -- delete in final commit
Done: waveB64 switch; specparity_lib.js; specparity_audit.js; specparity_ui.js draft; specparity_impact.js; jsOnly refusal; jsBackend defaults.
Done full audit: 251 cases 498 specs 0 diffs. Impact done (results/specparity_impact.json).
D2 D3 D4 applied; D5 refreshTabResults (projApply, applyVehicle) found by save/load test (Headers + boosted plan stale)
Findings:
- D1 check-lift (fixed f5ce4c3; since 4938758 2026-11-03): quantify with specparity_impact.js checklift
- D2 uelLayoutSpec port seg lacks port:true (since e444050 2026-11-13) -> Headers layout + sound ran without port law
- D3 simKey lacks fuel -> stale run shown current
- D4 tsimPlan drops 4-Stroke chambers in fallback manifold (centri / turbo w/o manifold)
- D5 latent: wave_step 0 -> default vs jsBackend 0 (fixed in JS)
- D6 JS-only parts silently dropped by Rust (latent; now refused)
- Node vs Chromium Math differ (validation numbers in Node differ ~1e-9 from browser): direct compare done in-page
- preset rule: kept fields (cam card etc.), see PRESET_KEEPS
Next: apply patch, run specparity_ui, impact, docs, STATUS, WAVE_VALIDATION note, full suite
Next: docs fill, STATUS, WAVE_VALIDATION note, full suite
