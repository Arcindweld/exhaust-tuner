# Published V8 header comparisons against the model (task 89, 2026-11-04)

What the model says (openwam/v8_841_study.py, the calibrated LS3, refs in openwam/ref/v8_841/results_v4*.json):
at wide-open throttle the exhaust layout moves brake torque by a few per cent at most. Against per-bank 4-1s, from
3000 to 6600 rpm: 180-degree headers -0.1 to +1.3 %, 8-into-1 -1.2 to +1.4 %, 8-4-1 with same-bank 180-degree pairs
-2.9 to +1.1 %, 270/450-degree pairs -1.9 to +0.4 %, cross-bank 360-degree pairs -1.4 to +0.6 % (and -4.9 % at 6600);
per-bank Tri-Y -1.9 to +0.7 %. The first merge at 250 or 500 mm instead of 368 mm, and secondaries 0.8 or 1.0 times
the area of their two primaries instead of 0.64, move it 2 % or less. The layouts differ mainly in sound (the
cross-plane half orders: 1 to 14 dB below the strongest order with per-bank 4-1s, 28 to 55 dB with the 8-4-1s).

What published back-to-back tests show:

| Test | Engine | What changed | Result |
|---|---|---|---|
| [LSX Magazine, Ultimate Headers long tube](https://www.lsxmag.com/?p=5653) | LS3 with heads and cam | an equal-length stepped dyno header with merge collectors against Ultimate's long tubes | 510 against 503 lb-ft (1.4 %), 569 against 572 hp (0.5 %) |
| [Engine Masters via GM Authority, 2016](https://gmauthority.com/blog/2016/08/engine-masters-finds-out-which-headers-work-best-on-the-400-cubic-inch-v8-video/) | 400 cu in Chevrolet V8 | Hooker primaries 1-5/8, 1-3/4 and 1-7/8 in | peak torque 519.7 / 519.3 / 513 lb-ft (1.3 % spread), peak power 529.7 / 539.1 / 539.6 hp (1.9 %); the smallest best from 2800 to 5000 rpm, the 1-3/4 above |
| [Burns Stainless, Bundle of Snakes](https://burnsstainless.com/blogs/articles-1/bundle-of-snakes-180-degree-headers-1) | (180-degree headers in general) | 180-degree against 90-degree collectors | no figures: "a broad power band is inherent", the 90-degree collector must be larger and loses some low and mid-range torque |

So the published tests between well-made long-tube headers land at 0.5 to 2 % on peak figures, the same order as the
model's spread between layouts; none of them puts a 180-degree or 8-4-1 header against per-bank 4-1s on one engine
with numbers, so the model's ranking of those cannot be checked yet. The model's stock LS3 makes 423 lb-ft at 4600
rpm against GM's 425 (see STATUS, upgrades): its absolute level is right where it can be checked.
