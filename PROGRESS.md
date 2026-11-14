# PROGRESS (agent23/boostpower) - delete in final commit
- [ ] 1 factor table + sources
- [ ] 2 three-way table (Garrett text, fuel-sourced, wave sim x3 boosts) + reported builds
- [ ] 3 defaults (fuel-driven AFR x BSFC, Garrett's figures selectable), range on 3 methods
- [ ] 4 preset trap
- [ ] 5 glance card power row
- [ ] 6 tests boostpower_ui.js, pins
- [ ] 7 docs
Notes:
- Sim (page, K24+5862 0.63 T3 journey, My boost, psi typed): 15 psi 429.6 hp@6050 air 39.68 lb/min veC 1.153; 22 psi 532.9@7100 air 50.93 veC 1.046;
  29.52 psi 641.9@7100 air 60.25 veC 1.05; bsfc 0.46-0.48 at AFR 12. Script: scratchpad sim3.js (args psi list). ~25 s/run.
- Page Garrett now: VE 0.90 (i-ve base), AFR 12, BSFC .55, rpm 6800 (preset hpRpm), Tm route 154.7F, ci 143.65 -> 29.58 psi (no turbo picked) / 29.52 journey
- Garrett TT103 quotes: BSFC "0.50 to 0.60 and higher"; "Race fuels and aggressive tuning are required to reach the low end"; VE "95%-99% for modern 4-valve heads", "88% - 95% for 2-valve"; Tm 100-130 IC; HP = flywheel
- Plan: i-opfig (src default / typed=legacy), i-fuel (pump 12x.55, race 12x.50, e85 8.0x.75), i-opve (blank: Garrett 97%/91.5%), i-hpat crank/wheel + i-dtl 12.5 (Motor1 FWD 10-15)
  preset trap: HP_FROM_PRESET flag -> fallback 'boost' mode with inline target field; glance power row 3-way + run button
- Reported: IPG 475whp K24/GT35R ~18psi 93; DSport 570whp K24A2 Comp6767 18psi E85 Dynapack shift 8000; DSport 711whp K24A1 PTE6776 32psi C16 Dynojet;
  Full-Race K20 FAQ GT3076R 400-420whp 11-12psi pump (maker expectation); Garrett Miata 1.6 GTX2867R 241@16psi pump 7000, 401@30psi E85 7500 Mustang
