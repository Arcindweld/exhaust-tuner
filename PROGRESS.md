# PROGRESS (agent36/presetdata) — delete in the final commit
Task: source real bore/stroke for the 515 car-list presets without them (see task brief in session).
State files: tools/validation/presets/worklist.json (export.js), research.json (rs.js add/review/tried; resumable).
Page hook added: window.__presets (index.html after motorList).
Steps: [x] export/triage  [ ] research (ongoing)  [ ] apply.js  [ ] page labels  [ ] effect (effect.js)  [ ] tests presetdata_ui.js  [ ] docs + STATUS  [ ] suite
Notes:
- estimate: boreStroke(): S=cbrt(per*4/(pi*1.44)), B=1.2 S (index.html ~9486)
- bike list: 392 4-stroke, 319 with bore already (not the target)
