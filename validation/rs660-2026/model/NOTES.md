# 2026 Aprilia RS 660, stock exhaust: first OpenWAM model against the owner's recording

Model: `rs660.py` (every number is tagged in its docstring: sourced from `../stock_exhaust_research.md`, estimated, or a
calculator default). Nothing dimensional about the stock exhaust is published, so the pipe lengths and diameters, the
catalyst, the box volume and the outlets are all estimates until they are measured (research doc, section 6).

What is new in the tools for this bike:
- the OpenWAM writers (`openwam/make_wam.py`, `wam_export.js`, the page) take a muffler box with several exits:
  `{"outlets": [[segments], [segments]]}` as the last tail element after a plenum. Both writers give the same bytes
  (98/98 parity cases), and a one-outlet list writes exactly the plain chain.
- `sound/wam_sound.py synthesize_multi()`: several open ends heard at one microphone, each a compact monopole at its own
  distance and angle, summed coherently with the path difference (two coincident identical outlets give +6.02 dB on
  every order, as they must).

Runs (no load: each intake runner fed from a reservoir at the manifold pressure that makes NMEP = FMEP, calibrated per
speed from three short runs): idle 1442 rpm at 0.257 bar, the 5460 rpm hold at 0.305 bar. Both outlets carry the same
mean flow.

Run settings (2026-10-31, second pass): instantaneous rows written at 64 kHz and 48 (idle) / 72 (hold) cycles.
- Row rate: against rows at every solver step, 64 kHz rows give the same order levels within 0.42 dB up to order 12
  at the hold; 16 kHz rows (the first pass) were up to 2.5 dB off at orders 10-12 (the monopole uses d(mdot)/dt,
  which the coarse rows smear).
- Settling, judged by the silencer box's own state over the last 10 cycles (`box_settling` in runs_summary.json): at
  the hold its gas density changes by 0.02 % per cycle and its temperature by 1.2 K, and NMEP stays within
  1.590-1.595 bar over the last 6 cycles. At idle the box is still warming (6.7 K over the last 10 cycles, density
  -0.13 % per cycle) and NMEP scatters between 0.789 and 0.806 bar from cycle to cycle. The cylinders' own intake
  and exhaust masses agree within 0.3 % (idle) and 0.01 % (hold).
- Correction (2026-11-01): the first version of these notes judged settling by OpenWAM's mean flow at the tail
  against its mean flow in the intake runners (within 0.4 % after 72 cycles, 4 % short after 36), and called that
  the flow through the cylinders. That ratio is no mass balance. OpenWAM's boundary conditions do not conserve
  mass at closed valves and open ends: next to the closed intake valve the runner gas drifts into the valve at
  1.2 m/s (hold) and 3.6 m/s (idle) without ever reversing, so the runners' mean flows read 11 % above (hold) and
  3.7 times (idle) the cylinders' intake, and the outlets' open-end node reads 19 % below the middle of the same
  pipe (details in openwam/run_models.py). The cylinder quantities (NMEP, VE, trapped mass) are self-consistent.
- Cell size (the hold at 5 mm cells instead of 10 mm, both at the main settings, 72 cycles): orders 1-2.5 move by
  1.0-1.9 dB and orders 3.5, 4, 4.5 and 5.5 by 0.5-2.0 dB, but the dips move. Order 3, in a dip 8-14 dB below
  orders 2.5 and 3.5, drops another 14.5 dB; order 6.5, in a dip at 10 mm (81 dB against 92 and 88 dB beside it),
  rises 12.9 dB; orders 5, 6 and 7 move 3.4-4.6 dB. That is 5.8 dB RMS over orders 1-7, and the RMS against the
  recording goes from 7.8 to 8.8 dB. NMEP drops 4 % (1.593 to 1.527 bar), which would move the calibrated manifold
  pressure a little. So at 10 mm a single order is good to about 2 dB where it is not in or next to a dip. A check
  at 14 cycles, before the box settles, had shown less (3.5 dB RMS at the hold, 1.3 dB RMS at idle, where the 5 mm
  run was not yet periodic).
