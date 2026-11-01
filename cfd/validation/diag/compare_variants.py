"""Per variant: the first initial residual where the Linux and the Windows runs of the same variant part (relative
difference over 1e-6) and the largest relative difference over the logged iterations.
    python3 compare_variants.py <linux variants folder> <windows variants folder (diag-variants/var)>"""
import os
import re
import sys


def residuals(path):
    out = []
    with open(path, errors="ignore") as f:
        for line in f:
            m = re.search(r"Solving for (\w+), Initial residual = ([-0-9.eE+]+)", line)
            if m:
                out.append((m.group(1), float(m.group(2))))
    return out


def main(lin, win):
    for v in sorted(os.listdir(win)):
        L, W = os.path.join(lin, v, "log.simpleFoam"), os.path.join(win, v, "log.simpleFoam")
        if not (os.path.exists(L) and os.path.exists(W)):
            print("%-22s missing on %s" % (v, "Linux" if not os.path.exists(L) else "Windows"))
            continue
        a, b = residuals(L), residuals(W)
        worst, first = 0.0, None
        for i, ((na, x), (nb, y)) in enumerate(zip(a, b)):
            if na != nb:
                first = first or (i, "order differs: %s vs %s" % (na, nb))
                break
            big = max(abs(x), abs(y))
            r = abs(x - y) / big if big > 1e-12 else 0.0
            worst = max(worst, r)
            if r > 1e-6 and first is None:
                first = (i, "%s %.10g vs %.10g" % (na, x, y))
        print("%-22s %3d/%-3d residuals  worst rel %.2e  first part: %s" % (v, len(a), len(b), worst, first))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
