# PROGRESS (knock estimate task, delete in final commit)
- [x] engine trace JS+Rust (opts.trace / wave_trace), WASM rebuilt, kat identical, wave_wasm QUICK all pass + trace parity
- [ ] knockLib JS (DE tau, isentropic Tu, LW integral to MFB90, retard search, boost scaling)
- [ ] validation scripts tools/validation/wave/knock_*.{js,py}
- [ ] page: tsimRun knock, summary line, glance Power row, advanced inputs
- [ ] tests web/tests/knock_ui.js; docs part 12 (L), BOOST_AUDIT, STATUS
Sources: Fluent theory 12.2 (DE 0.01768 s), Kumar&Antony Sadhana 2008, McKenzie&Cheng SAE 2016-01-0699 (isentropic end gas from IVC),
Kasseris thesis abstract (ONeff 97 gas..115 E85; evap 5..18), SAE 2012-01-1284 abstract (LW + DE, ON fitted), SAE 902134 abstract (10% unburned at knock),
Wang et al Fuel 2017 (K neg), Vuilleumier&Sjoberg SAE 2017-01-2234 (K -0.6..-0.9 turbo DISI), ORNL/TM-2016/42 (93 AKI/97 RON, ethanol 109),
Sunoco E85-R (99 AKI, RON 104, MON 94), Sunoco EVO 10 (RON 110 MON 100), StreetMuscle Octane Game (1 ON per 25 F inlet), NREL Chupka 2015 (ethanol RON~110 MON 90).
