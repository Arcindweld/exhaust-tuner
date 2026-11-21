# Sound realism (branch agent40/soundreal) - progress

Task: find objectively why "Hear the model" does not sound like a car and fix it with cited physics; then (coordinator
additions) play the whole system the owner set up, list what is not in the sound, audit every part, compare parts, and a
listening space (reverb) with a toggle.

## State
- [x] tools/sound/analyze.py (metrics), tools/sound/render_page.js (page sound of a validation spec to a temp WAV)
- [x] real vs model-before table (scratch t/real.json, t/model.json) and after (t/new.json); docs table
- [x] fixes: band-limited synthesis (sndPrep/sndSynth), cited variability (sndCov, SND_SPREAD, SND_WANDER), listening path
      (sndPath: ground image + ISO 9613-1), whole engine (wsndWholeSpec), system from the other tabs (wsndAutoSys),
      "Hear my exhaust" (wsndListen: idle, rev, back), playing line + not-in-the-sound + open-headers warning
- [x] recSynth rewritten on sndSynth (band limit, no cycle-boundary click)
- [x] reverb: SND_SPACES, sndSpaceIR (image sources + Eyring tail), Reverb switch, custom IR, stereo WAV
- [x] compare buttons (xo / res / cone), A/B difference line
- [ ] run every listed test; rec_ui gap check: old 19.6 vs 12.0 dB (pass), new 21.6 vs 12.0 (fails < 9 dB pin) - REPORT, do not change pin
- [ ] A/B WAVs in scratchpad/sound_ab (mustang before/after done, rs660 before/after done; v8 xo, resonator, reverb: t/ab.js)
- [ ] docs/SOUND_REALISM_2026-11-21.md

## Notes
- WAVs only in the scratch dir. Symlink validation/outback-2004/model/runs/hold_1980 -> exhaust-tuner copy (for rec_ui):
  NOT ignored by git (a symlink, not a dir): never `git add -A`; remove it at the end.
- Outback recordings are tracked in git since the import commit (not ignored as the brief says): left as they are, reported.
- Edit only sound code in web/index.html; one line added to PROJ_UI (keys sndl, sndv).
