EXHAUST TUNER (Fusion add-in), version 4.18.0

4.18.0 (November 10, 2026)
  "Test this intake (CFD)" on the Intake tab: select an intake tube in the model, click once, and the pressure drop
  at its far end comes back in the panel (inH2O, Pa and kPa, the loss coefficient, the tab's own 1-D figure for the
  same tube beside it, the mesh size and the run time). The tube is read from the model (tubecfd.py) and run on the
  Exhaust Tuner program's own OpenFOAM (foamrun.py); "Use this tube in the Intake tab" fills the tab from it. See
  TEST AN INTAKE TUBE IN CFD below.

4.15.1 (November 6, 2026)
  The Sound tab's "Save the last sound (WAV)" saves through Fusion's file dialog (saveBase64). The panel's sound
  estimate also runs at no load (a free-rev hold), and "Hear a misfire" can stop any cylinder on a Headers layout.

4.15.0 (November 5, 2026)
  The panel runs OpenWAM itself (hostrun.py): "Run in OpenWAM on this PC" on the 4-Stroke and Two-Stroke tabs,
  the Muffler designer's check, the dyno fit and the header optimiser now work inside Fusion, and the results go
  straight into the tables and the Sound tab, with no case to save, run by hand or load back. Runs go to
  Documents\Exhaust Tuner\runs. OpenWAM is taken from engines\openwam\OpenWAM.exe in this folder, else the Exhaust
  Tuner program's copy, else one on the Desktop, in Downloads or in Documents; "Find OpenWAM.exe" in the panel
  points to any other. The Sound tab's estimate and "Hear a misfire" need no OpenWAM at all.

4.14.1 (November 5, 2026)
  Chamber baffles are cut to the chamber's bore (a line-on-line fit for welding in) instead of reaching
  0.5 mm into the shell wall, and the gas volume the chamber reports now takes the baffles off. Checked
  live in Fusion (tests/fusion_live_chambers.py): the plain, baffled and reverse-flow chambers, every
  body's volume against its section, the tubes and baffles clear of each other and the gas reported.

4.14.0 (November 5, 2026)
  Build the reverse-flow chamber: a round or flat-oval case with both tubes through one end plate
  (the Mufflers tab's reverse-flow layout), as a shelled extrusion, two cut holes and two revolves.
  Build the expansion chamber: an inline chamber with extended inlet and outlet tubes from the
  Mufflers tab (Munjal's double-tuned layout with the tab's Set button), three sketch-driven
  revolves along one marker on the pipe's centreline; clearance against the keep-outs.

4.13.1 (November 3, 2026)
- Starts with Fusion: the add-in is set to run on startup, so after the Windows program installs it
  there is nothing to switch on. (Untick "Run on Startup" in Utilities > Add-Ins to stop that.)

4.13.0 (November 2, 2026)
- Faster: the router runs in a Rust core, et_core.dll, which the Windows program installs next to
  the add-in. It is the router's own search, fit and clearance check rewritten line for line, and
  it gives the same routes to the last digit (tests/test_native.py checks every query, fit, search
  and whole route both ways), as long as the Python run is not stopped by the route's time limit
  (40 s a tube unless set): the 75 cm pipe below takes the Python 77 s, so at the default limit the
  Python router stops early with the best route it has by then, where the core finishes the search.
  On the test scenes, Python before and now:
    a pipe round a block                      2.4 s    0.05 s
    a 75 cm pipe off a port, under a shelf     77 s    0.8 s
    a four-primary header with a collector    137 s    1.0 s
    the scan fit under a J-pipe or Helmholtz   0.6 s    0.02 s
  Placing parts along a route, the collector check and the scan-to-tube gap check send their points
  to the core in one call too. Without the DLL (on a Mac, or a folder copied without it) the add-in
  runs its Python as before: the same answers, slower. The route report ends with which ran: "Rust router
  core", or "Python router" and why.
  Windows keeps a loaded DLL open until Fusion quits, so the add-in loads a copy of et_core.dll (in
  the "native" folder beside it) and an update can always replace the installed one. After an
  update, restart Fusion to load the new core; if an older one is still loaded the route report says
  so and the Python router runs.
  The core checks what it is given, and a fault inside it comes back to the add-in as an error
  instead of stopping Fusion. If one of its calls ever fails, that work and everything after it
  runs in the add-in's Python instead (a tube that was part way through is laid out again from the
  start, all in Python), with the same answers, and the route report says "Python router (the Rust
  core failed: ...)" with the reason until Fusion is restarted.
