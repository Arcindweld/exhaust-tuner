# Sound realism, 2026-11-21: why "Hear the model" did not sound like a car, and what changed

The owner (a former sound engineer) said the generated sound "doesn't seem right, it doesn't sound like a car at all",
then asked to hear his whole exhaust system, the effect of each part and of moving a part, and a listening space with a
reverb switch. This note gives the measurement method, the measured causes in order of size, each fix with its source,
the before and after tables against the owner's recordings, an audit of which designed parts are in the played signal,
and what is still missing. Nobody has listened to the result yet: the owner must.

## 1. Method

`tools/sound/analyze.py WAV --t0 --t1 --rpm --fire` measures one steady stretch of a WAV the same way whatever made it:

- octave and third-octave band levels relative to the total; the slope (dB per octave) of the third-octave levels from
  twice the firing frequency to 8 kHz;
- the speed: a harmonic-comb tracker (half orders 1 to 24, the firing order and its multiples weighted double, frames of
  at least three 720-degree cycles) refined by the phase advance of the strongest half order between frames (phase
  vocoder); its standard deviation (wander) and the part left after a 1 s moving average (short-time jitter);
- along that track, the signal resampled to 2048 points per cycle: the tonal-to-noise ratio (energy within one bin of the
  half orders against the rest, 40 Hz to 4 kHz), the cycle-to-cycle and firing-to-firing RMS spread, and the
  cycle-to-cycle spread (dB) of the six strongest half orders;
- the gap between the orders: for every half order within 30 dB of the strongest, its level (Welch, 0.5 s Hann) less
  the lowest level in the middle half of the way to the next half order; the median;
- the envelope (Hilbert, 50 Hz to 5 kHz) modulation depth in 0.3-2 Hz and in 2 Hz to half the cycle rate;
- the crest factor after a 30 Hz high-pass.

`tools/sound/render_page.js SPEC OUT rpm` runs the page's own wave model (`wsndSpeedRun`, no load) on an OpenWAM
validation spec (the Outback's and the RS 660's, their silencer volumes as straight bores of the same volume, the RS 660's
two outlets as one pipe of their summed area) and plays it through the page's sound path, old (`--old`) or new, into a
temporary WAV. The recordings and the WAVs were never copied into the repository; only the numbers below are.

Recordings (the owner's, read in place; phone-class microphones, so only relative figures are used):
Outback 2.5i (flat four, mic on the ground 3 ft behind and 1.5 ft right of the downturned tip): idle 14-26 s (735 rpm),
no-load hold 28.5-33.5 s (1978 rpm) of `full_idle_revs.wav`. RS 660 (270-degree twin, mic on the ground about 3 ft behind):
idle 27.5-31 s (1442 rpm), hold 24.2-26.4 s (5460 rpm) of `idle_to_5500.wav`.

## 2. What was wrong, by measured size

The default page plays "the headers and collector, open" for one collector, 4 of the default V8's 8 cylinders, because
no line after the collector is set; Estimate at 2500 RPM and Play A gave a 4 s perfectly steady tone. Measured:

| cause | measure | recordings | old playback |
|---|---|---|---|
| (a) no speed wander, too little variation | gap between the orders, median | 3.2-24.6 dB | 11.6-49.1 dB (35-49 at holds) |
| | speed wander, std | 1.1-5.2 % | 0.00-0.04 % |
| | order level jitter, cycle to cycle | 1.0-5.8 dB | 0.2-0.5 dB |
| | envelope modulation 0.3-2 Hz | 1.4-9.9 % | 1.6-1.7 % |
| (f) straight-line resampling of the 720-point cycle | 16 kHz octave re total, Outback | -51 to -54 dB | -30 to -32 dB |
| | energy above the model's validity limit (default V8, idle) | - | 25-35 dB more than the band-limited signal |
| (e)+(d) open headers, half an engine | what is played | a car with its system | 4 cylinders of 8, no pipe, no muffler |
| (g) a static hold | | idle, revs | one speed, 4 s |
| (b) high end | octave 500 Hz-1 kHz re total, Outback | -25 to -30 dB | -10 to -20 dB |
| (c) no listening path | | ground comb, air | +6 dB flat |
| (i) level, mono | crest factor | 5.5-14.2 dB | 8.5-19.8 dB |

(h) Shell, mechanical and intake noise are absent in both old and new (section 6).

Ranking by size: the variability (gaps 10-35 dB too deep, no speed wander at all) is the largest and the one a listener
calls "an organ pipe"; then the playback artefact (images of the firing pulses at 8-16 kHz from linear interpolation of
a 720-point cycle, plus a gain step at the cycle boundary where a firing window wrapped round: a click every cycle); then
what is played (open headers, half the engine, one speed).

## 3. What changed (each stage switchable on the Sound tab, and said in its caption)

1. **Band-limited synthesis** (`sndPrep`, `sndSynth`). Each run's averaged cycle is kept as its harmonics, only below the
   lowest of: the tip pipe's first cross mode, f = 1.84 c / (pi D) at the tip gas temperature (above it a 1-D plane-wave
   model says nothing; Munjal, Acoustics of Ducts and Mufflers, 2014, 1.3); the solver's grid at 8 cells per wavelength
   (a second-order scheme's modified wavenumber sin(k dx)/dx is then 10 % short; Lomax, Pulliam and Zingg, Fundamentals of
   CFD, 2001, 3.3; the solver is MUSCL-Hancock with HLLC at 20 mm cells); and the 720-point cycle's own Nyquist (359 half
   orders). Per 20 ms block the harmonics of the two runs either side of the current speed are interpolated in dB and
   phase (as `recPull` already did), made into a 4096-point band-limited cycle and its slope by one inverse transform, and
   read with cubic interpolation along the integrated speed. The pressure is d/dt of the pulse train (the open end a
   compact monopole), worked out analytically, so there is no finite-difference noise. Above the limit only the jet noise
   (Lighthill, unchanged) is played; the caption gives the limit and which of the three set it. "Frequencies: Everything
   in its cycle" turns the limit off for comparison.
