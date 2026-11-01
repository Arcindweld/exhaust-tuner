"""Compares an intake_cfd results.json with a reference run of the same case (same mesh, same iterations).
    python compare_results.py results.json reference.json [rel_tol]
Exit 1 when any compared quantity differs by more than rel_tol (default 0.2 %). Exit 2 when the two runs were not
made the same way: another generator version, other numerics (algorithm, relaxation, linear solver, 2-D mode), another
flow scale or solver. The reference must then be regenerated (cfd/validation/make_references.sh), not compared."""
import json
import sys

res, ref = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.002

prov = ("generator", "numerics", "flow_scale", "solver")
print("%-10s %-48s %s" % ("record", "this run", "reference"))
mismatch = []
for k in prov:
    a, b = res.get(k), ref.get(k)
    sa, sb = json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True)
    print("%-10s %-48s %s%s" % (k, sa[:48], sb, "" if sa == sb else "   <-- differs"))
    if sa != sb or a is None:
        mismatch.append(k)
if mismatch:
    print("the run and the reference were not made the same way (%s): regenerate the reference with "
          "cfd/validation/make_references.sh instead of comparing" % ", ".join(mismatch))
    sys.exit(2)

keys = ("PR_p0_over_ps", "dp_static_Pa", "dp_total_Pa", "K_total_loss", "Cd_flowbench", "uniformity_index")
worst, bad = 0.0, []
print("%-10s %-16s %14s %14s %9s" % ("plane", "quantity", "this run", "reference", "diff"))
for pl, r in ref["planes"].items():
    for k in keys:
        a, b = res["planes"][pl][k], r[k]
        d = (a - b) / b if b else 0.0
        worst = max(worst, abs(d))
        flag = "" if abs(d) <= tol else "  <-- over %.2f %%" % (100 * tol)
        if flag:
            bad.append((pl, k))
        print("%-10s %-16s %14.6g %14.6g %+8.3f%%%s" % (pl, k, a, b, 100 * d, flag))
print("largest difference %.4f %% (limit %.2f %%); solver %s, %s iterations vs %s" % (
    100 * worst, 100 * tol, res.get("solver"), res.get("iterations"), ref.get("iterations")))
sys.exit(1 if bad else 0)
