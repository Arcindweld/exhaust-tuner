# PROGRESS (agent15/waveturbo) - delete in final commit
Plan (decided after reading):
- intake.source {p,T}: mouths openEnd at (p,T), fill at p,T; default absent = bit-identical
- exhaust.pOut: tail open ends at pOut (NA comparison variant)
- spec.turbine {CdA, wgCdA, wgTo 'down'|'atm', eta, pOut, down{segs,Tw}}: every open tail end becomes a turbine entry
  (Benson partially-open-end: characteristic + compressible orifice from face stagnation to downpipe cell p), work =
  eta*m_t*(h0 - h(T_is)) exact thermally-perfect isentrope (pow/exp only, Rust imports no log); downpipe fedEnd;
  pre-filled like a junction before stepPipe. Accumulators per cycle + 720 bins (p3 per entry, tail mdot).
- Rust: Bnd::OpenAt, turbine, wave_turbo_set / wave_turbo_out exports
- closure driver in page JS (backend-agnostic): A_t at full-boost rpm gate shut, then A_wg per rpm
- OpenWAM cross-check: SKIP (turbine needs a turbo shaft + compressor or speed + Watson/polynomial eta; no constant eta)
Sources found: SAE 2017-24-0019 accepted (Imperial spiral) restriction analogy, W&J/Benson constant Aeff;
 Frontiers Mech Eng 2021 Galindo/Serrano double-entry = two parallel equivalent nozzles; NASA BGP mflchk; core.ac.uk
 288501307 (Galindo ECM 85 2014) rotor quasi-steady; OpenWAM TTurbinaSimple.cpp
Status:
- [x] read docs/code
- [x] JS model (turbine, source, pOut)
- [x] Rust port, bit parity on 4 scratch turbo jobs (scratchpad par.js)
- [x] NA checks: kat 66 identical json, wave_wasm QUICK all pass, wavegas 121 pass, wavekat pass
- [x] closure driver turboSimLib in page (JS==Rust, scratch t2.js)
- [x] waveturbo_ui (16 pass), wave_wasm turbo jobs pass, wasm embedded (rebuilt after tail-bin change!), turbosim_ui 21 pass, K24 page run captured results/turbo_k24_page.json
- [x] turbo_k24.js, docs part 5, STATUS
- [ ] full suite (web,fusion,parity --no-build -j 2; rust et_wave only: host build needs 1.2 GB disk), delete PROGRESS
