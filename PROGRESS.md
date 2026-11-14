# PROGRESS (agent18/ve) - part 8, VE decomposition
- done: tools/validation/wave/ve_decomp.js (VE = V p T R x fa at IVC; experiments amb, inTw, portInL/Tw, chk, fuel, exdp, fdp, back)
- results/ve_h_*.json: base, j1349, intw360, port370, chk, fuelair, fdp25, back10, tw500, premix, exdp30, exdp50, nowosch
- sources: J1349 99 kPa dry 25C (ddisoftware Chaney; bikeboy 990 mbar); intake port Nu: Rahman et al 2011 IJPS 6(16) Table 1
  (Depcik-Assanis 0.0694 Re^0.75, Shayler 0.135 Re^0.713, Bauer curved 0.140 Re^0.66); LS3 260cc runner (vpw GMP-12629063);
  LS7 1.8 rocker + shorty manifolds (corvetteactioncenter LS7 p15); 0.050 at tappet (performancetrends); AutoSpeed EF Falcon 8.7 psi
  ; FCH form + Oberg-Eriksson refit (fs.isy.liu.se SAE_06_POLE)
- done: intake port law JS+Rust+WASM (wavegas 13 pass, wave_wasm QUICK parity pass incl. 3 intake-port jobs); ratings.js amb=j1349 exdp= portIn= acckw=
- done: page input f-pin (cam_ui pass); ratings h_legacy == g_final bit for bit; h_port LS3 473/494; h_asrated (port+J1349) LS3 459/479 LS7 522/528 LT1 460/461
- next: LS3 sensitivities running; then q2.sh (ve_decomp h_base/h_final 3 engines, short/long runner, law07, final_all, turbo_portin); kat, constref, suite; docs part 8 (draft scratch h_static.md)