- Fixed: a pipe with a length target could fail ("Length is ... the target is ...") when the widest
  corridor's clear route came out longer than the target: only that route was fitted to length, and
  the fit can add length but not take it away. A route too long for the target now leads on to the
  narrower corridors; the clear routes no longer than the target are fitted to length first (the
  longest of them, needing the least added), the next only when one does not fit. The choice no
  longer depends on how long a search took, so a slow computer and a fast one give the same route.
- Fixed: a trial centreline that folded back on itself during the fit (no length, so no points to
  check along it) gave the fit a shorter list of numbers than the trial before; the fit then compared
  numbers that did not belong together, or stopped with an error. Zeros now stand in for the missing
  points, in the Python router and the core alike.
- The core's sin, cos, tan and acos come from the same C library Python's math module uses (on
  Windows the Universal C Runtime), also when the DLL is built with MinGW or zig instead of Visual
  C++: MinGW's own maths differ from it by a unit in the last place now and then, which was enough
  for a route through the block scene to come out a little different from the Python one.
  tests/test_native.py passes with such a build on Windows, run in Fusion's own Python.
- Fixed (found running the drone parts in Fusion itself): a J-pipe whose route had no room for its
  bends, so they overlapped, made a centreline that folded back through itself, and Fusion stopped
  with a sweep error; the router can also leave a bend a fraction of a millimetre long at a corner,
  which Fusion will not sketch. A bend that small is now part of the straight around it, and a route
  whose bends overlap is refused with how far, and what to change (end marker farther away, a smaller
  bend radius or a shorter target length).
- Fixed (also found in Fusion): a J-pipe the same size as a main pipe read from the scan was left
  square ("the branch is wider than the main pipe"). The cylinder fitted to a scan is never exactly
  square to the marker, so one side of a same-size branch passed a hair beside the main pipe. A side
  that passes within the same-size allowance (1 % of the radius, at least 0.5 mm) is taken as
  touching it; one leaning farther across is left square with that reason, not "wider".

