# 2.0 L four at 6,000 RPM: the OpenWAM run behind the page's Method note

`i4_41_6000.wam` was written by the Python generator (make_wam.py) for a 2.0 L four-cylinder with a 4-1 header and run
to completion in OpenWAM 2.2 (Linux build, 30 cycles, no warnings). `i4_41_6000AVG.DAT` is OpenWAM's own output and
`summary.json` the generator's summary of the last cycle. The page's Method text quotes this run: 195 N·m net
(Net_Torque 195.201 N·m) and 107 % delivered VE (intake mass against air at 1.01325 bar and 25 °C in the swept volume:
1.0689). web/tests/wam_ui.js loads the AVG.DAT through the page's reader and checks both figures against this file.
The INS.DAT and run log are not kept (373 kB and 250 kB; rerun the .wam to get them).
