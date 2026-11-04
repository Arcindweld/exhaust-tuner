# Patches to OpenWAM

Applied, in name order, to CMT-UPV's OpenWAM at the commit pinned in `.github/workflows/windows.yml`
(`OPENWAM_COMMIT`) before it is built, by CI and for a local build (`git -C ext/OpenWAM apply ../../openwam/patches/*.patch`).
Each leaves every existing input file behaving as before.

| Patch | What |
|---|---|
| `0001-reed-lift-stop.patch` | TLamina (reed valve) model 2: the 1-D mass-spring-damper of model 1, read with one more number, the lift stop in metres. At the stop the lift is held with no rebound (inelastic contact, as OpenWAM already treats its own 1e5 m cap) until the net force takes the petal off again. The 1e5 m cap of models 1 and 3 is now the member `FLevMax`, unchanged for them. Written by `make_wam2t.py` / `wam2t_export.js` as `intake.reed.model = "1d_stop"`. |

Check (Maico 490 example, 30 cycles, 8 mm cells): model 2 with a 15 mm stop gives exactly model 1's numbers on the
same CD table (the free petal never reaches 15 mm), so the patch changes nothing until the stop is reached; a 4 mm
stop changes delivery ratio and power at 6500 and 8000 rpm, a 2 mm stop more.
