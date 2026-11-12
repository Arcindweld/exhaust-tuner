# PROGRESS (agent9/cyl) - delete in final commit
Task: closed-cycle work wave vs OpenWAM (addendum part 4, D sections).
- [ ] 1 instrument both codes (make_wam cyl_ins_extra; cyl_trace.js extra columns), single_L800 3 speeds
- [ ] 2 closed_cycle.py independent arbiter
- [ ] 3 fix model defects if any (JS+Rust parity)
- [ ] 4 revalidate
- [ ] 5 runner length search
- [ ] 6 docs
Notes:
- OpenWAM Woschni (TCilindro4T.cpp:553-587): 1.2e-2 p(Pa)^.8 T^-.53 B^-.2; C2=0.001 (comment: was 3.24e-3) only during burn; pm exponent 1.36; liner area 4(Vavg-Vc)/B (no clearance strip).
- OpenWAM simple species: cv burnt polynomial (Globales.h:1609), R burnt 285.4, air 287, gasoline 72.42.
- wave cylinder: explicit p dV (p at step start), dth<=0.5 deg.
