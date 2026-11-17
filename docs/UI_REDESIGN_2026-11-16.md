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
