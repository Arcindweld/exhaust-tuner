# PROGRESS (spec parity audit) -- delete in final commit
Done: page switch window.__waveJs (waveB64), __sim.simPlan/simKey/waveRust, window.__b64.
Findings so far:
- F? Rust wave_step: max_extra/first_cycles/cycles 0 -> defaults (4/6/3); JS jsBackend 0 -> 0. Latent (page never passes 0).
- JS-only spec features (Rust ignores silently): opt.crossover, collector(s).pieces/parallel/branches, e.dead (sound path is JS-only worker).
- simKey(q) lacks fuel (Intake tab fuel/evap) -> stale 4-Stroke result not marked? verify
- e.camProfile, e.combEff: OpenWAM-only (not wave engine)
Harness: in-page TL.jsBackend vs TL.rustBackend with cyc 1/firstCyc 2/extra 1, dx 0.02 ~0.5s per speed
Scratch: $SCRATCH/diff2.js, rec.js
Next: harness specparity (cases), fuzz, save/load, units, presets; docs
