# PROGRESS (agent20/uc: turbine efficiency U/C0, pulse, bearing, housing heat, compressor off-island)
- [x] read docs/code; sources: SP-290 eq 2-88 parabola (ch2 p49-52; ch10 p302 radial similar, slightly faster fall);
      Luddecke et al IJRM 2012 abstract (radial peak 0.7); Morrison et al ITS 2016 core.ac.uk/download/74406752.pdf (0.7);
      OpenWAM TTurbinaSimple.cpp Watson polynomial per step; Pakle 2018 (PR 2.5 at 427 m/s, CFD 87%);
      Deligant/Podevin/Clenci Pitesti 2010 (mech eff 0.8-0.9 usual, 0.5 at low speed); MotoIQ bearings (thrust >1000 W)
- [x] engine: exhaust.turbine.bsr {U,xo,form} JS+Rust, bsrE output appended; WASM rebuilt; wave_wasm QUICK pass (2 jobs added)
- [ ] closure: U from compressor (mu, Dc2, Dt); options C (friction), E (comp eff), D (volute)
- [ ] experiments script tools/validation/wave/turbine_eff.js
- [ ] page text, guidance, tests turbineeff_ui.js, docs
