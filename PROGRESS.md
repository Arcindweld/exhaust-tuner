# PROGRESS (spec parity audit) -- delete in final commit
Done: waveB64 switch; specparity_lib.js; specparity_audit.js; specparity_ui.js draft; specparity_impact.js; jsOnly refusal; jsBackend defaults.
Running: full audit (presets + 220 fuzz) -> scratch runs/full.log (do NOT edit index.html until it ends)
Pending patch: tools/validation/wave/.fix1_pending.py (simKey+fuelSig D3, uel port:true D2, tsim chambers D4) -> apply, then delete file
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
