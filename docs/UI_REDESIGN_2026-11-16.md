# UI pass, 2026-11-16: one considered tool

The owner's request: "also make the software UI better". He is a fabricator, not a software person, and uses the page on
a shop PC, inside Fusion's narrow side palette and on a phone; he asked earlier for one clean program usable without
learning a lot, and every dimension in inches and mm. This pass builds on the 2026-11-01 interface (instrument-panel
shell, rail, readouts, drawing well) and the 2026-11-14 usability audit (turbo glance card, advanced boxes with
"changed" markers, both units everywhere). No calculation, default, input id, project-file key, URL hash or tested text
changed; the bridge and host hooks (data-* attributes, `window.adsk`, `__fromHost`, `hostInfo`, element ids) are as
they were.

## Direction

A build sheet on a steel bench: each tool leads with its answers set as readouts, and the working sits below them,
quieter, as label / value rows with the reasoning in small type under the value. Calm blasted-steel neutrals with a blue
cast, one heat-straw accent kept for what you can act on, ok / warn / bad / info / out-of-date each with a shape as well
as a colour, figures in tabular numerals with the second unit set quieter than the first.

## Audit (before; screenshots at 1440, 420 and 400 px, light and dark, every tab and the K24 turbo journey)

Kept outside the repository (device scale 2). What was wrong:

| # | Kind | Finding |
|---|---|---|
| A1 | Hierarchy | Result rows with a long explanation set it right-aligned in a 34-character column: dozens of lines of ragged-left grey text under one number (Mufflers cope templates, J-pipe, chamber rows; Headers, Intake). The answer and the working looked alike. |
| A2 | Hierarchy | Values like "6.69 in (170.0 mm)" printed both units at the same weight; the readouts (`.fv` / `.fa`) already set the second unit quieter, the rows and the glance card did not. |
| A3 | Wall of text | The engine preset's note (vehicle picker) runs to 15 to 30 lines on a phone (K24A2: about 1,400 characters of sources) above every tab's inputs and results. |
| A4 | Wrong copy | "Quick gives a whole starting build from a few answers" sat under the picker on every tab, not only Quick. |
| A5 | Navigation | Below 1180 px the 13 tabs are one sideways strip: no sign there are more, no grouping, no way to see them all at once. No arrow-key movement between tabs. |
| A6 | States | Warnings, problems and OK notes differed by colour only; out-of-date results were an ordinary warning; status values in readouts (green / amber / red) by colour only. |
| A7 | Touch | Many controls under 40 px at 400 px: glance "Go" and "Run the simulation" buttons (inline `min-height:0`), section jump chips (about 26 px), the compressor-map fields (24 px), "Specs at …" links on part cards (20 px), sole links in table cells (16 px), segment buttons (38 px). |
| A8 | Jump list | On a phone the section chips wrapped into 9 rows of buttons (about 370 px) before the first section. |
| A9 | Glance card | On a phone its three columns squeezed the value to about 40 % of the width. |
| A10 | Tables | Wide tables scroll inside their box, but the header and the first column scroll away with them; figures left-aligned. |
| A11 | Long runs | The simulation status was a plain bold line with "(42 %)" in it; three runs worded and styled it three ways. |
| A12 | Fonts | An embedded web font (120 KB of the page) instead of system fonts. |
| A13 | Motion | A fade on every tab change (decoration). |
| A14 | Contrast | `--faint` (placeholders) at about 3.5:1 in light and 3.9:1 in dark. |

No sideways page scroll at any width, no console errors, before or after.

