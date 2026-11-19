# Engine presets: sourced bore and stroke (2026-11-18)

Question (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1 (b)): of the 592 four-stroke presets in the car and truck engine
list, 77 carried a bore and stroke; the other 515 had none, so the page estimated them from the displacement. That was the
largest gap in the presets' data. This round gives as many of them as could be done properly their real bore and stroke,
each from a citable source with the figures as written, the quality of the source, the date read and an arithmetic check,
and says on the page, wherever the figures are shown or used, which ones are still estimated.

Result in short: **144 of the 515** car-list presets now have a sourced bore and stroke (221 of 592 with one, against 77),
plus 4 vehicle-only entries and 6 presets that already had the same figures and now name a better source: 154 preset lines,
from 88 source entries, 137 of the lines from the maker's own published data. The estimate was wrong by -7 to +28 % in
stroke on the presets changed (median {{MEDS}}); it serves long-stroke engines worst, and those are most of the modern
turbocharged fours and sixes. In the wave simulation of 30 of the most-corrected presets, peak torque moved by
{{TQRANGE}}. Two findings are parked for review (one looks like a wrong displacement in a preset), and 371 car-list presets
still carry the estimate, now labelled as such.

## 1. How the page estimates, and whom it serves worst

`boreStroke()` (and the same lines in `simSpec`): with neither figure given, stroke S = (4 V / (pi x 1.44))^(1/3) for the
swept volume V of one cylinder, and bore B = 1.2 S. With one of them given, the other comes from the displacement. From
the bore and stroke follow, on the 4-Stroke tab: the valve heads the wave simulation scales when none is typed (intake
0.40 x bore with four valves, 0.49 with two; exhaust 0.34 / 0.40), the valve lifts from those, the rod (1.7 x stroke when
blank), the piston motion and mean piston speed, Taylor's valve sizes and Mach index, Smith's pipe rule, Stone's best
intake closing (3 deg per m/s of piston speed). The 4-Stroke tab's primary length and size (calcFour) do not use them.

For a real bore/stroke ratio r, the estimate's stroke is off by S_real / S_est = (1.2 / r)^(2/3) and its bore by
B_real / B_est = (r / 1.2)^(1/3); mean piston speed at a given RPM is off as the stroke. So the estimate is exact only at
r = 1.2 (a wide-bore V8 or a short-stroke racing flat-six), about 13 % short in stroke for a square engine (r = 1), 23 %
for the K24 (87 x 99, r = 0.88) and 28 % for the 2024 Mustang 2.3 EcoBoost (r = 0.83), and about 7 % long for the 997.2
GT3's 102.7 x 76.4 (r = 1.34). The layouts it served worst are therefore the long-stroke turbocharged fours, fives and
sixes (EA888, 2.5 TFSI, B48/B58, S55, M177/M178, 2.3 EcoBoost, K24), then the square engines (K20, FA20, 2JZ, the
2.7 EcoBoost) and the longer-stroke pushrod V8s (the 6.6 L8T, r = 1.05); engines near r = 1.2 come out close, and the
short-stroke GT flat-sixes a little long. Over the {{NGEO}} presets changed the stroke error ran {{SRANGE}}.

## 2. What was done

- `tools/validation/presets/export.js`: every MOTORS and VEH entry (one source line each) with what the engine picker
  lists, as `worklist.json` (1,037 entries; the car and truck engine list 598, motorcycles 401).
- Triage by engine code and displacement (348 distinct code/cc pairs among the 515), worked through by likely use (GM
  small-block LS/LT, Ford Coyote, Modular, EcoBoost, Mopar HEMI and Viper, Honda K/B/C/F, Toyota and Lexus, Subaru FA,
  BMW M, VAG, Mercedes-AMG, Nissan VR/VQ, Hyundai-Kia) and by estimation error (long-stroke engines first).
- Sources in the order asked: the maker's published specification (press kits, technical data sheets, the maker's crate
  engine and industrial engine pages), then a reputable vendor's or magazine's figure, then an encyclopedia as a last
  resort and labelled as one. Forums were not used. A site that refused the fetch was not worked around.
- `tools/validation/presets/rs.js add` records one source entry at a time in `research.json` (the resumable checkpoint):
  the URL, the figures as written, the quality label, the date read, the presets it applies to, and the arithmetic check
  pi/4 x bore^2 x stroke x cylinders against each preset's displacement, 1 % (or the maker's stated cc, 2 % on the
  preset's figure); a preset outside it is not taken and lands in the review list with what was found.