- Effect of the second pass on the comparison: under 0.6 dB RMS everywhere (table).

Against the recording (relative order levels, gain offset removed; orders below 60 Hz left out for the phone-class mic):

| point | recording segment | orders compared | RMS difference, first pass | second pass |
|---|---|---|---|---|
| idle 1442 rpm | idle_after (27.5-31 s) | 2.5-7 | 10.1 dB | 10.1 dB |
| idle 1442 rpm | idle_warm / idle_start | 2.5-7 | 10.6 dB | 10.7 / 10.6 dB |
| hold 5460 rpm | hold_5400 (24.2-26.4 s) | 1-7 | 8.0 dB | 7.8 dB |

Level change from idle to the 5460 rpm hold: model +13.7 dB (first pass +13.9), recording +12.0 dB (fixed gain).

Reading it: the overall level trend with speed is right within 2 dB, and at the hold orders 1, 4, 4.5 and 7 are
within 3 dB (second pass: -0.8, -1.2, -0.2 and -2.2 dB; order 6.5, within 3 dB in the first pass, is now 12.2 dB
low). Orders 1, 4 and 4.5 hold to about 1-2 dB with the cell size; order 7 moves 4.6 dB and order 6.5 13 dB (above),
so those two are not firm. The balance between the strongest orders, which the cell size moves by under 2 dB, is not
right: the recording's strongest order at 5460 rpm is 1.5 (136 Hz) with 2.5 close behind; the model's is 2 (182 Hz),
with 2.5 12 dB too low. Those orders sit where the estimated header lengths put the pipe resonances, so this is the
first thing the measured lengths will move. Above order 7
(640 Hz at the hold) the recording keeps 20-25 dB below its peak while the model falls away: engine mechanical, intake
and flow noise reach the microphone there and the model has none of them, so those orders are not compared.

How much the header lengths matter (5460 rpm hold, both headers' second sections changed together, everything else
the same; all rows at the main runs' settings, 64 kHz rows and 72 cycles: `python3 rs660.py sweep`, sweep.json):

| header length change | RMS vs recording (orders 1-7) | order 1 | 1.5 | 2 | 2.5 | 3 (dB rel) |
|---|---|---|---|---|---|---|
| recording | | -4.9 | 0.0 | -12.4 | -2.8 | -15.3 |
| -50 mm | 4.6 dB | 0.0 | -3.7 | -2.6 | -8.1 | -13.8 |
| as estimated (575 / 625 mm) | 7.8 dB | -6.3 | -4.9 | 0.0 | -15.4 | -24.6 |
| +50 mm | 9.2 dB | 0.0 | -0.5 | -5.3 | -15.8 | -24.0 |
| +100 mm | 6.3 dB | -1.2 | 0.0 | -3.1 | -7.9 | -22.2 |

All three length runs settled like the main hold (box density within 0.06 % per cycle and temperature within 3.1 K
over the last 10 cycles, periodicity 0.4-0.6 %). The RMS against the recording ranges from 4.6 to 9.2 dB over the
four lengths (halving the cells moves it 1.0 dB), and orders 1-2.5, which the cell size moves by under 2 dB, change
by up to 8 dB for a 50 mm step (order 2.5 from +50 to +100 mm). So the order balance cannot be judged until the
lengths are measured; picking the length that fits best would be fitting the model to the recording, not checking
it. (Order 3 moves 11 dB from -50 mm to the estimate, but it moves as much with the cell size.) The earlier
first-pass rows of this table (16 kHz rows, 36 cycles) gave 5.4, 6.2 and 6.9 dB RMS for -50, +50 and +100 mm; at
+50 mm order 3 was 10 dB higher (-13.9 dB), the dip again.

Next: the owner's measurements (research doc section 6, most of all the two header centreline lengths and the step
position, the box volume and the outlet tubes, and where the microphone was relative to each outlet).
