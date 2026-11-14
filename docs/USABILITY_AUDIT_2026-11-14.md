# Usability audit of the boosted build, 2026-11-14

Scope: the Intake tab's boosted side, walked as a first-time builder doing one real build: Honda K24A2 picked from the
engine list, Turbocharged, 450 hp target, Precision GEN2 PT5862 with the 0.63 A/R T3 / 4-bolt housing, Use these sizes,
Use this intercooler, tubular manifold, port spacing 3.661 in (93 mm), the step-by-step list, the turbo build sheet, the
wave simulation with the turbo (4-Stroke tab) and the Mounts designer (Hangers tab). Chromium through Playwright at
1440 px and 400 px wide, light and dark, Simple mode (the default) and Expert, inches and mm. No physics changed.

How it was checked:
- Screenshots before (git dcd0f22) and after, at device scale 2 (kept outside the repo).
- A lone-unit checker (in web/tests/easyflow_ui.js): every number followed by a unit in a result cell (table cells,
  result rows, the step lines, the glance card, the build sheet's tables) must have the same quantity in the other unit
  system within 70 characters of the same cell. Power and torque are left out (makers' ratings are quoted as published);
  quoted source text is left out.
- Default results unchanged: the same journey on the old and the new page, Simple and Expert, inches, mm and a
  centrifugal case; the route result, Garrett's figures, the intercooler heat, oil load, the exhaust march, the manifold
  and every number of every section's text compared (the old numbers must appear, in order, in the new text: the new text
  only adds conversions and words). No differences; the only reordered number is the sheet's turbine tip speed, now
  ft/s first in inches like every other row.
- Field edits timed (synchronous re-render): 97 to 259 ms; the slowest is switching Induction to Turbocharged.

## Contradictory numbers between sections (the ones that matter most)

| # | Quantity | Where, value | Where, other value | Which is right |
|---|---|---|---|---|
| C1 | Compressor pressure ratio | Boosted intake, surge check, Stone: 1.54 | Inlet and charge pipes, step 2, sheet: 1.648 | 1.648 (with the inlet and charge-pipe losses); 1.54 is the throttle's ratio with no losses. Fixed: rows now say "no pipe losses" and point to the other section. A third figure, 2.89, is what the 450 hp target needs (C4). |
| C2 | Air leaving the compressor | Boosted intake, Stone, Charge pipes: 189 °F (87 °C) | Inlet and charge pipes, sheet: 206 °F (96 °C) | 206 °F, the one the turbo, intercooler and valve sections use. Labels now name the basis. |
| C3 | Air leaving the intercooler | Charge pipes, Stone: 105 °F (41 °C) | Inlet and charge pipes, sheet: 109 °F (43 °C) | 109 °F. Labels now name the basis. |
| C4 | Power target against boost | Garrett's method: 450 hp needs about 26.3 psi (181 kPa) boost, 49.5 lb/min (0.374 kg/s) | Boost typed 8 psi (55 kPa) gives 28.6 lb/min (0.216 kg/s); pipes, intercooler heat and valves are sized for that | Both are right for their basis; nothing said so on one screen. The glance card now warns and states both. |
| C5 | Boost of the wave simulation | Simulation text: "simulated at the boost the tab works out for 450 hp" | The run takes the typed boost (8 psi at the throttle) | The typed boost. Text fixed. |
| C6 | Pressure before the turbine (p3) | Turbine balance, valve placement, sheet: 2 × boost, 16.00 psi (110.32 kPa), Bell's figure, assumed | Wave simulation: 0.66 × boost mean, 1.32 × at the blowdown peak, with a turbine sized from the typed full-boost RPM | Not decidable on the page: both rest on assumptions (Bell's rule; a guessed full-boost RPM and no published turbine flow). Left as is; the glance card shows both side by side and the measurement list asks for the measurement. |
| C7 | Pressure after the turbine | Exhaust after the turbine: 1.87 psi (12.90 kPa) static | Turbine balance and the wave simulation: none (atmosphere) until "Use my exhaust's back pressure" | Left: by design (blank = none keeps the earlier results); the step list and the measurement list say how to put it in. |
| C8 | Tube wall and OD on the sheet | Runners: "0.065 in (1.65 mm) stainless tube" | Same cell: "wall 0.07 in (1.7 mm)", "OD 1.88 in" | 0.065 in, 1.875 in. Display only: tube OD and wall now print as tube is sold (ctube). |

Checked and consistent: wastegate valve 1.50 in (38.0 mm) from the placement section and from the simulation's widest
opening; downpipe, runner, collector, blow-off valve and oil line sizes between the step list, the sections and the sheet.

## Findings

Kinds: C contradiction (above, 8), D dead end (4), H hidden or unexplained input (3), J jargon or naming (3), U one unit
system only (14 places, 1 row), O order or layout (4), V input check (1), P performance (1), N reads as an error but is
normal (2).