- Compression, valves and redline only where the same source states them **for that model** (a sheet for another model
  year or rating gives bore and stroke only, said in the entry's note); a preset's existing compression is never
  overwritten (a differing one would be reported; none was). Rod length and firing order: no source in this round gave
  them.
- `tools/validation/presets/apply.js` writes research.json into the preset lines (`bore:..,stroke:..` after `cc`, `cr`
  and `valves` after them, `red` where it was `null`, and `bsSrc:'URL',bsQ:'label'` before `src`), deterministic and
  idempotent (a second run changes nothing; `--check` reports what would change). A preset that already had its own
  figures is left alone unless they agree, when only the source is added.
- Where a vendor's PDF text gave the labels apart from the values (BMW's 2017 M4 sheet), the figures were taken from a
  second sheet of the same maker that pairs them (BMW Canada's M3/M4 sheet, 84 bore x 89.6 stroke, which is also the only
  pairing that gives the stated 2979 cm3); inch-only figures (Ford's 2014 and 2020 F-150 and 2026 Mustang sheets) are
  converted and said so.

### On the page

- The preset note says, after "Bore and stroke ... mm": "(source: <maker data>)", the label linked to the bore-and-stroke
  source; for the 77 earlier presets "(from the source below: <kind>)", the kind of their own source from its address
  (`srcKind`: encyclopedia, maker data, magazine test, enthusiast reference). The figures now show to 0.01 mm (103.25, not
  103.3).
- A four-stroke preset without them says: "Bore and stroke: not in the sources found, so they are estimated from the
  displacement (bore 1.2 x stroke, B x S mm), and the 4-Stroke tab's valve sizes, rod and piston speed follow from that.
  Measure your engine's, or take them from its maker's data, and type them in on the 4-Stroke tab."
- The 4-Stroke tab's wave simulation says so above its results when the bore or stroke field is blank (`#sim-bsest`),
  with the figures it assumes; the head and valve rules section and Smith's rule already said "(estimated from the
  displacement)"; Stone's IVC hint now says its stroke was estimated.
- The "undefined" source links of part 14 do not return: every one of the 1,037 entries has a real address, and every
  engine preset note (999, both lists) was rendered and checked for an undefined link or NaN (presetdata_ui).
- A test hook `window.__presets` (MOTORS, VEH, ENGLIB, motorList, vehCode, vehMaker, boreStroke) for the tools and tests.

## 3. Coverage, before and after (car and truck engine list, four-strokes, by maker)

{{COVERAGE}}

## 4. Sources

{{QUALITY}}

The 88 entries (bore x stroke as taken; the figures as written, the presets and the notes are in research.json):

{{SOURCES}}

## 5. The 20 largest corrections (mean piston speed at the preset's redline)

{{LARGEST}}

{{SRANGE2}}

The wave simulation, the 30 picker presets with the largest stroke corrections (one per source entry): each preset chosen
in a fresh page, the page before this round (git 0c8fcfb) and this page, the design as entered run at the 12 speeds the
page runs, WebAssembly back end, short run control (2 first cycles, 1, 1 extra pair, 20 mm grid), peak indicated torque
from IMEP x displacement / 4 pi. The "after" includes the compression and redline where the round sourced them.

{{WAVE}}

Reading it: the longer stroke with the smaller bore (smaller scaled valves, a longer rod) mostly lowers the simulated
peak torque and VE of these engines a few per cent and moves nothing by much more than ten; the estimate had given these
long-stroke engines a wider bore and larger scaled valves than they have. The absolute torque is the model's, not the
maker's rating; what the table shows is how far the estimate had moved it.

## 6. Needs review, and what is still estimated

{{REVIEW}}

Still estimated: 371 car-list four-stroke presets (and the 73 motorcycle presets without a bore and stroke, not part of
this round). By family the largest groups left are the Porsche flat-sixes of the 964 to 991 generations other than the
997s (Porsche's newsroom data sheets for the older models were not found by search), Ferrari, Lamborghini and McLaren
(their own model pages did not come up in search, and no maker sheet was reached), the classic GM, Ford and Mopar V8s of
the 1960s and 1970s (no maker data on line; a magazine source per engine would be needed), the Ford Modular 4.6 / 5.4 and
the 5.0 Windsor, BMW's older M engines (S14, S38, S50, S52, S54), N55 and the B58 in BMW cars (BMW's newer press sheets
redirect to a site that could not be read), the VW-badged EA888 / EA113 / VR6 presets (an Audi sheet was not applied to
a VW preset), Mitsubishi, Mazda, the Subaru EJ, Nissan's SR, RB, VQ35 and VG, and the Lotus-installed Toyota engines.
Each is a search for a maker sheet away; the tools take a new entry with one command, and apply.js and the test pick it
up.

## 7. Tests and pins

`web/tests/presetdata_ui.js` (new): research.json complete and self-consistent; apply.js has nothing left to write;
every preset entry with a bore and stroke (about 560, cars and bikes) within 2 % of its displacement; every entry's
source a real address; every bsSrc a real address with a quality label; the page's figures equal research.json's; all
999 engine preset notes rendered, none with an undefined link or NaN; every four-stroke preset without the figures shows
the estimate line with the hint, every one with them shows the source and label; the 4-Stroke tab's estimate line on an
unsourced preset and not on a sourced one; eight changed presets (one per quality label and cylinder count) run on both
engines with every number the same.

{{PINS}}

## 8. How to rerun

    node tools/validation/presets/export.js                 # the work list (worklist.json)
    node tools/validation/presets/rs.js show [code regex]   # presets still without a sourced bore and stroke
    node tools/validation/presets/rs.js add <id> '<json>'   # one source entry (checked against the displacements)
    node tools/validation/presets/apply.js [--check]        # write research.json into web/index.html (idempotent)
    node tools/validation/presets/effect.js old=<page before> n=30   # results/effect.json (resumable)
    node tools/validation/presets/report.js                 # the tables of this document
    (cd web && node tests/presetdata_ui.js)