4.12.0 (November 2, 2026)
- New: drone-fix parts, all from the Mufflers tab.
  J-pipes (built along a path or auto-routed) get a flat cap plate on the far end (the J-pipe
  cap plate on the tab, 1/8 in by default; its inside face sits on the tube's end, so the inside
  length stays the cut length) and their tee end coped to the main pipe: the fishmouth is cut
  to the main pipe's outside and joined to the tube, and a hidden "tee hole (cut tool)" body is
  left for the hole: Combine > Cut the main pipe with it, Keep Tools off. The report gives how
  deep the fishmouth runs at its sides and the tube's cut length at its longest side.
  "Build the Helmholtz can": draw a short sketch line on the main pipe's outside where the neck
  tees in, pointing the way the neck goes, select it and press the button. It builds the neck
  (the tab's ID, length and wall, coped to the main pipe the same way) and the can along it: the
  tab's can (inside diameter) with its wall and end plates, its inside length set so the gas
  round the neck is exactly the tab's volume, also when the neck runs into the can (the can
  grows by the neck's outside area times that length, over the can's area). With the scan set
  as a keep-out it checks the can's clearance. The panel reads the built can back as the
  frequency it tunes to, with the tab's own formula.
  The main pipe comes from its outside face (Ctrl+click it with the marker or path), else from
  a solid the marker sits on, else from the scan: a cylinder fitted to the keep-out scan round
  the marker (all five numbers of the cylinder, so a marker a little off the surface or off
  square is fine; it is refused, and the end left square, when the scan there is not a round
  pipe or shows too little of the way round it). A marker drawn off square, or a lateral, is
  fine: the tube's first part, which runs inside the main pipe, is cut to it too, and the hole
  tool runs as far up as the wall does. A branch wider than the main pipe, one running along it,
  or a marker pointing into the main pipe is left square (the Helmholtz can is refused) with the
  reason. A branch the size of the main pipe (the tab's default J-pipe) meets it tangentially at
  the tips of the fishmouth, and its bore meets the main pipe's bore the same way at the sides of
  the hole; the last 2.5 mm of those tips is left off, ending in a small flat: finish them by
  hand. A size read from a scan a hair under the branch's is taken as the same size.
  The main pipe is the round face the marker sits on: a flange or slip-joint end on the same
  axis is not taken for it, and a selected face away from the marker is not used.
  The can, the neck and the cap are sketch-driven revolves; the coped piece and the hole tool
  are fixed bodies cut from the main pipe's shape.
- Fixed: two fallbacks that were called but never written. When Fusion refused the parametric
  merge collector or a part's outline, the route stopped with an error after building the
  tubes; now the collector and the part outlines are added as fixed bodies, as the message
  always said. A part's outline now keeps an offset inlet or outlet on its own port (the
  outlet stub was centred on the case), and a half-made part is removed before its outline is
  added. Bodies added as fixed bodies are now named after the base feature is closed (a name set
  while it is open came back as "BodyN").