2. **Measured engine statistics** (`sndCov`, `SND_SPREAD`, `SND_WANDER`), seeded. Every firing's pulse is scaled by
   1 + s_c + cov N(0,1) inside a smooth window around that firing (Gaussian windows normalised to add to one, each firing
   indexed by its own nearest occurrence so a window crossing the cycle boundary keeps one gain). cov, the coefficient of
   variation of IMEP, from Heywood's ranges (Internal Combustion Engine Fundamentals, 1988, 9.4: 1-3 % at part load,
   5-10 % near idle): 1.5 % at full throttle, 3 % closed throttle at speed, 8 % closed throttle at idle, linear in manifold
   pressure (20-100 kPa) and speed (2500 down to 1000 RPM). s_c: a steady 2 % RMS cylinder-to-cylinder offset (Heywood
   9.4.1, "a few per cent"). Speed: an Ornstein-Uhlenbeck wander, 0.5 s correlation (sound/realism.py), 1.2 % RMS with no
   load (the owner's Outback: 1.1 % at its hold, 1.4 % at idle, measured above) and 0.3 % under load (the short-time part
   of the measured holds, 0.06-0.47 %). The firing windows sit at the engine's own firing angles (`phases`, now carried by
   every run), aligned to the outflow's pulse energy, so an uneven 270-degree twin or a V8 bank is right.
