# Boost audit progress (temporary, delete in final commit)
- [x] read STATUS
- [x] intake boosted functions (fixes B9 B13 B15 B19 B21 B23 + wording; test web/tests/boostaudit_ui.js)
- [x] pie cut / catDp (correct; Hooper wording B17)
- [x] chargeroute (parity ok; crFlows uses route B21)
- [x] K-series presets (K24A2 Z7 W1 match)
- [x] catalogue spot check (GTX3076R wg fixed)
- [ ] audit doc, STATUS entry, full suite
- [ ] AFTER audit fixes committed: owner addition "consider the turbo A/R" (structured housings per TURBO_LIB row,
      published turbine flow per housing only, volute tan(alpha)=2 pi b/(A/R) derivation, verdict per housing,
      ordering w/o flow, measured pre-turbine pressure input -> one A/R step, divided housing vs i-mani,
      housing select in Turbo options, A/R on drawing turbine label, update 'Turbine housing A/R' section,
      tests + own section in audit doc)
      + coordinator 2: Garrett A/R article https://www.garrettmotion.com/news/newsroom/article/turbo-tech-how-to-turbo-and-the-difference-an-a-r-makes-for-optimizing-your-turbo-system/
        quote definition (replace second-hand lecture-deck cite), GTX3076R 0.83 vs 1.01 worked example (one engine, no formula),
        housing A/R a visible field (options choice, summary rows, drawing, saved with project), check GTX3076R/G25-660 A/R lists.
- [x] audit doc + STATUS written
- [ ] A/R feature (next)
A/R plan: form inputs i-tar (A/R number, visible), i-thsg (readonly text, housing label, restores TSO), i-p3m (measured
  pre-turbine pressure gauge -> replaces k, Bell step); TURBO_LIB[].hs structured; arSection in Turbo options; drawing
  turbine label; route summary row; 'Turbine housing A/R' section first-hand Garrett (catalogue p7 "WHAT IS A/R?", article
  GTX3076R example); divided vs i-mani (BorgWarner catalogue twin-scroll text). No maker publishes per-housing turbine flow
  in text (Garrett catalogue: only wheel "flows up to 43/56 LBS/MIN", no reference conditions) -> verdict path tested on a
  synthetic row. Fetched so far: PT5862, PT6266, GTX3076R, G25-660, G35-900, EFR catalogue.
