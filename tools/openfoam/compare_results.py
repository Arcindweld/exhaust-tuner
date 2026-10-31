"""Compares an intake_cfd results.json with a reference run of the same case (same mesh, same iterations).
    python compare_results.py results.json reference.json [rel_tol]
Exit 1 when any compared quantity differs by more than rel_tol (default 0.2 %)."""
import json, sys
res, ref = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.002
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
