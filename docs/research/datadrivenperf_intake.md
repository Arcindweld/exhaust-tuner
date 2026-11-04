# Data Driven Performance (datadrivenperf.com) intakes, researched 2026-11-03 for design input

What they sell: one cold-air intake, the DDP Velocity Intake System for the 2009-15 Cadillac CTS-V (supercharged
LSA), $650-675. No intake manifolds, runners or plenums. A dealer also lists a "Velocity Race 120mm" kit.

Published geometry (the only design data): 6 in (152 mm) cone filter (Green Filter USA), "smoothly transitioning to
4.5 inches at the MAF" (114 mm), "port matched to a 103mm or 112mm throttle body". Heat shield around the filter.
No tube material, length, bend radii, transition angle or bellmouth shape.

Area check (ours): MAF section 102.6 cm2; 112 mm TB 98.5 cm2 (4 % smaller), 103 mm TB 83.3 cm2 (19 % smaller,
diameter ratio 0.90). So a duct that narrows steadily toward the throttle with no step at the joint: the same
default the Intake tab uses (a contraction tolerates steeper angles than the ~8 deg diffuser rule, which is untested
here).

Test data: none. No dyno, flow (CFM at a test pressure), IAT or CFD results; "extensive in house testing" and
"highest performing intake on the market" are claims only. No independent dyno threads or videos found.

Use: none as a calibration source. One build reference for an LSA NA-tube default (152 / 114 / port-matched TB).

Sources: https://datadrivenperf.com, https://datadrivenperf.com/product/ddp-velocity-intake-system-for-09-15-gen2-cadillac-cts-v/,
https://datadrivenperf.com/product-category/intakes/, https://montmotorsports.com/ddp-velocity-cold-air-intake-kit-09-15-cts-v

## The dyno sheet (sent by the owner, 2026-11-03)
Dedicated Motorsports, Mainline DynoLog chassis dyno, 8 Aug 2019, SAE J607 correction. Car: FED LS9 heads, "SheGone"
cam, Stainless Works 2 in primaries / 3 in. Axle speed 800-1800 = engine 3000-6760 RPM (x 3.755).
- DDP Intake Ver 1 (test 2107.2, 11:48, air density 91.6 %): 823.3 hp at 1750 axle (about 6570 RPM); torque 742 ft-lb
  at 1300 axle; average 717 ft-lb over 875-1625 axle.
- 4.5 Inch Intake Ver 1 (test 2106.1, 11:45, 91.9 %): 800.6 hp at 1725 axle; 727 ft-lb at 1200; average 708.
- Difference: +22.7 hp at the peak (+2.8 %), +9 ft-lb average (+1.3 %). The curves lie together to about 1400 axle
  (5300 RPM); the gain is at the top, where the airflow is highest, as an inlet pressure-loss gain would be.
- One pull each, 3 minutes apart: chassis-dyno repeatability is of the same order (1-2 %). The DDP pull was second
  (hotter), which usually costs power. Air density differs by 0.3 %, inside the correction.
Reading for our model: on a blown engine at ~800 whp a 2.8 % gain is a ~2-3 kPa smaller loss ahead of the blower, about
one velocity head of a 4.5 in tube at ~60 m/s; the converging duct into a port-matched throttle body is the plausible
cause. A reference case for the intake CFD's pressure-drop comparison, not a calibration.

## turbohoses.com velocity stacks (AirRam), researched 2026-11-03
T6-6061 aluminium bellmouths from 3 / 3.5 / 4 in OD to a 6 in OD mouth, with silicone couplers. No profile, radius,
length or flow data; "5-7 HP gain", "250 rpm less spool" are claims. Nothing to use as design input.
Source: https://www.turbohoses.com/velocity_stack.htm
