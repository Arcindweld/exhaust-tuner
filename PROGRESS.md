# PROGRESS (agent17/egt, exhaust energy balance) -- delete in final commit
- [x] read docs/tools
- [x] energy_balance.js; BEFORE results/energy_before.json (LS3 c_final 3000/4600/5800, K24 NA plan 3500/5550/7100)
- [x] literature: Heywood Table 12.1 via MIT 2.61 lec18 slide 7 (Pb 25-28, cool 17-26, misc 3-10, ic 2-5, exh 34-45);
      port correlations Morgan 2003 Nottingham thesis Table 2.1 (Hires 0.258Re^.8, Malchow 0.0483Re^.783, Meisner 0.0774Re^.769,
      Caton-Heywood 0.35Re^.6); CSU Kirkpatrick page9 (Malchow, pulsing ~50% above steady); PROMETS split cyl/port 50.8/49.2 (Table 5.3b),
      port element 137-144 C (Table 5.4c); Sutherland air via COMSOL tables 5-2/5-3
- [x] JS port law (e.portHeat default caton; 'off' legacy) in web/index.html; kat 66/66 byte-identical; constref 112 identical
- [x] AFTER energy: port 2.1-2.4 % of fuel (was 0.8-0.9), port-exit T -30..-40 K; hires 7 %, malchow 1.9, meisner 2.5
- [ ] Rust twin + WASM rebuild + parity
- [ ] page: simSpec port flag (+bulge split), tsimPlan port?, method text
- [ ] tests: wavegas_ui new section (port law by hand, conservation, legacy), wave_wasm job
- [ ] revalidate: ratings (LS3/LS7/LT1 c_final), OpenWAM 2 configs (port T), turbo K24 (calib eff), sound orders, run time
- [ ] step 5: VE/trapped mass, friction (Sandoval-Heywood), SAE J1349 accessories; LS3 BSFC published
- [ ] docs part 7, STATUS.md entry, suite
