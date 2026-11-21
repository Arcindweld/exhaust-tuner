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

AFTER_TABLES

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

PLAYED_SETUPS


## 6. What still differs, and why

STILL_DIFFERS

## 7. Tests

TESTS