| Kind | Issue | Where | Fix, or why left |
|---|---|---|---|
| O | The first screen of a turbo build showed the naturally aspirated key figures and the induction-tone chart; no part or size | Intake tab, top of the result column | New "Your turbo build at a glance" card first in the result column: power target against boost (Garrett), the simulation's power with its stated error, turbo, housing, compressor ports, every pipe, intercooler, throttle end, blow-off valve, wastegate, runners, collector, downpipe, oil lines, pressure before the turbine, brackets; each read from the build sheet's rows (which read the sections), each with Go |
| O | The turbo sections came after ten inlet-tube sections | Intake tab | The boosted block now follows the step list; computed in the same order as before, only placed first |
| O | Very wide option tables (intercooler options 5,318 px, oil coolers 3,718 px at desktop) | Turbo options, intercooler, oil | Left: they scroll inside their own box at every width; reshaping them is a redesign, not a clean-up |
| O | The engine preset's note is long on a phone and pushes the inputs down | Vehicle picker | Left: outside the boosted sections |
| D | "Type it off the maker's turbine flow chart": the field was hidden in Simple mode and not named | Step 4, sheet | Advanced boxes (below); the step has a "Type it in" button; the sheet names the field and where it is |
| D | "Measure it for the A/R check": no field named, hidden in Simple mode | Sheet assumptions | Names the field; measurement list with a link |
| D | "Turbine efficiency not entered": hidden in Simple mode | Sheet assumptions | Names the field |
| D | The Mounts designer (Hangers tab) was not reachable from the turbo guide | Step list, sheet | Glance row "Brackets (mounts)" with Go, which opens the Hangers tab; Go and the new links now open another tab when needed |
| H | Expert-only inputs were hidden in Simple mode even when set away from their default (picking a housing sets "Turbine housing picked"; Use this intercooler sets the core's rated drop and flow) | Charge pipes and intercooler, Turbo manifold, Exhaust after the turbine | Each group's advanced inputs (28, 6 and 9) moved, ids unchanged, into one box at the group's end: collapsed in Simple mode until opened (remembered in this browser), always open in Expert; the header says "changed: …" with each input not at its default |
| H | No list of what to measure on the car | Step list, sheet | "What to measure on the car to firm this up": pressure before the turbine, full-boost RPM, exhaust cam events, port spacing, turbine flow (from the maker), pressure after the turbine; each with what the page uses now and the input it goes in (link on the page, named on the sheet) |
| H | "Horsepower, blank to skip" is the boosted build's target | Engine group | Left: the field is shared with naturally aspirated builds; the glance card and step 1 call it the target |
| J | Corrected flow, expansion ratio, work coefficient, blade speed ratio, effective area, p3, A/R, NTU/UA, BSFC, surge/choke, static/total had no one-line meaning | All boosted sections | "Words used in the turbo sections" under the step list, one line each |
| J | One quantity under several names: turbine inlet pressure / pressure before the turbine / turbine-inlet pressure / p3 | Inputs, step 9, sheet | Plain term "pressure before the turbine", technical term in brackets once (input label, glossary, glance); step 9 line reworded. Long expert captions keep "turbine-inlet total pressure" (left: precise there) |
| J | "Turbine effective area" against "Turbine size (flow capacity)" | Input, sheet | Input label "Turbine size (its effective area)"; glossary |
| U | One unit system only: turbine flow parameter (kg√K/(s·bar)); extra air in the pipes (g); Bell's Mach 0.4 speed; Bell's hose-joint example; Bell's 2 psi budget (3 places); Setrab's dry-sump test; coolant mass flow (3 places); the intercooler rating's lb/min; the corrected-flow reference on the sheet; Boosted intake's airflow and temperatures; Bell's 6 in² per 100 hp; Bell's 10 psig and 1.5 cfm per hp; the A/R section's 15 psi, 2 L and 1.9 L; Garrett's ducting example on the sheet | Boosted sections, sheet | Both systems everywhere; the checker in easyflow_ui finds none left in inches or mm first |
| V | Port spacing typed as 93 into the inch field gave 141.6 in (3,598 mm) runners and a 23 L manifold with no remark | Turbo manifold | Warning when the spacing is over 4 × the port bore, in the section and on step 9 (results left as typed) |
| P | Field edits 97 to 259 ms; "Use these sizes" to a settled page 400 to 520 ms including the frame waits | Intake tab | Under the 300 ms target for edits; nothing changed |
| N | Power check: 25.2 bar BMEP, above Heywood's turbocharged range | Power check | Left: correct for a 450 hp K24 target, it is an ambitious figure, the row says so |
| N | Picked PT5862 shown with "recommended BorgWarner EFR 6758, not applied" | Step 3 | Left: the step also says the picked turbo's rating covers the build |
| — | Page width at 400 px | All | No change needed: no sideways page scroll before or after; every boosted table scrolls inside its own box; the glance card fits |
| — | Console errors | All | None before or after |

## Not done

- No power estimate without the wave simulation: the glance card says so and points to it. Turning Garrett's relation
  round (power from the airflow) would be a new calculation, so it was not added.
- The defaults of C6 and C7 stay as they were (they change results); the page now shows the disagreement instead.
