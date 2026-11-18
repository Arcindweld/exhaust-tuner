# PROGRESS (agent35/fast perf work) - delete in final commit
Scratch tools (not in repo): $SCRATCH/{bench.js,prof.js,serve.js,agg.js,trace.js,churn.js,lay.js}
## Baseline (bench.js, same font, median of 15, best of 3, 1440px)
hangers 193.7, intake(K24 turbo) 94.2, mufflers 60.7, 4-stroke 19.5, headers 17.8, sound 17.8
## Profiles
- hangers: renderHang 186/edit, hgHeat 169 (reachFor bisection: 125 hgParts+hgIsoTemp per render, 116 distinct);
  self: hgScan 69, pol(minD) 29, hgFin 24, simple 17; refreshDeps 10.6; layout ~11 (widthOf in drawHang 7.5 forced)
- intake: trace: style 12.9, layout 40.2, parse 7.5; forced by drawCompMap widthOf ~48; fiSection 21+, exhMarch 13, calcSkin, outerH
  churn: i-details 328KB, 8/32 secs same, text 770/3725 same; Intercooler options 145KB
- mufflers: abTL 23 (m4exp), layout 15 (ttDraw widthOf forced), refreshDeps 11, parse 4; churn text 1040/1085 same
- hidden producers (h-details, x-details, i-details) rewrite SAME strings every keystroke
## Tried
- content-visibility:auto on .sec: intake 94->43, muf 61->41 BUT innerText drops off-screen text (17.7k vs 225k chars), print too -> rejected
## Plan / status
- [x] 1 hangers kernels bit-exact: 194 -> 99 (abcompare hangers seeds 1,2 x80: 0 diff)
- [ ] 2 setHTML: skip identical strings; morph text-level for heavy tabs
- [ ] 3 mufflers abTL; intake JS dupes
- [ ] differential guard web/tests/incremental_ui.js; ui_ui budget; docs; STATUS
- [x] 2a setHTML morph (pristine template tree + MutationObserver dirty marks) on intake/muf/hang/mt/headers/cross;
  tblPolish num/data-l/stk exact both ways; fixPass label; addToc+foldPass toc idempotent; passes via shOwn.
  abcompare old-vs-new: muf 40 s1, intake K24 40 s1, hangers 60 s3: 0 diff. bench: hang 80.4 intake 73 muf 35 4s 16.3 hdr 13.5 snd 17.5
- [x] web/tests/incremental_ui.js (A in place vs B __fullWrites, lockstep, 260 actions seed 7, 2m42): passes. Found+fixed:
  fold id following data-sec on kept sections (foldId), widthOf in folded kept sections (measure open)
