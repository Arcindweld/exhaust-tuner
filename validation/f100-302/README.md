# Built 302 F-100: long tubes, 2.5 in X-pipe, chambered mufflers

A third validation case for the OpenWAM sound path, and the first with two banks joined by a crossover (make_wam v10).
The engine is from the owner's build sheet (supplied by the user); the exhaust layout is from published write-ups of
the truck; the recordings are roadside pass-bys in a public video, read for relative order levels only. No audio
from the video is kept in the repository, only the derived numbers in `recording_orders.json`.

## The recording

Four clean stretches of wide-open-throttle pulls (`recording_orders.json`), 0.4 s windows every 0.2 s. Each window's
rpm comes from the half-order line spacing (the autocorrelation of the whitened log spectrum, which does not make the
comb tracker's octave errors). Two checks hold. The 3rd-to-4th shifts drop the speed by 0.76-0.78, the Tremec TKX's
1.28 -> 1.00 step. And order 4 at 360-390 Hz is the strongest line through every stretch.

All four pulls show the same pattern: order 4 on top; order 8 at -7 to -19 dB; order 12 at -9 to -23 dB; every other
order at -16 to -30 dB, which is about the floor of a moving roadside recording (road, wind and tyre noise, and the
speed change within a window). The apparent rpm (Doppler included) runs 4650-6080.

## The model

`model/f100.py`, wide open throttle, 40 cycles a run (about 5 minutes each). Each assumption is marked in the
docstring. The two most important are a CR of 11.7 (the head's chamber size is not on the sheet) and the HO firing
order 1-3-7-2-6-5-4-8 (the N-91 is sold for the 5.0 HO). Two scores per case, over orders 1.5-12:
the plain RMS of the difference (offset removed), and the RMS with both sides clipped at -25 dB, each relative to its
own strongest order. The clipped score is the meaningful one here, because the recording cannot show anything below
its floor.

| Case (5800 rpm unless noted) | RMS | Clipped at -25 dB |
|---|---|---|
| muffler as one 6.5 L volume, 600 mm exit | 11.5-13.2 | 6.7-7.8 |
| the same, stock firing order | 17.7-18.3 | 6.8-7.6 |
| the same, 300 mm exit | 11.7-13.2 | 8.2-9.3 |
| muffler as a 1-D chamber, 356 mm x 152 mm | 10.9-11.7 | 8.9-10.1 |
| no muffler (plain pipe) | 17.5-18.0 | 8.9-9.6 |
| chambered layout (front chamber, two side passages, rear chamber) | 17.9-19.1 | 5.0-7.1 |
| chambered, with the single plane's shared intake plenum | 13.0-15.2 | 4.7-7.0 |
| chambered, plenum, stock firing order | 13.8-15.7 | 4.9-7.0 |
| chambered, plenum, 5000 rpm | 10.1-10.9 | 7.2-7.8 |
| chambered, plenum, X 250 mm from the collectors (not 1000) | 12.4-14.5 | 4.0-6.6 |
| chambered, plenum, X 400 mm | 19.8-20.7 | 3.8-6.2 |
| chambered, plenum, X 400 mm, stock firing order | 18.6-19.5 | 3.9-6.2 |
| chambered, plenum, X 400 mm, 5000 rpm | 19.8-20.4 | 4.4-6.3 |
| chambered, plenum, X 550 mm | 14.3-16.0 | 4.6-6.9 |
| chambered, plenum, X 700 mm | 9.8-12.5 | 3.8-6.0 |
| chambered, plenum, X 1400 mm | 13.9-15.6 | 4.0-6.9 |

(Ranges across the four pulls; both exits summed at the microphone, the far one 1.8 m further away. Hearing the near
exit alone scores 2-3 dB worse throughout.)

What it shows:

- The chambered layout comes closest. Like the recording it puts order 4 on top and holds most other orders down.
  The single 6.5 L volume does not: a 0-D volume feeding a 600 mm tailpipe is a Helmholtz resonator near 80 Hz and a
  low-pass filter above it, so order 1 comes out strongest. The recording rules that out.
- What remains is a family of integer orders (1, 2, 3, 5, 6, 7) at -8 to -15 dB in the model, against no more than
  about -18 in the recording. Both exits carry the same flow (the lumped X mixes the banks completely), so these orders
  come from the cylinders differing from each other. In the model the cylinders' NMEP spans 18-26 % (VE 0.94-1.09),
  largest in the cylinders that follow a same-bank firing. Adding the shared intake plenum does not change that. With
  a 315 deg cam (24 deg of overlap at 0.050 in, about 100 deg seat to seat in the model), each cylinder's scavenging follows the pressure its own bank's
  collector sees, and each bank fires unevenly (90-180-270-180 deg). Real engines show the same effect, but the model
  probably overstates it. Its combustion is identical in every cylinder and its X is a single point, and nothing in
  it damps the collector waves (no packing, no wall losses beyond friction and heat).
- The firing order barely changes the clipped score: the X evens out both orders.
- Where the X sits matters more than anything else tried, through the cylinders. The NMEP spread across the eight is
  7.6-7.7 % with the X 250-400 mm behind the collectors, 12 % at 550, 20 % at 700 and 26 % at 1000-1400 mm. A close X
  couples the two banks' collectors, so each cylinder's overlap sees a more even pressure. The clipped score moves less
  (3.8-6.9 dB from 250 to 1400 mm): what is left is the firing harmonics, orders 8 and 12, which the model has 5-20 dB
  weaker than the recording, and orders 2 and 6, which it has about 8 dB stronger. Neither moves much with the X
  position, so those are for the muffler's inside and the radiation to fix, not the pipe layout.

To narrow this further: the header's primary size and length, the X-pipe's position, the exit length, and the
muffler model (a box photo).

### Length fit (model/fit.py, writers v13/v14)

One step each way from the base layout (X 400 mm behind the collectors, 600 mm exits, 762 mm primaries) at 5,800 rpm,
40 cycles, scored on both exits against the pull windows (clipped RMS, mean and spread over the pulls; `fit.json`):

| X to collectors | Exit | Primary | Clipped RMS | vs base |
|---|---|---|---|---|
| 400 mm (15.7 in) | 600 mm (23.6 in) | 762 mm (30 in) | 4.82 dB (0.87) | base |
| 250 mm (9.8 in) | 600 | 762 | 4.89 (0.91) | +0.07 |
| 550 mm (21.7 in) | 600 | 762 | 5.52 (0.87) | +0.70 |
| 400 | 300 mm (11.8 in) | 762 | 5.20 (0.73) | +0.38 |
| 400 | 900 mm (35.4 in) | 762 | 5.78 (0.91) | +0.96 |
| 400 | 600 | 660 mm (26 in) | 5.02 (0.92) | +0.20 |
| 400 | 600 | 860 mm (33.9 in) | 4.24 (0.91) | **-0.58** |
| 400 | 600 | 960 mm (37.8 in) | 4.31 (0.82) | -0.51 |
| 400 | 600 | 1060 mm (41.7 in) | 7.41 (0.54) | +2.59 |

The X position is flat between 250 and 400 mm and worsens past 550; the 600 mm exit beats both 300 and 900; the
primaries have a broad best between 860 and 960 mm (34 to 38 in, about half a decibel better than 762) and fall off hard
by 1060 mm (+2.6 dB): the recording does pin the primary length, to roughly 33 to 39 in. These runs carry the
neck and open-end corrections added to the writers after the table above (v13, v14), so the base score moved from the
earlier 3.8-6.2 dB band to 4.82 dB. The remaining gap is still orders 8 and 12. The next step along this line is
the muffler's inside, with 900 mm primaries as the base.