3. **Listening path** (`sndPath`): the listener at the table's distance, ear 5.25 ft (1.6 m) and tip 1 ft (0.30 m) up
   (both editable); hard ground as an image source (reflection coefficient 1, ISO 9613-2's G = 0) giving the comb a
   standing person hears; air absorption on both paths, ISO 9613-1 at 20 C, 70 % (checked: 4.98 dB/km at 1 kHz, as the
   standard's table). The table's dB(A) are still computed from the model's signal with +6 dB, unchanged; "Where you are:
   As the table" plays exactly that reckoning.
4. **Whole engine** (`wsndWholeSpec`): when the 4-Stroke tab models one collector of a multi-collector engine, every
   cylinder runs with the Headers tab's grouping (which cylinders join, at which firing angle: the same data its
   unequal-length run uses) and the 4-Stroke tab's primaries and collector on each; both exits are heard (summed with the
   OpenWAM panel's microphone layout, as before). Only "Hear my exhaust" and the compare buttons ask for it, so
   "Estimate the sound" keeps its tested behaviour.
5. **The system the owner set up** (`wsndAutoSys`), for the sound only, written nowhere else: the OpenWAM line when it is
   on; else the Quick build once "Fill in every tab" has put its pipe on the Mufflers tab (its cone, pipe, build-sheet
   resonator at its place, the chosen muffler's case, the crossover); else the Mufflers tab's pipe, head-to-tip length,
   chamber and tailpipe. "Playing: ..." above the buttons names every part with links to where each is set, and
   "Not in the sound: ..." lists what the line cannot carry. Open headers get the warning "This is open headers with no
   exhaust system; it will sound like a race engine on open pipes" with one click to the system.
6. **A listening experience** (`wsndListen`, "Hear my exhaust"): idle, a middle and a higher speed with no load, then
   idle 2.5 s, up to the middle speed, held, up to the top, held, and back to the idle hold through a 0.25 s cross-fade.
   No decel is played: a closed-throttle overrun is not one of the runs. The hold, drive-past and pull remain.
7. **The model beside a recording** (`recSynth`) now uses the same band-limited core; its level is still the
   recording's RMS.
8. **Where you are listening (reverb)**: a "Reverb: off / on" switch beside the play buttons (a button with
   aria-pressed, its state in words; while a sound plays it acts at once through the wet gain) and four spaces made from
   stated geometry (`SND_SPACES`, `sndSpaceIR`): image sources for the box (Allen and Berkley 1979) with per-face octave
   absorption (Everest and Pohlmann, Master Handbook of Acoustics, 2009, appendix), then for enclosed spaces a noise tail
   per octave band at the diffuse-field level (4 pi c / V, Kuttruff, Room Acoustics, 2009, 5.1) decaying with the Eyring
   time; two ears 0.17 m apart, no head model. The dry sound (direct and ground) is untouched, so its level and the
   table do not change; the saved WAV is stereo when the switch is on and equals dry + the offline convolution. A loaded
   impulse response (any rate, resampled to 48 kHz by the browser) is normalised to its direct sound and kept for the
   session only. Off by default: open air is the reference for comparing parts.
9. **Comparing parts**: "Compare: true duals, H-pipe and X-pipe", "a resonator at 3 ft and at 6 ft", "a megaphone into the
   pipe and a plain step" run the played system with one thing changed; "B against A" beside the play buttons gives the
   dB(A) difference and the four orders that change most.

## 4. Real against model, before and after

"Before" is the old playback (one cycle repeated, 2 % pulse variation, no wander, straight-line resampling); "after" the
new one with its defaults (variation on, band limit on, standing 25 ft (7.6 m) away: here the validation runs use the
recordings' 1 m (3.3 ft) at 5.25 ft (1.6 m) ear height, which puts a ground comb in that the recordings, with the mic on the
ground, do not have; the gap, variability and slope figures are little affected). Same model runs (the page's wave model,
no load, on the OpenWAM validation specs), same analysis. Both model columns lack everything that is not exhaust flow
(section 6), which the recordings have: that is most of the recordings' 2-16 kHz content and of the RS 660 idle's noise
(its tonal-to-noise ratio is negative: the engine, not the exhaust, dominates on the ground 3 ft behind a bike).

**Outback idle 735 rpm** (recording / model before / model after)

| measure | recording | before | after |
|---|---|---|---|
| speed wander, std (%) | 1.36 | 0.00 | 1.11 |
| short-time speed jitter (%) | 0.27 | 0.00 | 0.39 |
| tonal-to-noise (dB) | 11.5 | 22.3 | 16.9 |
| gap between orders, median (dB) | 6.3 | 11.6 | 4.9 |
| cycle-to-cycle RMS COV (%) | 16.8 | 1.8 | 4.6 |
| firing-to-firing RMS COV (%) | 19.7 | 3.5 | 6.5 |
| order level jitter, cycle to cycle (dB) | 1.65 | 0.54 | 0.52 |
| envelope modulation 0.3-2 Hz (%) | 6.5 | 1.7 | 4.5 |
| envelope modulation 2 Hz-cycle/2 (%) | 4.9 | 1.3 | 2.9 |
| crest factor (dB) | 14.1 | 19.8 | 9.5 |
| slope above 2x firing to 8 kHz (dB/oct) | -5.1 | -3.7 | -11.9 |
| octave bands re total (dB) 62 Hz..16 kHz | -4.1 / -2.3 / -19.9 / -25.2 / -28.7 / -33.0 / -33.9 / -38.1 / -53.6 | -0.6 / -10.8 / -23.1 / -18.3 / -20.4 / -34.5 / -27.4 / -31.3 / -30.3 | -0.4 / -11.6 / -27.9 / -21.7 / -23.3 / -34.0 / -86.1 / -91.7 / -91.4 |

**Outback no-load hold 1980 rpm** (recording / model before / model after)

| measure | recording | before | after |
|---|---|---|---|
| speed wander, std (%) | 1.12 | 0.04 | 1.16 |
| short-time speed jitter (%) | 0.06 | 0.03 | 0.54 |
| tonal-to-noise (dB) | 21.8 | 26.8 | 16.2 |
| gap between orders, median (dB) | 24.6 | 35.2 | 26.7 |
| cycle-to-cycle RMS COV (%) | 1.3 | 1.5 | 2.4 |
| firing-to-firing RMS COV (%) | 1.9 | 3.7 | 3.6 |
| order level jitter, cycle to cycle (dB) | 0.98 | 0.27 | 0.43 |
| envelope modulation 0.3-2 Hz (%) | 1.4 | 1.7 | 1.8 |
| envelope modulation 2 Hz-cycle/2 (%) | 1.5 | 3.6 | 2.1 |
| crest factor (dB) | 5.5 | 14.3 | 8.0 |
| slope above 2x firing to 8 kHz (dB/oct) | -3.4 | -6.1 | -14.9 |
| octave bands re total (dB) 62 Hz..16 kHz | -0.5 / -10.1 / -20.0 / -28.6 / -30.2 / -32.4 / -34.5 / -36.4 / -50.8 | -1.4 / -9.6 / -13.1 / -10.4 / -17.1 / -26.3 / -37.7 / -35.0 / -32.1 | -0.8 / -10.6 / -16.9 / -13.6 / -18.7 / -28.0 / -83.4 / -90.1 / -91.7 |

**RS 660 idle 1442 rpm** (recording / model before / model after)

| measure | recording | before | after |
|---|---|---|---|
| speed wander, std (%) | 5.19 | 0.01 | 1.15 |
| short-time speed jitter (%) | 3.24 | 0.01 | 0.52 |
| tonal-to-noise (dB) | -7.2 | 27.9 | 16.6 |
| gap between orders, median (dB) | 3.2 | 37.8 | 13.7 |
| cycle-to-cycle RMS COV (%) | 19.2 | 1.5 | 4.0 |
| firing-to-firing RMS COV (%) | 25.5 | 2.2 | 4.3 |
| order level jitter, cycle to cycle (dB) | 5.75 | 0.19 | 0.41 |
| envelope modulation 0.3-2 Hz (%) | 9.9 | 1.7 | 2.7 |
| envelope modulation 2 Hz-cycle/2 (%) | 8.7 | 2.8 | 2.5 |
| crest factor (dB) | 14.2 | 10.2 | 8.9 |
| slope above 2x firing to 8 kHz (dB/oct) | -1.8 | -4.3 | -11.9 |
| octave bands re total (dB) 62 Hz..16 kHz | -6.6 / -3.3 / -9.0 / -15.3 / -11.3 / -13.4 / -17.0 / -23.0 / -36.7 | -4.9 / -4.3 / -6.3 / -20.2 / -22.0 / -20.6 / -38.7 / -28.7 / -34.2 | -3.9 / -3.9 / -9.8 / -20.8 / -22.8 / -23.8 / -85.0 / -91.5 / -91.9 |

**RS 660 hold 5460 rpm** (recording / model before / model after)

| measure | recording | before | after |
|---|---|---|---|
| speed wander, std (%) | 1.25 | 0.00 | 1.16 |
| short-time speed jitter (%) | 0.47 | 0.00 | 0.54 |
| tonal-to-noise (dB) | 5.1 | 26.8 | 8.8 |
| gap between orders, median (dB) | 17.7 | 48.7 | 27.3 |
| cycle-to-cycle RMS COV (%) | 9.2 | 3.1 | 2.1 |
| firing-to-firing RMS COV (%) | 11.5 | 4.3 | 2.8 |
| order level jitter, cycle to cycle (dB) | 2.54 | 0.41 | 0.26 |
| envelope modulation 0.3-2 Hz (%) | 7.3 | 1.6 | 0.6 |
| envelope modulation 2 Hz-cycle/2 (%) | 8.4 | 5.3 | 2.0 |
| crest factor (dB) | 10.3 | 12.3 | 12.4 |
| slope above 2x firing to 8 kHz (dB/oct) | -0.7 | -3.1 | -12.1 |
| octave bands re total (dB) 62 Hz..16 kHz | -15.8 / -2.9 / -5.9 / -15.1 / -13.5 / -12.0 / -13.5 / -18.3 / -34.0 | -30.9 / -5.5 / -3.1 / -9.5 / -11.4 / -13.9 / -23.7 / -29.2 / -35.1 | -20.6 / -3.1 / -5.7 / -9.4 / -11.6 / -13.3 / -64.8 / -69.2 / -72.6 |


The slope row runs to 8 kHz; "after" falls off a cliff at the validity limit (2.2-2.4 kHz here), because nothing above it
is played as a prediction. Up to the limit the after slope is -6.6 dB per octave on the default V8's system at idle
(wsndreal_ui), against -3.4 to -5.1 in the Outback recordings to 8 kHz.

Default V8 on the default page ("Hear my exhaust": the Mufflers tab's 2.37 in (60.2 mm) pipe and 6 x 14 in (152 x 356 mm)
chamber, every cylinder), idle 750 RPM hold, from wsndreal_ui: gap between the orders 10.2 dB (old playback of the same
runs 31.2 dB, variation off 34.5 dB); share of the energy exactly on the orders 72 % (old 99.1 %); above the 2244 Hz limit
-82 dB re the total with the jet off. On the default Estimate (open headers, one collector, 2500 RPM full throttle) the
old playback put -27.7 dB of the total above 8 kHz with no jet and no variation (the straight-line resampling and
differencing of the 720-point cycle, the reviewer's 8-16 kHz rise); the new one -66 dB.

## 5. Parts audit: which designed parts are in the played signal

"In the signal" means in the wave simulation whose tip flow is played (the Sound tab's estimate, "Hear my exhaust",
the compare buttons, "Hear each part"); "position" means that moving the part along the system changes the run.

| part | in the played signal | position in the signal |
|---|---|---|
| primaries, equal (4-Stroke tab) | yes, each cylinder's own pipe, steps and tapers as segments | yes (length) |
| primaries, unequal (Headers tab, unequal lengths) | yes, every cylinder and every exit (`uelLayoutSpec`) | yes |
| 4-1 collector and merge cone | yes (merge cone and straight as segments; the junction one shared pressure) | yes |
| Tri-Y | yes on the Headers tab's unequal-length layout; the 4-Stroke tab's own header is a 4-1 | yes |
| 180-degree header (collectors across the banks) | yes: the collectors' grouping and firing angles come from the Headers tab | n/a |
| merge loss from the exhaust CFD (K) | no: written into the OpenWAM case only | - |
| megaphone on the 4-Stroke tab's collector | yes (a tapered segment, d0 to d1) | yes |
| megaphone / reducer into the pipe (Quick's build sheet, the compare button) | yes, a tapered segment at the start of the line (new) | yes |
| reverse-cone megaphone, diffuser tailpipe | dropped: parts-list items only, not line fields | - |
| straight pipe after the collector | yes | yes (length, diameter) |
| X-pipe | yes, a 4-way junction between the two banks' lines (`opt.crossover`, the Crossover tab's place); needs both collectors running, which "Hear my exhaust" now does | yes (distance from the collectors) |
| H-pipe | yes, a balance tube of the Crossover tab's length and bore | yes |
| Z-pipe | approximated as an X (one junction) | yes |
| Y-merge, two banks into one pipe | dropped, listed under "Not in the sound" (each bank runs its own pipe) | - |
| catalytic converters | dropped, listed (the wave model has no converter; the OpenWAM case runs one as plain pipe) | - |
| chambered muffler (Quick's part) | approximated: one empty case of the same cross-section and length; internal chambers listed as not in the sound | yes (after the pipe) |
| Mufflers tab chamber, straight through, extended tubes | yes (expansion chamber, inlet / outlet pockets as side volumes) | yes |
| reverse-flow chamber | approximated: the chamber as a closed pipe off the end plate (Munjal 3.7); tube extensions left out (noted) | yes |
| turbo-style muffler | approximated as the reverse-flow can of its case | yes |
| straight-through packed | yes: perforated core in slices with the annulus as side volumes, the packing's loss applied to the outflow from the transfer-matrix model (`calcAbsorb`); the packing density is the Mufflers tab's | yes |
| multi-chamber muffler | approximated as one chamber of the case | yes |
| glasspack | as straight-through packed | yes |
| volume can (OpenWAM line "muffler L") | yes, an empty can 1.5 diameters long | yes |
| Helmholtz resonator | yes, a side branch (volume on a neck, end correction) | yes (W.x, the compare button: 3 ft and 6 ft) |
| quarter-wave / J-pipe | yes, a closed side branch | yes |
| in-line bottle resonator (parts list) | dropped: a catalogue part, not a line element | - |
| auger, tube bundle | yes, parallel paths on the line pipe | yes |
| primary chambers (can on bleed holes, shell, bulge: 4-Stroke tab) | yes on the 4-Stroke tab's one-collector run; the whole-engine run is not built with them (it falls back to one collector, said in the notes) | yes |
| tailpipe | yes (length at the line's bore) | yes |
| tip shape, turndown, tip diameter change | dropped: the open end is a point source at the tail's bore | - |
| dual exits | yes: both tips, summed at the microphone (centre or side layout, the OpenWAM panel's) | spacing only through the side layout |
| single exit from one collector (4-Stroke tab) | yes | - |
| two-stroke expansion chamber | dropped: the Sound tab's estimate runs the 4-Stroke tab's engine | - |
| case (shell) radiation, intake noise | dropped (sound/realism.py has a shell model; not in the page) | - |

Exhaust parts in the played signal for three set-ups (from the "Playing" line and "Not in the sound"):

- (a) Default page, "Hear my exhaust": every cylinder of the V8 (the Headers tab's collectors 1-3-5-7 and 8-4-6-2), each
  with the 4-Stroke tab's 1.75 in (44.5 mm) x 28.4 in (721 mm) primaries, its 3.5 to 3.13 in (88.9 to 79.5 mm) merge cone,
  straight and megaphone; then the Mufflers tab's 2.37 in (60.2 mm) pipe, 14 in (356 mm) long (its 8.5 ft (2.59 m)
  head-to-tip length less the header, chamber and tailpipe), its 6 x 14 in (152 x 356 mm) chamber, a 26.4 in (670 mm)
  tailpipe; both tips heard. Nothing listed as left out. "Estimate the sound" on the default page is still the open
  4-into-1 of one bank (its tests pin that), and now says so in the warning above the play buttons.
- (b) 2018-20 Mustang GT, Quick, "Fill in every tab" with 180 in (4.57 m) head to tip: every cylinder (collectors 1-4-3-2
  and 5-8-6-7), 1.62 in (41.1 mm) x 32.2 in (817 mm) primaries into 2.90 in (73.6 mm) collectors; a 2.0 in (51 mm) reducer
  to the 2.37 in (60.2 mm) pipe, 83.7 in (2.13 m) long; the H-pipe 12 in (305 mm) behind the collectors with a 1.90 in
  (48.2 mm) x 3.5 in (89 mm) balance tube; the build sheet's 12.1 L Helmholtz can at its place; Quick's chambered muffler as
  a 4.8 in (122 mm) bore x 18 in (457 mm) can (its case's cross-section and length); a 26.4 in (670 mm) tailpipe; both tips.
  Not in the sound: the muffler's internal chambers and baffles, the catalytic converters. With the head-to-tip length
  left blank the Mufflers tab's 8.5 ft is used: the pipe is then 5.7 in (144 mm), the H-pipe does not fit and the
  resonator has no place; both are listed as not in the sound.
- (c) 2025+ Aprilia RS 660, Quick, "Fill in every tab": both cylinders, 1.50 in (38.0 mm) x 18.7 in (475 mm) primaries
  into a 1.89 in (48.0 mm) collector, a 1.89 in (48.0 mm) pipe 33 in (838 mm) long, the Mufflers tab's 6 x 14 in
  (152 x 356 mm) chamber (no silencer in the parts list has a case size for Quick to give), a 26.4 in (670 mm) tailpipe.
  Not in the sound: the build sheet's resonator (no head-to-tip length), the catalytic converter. The bike's stock system
  (catalyst, 10 L underbelly box, two outlets: validation/rs660-2026) is not a vehicle preset, so it cannot be picked; the
  presets carry engines, not exhausts.


## 6. What still differs, and why

- **2-16 kHz.** The model stops at its validity limit (about 2.2-2.9 kHz on these runs: the 720-point cycle at idle, the
  20 mm grid above). The recordings keep 2-16 kHz at -13 to -38 dB re the total: flow noise in the pipes and muffler,
  case radiation, valve train and combustion noise through the block, intake, wind and the phone microphone's own
  response. The jet noise (Lighthill) is the only broadband source in the model and is 50-70 dB below the pulses at these
  gas speeds. So the new sound is darker than a real car; the honest fixes are finer grids and a finer recorded cycle (a
  solver run setting, not playback), and modelled flow and shell noise (sound/realism.py has a shell model; the page does
  not), not an equaliser.
- **Idle roughness.** The recordings' idles vary far more than Heywood's figures give: cycle-to-cycle RMS 17-19 % and order
  levels 1.6-5.8 dB from cycle to cycle, against 4-5 % and 0.4-0.5 dB in the model with an 8 % COV of IMEP. Part of the
  real spread is other noise in the frame, but the Outback's idle is also genuinely lumpy. The page uses the textbook
  figure, not a fit to these two engines.
- **Speed.** The wander's size now matches the holds (1.1-1.2 % against 1.1-1.25 %), but its short-time part is larger
  than the Outback hold's (0.54 % against 0.06 %): the 0.5 s correlation time from sound/realism.py is shorter than that
  hold's. The RS 660 idle hunts much more (5 %) than the page's 1.2 %.
- **Order balance.** Which orders are strong is the wave model's (the validation reports: 7-14 dB RMS against the
  recordings, set mostly by the estimated pipe lengths); playback cannot fix that.
- **Decel and overrun** are not modelled: after a rev the sound goes back to the idle hold.
- **The comparison with a recording** ("Play the model", `recAbCheck`): with the artefacts gone the model at the default
  2 % variation is 9.6 dB cleaner between its orders than the Outback's 1980 rpm hold (21.6 against 12.0 dB; the old
  playback 19.6 against 12.0, 7.6 dB). rec_ui.js pins "within 9 dB": see section 7.
- **Stereo** only with the reverb on (two ears in the space); dry, two tips behind the car are within a few
  centimetres of the same distance from each ear, so mono is kept.
- **Not modelled parts**: see the audit (catalytic converters, Y-merges, muffler internals, reverse cones, tip shapes, the
  two-stroke chamber).

## 7. Next round (not started here)

Needs the solver (wsFactory and its Rust/WASM twin, whose bit parity the tests enforce), so left alone this round:
- a catalytic converter element (a monolith: many small channels, friction and heat loss, the area step in and out):
  wsFactory pipe network plus the Rust twin, about 150-250 lines each and parity cases;
- a Y-merge of both banks' lines into one pipe (a three-way junction closing the network, as the crossover's X and H do
  between two exits): about 100-200 lines each side.

Needs no solver change:
- muffler internals as line elements (baffle plates with holes, series chambers joined by tubes, the turbo muffler's
  reversal) built from the existing segments and side branches;
- case (shell) radiation from sound/realism.py's panel model, played beside the tip;
- a closed-throttle overrun (every cylinder not firing, the `dead` list the misfire run already uses, at a lower manifold
  pressure) so a rev can come back down as a decel instead of the idle hold;
- a finer recorded cycle for playback (more than 720 points, kept apart from the 720-point averages the tables use) and a
  finer grid for "Hear my exhaust", which would lift the validity limit from about 2.2-2.9 kHz;
- the open end's directivity above ka = 0.5 (Levine and Schwinger 1948) for a listener off the tip's axis.

## 8. Tests

TESTS
