# Sound realism round 2 — progress (agent42/sound2)

Started 2026-11-21. Brief: A diagnosis/ablation, B >1-D content, C chambered mufflers, D listening position,
E idle roughness, F transients, G RS 660 stock. WAVs only in scratchpad sound_ab2/.

## Status
- [x] A ablation harness tools/sound/ablate.js; first numbers (Mustang no load 750/2500, WOT 2500) in scratchpad abl_*.json
- [~] B: fine playback cycle (SND_NF 4096), shell stage (sndShellGain), grid choice 10 mm; flow noise NOT implemented (no K(St) constants obtainable)
- [~] C: sndMufLayout (baffle chain, generic chambered 2/3, turbo 3-pass stubs); tools/sound/ilcheck.js running
- [x] D: SND_L.pos behind 6 ft default, ground Delany-Bazley + spherical Q (Faddeeva Humlicek W4) asphalt default
- [x] E: SND_IDLE cov 10 % (Han & Hwang 2013), hunting OU 1.36 %/1.7 s (Outback idle measured)
- [~] F: wsndSpeedRun 'motor', per-variant rpms/load/mode in wsndJob+worker, sndBlip/sndBlipTrack, how 'rev'; untested
- [ ] G RS 660 stock
- [ ] deliverable WAVs
- [ ] tests
- [ ] doc

## Notes
- all new stages off = round one bit-identical (checked 800/1500 rpm hold and show, default V8)
- grid limit (c/8dx) sets fLim at idle (2.36 kHz), not the 720 cycle: dx 0.01 is the lever for HF
- ablation: jet < -70 dB; 25 ft comb null 1.39 kHz carves 1-2k by ~11 dB; band limit carves 4-8k; strongest order with Quick system at 2500 no load = order 3 (pipe/muffler), not 4

## 03:40 state
- done in code: fine cycle, ground/positions, idle, shell, grid choice, muffler layouts, IL check (fixed 35 kPa: 40-320 Hz octave medians within 6 dB), blip (idle/WOT/motor), slow rev, RS660 stock script, F-100 orders script, deliverables script, wsndreal_ui extended (not yet run)
- deliverables: mustang_gt_round1.wav, rs660_round2.wav done (sound_ab2); mustang_r2 at dx 0.01 running (dx01/)
- todo: ablate --stages r2 (650,2500 none; 2500 wot), f100_orders, v8_xo, v8_muf, tests one at a time, doc
