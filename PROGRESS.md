# PROGRESS (agent8/xflow) - delete in final commit
Decisions:
- Reuse calcSkin (Headers tab heat model: Gnielinski+CAF, Churchill-Chu/Bernstein, radiation, SKIN_FIN eps) for cooling; add cpGas option (burned gas cp in energy balance only); Headers default unchanged.
- CAF: Wendland 1993 SAE 931085 (2.3/3.0/1.6, Re 4000-20000) via Balasubramanian 2018 core.ac.uk/download/215523088.pdf and Spyrounakos & Mavropoulos 2025 mdpi.com/2079-3197/13/9/223 ("Daniel" on page = Wendland's first name -> fix label). Default CAF 1 (upper bound on T). Konstantinidis 2.5 not re-read.
- Compressible: Powers ND AME30332 notes 4.1.4 influence coeffs, Fanno eq 4.492 (Darcy f). Compressible everywhere (no switch).
- Back pressure reported = static at turbine outlet (T-S convention), total also shown.
- Old H=1.4 p M^2/2 with exhaust M -> 1.4/gamma high (~8%) in turbo march: fixed there; Mufflers tab left (open finding).
- Y merge: not sourced for symmetric Y (python-fluids Crane tees = run+branch) -> left out.
- No NA whole-exhaust back-pressure sum exists on the page -> nothing to apply; report.
Steps:
- [x] D shared muffler fn (mufElems, mufElemLoss; Mufflers tab rows + xMuffler)
- [x] A/B/C march (exhMarch, exhSteps); case A: old 39.30 -> 7.72 kPa static at outlet (cone recovery -28.7); total 52.39; separated cone 16.30
- [x] E output/checklist/sheet (first pass)
- [x] tests xflow_ui.js (all pass); [ ] turboguide updates
- [x] python check xflow.py: case1 7700.128 vs page 7716.365 (0.21%), case2 120749.896 vs 120752.065
- [ ] docs, test runs