- Tests: tests/test_drone_parts.py (the geometry against closed-form and brute-force answers,
  the scan fit), tests/test_drone_fusion_mock.py (the builders against a stand-in for Fusion's
  API that records what they ask for) and tests/fusion_live_drone_parts.py, to run inside
  Fusion: it builds each part in a throw-away design and checks it in Fusion's own numbers.

  "Build the expansion chamber": draw one sketch line along the pipe's centreline where the chamber's
  near end plate goes, pointing the way the gas flows. Sizes come from the Mufflers tab (pipe inside
  diameter and wall, chamber inside diameter and length, the inlet and outlet tube extensions, the
  chamber wall, and the Mufflers tab's baffle count and hole); sketch-driven revolves in one component
  (shell with end plates, inlet tube, outlet tube, a washer per baffle spaced evenly between the tube
  mouths), each stub 2 in past the plates. The straight-through layout only: the reverse-flow
  chamber's pipes sit side by side and are not a revolve.

  "Build the reverse-flow chamber": the layout of most chambered street mufflers, inlet and outlet
  side by side through one end plate, the far plate blank. Draw one sketch line along the case's
  axis from the middle of the pipe end plate's outside face, pointing into the case; the tubes sit
  either side of it across the case's width (the longer way of a flat oval). Sizes from the Mufflers
  tab with the reverse-flow layout: the case is round (the chamber bore) or a flat oval of the same
  inside area at the cut-file height, the tubes run in by the tab's inlet figure at OD + 12 mm
  centres. Built as a shell (outer extrusion, inside cut away between the plates), two holes cut
  through the pipe plate, and the two tubes as revolves. Gussets are yours to add.

4.11.1 (November 2, 2026)
- Fixed: "Auto-route the J-pipe through the scan" (Mufflers tab) dropped the J-pipe's cut
  length, so the tube came out at whatever length fit between the two markers and missed the
  drone frequency. The route now comes out at the cut length (pipe wall to cap). Put the start
  marker on the main pipe wall where the branch tees in, pointing away from the pipe, and the
  end marker where the cap goes, closer than the cut length in a straight line. If the markers
  are too far apart for that length, it says so and flags the route instead of passing it.
  It still builds an open tube: weld a cap on the far end.
- New: on the Mufflers tab, a measured or built path shows how far it is from the cut length
  and the frequency it tunes to as a J-pipe (the tab's own quarter-wave formula, inverted).

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
The Windows program installs and updates the add-in for you (Add-in menu). By hand:
1. Unzip so you have a folder named ExhaustTuner holding ExhaustTuner.py, cadtools.py,
   router.py, templates.py, native.py, palette.html and ExhaustTuner.manifest, and et_core.dll
   (the router's Rust core; without it the router runs in Python, slower). Keep the files together.
2. In Fusion: Utilities > Add-Ins (or Shift+S), Add-Ins tab, green plus next to "My Add-Ins",
   then pick the ExhaustTuner folder.
3. Select Exhaust Tuner and click Run (it is set to run on startup from then on).
Updating from an older version: stop the add-in, replace the whole folder (the "native" folder
inside it can go too), then restart Fusion so the new Rust core loads.

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
                       with the runner length the page asks for. On the Mufflers tab
                       ("Build J-pipe along selected path") it also caps the far end and
                       copes the end on the main pipe (select the main pipe's outside face
                       too, so it knows which end tees in).
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
                       Mufflers tab: it routes the J-pipe at its cut length, from a marker on
                       the main pipe wall where the branch tees in to one where the cap goes,
                       caps the far end and copes the tee end to the main pipe.
   Build the Helmholtz can
                       Mufflers tab: select a short sketch line drawn on the main pipe's outside
                       where the neck tees in, pointing the way the neck goes (Ctrl+click the
                       main pipe's outside face too if it is a body). Builds the neck, coped to
                       the main pipe, and the can along it, sized to hold the tab's volume
                       round the neck, with a hidden tool body for the hole.
   CAD library        Parts on the Parts tab marked "CAD model" have a STEP file in the shop's CAD
                       library folder (Desktop\claude training books\cad files in your user folder, or the
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

SPLIT A TUBE FOR PRINTING (Split the selected tube for printing, on the Intake, Headers, Muffler, Parts and Boom tabs)
For a printed pipe longer than the printer: click the tube's outside face (Ctrl+click its centreline sketch curves too
if it was not made with Pipe). printsplit.py plans the cuts: only in straights, the whole joint clear of bends and of
anything raised or recessed on the tube (lettering, bosses, end lips), every piece standing on an end (its axis
vertical) within the printer's bed and height, the fewest pieces. Each joint is a flush lap: the receiving piece keeps
the inner half of its wall for the lap length, the other piece carries the outer half over it, with an epoxy gap
between, so neither the outside nor the bore shows a step and nothing sits in the flow. A 45 degree chamfer fills the
step each piece prints over (no supports). Every piece stands on an end with no outer tongue. The features go into a
"Print split" group at the end of the timeline; print-ready STLs (each stood on its end) go to
Documents\Exhaust Tuner\prints\<design>. Settings: printer (bed size), lap length (20 mm), epoxy gap (0.15 mm per
side), material (for the weight and filament length). Scuff both lap faces and use a plastic-rated epoxy.
It refuses, with a note saying why, a wall too thin for the lap (either tongue under 0.8 mm / 0.031 in, two 0.4 mm
perimeters; it warns under 1.2 mm / 0.047 in), a tube with no straight long enough for the lap both sides of a cut
plus 5 mm margins, straights all covered by lettering, a tube wider than the bed, and a body inside a moved
component (open that component on its own first). The result lists the gluing order: for each joint which piece
carries the outer tongue, the bonded area (cm2 and in2) and the epoxy in the bond line (mL; mix about three times
that). If a step fails part way, what was made sits in a "Print split (incomplete)" timeline group: delete it before
trying again. A chamfer Fusion will not make is reported (add it by hand) rather than stopping the split.
Tests: tests/test_printsplit.py and tests/test_printsplit_edges.py (the planner), tests/test_printsplit_fusion_fake.py
(the add-in's glue against a stand-in for Fusion's API), tests/fusion_live_printsplit.py (inside Fusion).

TEST AN INTAKE TUBE IN CFD (Test this intake (CFD) and Use this tube in the Intake tab, on the Intake tab)
Click the intake tube's outside face near the end the air goes in (or click that end face), then Test this intake
(CFD). Nothing else to set and no files to handle. The add-in reads the tube (tubecfd.py): its centreline from the
Pipe feature that made it (or Ctrl+click the centreline sketch curves too), trimmed to the part the tube covers, the
bore and wall from its faces, every bend's centre-line radius, angle, start (mm from the mouth) and direction round
the tube, and a fillet on the mouth's inside edge as a lip radius (else a square-cut mouth with the real wall). The
mouth is the end nearer where you clicked; "Air goes in at: the other end" turns it round. The airflow is the Intake
tab's (engine, RPM, VE, the same cycle-mean flow its own CFD case uses), with the tube from Fusion in place of the
tab's. The case is a steady-flow OpenFOAM case of the tube alone with its mouth flush in a flat wall (a straight tube
in 2-D, a bent one in 3-D, medium mesh), written by the same generator as the tab's CFD case and run on this PC by the
Exhaust Tuner program (its exhaust-tuner-host, the bundled OpenFOAM; the add-in bundles no solver). The panel shows
the meshing and solving steps, the iteration count and a Stop button; a bent tube takes minutes on one core. The
result: the total-pressure drop at the tube's far end, its loss coefficient K, the tab's quick 1-D estimate for the
same tube, the airflow used, the cell count and the run time; "Open the case folder" shows the case and its logs
(in %LOCALAPPDATA%\ExhaustTuner\runs). A tube tested before (same tube, airflow, mesh and program build) shows its
result at once from Documents\Exhaust Tuner\cfd-cache.
It takes constant-bore round tubes whose centreline is straights and circular arcs, end to end and tangent. It says
why, in a sentence, when the tube is not that: a spline or a mitre in the centreline, a bore that tapers, goes oval or
has a branch, a bend tighter than 0.6 times the bore, a bend right at the mouth, a mesh body, nothing or two bodies
selected, no centreline. If the Exhaust Tuner program (or its OpenFOAM) is not installed it says so, and still shows
the tube it read and the 1-D estimate.
Use this tube in the Intake tab: the same reading fills the tab's tube length, inside diameter, bend angles (from the
mouth), bend radius (their mean, said so, when they differ), mouth (plain cut or lip radius) and the CFD panel's bend
starts, so the tab's own 1-D figures and CFD case describe the tube in the model.
The program is looked for where its installer puts it: exhaust-tuner-host.exe in Exhaust Tuner under
%LOCALAPPDATA%\Programs or Program Files (settings.json "program_host", or EXHAUST_TUNER_HOST_EXE, point elsewhere),
its OpenFOAM in engines\openfoam\OpenFOAM-v2412 beside it.
Tests: tests/test_tubecfd.py (the tube to the design; the design rebuilt with the generator's own path),
tests/test_intakecfd_fusion_fake.py (the add-in's glue against a stand-in for Fusion's API), tests/test_foamrun.py
(the run, with a stand-in for the program), web/tests/fxcfd_ui.js (the panel), tests/fusion_live_intakecfd.py
(inside Fusion, on the owner's PC).

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
9. Drone parts: run tests/fusion_live_drone_parts.py as a script (Utilities > Scripts and
   Add-Ins, or through the Fusion connector). It makes its own throw-away design, builds a
   Helmholtz can, a J-pipe along a path and an auto-routed J-pipe on a test pipe (and the can
   again on a scan of it), checks each in Fusion's own numbers, prints the results and closes
   the design without saving.
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
