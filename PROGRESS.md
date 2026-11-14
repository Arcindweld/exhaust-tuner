# PROGRESS (agent18/ve) - part 8, VE decomposition
- done: tools/validation/wave/ve_decomp.js (VE = V p T R x fa at IVC; experiments amb, inTw, portInL/Tw, chk, fuel, exdp, fdp, back)
- results/ve_h_*.json: base, j1349, intw360, port370, chk, fuelair, fdp25, back10, tw500, premix, exdp30, exdp50, nowosch
- sources: J1349 99 kPa dry 25C (ddisoftware Chaney; bikeboy 990 mbar); intake port Nu: Rahman et al 2011 IJPS 6(16) Table 1
  (Depcik-Assanis 0.0694 Re^0.75, Shayler 0.135 Re^0.713, Bauer curved 0.140 Re^0.66); LS3 260cc runner (vpw GMP-12629063);
  LS7 1.8 rocker + shorty manifolds (corvetteactioncenter LS7 p15); 0.050 at tappet (performancetrends); AutoSpeed EF Falcon 8.7 psi
  ; FCH form + Oberg-Eriksson refit (fs.isy.liu.se SAE_06_POLE)
- next: intake port law JS (wsFactory) + Rust + WASM; ratings.js amb/exdp/portIn; tests; docs part 8
