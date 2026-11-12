# PROGRESS (agent5/gamma) - variable gas properties in the wave model
Started 2026-11-12. Delete in the final commit.

Plan
1. Gas model inside wsFactory (GRI-Mech 3.0 NASA-7 species, verified vs Cantera gri30.yaml + NIST-JANAF):
   fresh = dry air (N2/O2/Ar), burned = CH1.87 products at the engine's AFR (lean: O2; rich: CO/H2 by water-gas K).
   Per cell / per cylinder: x (fresh fraction, already carried) -> R(x), cp(T,x), h_s(T,x) (datum 298.15 K), e = h_s - R T;
   T from e by Newton. Frozen local gamma for sound speed, characteristics at ends/junctions/valves.
   e.gas==='const' -> today's code path (gamma 1.35, R 287), bit-for-bit; pipes built by makePipe without gas -> const.
2. JS first, then Rust mirror, rebuild WASM, wave_wasm parity.
3. Tests: property KATs, adiabatic compression KAT, const-mode reference fixture, conservation.
4. OpenWAM compare (base tag before/after), docs addendum, STATUS, page text.

Status
- [x] sources fetched/verified (TM-4513 via Caltech nasa7.dat + Cantera nasa_gas.yaml; JANAF tables; MIT 2.61 lec4 K 3.5-3.7)
- [x] JS gas model + const mode bit-identical (constref.js PASS, kat.json identical)
- [x] found+fixed: supersonic sub-ambient open end ran away (9000 rpm warm start, variable gas); const fixtures unaffected
- [x] engine.js balances; species table = GRI-Mech 3.0 shared with sosExh (sosExh bit-identical; TM-4513 considered, see notes)
- [x] Rust + WASM rebuilt, wave_wasm parity incl. const-mode vs fixture PASS
- [x] web/tests/wavegas_ui.js (property KATs vs JANAF, closed-cylinder isentrope, supersonic exit, balances, const ref) PASS
- [x] FOUND: compare.py aligned OpenWAM traces to the wrong TDC in 22/48 runs (port corr artefact) -> fixed TDC detection
- [ ] OpenWAM rerun: base, const, nofric, nofricconst (background), then gas_report.py, work_split.py
- [ ] page method text, docs addendum, STATUS, full test suite, pinned values
Notes: TM-4513 better for N2 below 1000 K (0.05% vs 0.26%) but would move sosExh by up to 0.03% (physaudit, turbosize pins); kept GRI for one consistent table
