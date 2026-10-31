EXHAUST TUNER (Fusion add-in), version 4.11.0

4.11.0 (October 31, 2026)
- New: "Export the STL from Fusion" in the Headers tab's exhaust component CFD section. Model
  the gas space inside the part as one solid body with every opening capped by a flat face,
  select the caps in the order the page lists (inlet1, inlet2 ... then outlet) with
  Ctrl+click, press the button and save the file next to design.json. Every face of that
  body is written from Fusion's own triangulation (0.05 mm surface tolerance), the caps
  under their names and all other faces as wall, as one ASCII STL in millimetres - the form
  the case generator (intake_cfd.py) reads. The Windows program takes the same file
  ("STL of the part, to run on this PC"). Earlier page text said the add-in already did
  this; it did not until now.

4.10.0 (October 30, 2026)
- New: "Lay out 180-degree headers (V8 template)" on the Headers tab (route mode 'bundle180',
  templates.py). Select the eight port markers in cylinder order (1 to 8), then the two
  collector markers (either order). The template is the LS3 plan built by hand on October
  30: each collector takes the cylinders that fire 180 degrees apart (alternate cylinders in
  the firing order), the front and rear tube of each bank stay on their side, the two middle
  tubes cross under the bellhousing on two levels, and every tube is trimmed to one length
  (the longest minimum, or the target you enter). Checked numerically against the keep-outs
  and tube to tube; bends overlapping, gaps under your rule and near pairs are reported.
  Tubes into one collector close to touching over the jog into the slots (tack them). The
  bay frame comes from the markers (front = cylinders 1-2 side, up = the model's up axis),
  so the engine can sit anywhere in the model. The template fits a 90-degree cross-plane V8
  in a front-engine bay; other orders raise a clear error.
- Unequal-length headers: the header route accepts targets_mm, one centreline length per
  port marker in selection order (router.route_header spec['targets']); each primary is
  routed to its own length and the result lists the lengths and the largest miss.
- saveFiles now writes sub-folders (a CFD case: name/system/controlDict) and the exec bit
  for Allrun/Allclean, so the page's "Save in Fusion" works for OpenFOAM cases.

4.9.1 (October 30, 2026)
- Fix: building a route inside a new component failed in the current Fusion build
  (Path.create wanted the curve in its occurrence context: "InternalValidationError
  getObjectPath", after which TemporaryBRepManager also failed until the command ended).
  The sketch path and the wire fallback now use the occurrence proxy.
- Fix: a CAD-library model imported for a fitting came back named "BodyN" (the name set
  while the base feature was open did not stick); it is named after finishEdit now.
- When the real CAD model is imported, the round footprint outline is hidden (turn it on in
  the browser to see the clearance it was checked with) and the MAF note keeps the import note.
- Router: route_header() can share one tube set between headers (spec['tubes'],
  spec['owner_base']) and take a routing order (spec['order']), for 180-degree pairs.

INSTALL
1. Unzip so you have a folder named ExhaustTuner holding ExhaustTuner.py, cadtools.py,
   router.py, palette.html and ExhaustTuner.manifest. Keep the five files together.
2. In Fusion: Utilities > Add-Ins (or Shift+S), Add-Ins tab, green plus next to "My Add-Ins",
   then pick the ExhaustTuner folder.
3. Select Exhaust Tuner and click Run. Tick "Run on Startup" to keep it loaded.
Updating from an older version: stop the add-in, replace the whole folder, run it again.

TWO COMMANDS, both in the Solid tab > Create panel

1. Exhaust Tuner Panel
   Opens the full calculator docked on the right. It is the same page as the web version,
   with the same tabs (Quick, 4-Stroke, 2-Stroke, Sound, Headers, Crossover, Mufflers,
   Cats, Boom tubes, Options) and the Simple / Expert switch.
   - Quick: pick a preset or describe the engine, say how loud, what tone, where you want
     the power and where it's used, and it lays out the whole system (primaries,
     collectors, pipe size, crossover, muffler type and parts, drone lengths and a
     resonator). "Fill in every tab with this build" copies it to the detailed tabs.
   - Start from a stock vehicle, or from an engine on its own: the vehicle presets (classic and
     modern muscle, JDM, Euro, sport bikes, motocross, a 2-stroke triple, the Honda CBX) fill in the
     engine, firing order and RPMs on every tab, and the engine-only mode lists every one of those
     engines by maker for swaps and crate motors. Each preset links its source.
   - Engines: cars and trucks (inline 3 to 6, V6, flat 4 and 6, every common V8 order,
     flat-plane V8, V10, V12), motorcycles (singles, twins, triples, fours, crossplane,
     V4s, the CBX six), two-strokes and rotaries. Any firing order can be edited.
   - Sound handles pipes made of sections of different sizes and shapes (round, oval,
     flat oval), pipes that split one into two (set each section's Part to Main, Branch A
     or Branch B), gas that cools along the pipe, hangers and flex pipes. It checks for
     drone at cruise and boom at idle (the tailpipe-to-muffler resonance), and works out
     how far the pipe grows when hot, with slip-joint clearances.
   - 4-Stroke also sizes a resonance chamber on the header (sealed can on bleed holes,
     a shell around the pipe, or an inline bulge, as on KTM, Kawasaki and FMF headers),
     and runs a wave simulation: a gas-dynamics model that compares the header with
     primaries 10% shorter and longer, and with and without the chamber, across the RPM
     range. With a collector it models every cylinder on it, firing evenly or at the gaps
     you enter (a stock V8 preset fills in the cross-plane bank's 270, 180, 90, 180), and
     reports how evenly they fill. The designs run side by side; a 4-into-1 takes about
     half a minute. Use it to compare designs; it is not checked against a dyno.
   - Intake sizes a cold air intake, short ram, airbox or individual throttles: airflow, tube
     size, duct loss, the power cost of warm air (SAE J1349), filter size by K&N's rules for
     cone, cylinder, oval and panel filters, bellmouth shape, tuned lengths, MAF sensor
     placement, boosted setups (turbo, centrifugal, Roots or screw) with charge pipe sizing
     and intercooler temperatures, and induction noise.
   - The vehicle picker can be narrowed by maker, and the engine lists are grouped by maker.
   - Mufflers designs Helmholtz resonators and J-pipes and lists parts that fit,
     including 51 mm motorcycle silencers.
   - 2-Stroke builds Jennings' one-cone chamber or Blair's two-stage chamber, and checks
     one against the other.
   - Cats works out back pressure, power cost and sound for catalytic converters, with a
     dyno test of back pressure for comparison.
   - Boom tubes sizes NASCAR-style flattened and flared tubes.
   - Options lists every common change and what it does to tone, loudness and power.
   - Parts lists mufflers, resonators, flex pipes, bends, merge collectors, air filters,
     couplers (silicone, V-band style and Wiggins) and velocity stacks by brand and model,
     each with the maker's page. Add parts to a build list in flow order, or add your own
     part from a scan or drawing; the auto-router places them along the pipe.
   - Intake also designs the velocity stack or bellmouth (Blair and Cahoon's elliptical
     shape, Vizard's ram pipe chart), places the stack and filter, keeps the MAF's straight
     runs, and works out Helmholtz tuning by Engelman's ASME paper (runner peak, and the two
     peaks a plenum and its feed tube give).
   - 4-Stroke takes the port exit shape (round, oval, racetrack, rectangle with corner
     radius, or an odd shape's equivalent diameter) and the full cam card for the wave
     simulation, and downloads an Engine Simulator engine file for a rough listen (a
     preview only: Engine Simulator cannot judge a header).
   Inside Fusion each tab also gets a Fusion section near the bottom:

   Measure selection   Select one curve of each route first (a sketch path or edges), or
                       circular edges, tube faces or tube bodies. It reports:
                       - centerline length of each route and its bend radii
                       - a bend schedule for the bender: straight, rotation, bend angle, CLR
                       - an equal-length check when you select several routes
                       - tube OD and ID, bend radii and an estimated length for tube bodies
                       The "Use" buttons copy a measured value into the calculator
                       (runner space, primary ID, span length, tube OD).
   Build runner along selected path
                       Builds a hollow tube along each selected route using the primary
                       ID and wall from the Headers tab, and compares the route length
                       with the runner length the page asks for.
   Build ... straight  Builds the page's profile as hollow revolved bodies along X.
   Set keep-outs from selection
                       Remembers the bodies the exhaust has to clear (frame, floor,
                       oil pan, steering shaft, starter...).
   Check clearance of selection
                       Minimum distance from each selected tube to each keep-out, flagged
                       when it is under the minimum clearance you enter.
   Draw centerlines    Crossover tab: draws the crossover centerlines in a new component.
   Auto-route ...      Headers, Intake, Mufflers and Parts tabs. Set keep-outs first: your
                       raw scan (mesh body) and any solids are the space limit. Draw a short
                       sketch line at each end, at the pipe center, pointing the way the gas
                       flows (for headers one per port, then the collector line last), select
                       them in that order and press the button. It finds a way through, keeps
                       your gap from the scan and between tubes, uses your bend radius and
                       straights, hits the target length (header primaries come out equal),
                       checks the result against the scan's triangles, and builds each tube as
                       a sketch plus a pipe feature sized by user parameters, so it stays
                       editable. Parts from the Parts tab are placed and turned for the most
                       room, with filters and stacks at the start and couplers at the end.
                       Weld-on fittings (blow-off valves, sensor bungs, MAF pads) are stood
                       on straight runs and clocked round the tube for clearance: valves
                       near the throttle, a MAF pad in the middle of the longest straight
                       with the maker's straight leads and at least 8 in from the throttle.
                       It reports bends, the tightest radius and the number of pieces, and
                       flags bends tighter than one tube diameter or too much bending, with
                       the way to build them (mandrel sections, pie cuts, or a short
                       metal-printed section).
   CAD library         Parts on the Parts tab marked "CAD model" have a STEP file in the shop's CAD
                       library folder (C:\Users\<you>\Desktop\claude training books\cad files, or the
                       folders listed one per line in a cad_library.txt next to this add-in). When the
                       router places such a fitting it imports the real part and stands it at the same
                       spot (model Y out of the tube, X along it) beside the stand-in. Add a STEP whose
                       file name contains the part's key (for the Nissan pad: 22680-7S000). SolidWorks
                       .SLDPRT files cannot be imported by the Fusion API; save them as STEP.
   Part Design files   Fusion's newer "Part" documents hold one component only; there the add-in builds
                       into the root component (named bodies and sketches) instead of a new component.
   OpenWAM case        4-Stroke tab, "Run it in OpenWAM", Download: in Fusion a folder dialog opens and the
                       .wam files, run_all.bat and README are written there.
   Build this boom tube
                       Boom tubes tab: lofts the inside shape (round inlet, flat run,
                       flare) through the page's sections along X in a new component,
                       then shells it outward by the sheet thickness with both ends open.
                       Width runs along Y and height along Z (Z and Y in a Y-up setup).

2. Exhaust Tuner
   The native dialog from version 2: 4-stroke header + megaphone, 2-stroke chamber,
   header layout and crossover, with values saved as user parameters.

WORKING TO REAL PARTS
- Model each route as a 3D sketch of lines with fillets at your bender's centerline radius.
  The bend schedule then matches the tube bender, and the length is exact.
- For a scanned exhaust (mesh), sketch a centerline through the scan and measure the sketch.
- On the Headers tab, fill in "Space you have" (or use a measured route). If the ideal
  runner does not fit, it tells you what RPM the runner that fits is tuned for, and what to
  change to get closer.
- Fusion does not update these numbers when you edit the model. Measure again after changes.

FIRST-RUN CHECKLIST (please try these on a throwaway design)
1. Open Exhaust Tuner Panel. The panel should dock on the right and say "Connected to Fusion".
2. Make a 3D sketch: a line, a fillet, another line, a second fillet in a different plane,
   a last line. Select one line and press Measure selection. Compare the length with
   Inspect > Measure, and the bend angles with your sketch.
3. With that line still selected, press Build runner along selected path (Headers tab).
   Check the tube's OD and wall with Inspect > Measure on a face.
4. Select the new tube body and press Measure selection. OD, ID and length should match.
5. Draw a box near the tube, select it, press Set keep-outs. Select the tube and press
   Check clearance. Compare the gap with Inspect > Measure.
6. Boom tubes tab: press Build this boom tube. Check the inside height and width at the flat
   run and the wall with Inspect > Measure, and that both ends are open.
7. Pick a stock vehicle at the top of the panel and check that the tabs fill in.
8. Run the Exhaust Tuner dialog once in each mode.
If anything fails or looks wrong, note what was selected and the message shown.

WHAT IS SOLID AND WHAT IS A RULE OF THUMB
- The primary-length formula, collector, megaphone, belly and stinger defaults are rules of
  thumb. The Method and sources section at the bottom of the panel lists every source.
- Pulse spacing, Tri-Y pairing, bend schedules, measured lengths and clearances are
  exact geometry.
- Body length estimates count cylindrical and toroidal faces only; collectors, cones and
  free-form tubes are not counted. Splines give a length but no bend schedule.
- Auto-routing was tested on a real engine-bay scan (about 300,000 triangles) and in
  simulated scenes; every gap it reports was checked against the scan's own triangles.
- This version was checked against the web calculator's math and run against a stand-in for
  Fusion's API, not in Fusion itself. The first-run checklist above is the real test.
  To try auto-routing: import a scan as a mesh body, Set keep-outs with it selected, sketch
  the two end lines and press Auto-route on the Intake tab.