## Design tokens (all on `:root`, again for dark under `prefers-color-scheme` and `data-theme`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` `--panel` `--raised` `--field` `--inset` `--well` | #E6EBEE #F5F7F8 #FFF #FFF #DCE3E8 #EEF2F5 | #10161B #151D23 #1B242B #0D1318 #1E2A33 #0B1014 | page, cards, glance/figures, fields, segment tracks, drawing well |
| `--ink` `--muted` `--faint` | #0F161B #52606A #66737D | #E6ECF0 #90A0AA #7F8D97 | text, secondary text, placeholders (faint darkened / lightened for 4.5:1) |
| `--line` `--line-2` | #CFD7DD #B3BEC6 | #222D36 #323F49 | rules, field borders |
| `--accent` (+ `-hi`, `-soft`, `-line`, `--on-accent`) | #935A06 | #E8AF48 | the one accent: primary buttons, links, current tab, focus ring |
| `--ok` / `--warn` / `--bad` (+ `-bg`) | #1B673F / #774800 / #A3241C | #86D6A6 / #F0C987 / #FF968C | states, each with its shape |
| `--info` `--info-bg` | #2B5A80 #DFE6EC | #9CC3E8 #172129 | plain notes (new `--info`) |
| `--stale` `--stale-bg` | #5B4E8C #E7E3F2 | #C3B5F2 #241F36 | results older than the inputs (new) |
| `--u2` | = `--muted` | = `--muted` | the second unit (new) |
| `--scrim` | rgba(8,12,16,.45) | rgba(0,0,0,.6) | dialog backdrop (was a literal) |
| `--t1`…`--t6` | heat-tint ramp | | pipe drawings, chart series, the mark |
| `--fs-xs` `--fs-sm` `--fs-md` `--fs-base` `--fs-lg` `--fs-xl` `--fs-fig` | 12 13 14 15 17 20 px, clamp(26px,3.2vw,40px) | | one type scale |
| `--sp-1`…`--sp-6` | 4 8 12 16 24 32 px | | one spacing scale |
| `--r-sm` `--r-md` `--r-lg` | 8 10 14 px | | fields/buttons, notes, cards |
| `--hit` | 40 px | | minimum control height on touch widths |
| `--measure` | 76ch | | reading width for prose |
| `--f-display` | Bahnschrift (a DIN face, Windows 10+), DIN Alternate, Segoe UI, the Apple system face, Liberation Sans, Arial … | | readouts, headings |
| `--f-ui` / `--f-body` | Segoe UI Variable / Segoe UI, the Apple system face, Liberation Sans, Helvetica Neue, Roboto, Arial … | | reading, controls |

Hierarchy rule: cards (`--panel`, 14 px radius) hold inputs and the "what this means" summary; readouts and the glance
card sit on `--raised` (the brightest surface); result rows are not boxed at all, only ruled; notes are tinted with a mark.

## What changed

