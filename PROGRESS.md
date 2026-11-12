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
- [ ] D shared muffler fn
- [ ] A/B/C march
- [ ] E output/checklist/sheet
- [ ] tests xflow_ui.js, turboguide updates
- [ ] python check tools/validation/boost/xflow.py
- [ ] docs, test runs
