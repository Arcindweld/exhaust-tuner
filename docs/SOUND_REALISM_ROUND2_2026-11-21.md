# Sound realism, round two (2026-11-21): the street V8, content above the 1-D limit, real muffler insides, standing behind the car

The owner listened to round one's files: "the rs660 one is getting closer", "not quite there yet", "the rest are still
pretty far off". This round measured where the cross-plane V8 with a street system departs, changed what the measurements
pointed at, and says plainly what could not be done honestly. Nobody has listened to these files yet; the owner must.
Nothing here is an equaliser set by ear and no sample is used: every stage is model output, cited physics or a cited
statistic, switchable on the Sound tab, and with every new stage off the page plays round one's sound sample for sample
(checked against round one's own code, commit 3026098, in `wsndreal_ui.js`).

Tools (all read recordings in place; no audio was copied into the repository):
`tools/sound/ablate.js` (each exhaust part and each playback stage on and off, octave bands and the tip's orders),
`tools/sound/ilcheck.js` + `ilstat.py` (a muffler layout's insertion loss in the wave model against the page's transfer
matrices), `tools/sound/f100_orders.js` (the F-100 302's layout in the page's wave model against its roadside pulls),
`tools/sound/rs660_stock.js` (the closest model of the RS 660's stock system), `tools/sound/deliver.js` (the listening files),
`tools/sound/render_page.js` (now with `--listen` and `--dx`), `tools/sound/analyze.py` (unchanged).

Octave bands below are the reviewer's: 20-60, 60-125, 125-250, 250-500, 500-1k, 1-2k, 2-4k, 4-8k, above 8k Hz, dB re the
total, unless a table says "analyze.py octaves" (centres 31 Hz to 16 kHz).

## 1. Diagnosis of the V8 (work item A)

### 1.1 What the reviewer's numbers were made of

The reviewer measured whole files. Round one's "Hear my exhaust" plays idle 2.5 s, then holds at about 1,400 and
3,300 RPM (Mustang: 650, 1,500, 3,300). The held revs carry most of the energy, and there the firing harmonics sit at 100 to
440 Hz, so a whole-file band average peaks at 125-500 Hz even when the idle itself is dominated by its lows. Measured on the
same runs (ablate.js, 2018-20 Mustang GT after Quick's "Fill in every tab", 180 in, no load, round one's playback):

| round one, Mustang system | 20-60 | 60-125 | 125-250 | 250-500 | 500-1k | 1-2k | 2-4k | 4-8k |
|---|---|---|---|---|---|---|---|---|
| idle 650 RPM hold | -1.4 | -8.4 | -13.0 | -14.0 | -15.3 | -22.6 | -68.9 | -86.3 |
| 2,500 RPM hold, no load | -15.6 | -6.1 | -4.0 | -5.9 | -11.8 | -28.0 | -33.0 | -88.1 |
| 2,500 RPM, full throttle | -14.0 | -12.1 | -9.8 | -3.9 | -4.3 | -22.0 | -21.8 | -53.0 |

So the idle was not short of lows; the revs were, and above all the full-throttle hold, whose strongest order at the tip is
order 9 (375 Hz), not the firing order 4 (167 Hz).

### 1.2 Hypotheses and what the numbers say

1. *The 25 ft listening comb carves the lows.* No. With the tip 1 ft and the ear 5.25 ft up at 25 ft the path difference
   is 0.123 m, so the first null is at 1,394 Hz; below it the reflection adds up to +6 dB at every frequency. The comb's
   measured effect is in the 1-2 kHz band (round one: 11 dB lower there with the path on than off, 2,500 RPM). Standing
   6 ft behind the car the difference is 0.374 m and the first null falls at 459 Hz, which takes 4-8 dB out of 250-500 Hz
   (section 4). A finite ground impedance does not remove the lows: asphalt (Nord2000 class G) reflects with |Q| 0.98 to
   0.999 from 50 Hz to 2 kHz in this geometry, a near mirror; ablation "mirror" against "asphalt" moves no band by more
   than 0.3 dB.
2. *The empty-can muffler carves the lows.* No; it carves 250-500 Hz. A 330 mm empty case has its first transmission-loss
   dome at c / 4L, about 300-330 Hz in the tip gas. Splitting it into two chambers moves the dome to about 700 Hz and lets
   250-500 Hz through (+19 dB in that band at idle, below).
3. *The source orders are wrong.* Partly. Which orders are strong is the wave model's: at full throttle the Mustang system's
   strongest tip order is 9 at 2,500 RPM, and with the crossover removed order 2. On the F-100's own layout at 5,800 RPM
   (section 1.4) the model has order 4 on top as the recording does, but the other orders' balance differs.
4. *Band limit.* Yes, for everything above 2-3 kHz: section 2.
5. *Playing 25 ft by default.* The owner stands behind the car; the default is now 6 ft behind the tips (section 4).

### 1.3 Ablation (Mustang GT system, idle 650 RPM and 2,500 RPM, no load; ablate.js --stages r2)

Exhaust parts, each taken off in turn (the wave model rerun), heard with round two's playback (6 ft behind, asphalt,
fine cycle, idle stage; case noise off). "full" is the system as played now: H-pipe, 12.1 L Helmholtz can, the chambered
muffler as two chambers joined by a pipe-sized hole (generic); "empty case" is round one's muffler.

| 650 RPM | 20-60 | 60-125 | 125-250 | 250-500 | 500-1k | 1-2k | 2-4k | 4-8k | strongest tip order |
|---|---|---|---|---|---|---|---|---|---|
| full | -5.8 | -8.9 | -15.8 | -4.9 | -6.2 | -18.5 | -26.0 | -80.0 | 4 |
| empty case (round one's muffler) | -1.3 | -8.7 | -14.4 | -23.6 | -11.9 | -16.2 | -35.9 | -87.9 | 4 |
| no muffler | -5.8 | -11.8 | -5.8 | -11.1 | -8.4 | -7.4 | -22.6 | -80.5 | 4 |
| no resonator | -3.9 | -4.0 | -19.6 | -9.8 | -10.9 | -24.4 | -34.0 | -86.9 | 5.5 |
| no crossover (true duals) | -1.0 | -8.1 | -17.2 | -17.2 | -21.4 | -32.3 | -48.3 | -83.3 | 4 |
| open headers | -12.9 | -0.8 | -12.4 | -21.2 | -14.0 | -17.6 | -32.3 | -79.4 | 8 |

| 2,500 RPM no load | 20-60 | 60-125 | 125-250 | 250-500 | 500-1k | 1-2k | 2-4k | 4-8k | strongest |
|---|---|---|---|---|---|---|---|---|---|
| full | -15.5 | -4.3 | -3.9 | -8.2 | -13.9 | -30.1 | -39.9 | -88.7 | 9 |
| empty case | -14.1 | -5.3 | -3.6 | -13.7 | -7.6 | -20.3 | -33.8 | -84.9 | 3 |
| no muffler | -21.5 | -13.1 | -6.3 | -7.5 | -3.7 | -10.2 | -20.9 | -73.9 | 9 |
| no resonator | -18.2 | -3.5 | -3.2 | -15.9 | -19.5 | -19.1 | -23.8 | -71.6 | 3 |
| no crossover | -12.9 | -4.5 | -3.7 | -9.1 | -14.2 | -23.3 | -40.3 | -64.8 | 8 |
| open headers | -23.3 | -8.1 | -12.7 | -14.6 | -1.7 | -11.5 | -23.4 | -68.6 | 9 |

Playback stages, each switched on its own against the round-two default (same runs; the numbers are the change in each
band, dB, at 650 / 2,500 RPM, "full" system):

| stage off (or changed) | largest band changes |
|---|---|
| all new stages off (round one's playback) | 2-4 kHz -41 / -2; 250-500 Hz +8 / +10; 20-60 Hz -9 / -5 |
| fine cycle off (720 points) | 2-4 kHz -38 at idle (the limit falls from 2,646 to 1,945 Hz); none at 2,500 |
| listener at 25 ft roadside instead of 6 ft behind | 250-500 Hz +7 / +9; 1-2 kHz -13 / -10 |
| listening path off (the table's +6 dB) | 250-500 Hz +8 / +9; 60-125 Hz -7 / -3 |
| asphalt to a perfect mirror | under 0.3 dB |
| idle roughness off | under 0.1 dB on the bands (it changes the cycle-to-cycle spread, section 5) |
| band limit off ("everything in its cycle") | 4-8 kHz +50, above 8 kHz +36 (not a prediction) |
| engine variation off | under 1 dB below 4 kHz |
| jet noise off | only above 4 kHz, which is already 80 dB down |
| muffler case noise on (an upper bound, off by default) | 20-60 Hz -24 / -31 (the case dominates the lows: section 2.3) |

Ranking for the V8, by the size of the change in the played spectrum: (1) the band limit (40-50 dB above 2-4 kHz: the one
the reviewer heard as "dull"); (2) the exhaust parts in the wave model: the muffler's inside (19 dB at 250-500 Hz), the
crossover (12-16 dB at 1-4 kHz) and the resonator; (3) the listening position (7-13 dB, 250-500 Hz and 1-2 kHz); (4) the
cycle detail at idle (38 dB at 2-4 kHz, part of 1); then the variation, ground impedance, idle stage and jet, each under
1 dB on the bands.

### 1.4 The F-100 302 (long tubes, X-pipe, chambered mufflers) against its roadside pulls

`f100_orders.js` on the validation spec `ho_venom_plenum_x400_5800` (read in place from the main checkout): the README's
chambered layout (front chamber 2 L, two 70 mm side passages round the V baffle as the solver's parallel paths, rear
chamber 2 L, each chamber at a Flowmaster-40-size bore, 600 mm exits), X 400 mm behind the collectors, full throttle 5,800
RPM, both exits at the microphone (the far one 1.8 m further, as the README). Relative order levels (dB re order 4; the
recording the mean of its four pulls; the model's half orders are empty because its cylinders are identical, which the
playback's cylinder spread stands in for):

| order | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| page model, chambered layout | -14.7 | -13.9 | -16.6 | 0 | -25.6 | -7.1 | -23.7 | -24.6 | -37.2 | <-40 | -33.4 | -31.3 |
| page model, one empty case (round one's way) | -8.9 | -11.9 | -19.9 | 0 | -25.7 | -5.2 | -21.3 | -11.6 | <-40 | -11.7 | -12.6 | -4.6 |
| recording, mean of 4 pulls | - | -24.1 | -18.6 | 0 | -22.7 | -29.3 | -24.7 | -13.8 | -21.5 | -23.6 | -23.4 | -18.1 |

Clipped RMS at -25 dB (orders 1.5-12, the README's score) per pull: chambered 5.5 / 5.0 / 7.3 / 6.0 dB, one empty case
7.5 / 7.3 / 6.8 / 7.2 dB (OpenWAM on the same layout: 3.8-6.2). So both put order 4 on top as the recording does; the
chambered inside brings orders 10-12 down where the recording has them (the empty case leaves order 12 at -4.6 against
-18), but it takes order 8 to -25 against the recording's -14 and leaves orders 2 and 6 8-22 dB too strong. The stage
that departs from the recording is the source/system balance in the wave model (the README's finding too: orders 8 and
12 too weak, 2 and 6 too strong, "for the muffler's inside and the radiation to fix"), not the playback.

### 1.5 What the acoustics literature says a cross-plane V8 should show

A cross-plane V8 fires each bank at 90-180-270-180 degrees, so each bank's collector carries strong half orders and order
1 and 2 content (the "burble"); joining the banks (H or X) sums the two banks' pulse trains toward an even 90 degree train
whose firing order 4 and its multiples dominate (the page's Crossover tab sources; the F-100 README's measured pulls: order 4
on top, order 8 at -7 to -19 dB, others at -16 to -30 dB). The model does this direction: true duals against an H at 2,500
RPM full throttle, round one measured 9-10 dB off the uneven orders and +5.5 dB on order 4. What it does not get is the
level of the even multiples against the rest: the system's own pipe and muffler resonances in the wave model set the
order balance (order 9 strongest at 2,500 RPM on the Mustang), and playback cannot change that honestly.

## 2. Content above the 1-D limit (work item B)

### 2.1 Done: the model's own content, taken up to where it is a prediction

- **Cycle detail** (stage "Cycle detail", default on, `wsndAvg`'s fine average, `SND_NF` = 4,096). Round one averaged each
  run's cycle at 720 points, so its 359th harmonic set the limit at low speed (1,945 Hz at the Mustang's 650 RPM idle). The
  solver's own steps are 1,100 to 6,000 a cycle; the playback cycle is now averaged at 4,096 points from them (the tables
  keep the 720-point averages, so no dB(A) changes). The limit is then the grid or the tip pipe's cross mode.
- **The 10 mm grid** (choice "Solver grid", default 20 mm). The grid limit, c / 8 dx (Lomax, Pulliam and Zingg 2001, 3.3:
  a second-order scheme's wavenumber is 10 % short at 8 cells a wavelength), doubles; then the tip pipe's first cross mode,
  1.84 c / (pi D) (Munjal 2014, 1.3), sets it: 3.8-5.0 kHz on these runs. About four times slower (6 runs of a V8 took 7
  minutes here on a shared 2-core machine). All the listening files below use it.

| limit (Hz) | Mustang idle 650 | Mustang blip | V8 rev, H / X / duals | RS 660 | Outback idle / 1980 |
|---|---|---|---|---|---|
| round one (720 points, 20 mm) | 1,945 | 1,945 | about 2,300 | 2,305 | about 2,200 |
| round two, 20 mm grid | 2,646 | 2,646 | 2,300-2,700 | 2,305 | - |
| round two, 10 mm grid | - | 4,915 | 4,477 / 4,981 / 3,839 | 4,463 | 3,815 / 4,118 |

### 2.2 Evaluated and not done, with the reason

- **(i) Flow noise inside the pipes and the muffler.** The structure is published: Nelson and Morfey (J. Sound Vib. 79,
  1981) give the in-duct sound power of a flow obstruction as W(f) = K(St) A Δp^2 / (4 rho c) below the duct's cut-on (and
  a k^2 form above), St = f d / U, with Δp the element's pressure drop, which the simulation could supply cycle by cycle;
  Kårekull, Efraimsson and Åbom (KTH 2015) scale it by the momentum flux instead; Davies and Holland (Proc. IOA 26(2),
  2004) measured expansion-chamber flow noise rising as M^4.3 to M^5.3; Kunz (SAE 1999-01-1654) fits a Strouhal spectrum
  from cold-flow tests. None of the sources reachable here gives the normalised spectrum K(St) as numbers: Nelson and
  Morfey's is a plotted curve (later reported to need a 6 dB correction, Mak et al., JASA 125, 2009), Oldham and Ukpoho's
  likewise, Kunz's parameters are in the paywalled paper. The one closed law found, the empty-duct power
  Lw = 7 + 50 log U + 10 log A (dB re 1 pW; quoted in Tao, PhD thesis, Southampton 2016, eq. 1.6, for HVAC ducts), has no
  spectrum shape with it and is fitted under 20 m/s; at 100 m/s pulse speeds in a 60 mm pipe it gives about 65 dB at 2 m,
  30-40 dB under the tonal sound, i.e. it would not fill the gap either. Not implemented: a stage whose level constant
  cannot be cited would be an equaliser by another name. Next: obtain Nelson and Morfey's Fig. data or Kunz's
  parameters; the pressure drop per element is already in `mufElems` / `mufBackPressure`.
- **(ii) The model's harmonics above the cut-on, propagated statistically.** Not done. Above the grid limit the solver's
  harmonics are attenuated by its own numerical dissipation (its limiter), so they are not the source's; no cited method
  turns a 1-D solution into a multi-mode source spectrum. "Frequencies: Everything in its cycle" still plays them, labelled
  as not a prediction (it adds 40-50 dB at 4-8 kHz: ablation "noband").
- **(iv) Intake orifice noise.** Not available: in the whole-engine no-load runs the intake mouth is a fixed-pressure
  plenum behind the throttle (wsndSpeedRun), and the solver records only the exhaust's open ends; recording the intake
  mouth needs a solver change (`runSpeed`'s record), which was off limits this round.

### 2.3 Done but off by default: muffler case (shell) radiation (iii)

`sndShellGain`, ported from `sound/realism.py` and extended to every odd-odd mode of each flat face (a simply supported
plate: modal mass rho h ab/4, its net volume velocity 64 ab / (pi^4 m^2 n^2) per unit pressure response; Fahy and Gardonio,
Sound and Structural Vibration, 2007, ch. 2; summed it is realism.py's piston form). It is driven by the pressure inside
the case, which is the simulated tip flow carried back up the tailpipe by its transfer matrix with the open end's radiation
impedance (Levine and Schwinger, as `installedAL`), linear, no mean flow; the case's volume velocity is added beside the tip
in the tip's own convention (gas density x volume velocity; realism.py used the ambient density, 1.6-3x more). Only for a
catalogue case with a published width and height (the Mustang's 9.75 x 4 x 13 in); a round case is stiffness-controlled up
to its ring frequency (about 9 kHz for 7 in) and left out. Wall 1.5 mm and loss factor 0.03 assumed.

Measured: the flat 9.75 x 13 in face has its first mode at 91 Hz, and lightly damped it makes the case louder than the tip
in the lowest octave by up to 24 dB (idle) and 31 dB (2,500 RPM); its largest gain against the tip is 39.5 dB at one
harmonic. No published muffler measurement supports a case that dominates its own tailpipe: a real case is curved, rolled,
often double-wrapped and stiffened by the baffles welded to it, none of which a flat simply supported plate has. So the
stage is offered as an upper bound to listen to ("Muffler case noise: On"), off by default, and none of the listening files
use it.

### 2.4 Where that leaves the top end

Energy above 3 kHz (half the 2-4 kHz band plus everything above, dB re the total, the same measure on every file):
the recordings -13 (RS 660) to -33 dB (Outback); round two's files -18 to -23 dB with the 10 mm grid (the straight-through
-47); the regenerated round-one Mustang -29, with its 4-8 kHz band at -59 against round two's -28 to -34. Above 4-5 kHz the model is still 25-45 dB under the recordings, and above 8 kHz it has
nothing but the jet, 50-70 dB down. What is missing there is not exhaust acoustics the 1-D model can carry: flow noise
(no usable constants), engine mechanical and combustion noise through the block, intake noise, wind and, in the owner's
recordings, the phone's own response. The files are therefore still darker than a car above about 4 kHz; that is a known,
stated gap, not a setting.

## 3. Chambered and multi-chamber mufflers as their inside layout (work item C)

`sndMufLayout` builds the inside from the solver's own elements:

- **Baffled chambers**: n chambers of the case's bore in series, each pair joined by the baffle hole as a short tube of the
  hole's bore, length plate + 0.785 d (Morse and Ingard's end correction, the inertance the Mufflers tab's `calcBaffles`
  uses). The Mufflers tab plays it when "Baffled chambers in the shell" is 2 or more (its hole and plate sizes).
- **A catalogue chambered muffler**: its inside is not published, so a *generic* layout: two chambers (three where the
  maker's description says three, e.g. Flowmaster's 50 Series), a hole the pipe's bore through a 1.5 mm plate. "Playing"
  names it as generic and "Not in the sound" says the maker's baffles are not modelled.
- **Turbo-style (three-pass), generic**: the case as two equal chambers (Yasuda et al. 2013: equal volumes give the lowest
  cut-off), each entered and left through the same baffle, so each a flow-reversing chamber, run as a closed stub of the
  case's bore and half its length off a node (Munjal 1987, 3.7), joined by the return tube and left by the outlet tube.
- **Extended inlets/outlets** stay side pockets (round one). **Straight-through packed** is round one's perforated core
  with the packing's transfer-matrix loss.
- **Catalytic converter**: not added. A monolith is about 3,000 parallel 1 mm channels in laminar flow (friction factor
  64 / Re); the solver's pipes carry a turbulent wall-friction law, and the parallel-path element cannot hold thousands of
  paths, so no cited pressure-drop law can be represented. Still listed under "Not in the sound".

**Insertion-loss check** (ilcheck.js; the default 4-Stroke engine, one collector, firing at a fixed 35 kPa manifold so the
source is the same with and without the muffler; 7 speeds 800-2,500 RPM; the present orders within 20 dB of each run's
strongest; octave-band medians):

| layout, band | wave model IL | transfer matrix, constant-velocity source | transfer matrix, anechoic source | off by (nearer) |
|---|---|---|---|---|
| two baffled chambers, 40-80 Hz | 6.0 | 3.6 | -4.9 | 2.4 |
| 80-160 Hz | -1.1 | 1.1 | 7.8 | 2.2 |
| 160-320 Hz | 4.7 | 11.7 | 10.1 | 5.4 |
| 320-640 Hz | 1.1 | 0.1 | 0.4 | 0.7 |
| three-pass, 40-80 Hz | 7.1 | 10.2 | -2.4 | 3.2 |
| 80-160 Hz | -2.0 | 3.0 | 8.6 | 4.9 |
| 160-320 Hz | 3.9 | 8.0 | 5.2 | 1.3 |
| 320-640 Hz | -2.7 | 18.1 | 22.5 | 20.8 |

Stated tolerance, pinned in wsndreal_ui: within 6 dB of the nearer source model in every octave band from 40 to 320 Hz,
for both layouts (met). Above 320 Hz the three-pass misses its stub (quarter-wave) resonance near 520 Hz by 21 dB: the
transfer matrix has still gas in the stubs at the tip's temperature, while in the solver a dead-end branch fills with
hot pipe gas and keeps its heat (round one's resonator finding, section 5 there), which moves and spreads the resonance;
the other agent's branch-temperature change in the solver is the fix. Per order the two disagree by more (single orders
5-30 dB: the engine is neither source model, and the solver's cycles vary 10-20 % from one to the next), so only the band
medians are pinned. With the source held fixed the no-load runs' pressure search is avoided: run at no load the IL
comparison was not meaningful (the muffler's back pressure changes the found manifold pressure, and so the source).

What the layout did to the measured V8 gap: at idle the 250-500 Hz band rose 19 dB against round one's empty case (the
dome moved up), 500-1k 6 dB; at 2,500 RPM 250-500 Hz rose 5.5 dB and 500 Hz-2 kHz fell 6-10 dB. The dB(A) tables follow
(the simulated system changed): "Hear my exhaust" on the Mustang is a different run set now (blip), and its 2,500 RPM
no-load design row in wsndreal_ui still takes 17 dB or so off the orders above 300 Hz against open headers (section 8).

## 4. The listening position (work item D)

"Where you are" now offers: **Standing behind the car** (default for "Hear my exhaust": 6 ft, 1.83 m, behind the tips,
editable; ears 5.25 ft, tip 1 ft; image source 2.45 m from the tip against a direct 2.27 m, path difference 0.374 m, first
reflection null 459 Hz); **At the roadside** at the table's distance (25 ft, 7.62 m; difference 0.123 m, first null
1,394 Hz); and **As the table** (+6 dB, coincident ground). The ground ("Ground") is asphalt or concrete by default
(Nord2000 class G, flow resistivity 20,000 kPa s/m^2), grass (class D, 200), or the perfect mirror round one used; the
reflection is Delany and Bazley's impedance with the spherical-wave reflection coefficient (Attenborough, Li and
Horoshenkov 2007, 2.5; the Faddeeva function by Humlicek's W4, checked: W(1) = 0.3679 + 0.6072i, W(1+i) = 0.3047 + 0.2082i).
For asphalt |Q| is 0.999 at 50 Hz and 0.979 at 2 kHz here, so the comb is nearly the mirror's; over grass it is 0.96 at
100 Hz and 0.56 at 2 kHz. The dB(A) table stays the old reckoning at its distance; the reverb's impulse response follows the
listening distance.

## 5. Idle roughness (work item E)

Cited figures used (stage "Idle", default on, `SND_IDLE`): the coefficient of variation of IMEP at a closed-throttle idle
10 % (Han and Hwang, J. Energy Engineering 22(2), 2013: "slightly under 10 %" at the idle spark timing, 800 RPM; Heywood
9.4's driveability limit about 10 %), against round one's 8 %, blended in with closed throttle and speed below 2,500 RPM.
Partial burns: with a normal spread at 10 % the weakest of about a thousand cycles is near 0.7 of the mean, which is the
lowest normalised IMEP Han and Hwang accept, so no separate partial-burn term is added; a misfire is the existing "Hear a
misfire". Speed hunting: the owner's Outback idle, measured (analyze.py track, 14-26 s): 1.36 % RMS, 95 % of it below 1 Hz,
1/e correlation 1.7 s (round one's wander had 0.5 s). The RS 660's idle track is 66 % above 3 Hz, which is the tracker on
a noisy signal (its tonal-to-noise ratio is -7 dB), so it is not used.

Measured (analyze.py, cycle-to-cycle RMS COV / firing-to-firing COV / order jitter): Outback idle recording 16.8 % / 19.7 % /
1.65 dB; round one 4.6 / 6.5 / 0.52; round two 5.7 / 8.1 / 0.67 (mic on the ground at 3.3 ft, 10 mm grid). The gap is
still a factor of three. Part of the recordings' spread is other noise in the frame (their tonal-to-noise ratio is 11.5 dB
at the Outback idle), and part is that the exhaust pulse varies more than IMEP does (a slow burn lowers IMEP but raises the
pressure at exhaust opening); no cited figure for the pulse's own spread was found, so the stage uses IMEP's. Next: run the
wave model with the burn duration varied by the cited spread and take the pulse's spread from the model itself.

## 6. Transients (work item F)

"Hear my exhaust" now plays **idle, a blip and back**: the idle with no load, full throttle at three speeds up to the blip's
top (0.45 x the redline: 3,300 RPM on the Mustang), and the fuel cut at two speeds (every cylinder not firing, the throttle
closed; its manifold pressure from the idle's, falling as 1 / speed as a choked throttle passes a fixed air flow, Heywood
App. C; not under 15 kPa). The speed comes from J dw/dt = T with the model's own torque: full throttle (net indicated torque
less friction, FMEP = 0.5 + 0.012 rpm/60 bar, the law the no-load runs meet) to the top; the fuel cut (the motored runs'
torque) down to 400 RPM above idle, where fuel is assumed back; then the closed throttle fired, whose indicated torque is the
idle's friction torque x idle / rpm (the same choked throttle), which brings it back to idle. J is not an input: 0.28 kg m^2
for 5.0 L (a 30 lb, 8 in steel flywheel as a disk, the Engine Simulator V8 script's), scaled with displacement (0.037 for
the RS 660), assumed. Played: the runs of the current condition interpolated by speed, changed over in 60 ms.

Mustang: 650 to 3,300 RPM in 0.17 s at 509 N m less friction, the fuel cut (-87 N m) down to 1,050 RPM by 3.0 s, idle by
5.1 s; 6.6 s in all. The rise is quicker than a real blip because the manifold's filling lag and the driver's throttle
travel are not modelled. Not modelled either: the exhaust's transport delay, and the overrun's crackle (unburned fuel
burning in the pipe needs combustion in the exhaust, which the solver has not got). "Idle, then a slow rev" (no-load runs,
idle 2.5 s, 5 s up, 1.5 s held) is the other new way to play; the old "Idle, a rev and back" stays.

## 7. The RS 660 (work item G)

`rs660_stock.js`: two stepped primaries (35.5 mm for 225 mm, then 48 mm; 575 and 625 mm), the 58 mm x 100 mm Y, the catalyst
as an 85 x 115 mm bore, the 10 L under-engine box as two chambers of a 196 mm bore joined by a 58 mm hole (generic), its two
40 x 120 mm outlets as one pipe of their summed area: model/rs660.py's estimates (nothing dimensional is published,
stock_exhaust_research.md). Its sound: idle 2 s, full throttle to 5,460 RPM, held 2 s, the fuel cut down, idle: the
recording's shape. Holds heard where the recording's microphone was (on the ground, 3 ft behind; analyze.py octaves
31 Hz-16 kHz):

| RS 660 idle 1,442 RPM | recording | round one model | round two model |
|---|---|---|---|
| octaves 31..16k | -19.9 / -6.6 / -3.3 / -9.0 / -15.3 / -11.3 / -13.4 / -17.0 / -23.0 / -36.7 | -13.3 / -4.9 / -4.3 / -6.3 / -20.2 / -22.1 / -20.8 / -88.7 / -92.6 / -91.4 | -16.2 / -6.3 / -3.3 / -5.9 / -21.5 / -30.2 / -25.4 / -41.7 / -92.3 / -91.9 |
| gap between orders (dB) | 3.2 | 12.5 | 11.0 |
| cycle-to-cycle RMS COV (%) | 19.2 | 4.2 | 4.7 |
| slope to 8 kHz (dB/oct) | -1.8 | -12.4 | -9.1 |
| speed wander (%) | 5.19 | 1.22 | 1.28 |

| RS 660 hold 5,460 RPM | recording | round one | round two |
|---|---|---|---|
| octaves 31..16k | -24.9 / -15.8 / -2.9 / -5.9 / -15.1 / -13.5 / -12.0 / -13.5 / -18.3 / -34.0 | -37.9 / -23.5 / -5.4 / -3.0 / -9.6 / -12.1 / -14.9 / -70.9 / -73.5 / -76.4 | -35.8 / -25.3 / -7.9 / -2.3 / -7.3 / -14.6 / -15.3 / -31.1 / -75.3 / -79.0 |
| gap between orders (dB) | 17.7 | 25.1 | 25.9 |
| cycle-to-cycle RMS COV (%) | 9.2 | 2.1 | 2.1 |
| slope (dB/oct) | -0.7 | -15.0 | -12.4 |

(Round one here is the same estimated system with the box as one straight bore, all new stages off, 20 mm grid; round two
the two-chamber box, the new stages and the 10 mm grid.) The 4 kHz octave rose 40-47 dB and is still 18-25 dB under the
recording; 8 kHz and up is unchanged (nothing there). The box's two chambers take 1-2 kHz further from the recording at
idle (-30 against -11): the stock box's inside is unknown, so this is the generic layout's sound, not the bike's.

## 8. Outback hold, real against round one and round two

| Outback | recording idle 735 | round one idle | round two idle | recording 1,980 | round one 1,980 | round two 1,980 |
|---|---|---|---|---|---|---|
| octaves 62..16k (analyze.py) | -4.1 / -2.3 / -19.9 / -25.2 / -28.7 / -33.0 / -33.9 / -38.1 / -53.6 | -0.4 / -11.6 / -27.9 / -21.7 / -23.3 / -34.0 / -86.1 / -91.7 / -91.4 | -0.9 / -10.4 / -21.2 / -15.4 / -13.1 / -23.1 / -39.2 / -91.6 / -76.8 | -0.5 / -10.1 / -20.0 / -28.6 / -30.2 / -32.4 / -34.5 / -36.4 / -50.8 | -0.8 / -10.6 / -16.9 / -13.6 / -18.7 / -28.0 / -83.4 / -90.1 / -91.7 | -2.2 / -9.5 / -10.4 / -9.1 / -12.4 / -18.2 / -33.3 / -88.9 / -89.1 |
| gap between orders (dB) | 6.3 | 4.9 | 4.3 | 24.6 | 26.7 | 20.9 |
| cycle-to-cycle RMS COV (%) | 16.8 | 4.6 | 5.7 | 1.3 | 2.4 | 2.7 |
| speed wander / short-time (%) | 1.36 / 0.27 | 1.11 / 0.39 | 1.24 / 0.28 | 1.12 / 0.06 | 1.16 / 0.54 | 1.28 / 0.44 |
| slope (dB/oct) | -5.1 | -11.9 | -9.4 | -3.4 | -14.9 | -12.8 |

(Round one: its report's "after" column, ear 5.25 ft at 3.3 ft. Round two: the microphone on the ground at 3.3 ft as the
recording's was, asphalt, 10 mm grid.) The 4 kHz octave (the 7th value) rose 47-50 dB and is within 5 dB (idle) and 1 dB
(1,980) of the recording; 8 kHz and up is still empty; 500 Hz-2 kHz is now too strong by 10-20 dB: with the microphone on the ground there is no
comb to hide the wave model's own mid-range, which is the order balance of section 1.4, not playback.

## 9. The listening files (sound_ab2, 48 kHz 16-bit mono, peak-normalised to 0.9, reverb off)

All in `/tmp/claude-0/-home-claude/edc59f9c-4fbd-54e8-940b-111545c463b9/scratchpad/sound_ab2/` (not in the repository).
The 2018-20 Mustang GT is the engine of every V8 file (Quick's "Fill in every tab", 180 in head to tip: 1.62 in x 32.2 in
primaries, 2.37 in line, the build sheet's 12.1 L Helmholtz can at 27.8 in, the H-pipe 12 in behind the collectors, the
chosen 9.75 x 4 x 13 in chambered muffler, 26.4 in tailpipe, both tips). Round-two files: 10 mm grid, the listener 6 ft
behind the tips on asphalt, fine cycle, idle stage, case noise off, reverb off.

| file | what is in the signal | energy above 3 kHz (dB re total) |
|---|---|---|
| mustang_gt_round1.wav | round one's "Hear my exhaust" regenerated: no-load runs at 650, 1,500, 3,300 RPM (20 mm grid), the muffler as one empty case, played idle, a rev and back with every round-two stage off, 25 ft roadside, hard mirror ground | -28.6 |
| mustang_gt_round2.wav | idle 650 with no load, a blip to 3,300 (full-throttle runs at 1,600 / 2,500 / 3,300, the fuel cut at 2,000 / 3,300, the speed from the inertia balance), back to idle; the muffler as two generic chambers; 6.6 s | -22.6 |
| v8_true_duals_r2.wav | the same engine and mufflers with no crossover; no-load runs at 650 / 1,500 / 2,500 / 4,000, idle 2.5 s then a slow rev to 4,000 (5 s) held 1.5 s | -18.4 |
| v8_h_pipe_r2.wav | the same with the H-pipe (12 in behind the collectors, 3.5 x 1.90 in tube) | -22.7 |
| v8_x_pipe_r2.wav | the same with an X-pipe at the same place | -19.2 |
| v8_flowmaster_style.wav | the H-pipe system with the chambered muffler as its generic two-chamber inside (the same runs as v8_h_pipe_r2.wav, so the same file) | -22.7 |
| v8_straight_through.wav | the H-pipe system with a straight-through packed muffler of the same case (perforated core, the Mufflers tab's 100 kg/m3 packing as round one's transfer-matrix loss) | -46.6 |
| rs660_round2.wav | the RS 660 stock-system estimate (section 7): idle 1,442, full throttle to 5,460, held 2 s with no load, the fuel cut down, back to idle; 9.8 s | -21.2 |

The recordings by the same measure: the RS 660's whole clip -13.4 dB (idle -15.1, hold -11.9), the Outback idle -32.8,
its 1,980 RPM hold -32.4. Octave bands of the files (20-60 ... above 8k): Mustang round one -8.8 / -12.5 / -8.6 / -4.0 /
-5.8 / -22.2 / -25.6 / -59.4 / -60.8; round two -10.6 / -6.6 / -5.5 / -7.2 / -8.2 / -11.8 / -19.9 / -34.0 / -52.0 (the
reviewer measured round one's file at -21.8 / -15.7 / -10.5 / -1.8 / -6.9 / -23.1 / -25.0 / -67.8 / -69.2; the regenerated
file differs mostly in its lowest band). Peak-normalised, so the files play at the same peak level, not at their model
levels; the straight-through's darker sound is the packing's transfer-matrix loss applied to the outflow (round one's
method), which may be stronger than a real glass-pack's at 1-4 kHz.

## 10. What still differs, and why

- **Above 4-5 kHz**: the 1-D model's limit (grid and cross mode); flow, mechanical, combustion and intake noise absent
  (section 2.2). The files are darker than a car there.
- **Order balance**: which orders are strong is the wave model's pipes and muffler (order 9 on top at 2,500 RPM full
  throttle on the Mustang; 500 Hz-2 kHz too strong against the Outback recording at the ground microphone).
- **Idle roughness**: a factor of three short on the cycle-to-cycle spread with the cited IMEP figure.
- **The blip**: no manifold filling lag, so the rise is quicker than a real one; the flywheel inertia is assumed; no
  overrun crackle; fuel-back speed assumed.
- **Muffler insides are generic** for catalogue parts; the three-pass's stub resonance runs hot in the solver.
- **Catalytic converters**, **Y-merge**, **intake**: not in the sound.
- **Case noise**: modelled, but its flat-plate form overstates it, so it is off.

## 11. Tests

Run one at a time on the final code (2-core machine shared with another agent):

- `wsndreal_ui.js` (extended, 45 checks): @@REAL@@
- `wsnd_ui` 26 pass; `wsndwav_ui` 7; `wsndpar_ui` 8; `wsndxo_ui` 7; `wsndmis_ui` 18; `wsndload_ui` 11; `rec_ui` 17 pass, its
  OpenWAM part skipped (no INS.DAT here); `sound_ui` pass; `progress_ui` 34; `ui_ui` 312; `incremental_ui` all passed;
  `staleness_ui` all passed (12); `jobs_ui` 59, all pass.

Changed pins in wsndreal_ui, each following from a change of the simulated system or of the default: "Hear my exhaust" now
runs the idle, full throttle and the fuel cut and plays the blip (was three no-load speeds, "show"); the Mustang's chambered
muffler is now said as a generic inside ("maker's own baffles", was "internal chambers"), and its design line names the
two chambers; the reverb's impulse response is taken at the listening distance (6 ft behind by default, was the table's
25 ft). No other test changed. The dB(A) tables: unchanged for the same runs (the fine cycle feeds playback only); they
change where the simulated system changed (a catalogue chambered or turbo muffler now runs its generic inside), which
wsndreal_ui's Mustang check shows.