- **Navigation.** Below 1180 px (Fusion's palette, a phone) the strip gains an "All" button at its left: a grouped list
  of all 13 calculators (Start, Engine, Sound and intake, Exhaust parts, Library), the current one marked and focused;
  Escape or a click outside closes it; a choice sets the hash like a tab. The strip fades at its right edge to show it
  scrolls, and the current tab is kept in view (as before). The tabs take arrow keys, Home and End (Enter or Space
  opens). Every tab id, hash and `[role=tab]` is unchanged; the list's buttons are `data-gotab`, not `data-tab`, so the
  tests and the add-in that look for `[data-tab]` see exactly what they saw.
- **Result header pattern.** Every calculator already led with its readouts (`.figs`) and the turbo build with its
  glance card; those now carry the status shape (circle ok, diamond warn, square bad) next to a coloured figure, and the
  glance card stacks label / Go / value on a phone.
- **Working: label / value rows.** One change in the shared helpers (`rowT`, `rowL`) and the row CSS: the label floats
  left, the value right; a short note (a conversion, a few words) stays right under the value; an explanation longer
  than a line (over 64 characters) runs under the row, left-aligned at reading width (`span.rx`). A conversion in
  brackets inside a value, "2.50 in (63.5 mm)", is set quieter (`small.u2`), in rows and on the glance card. Text,
  `textContent` and `innerText` are unchanged (the tests' unit and lone-unit checks read them).
- **Notes and states.** Each note kind has a mark: info a circle "i", warning a triangle "!", problem a square "×", OK a
  circle "✓"; the mark also gives screen readers the word ("Warning:"…) through CSS alternative text. Out-of-date notes
  (`#…-stale`) share one look on every tab: dashed, violet, the "run again" arrow. Long runs (wave simulation, turbo
  simulation, the sound runs) show their status line on one style with a thin progress bar from the "(n %)" or
  "n of m" in it.
- **Inputs.** Unchanged in layout (grouped, units inside the field, the advanced boxes and their "changed" markers);
  on touch widths every control is at least 40 px (segment buttons, icon buttons, tabs, small inline buttons, jump
  chips, compressor-map fields, part-card links, summaries, advanced-box headers). The engine preset's note shows three
  lines and "Show the full engine notes and sources" (nothing removed; the note is still one element, `#v-note`).
- **Tables.** Inside their own box (now also capped at 75 % of the window's height, so a long table scrolls in place),
  the header row and the first column stay in view; a column whose every cell starts with a figure is right-aligned
  (one text-only pass after each render, `tblPolish`); highlighted rows keep their highlight under the sticky column.
- **Prose.** Captions, section paragraphs, lists and notes are held to about 76 characters.
- **Jump list** of sections: one sideways row on a phone instead of nine rows of chips.
- **Copy.** The Quick sentence shows on Quick only; the Simple-mode sentence everywhere in Simple mode.
- **Print** (the page's own print; the build sheets have their own print document and are unchanged): the nav, jump
  list and "show more" are left off; tables print whole (no scroll box, no sticky cells); rows, notes and readouts are
  not split across pages.
- **Fonts:** the embedded font is removed (−120,655 bytes); system stacks only. On Windows readouts and headings are in
  Bahnschrift and text in Segoe UI; on a Mac the system face.
- **Motion:** the tab fade is gone; the remaining transitions are state feedback (hover, focus) and are switched off
  under reduced motion as before.

Per tab: the changes above are in the shared CSS and helpers, so they reach every tab. Most visible: Mufflers (the
cope-template, J-pipe and chamber rows were the worst walls of text), Headers and 4-Stroke (rows and readouts),
Intake / turbo (glance card on a phone, quieter conversions, sticky table headers on the option tables), Hangers /
Mounts (rows), Parts and Options (card links sized for touch). The 2-Stroke, Sound, Crossover, Cats and Boom tubes tabs
get the same rows, notes and tables with no tab-specific work.

## Checks

New test `web/tests/ui_ui.js` (every tab in its default state plus the K24 turbo journey, at 1440, 420 and 400 px,
light and dark):

- no sideways page scroll; nothing past the page edge outside a scrolling or clipping box;
- contrast from computed styles, 4.5:1 body / 3:1 large text, against the composited background, a sample of about
  260 text elements per view (app bar, picker, tab), light and dark, 1440 and 400 px;
- every visible control has an accessible name (two were missing: the tuned-tube length / diameter fields on Mufflers
  and the measured lift-profile boxes on 4-Stroke; given `aria-label`s);
- a visible focus style on every kind of control (one of each kind per tab, focused after a key press);
- at 400 px every control at least 40 px tall (links inside a run of text excepted);
- the tabs by keyboard, the All list (opens, 13 entries, current marked and focused, Escape, a choice opens the tab);
- no console errors;
- field-edit time on Mufflers, Intake (turbo), Hangers and 4-Stroke against the page before this pass (from git),
  both with the same font so the comparison is of the code and the styles: within +20 % + 5 ms.

Results and the full suite: see "Results" below.

## Page weight and speed

- web/index.html: 4,830,991 bytes before, 4,725,045 after (−105,946: the font out, about 14.7 KB of CSS and JavaScript in).
- Field edits (synchronous input event to layout, median, 1440 px, this machine), same font on both pages: see the
  test's lines in Results. Note on fonts: in this Linux container the system stack falls back to the container's
  default face (Inter), which shapes text more slowly than the embedded font did: with each page's own fonts, Mufflers
  went from about 74 to 84 ms and the turbo Intake tab from about 118 to 150 ms here. On Windows and macOS the stack
  resolves to the platform's own UI faces, which this container cannot measure.

## Not reached

- Inline styles in generated HTML (about 540 `style="…"`) were not rewritten one by one; the ones that broke touch sizes
  are overridden on touch widths, the rest still set their own margins and widths.
- Conversions inside table cells and in sentences are not set quieter (only rows, readouts and the glance card).
- Working sections are not collapsed (the page's tests read the sections' `innerText`, which hidden text would leave
  out); the rows make them secondary instead, and the jump list reaches each one.
- Toasts and error messages were not reworded tab by tab.
- No layout-jump work beyond Chromium's scroll anchoring (keeping the scroll position by hand would force a layout on
  every edit, which the timing rule forbids); a WebKit-based view has no scroll anchoring, so there a re-render that
  changes the height above the reading point can still move the page.
- The app bar on a phone still takes three rows (the controls keep 40 px targets).
- The very long input hints (the boosted build's "Boost worked out" reasoning in the input column) are unchanged.

## Results (final code)

- `web/tests/ui_ui.js`: 227 checks pass. That covers 13 tabs plus the K24 journey, at 3 widths and in 2 themes: no sideways scroll, no overflow, contrast, names, focus styles, 40 px targets at 400 px, the tabs by keyboard and the All list, and no console errors. Field edits with the same font on both pages, median of 15, best of 2 runs:
  Mufflers 70.4 ms against 66.5 before, turbo Intake 114.1 against 105.9, Hangers 262.9 against 259.0, 4-Stroke 20.9
  against 22.5 (all within the +20 % + 5 ms limit; Intake is the closest, +8 %).
- The full suite, `python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`: 144 tests, 137
  passed, 0 failed, 7 skipped and 7 partial skips, all expected (no OpenWAM build, no host program here). No existing
  test was edited; no pinned number changed.

# Pass two, 2026-11-16: answers first, the working one click away

Pass one fixed the result columns and the navigation. What still read as hard work: walls of grey text in the 270 px
input column (the boosted build's "Boost worked out …" reasoning ran to about 25 lines), every working section open at
once, three rows of controls above the page on a phone, a jump list that did not say where you were, and about 540
inline styles. Same hard rules as pass one: no calculation, default, input id, project-file key or URL hash changed;
the bridge and host contracts (ids, `data-*`, `window.adsk`, `__fromHost`, `hostInfo`) as they were; no external
resources; no pinned number changed.

## How folding works (the one design decision the rest follows)

A folded block keeps all of its text in the page. A folded section's blocks (every child but its heading) are drawn at
no height with their overflow clipped and carry `inert`, so they are out of the tab order and the accessibility tree,
but `textContent` and `innerText` still read them. The alternative, `<details>`, drops a closed body from `innerText`,
which about 140 page tests read; clipping keeps those tests honest without editing them, and print (screen-only rules)
draws everything. `web/tests/settle.js` gains `expandAll(page)` for any test that must click inside a folded section
or measure what it draws; one existing test needed it (easyflow_ui measures every boosted table at 400 px).

## What changed

1. **Input column: inputs and one-line hints.** One pass (`hintPass`, after every render, text reads only) finds every
   hint, caption or info note in an input column longer than 160 characters and shows its first two lines with a
   "More about this" / "How this was worked out" button (`aria-expanded`, `aria-controls`); opened state is kept per
   field in this browser. A computed note can carry a headline (`data-ro`): the boosted build's note now shows a
   readout, "Boost worked out **25.91 psi** (178.66 kPa), likely 18.64 psi (128.51 kPa) to 30.54 psi (210.54 kPa)"
   (or "Power worked out …"), with the whole 1,092-character reasoning folded under "How this was worked out". Nothing
   deleted: the note is the same element with the same text. Warnings and problems in the input column are never
   folded, and neither is a note with its own button, field or link (it is acted on, not read: the 4-Stroke tab's
   "put the library cam back" note). Counted on every tab and the K24 journey at 1440 px (script outside the repo): explanations over 160
   characters drawn in full in an input column went from 10 to 1 in Simple mode and from 25 to 6 in Expert mode. Left:
   the engine preset's note (pass one already shows three lines of it), two long list items in the 4-Stroke tab's cam
   list (a button cannot go inside a list), and the three advanced boxes' captions (176 characters, inside a box that
   is itself folded).
2. **Results: answers first, working one click away.** Every working section (`.sec`, built by the shared `sec()`
   helper or by hand) gets a consistent heading: a chevron, the title, a status mark (triangle warning, square problem,
   dashed circle out of date, filled circle OK) and, when folded, its one-line conclusion (the warning when there is
   one, else its first figure or row: "Quarter-wave side branch for 144 Hz, l = c ÷ 4f: 24.1 in"). The heading is a
   button with `aria-expanded`; the conclusion is drawn from an attribute, so the heading's text is unchanged.
   Default: sections a builder acts on are open; method, derivation and source sections start folded (Other published
   primary lengths, Head and valve rules, Check against Blair, Two notes on true duals, Helmholtz tuning, Why these
   lengths and diameters, Inlet and charge pipes: design and sizing, Charge density, Boost against compression ratio,
   Silencer layout rules, Production muffler sizing check, both Muffler types, Compare converter types, Street use,
   In stock car racing, Sources and what is assumed). A section with a warning, a problem or an out-of-date note never
   starts folded, and if the builder folded it while it was fine it opens again when it turns bad. 99 sections on the
   11 tabs that have them can fold (31 more on the boosted Intake tab); 15 start folded (5 of the 31). "Expand all" /
   "Collapse all" at the top of each tab's results; choices kept per tab in this browser (`exhaust-fold-v1`). Anything
   that scrolls into a folded section (the sections list, the glance card's Go, a link to a field) opens it first.
3. **App bar on a phone and in Fusion's palette (below 700 px):** one row, the title and a "Settings" button. The
   button opens a small panel with the same controls (the same buttons and ids), each group labelled (Level of detail,
   Units, Inch fractions on cut lists, Projects, Colour theme with its state in words); Escape or a click outside
   closes it and focus goes back to the button; it stays open while a choice is made. Wide windows keep the controls
   in the bar. The project in hand shows under the title ("Project: name", "· changed since saved" after an input
   changes), set when a project is saved or loaded.
4. **Sections list** (tabs with more than six sections, now also the boosted Intake tab, whose sections sit in several
   boxes): one row of chips, sticky under the app bar from 900 px, fading at its edge; the section crossing a line just
   under it is marked (`aria-current`) and its chip scrolled into the row. One IntersectionObserver per list, no scroll
   handler. Below 700 px it is a "Jump to…" select that also shows the section you are in; choosing one scrolls to it,
   opens it and focuses its heading. Jump targets clear the sticky bars (`--stick`, measured on load and resize only).
5. **Inline styles.** The source had 537 `style="…"` attributes in 167 distinct strings. Every string used more than
   five times (12 strings, 304 uses) became a class (`u-span`, `u-mt0`, `u-mt8` … `u-hl`, `u-ink`, with `!important`
   so they still win over component rules as the attribute did); 300 uses converted, 4 left where the tag's class is
   built in a different piece of a string. 237 attributes left (one-offs and computed widths). After visiting every
   tab, elements with a style attribute in the page: 1,173 before, 643 after. 4,941 bytes smaller for this step. The
   pages rendered before and after the conversion were compared pixel by pixel on all 14 views with everything open:
   identical apart from the selected tab's transition.
6. **Numbers in sentences and table cells.** A conversion in brackets inside a table cell, a list item, a caption, a
   section paragraph or a row's explanation is set in the quieter second-unit colour (`small.u2.u2c`, colour only, so
   nothing moves). Done on the text nodes when the page is idle after a render (a split text node; `textContent` and
   `innerText` identical); done synchronously it cost 20 to 30 ms per keystroke on the boosted Intake tab, so it is off
   the edit's path. Not in coloured notes (they keep their state colour).
7. **Empty, loading and error states.** The three long runs that had no Cancel (wave simulation, turbo simulation,
   sound estimate) get one beside "Running…": the run is dropped (its id moves on, its workers end) and the results
   before it stay. Their status lines show the elapsed time ("0:42") from one 1 s timer that runs only while a run
   shows on the active tab. Error strings: 210 user-facing error and problem strings inventoried by script; most
   already say what to change. 14 vague ones rewritten in 20 places, keeping their first words: "No answer from
   Fusion." (7 places, now says to check the add-in is running under Utilities, Add-Ins), "No reply from Fusion.", "No
   answer from the add-in.", "No answer from the program.", "No add-in status came back.", "Could not load it: …",
   "Could not import …", "The simulation stopped: …", "The combined run failed: …", "The run stopped: …", "No Headers
   layout.", "No lift in the profile.", "Recommend piping first.", "At least two mounts.". No test read any of them. The
   page has no `alert`, `confirm` or `prompt`. Empty states were not rewritten tab by tab (see Not reached).
8. **Layout stability.** Around every render the page keeps what you are looking at: the field being edited (or, with
   nothing focused, the first section in view) is measured before and after and the page scrolled by the difference;
   a control the render replaced is found again (by id, its `data-k`, or its place under the nearest box with an id)
   and gets its focus and caret back. The browser's own scroll anchoring is turned off (`overflow-anchor:none`) so the
   page's correction is the only one, the same in Chromium (Fusion's QtWebEngine, WebView2) and in WebKit (Safari),
   which has no scroll anchoring. The sticky bars' height is read on load and resize, never during a render, so a
   render forces no extra layout.

## Checks (web/tests/ui_ui.js extended; web/tests/settle.js gains expandAll and uiClick)

Tests touched besides those two, and why: 69 test files (68 tests and staleness_lib.js) clicked the app bar's controls (`#u-met`, `#m-expert`, `#proj-btn`
…) with `page.click`; below 700 px those now sit in the Settings panel, so the clicks go through `uiClick(page, sel)`,
which opens the panel when the control is not shown and closes it after, as a builder would (114 calls, a mechanical
replacement, no assertion changed); chamber_ui, full_ui and sweep_ui built the id at run time (`'#u-' + u`) and got the
same by hand; easyflow_ui opens every section (`expandAll`) before measuring the boosted tables at 400 px, because a
folded section's table is not drawn. No assertion weakened, no pinned number changed.


- On every tab and the K24 journey, with nothing stored: no warning, problem or out-of-date section starts folded and
  no such note sits in a folded section or explanation; every fold control has `aria-expanded`.
- Nothing lost: on every tab and the K24 journey, the vehicle bar and the tab's `innerText` with everything open holds
  every word of the page before pass two (git 6f0c694) at least as many times as it had it; the `textContent` with
  nothing opened likewise.
- A section heading folds and opens by Enter and Space, keeps focus, and its blocks are inert only while folded; the
  boost reasoning folds under its readout and opens by Enter.
- Print draws every folded section and explanation in full.
- The sections list stays under the app bar and marks the section in view (1440 px); at 400 px it is a "Jump to" list
  that scrolls to the section, opens it and focuses its heading.
- The Settings panel at 400 px (one-row bar, every control and its label, Escape and focus return, click outside),
  and no Settings button at 1440 px.
- A field edit that re-renders the tab leaves the field where it was with its focus and caret (Mufflers, Hangers,
  Intake at 400 and 1440 px; the K24 turbo housing select, which the render replaces, at 1440 px).
- Field-edit time against both the page before the UI pass and the page before pass two, same font.

## Page weight and speed

- web/index.html: 4,725,090 bytes before pass two, 4,751,293 after (+26,203).
- Field edits, median of 15, best of 2, same font, this machine (before the UI pass / before pass two / now): Mufflers
  68.7 / 67.4 / 71.6 ms, boosted Intake 101.0 / 105.3 / 115.5 ms, Hangers 240.3 / 255.2 / 250.6 ms, 4-Stroke
  19.8 / 21.7 / 21.7 ms (all within +20 % + 5 ms; Intake is the closest, +10 % on pass one).

## Not reached in pass two

- Empty states were not reworked tab by tab: every tab starts from working defaults, so the page rarely shows one;
  the messages that do appear ("Fill in …", "Lay out a header on the Headers tab first.") already name what to do, but
  most do not carry the control itself as a button.
- No space is reserved for results that appear after a run (the run's status line takes the place of the results it
  will show only roughly); with the scroll keeping above, content below the reading point can still grow.
- The OpenWAM and OpenFOAM runs (in the Windows program and the add-in) keep their own Stop and status; the elapsed
  clock covers them only where their status line carries a percentage or "n of m".
- No WebKit engine in this container: the layout-stability test runs in Chromium with its scroll anchoring off, which
  is the WebKit case, but Safari itself was not run.
- Long input explanations left drawn in full: listed under 1 above.
- One-off inline styles (237) stay.

## Results, pass two (final code)

- `web/tests/ui_ui.js`: 268 checks pass (pass one's 227, now with the field-edit timing against both earlier pages, and
  the pass-two checks above). Field-edit times are in "Page weight and speed".
- The full suite, `python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`: 144 tests, 137
  passed, 0 failed, 7 skipped and 7 partial skips, all expected (no OpenWAM build, no host program here).
