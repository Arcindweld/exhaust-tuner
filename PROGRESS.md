# PROGRESS (agent7/intake) - delete in final commit
- [ ] read docs/tools
- [ ] 1 Cd(L/D)
- [ ] 2 intake system (plenum/throttle/filter)
- [ ] 3 OpenWAM experiments
- [ ] 4 revalidate ratings
- [ ] 5 tests
- [ ] 6 page + docs
## Findings so far (11:00)
- valve area law: nv*cd*min(pi d L, 0.85 pi/4 d^2) (curtain, capped 0.85 seat); OpenWAM writer writes the same table (cd_clip 1 vs pipe area)
- LS3 bench: Hot Rod Feb 2011 Holdener, stock 0821 casting, "CFM AT 28 INCHES" 0.05..0.7 in, int 34 67 147 211 259 297 312 312 314, exh 24 59 116 157 188 207 216 219 223 (lifts .05 .1 .2 .3 .4 .5 .6 .65 .7). URL nebula.wsimg.com/b443dbc4abe481862a65b4c1f1b178ab?AccessKeyId=0BDEF12C755C415CB626&disposition=0&alloworigin=1
- LT1 bench: EngineLabs ?p=249650 (WCCH, R. Reyman), 28 inH2O, 4.065 bore; lifts .1..: int 64 134 207 258 295 304 290 295 (.1 .2 .3 .4 .5 .55 .6 .7), exh 45 120 151 184 210 214 223 228
- LS7: no stock bench with pressure+exhaust found (forum RFD: int .1 68, .3 217.4, .5 337.3, .7 331.9, .8 345.9, "@28"")
- throttle: Mamo Motorsports (vendor) corvetteforum 4018317, stock LT1/LT4 TB WOT 916 cfm @20 inH2O radius plate -> CdA/A(87mm)=0.828
- Heywood 7.21 throttle area via Carlsson 2007 LiU thesis (therangerstation pdf): WOT limit = bore - shaft strip
- Intake tab: no filter loss model ("not modelled, no published loss curve") -> input
- page already has f-intk/f-plv/f-tbd/f-itl/f-itd for OpenWAM; simSpec intake.plenum {V_m3, inlet segs + 50mm tb step}
