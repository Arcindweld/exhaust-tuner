# Sound realism (branch agent40/soundreal) - progress

Task: find objectively why "Hear the model" does not sound like a car and fix it with cited physics.

## State
- [ ] 1. tools/sound/analyze.py (metrics) + tools/sound/render_page.js (page output to a temp WAV)
- [ ] 2. real vs model table (Outback idle 735 / hold 1980, RS 660 idle 1442 / hold 5460, default V8 2500)
- [ ] 3. fixes in order of measured size
- [ ] 4. re-measure, web/tests/wsndreal_ui.js
- [ ] 5. recSynth with a recording ("Play the model"), saved WAV
- [ ] 6. docs/SOUND_REALISM_2026-11-21.md, run all listed tests

## Notes
- WAVs only in the scratch dir, delete after use (disk < 1 GB).
- Outback recordings are tracked in git since the import commit (not ignored as the brief says): left as they are, reported.
- Edit only sound code in web/index.html (rec*, wsnd*, jet*, wam* sound functions, Sound tab sections).
