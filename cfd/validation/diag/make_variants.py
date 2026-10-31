"""Variants of a generated intake case for tracking down a platform difference: each variant changes one boundary
condition, scheme or model, so the first iterations on two OpenFOAM builds can be compared per variant (the variant
whose residuals agree points at what differs). The physics of a variant is not meant to be right, only identical on
both builds.
    python make_variants.py <meshed case dir> <out root> [iterations]
The case must already have its mesh (blockMesh, topoSet run). Writes <out root>/<variant>/ for every variant."""
import os
import re
import shutil
import sys


def patch_block(text, patch, body):
    """Replace the body of `patch { ... }` inside boundaryField."""
    i = text.index("boundaryField")
    m = re.compile(r"\n(\s*)%s\s*\n\s*\{" % re.escape(patch)).search(text, i)
    if not m:
        raise ValueError("patch %s not found" % patch)
    j = text.index("{", m.start())
    depth, k = 0, j
    while True:
        if text[k] == "{":
            depth += 1
        elif text[k] == "}":
            depth -= 1
            if depth == 0:
                break
        k += 1
    ind = m.group(1)
    return text[:j] + "{\n" + "".join(ind + "    " + ln + "\n" for ln in body) + ind + "}" + text[k + 1:]


def edit(path, fn):
    with open(path) as f:
        t = f.read()
    t2 = fn(t)
    if t2 == t:
        raise ValueError("no change in " + path)
    with open(path, "w", newline="\n") as f:
        f.write(t2)


def sub1(pat, rep):
    def f(t):
        t2, n = re.subn(pat, rep, t, count=1, flags=re.M)
        if n != 1:
            raise ValueError("pattern not found: " + pat)
        return t2
    return f


VARIANTS = {
    "base": [],
    "outlet_p_fixed": [("0/p", lambda t: patch_block(t, "outlet", ["type            fixedValue;", "value           uniform -3685.49806;"]))],
    "atm_U_zeroGradient": [("0/U", lambda t: patch_block(t, "atmosphere", ["type            zeroGradient;"]))],
    "atm_p_fixed": [("0/p", lambda t: patch_block(t, "atmosphere", ["type            fixedValue;", "value           uniform 0;"]))],
    "outlet_U_zeroGradient": [("0/U", lambda t: patch_block(t, "outlet", ["type            zeroGradient;"]))],
    "gradU_linear": [("system/fvSchemes", sub1(r"^(\s*grad\(U\)\s+)\$limited;", r"\1Gauss linear;"))],
    "divU_upwind": [("system/fvSchemes", sub1(r"^(\s*div\(phi,U\)\s+).*;", r"\1bounded Gauss upwind;"))],
    "laminar": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;"))],
    # momentum equation relaxation: off, factor 1, and no momentum predictor (laminar, to keep it small)
    "lam_noRelaxU": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                     ("system/fvSolution", sub1(r"^\s*U\s+[\d.]+;\n", ""))],
    "lam_relaxU1": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                    ("system/fvSolution", sub1(r"^(\s*U\s+)[\d.]+;", r"\g<1>1;"))],
    "lam_noPredictor": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                        ("system/fvSolution", sub1(r"^(\s*)consistent(\s+)", r"\1momentumPredictor no;\n\1consistent\2"))],
    # relax() prints its diagonal-dominance statistics with the fvMatrix debug switch
    "lam_debug": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                  ("system/controlDict", sub1(r"^(application\s+\w+;)", r"\1\nDebugSwitches\n{\n    fvVectorMatrix 1;\n}"))],
    # viscosity ~0 (laminar): the laplacian and dev2 terms drop out, leaving convection and the pressure gradient
    "lam_nu0": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                ("constant/transportProperties", sub1(r"^(nu\s+)\S+;", r"\g<1>1e-30;"))],
    "lam_nu0_upwind": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                       ("constant/transportProperties", sub1(r"^(nu\s+)\S+;", r"\g<1>1e-30;")),
                       ("system/fvSchemes", sub1(r"^(\s*div\(phi,U\)\s+).*;", r"\1Gauss upwind;"))],
    # the viscous terms are where Windows departs (round 6: nu ~0 matches to every digit). Both go through
    # surfaceInterpolationScheme::dotInterpolate (Sf & T for div(dev2), corrVec & grad(U) for the laplacian
    # correction); uncorrected drops the second one
    "lam_uncorrected": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                        ("system/fvSchemes", lambda t: t.replace("default         Gauss linear corrected;", "default         Gauss linear uncorrected;")
                         .replace("default         corrected;", "default         uncorrected;"))],
    # per-cell initial residual fields of U and p every iteration (solverInfo writeResidualFields)
    "lam_resfields": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                      ("system/controlDict", sub1(r"^functions\s*\n\{", "functions\n{\n    residualFields\n    {\n        type            solverInfo;\n"
                       "        libs            (utilityFunctionObjects);\n        fields          (U p);\n        writeResidualFields yes;\n"
                       "        writeControl    timeStep;\n        writeInterval   1;\n    }"))],
    # the wedge patches as symmetry patches: a thin slab instead of an axisymmetric pipe, but the same on both builds
    "lam_symmetry": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                     ("constant/polyMesh/boundary", lambda t: t.replace("type            wedge;", "type            symmetry;").replace("inGroups        1(wedge);", "inGroups        1(symmetry);")),
                     ("0/U", lambda t: t.replace("type wedge;", "type symmetry;")),
                     ("0/p", lambda t: t.replace("type wedge;", "type symmetry;"))],
}


def main(src, root, iters=3):
    os.makedirs(root, exist_ok=True)
    for name, edits in VARIANTS.items():
        d = os.path.join(root, name)
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(src, d, ignore=shutil.ignore_patterns("log.*", "processor*", "postProcessing", "[1-9]*"))
        for rel, fn in edits:
            edit(os.path.join(d, rel), fn)
        edit(os.path.join(d, "system", "controlDict"), lambda t: re.sub(r"^endTime\s+\S+;", "endTime         %d;" % iters,
             re.sub(r"^writeInterval\s+\S+;", "writeInterval   1;", re.sub(r"^purgeWrite\s+\S+;", "purgeWrite      0;",
             re.sub(r"^writePrecision\s+\S+;", "writePrecision  17;", t, flags=re.M), flags=re.M), flags=re.M), flags=re.M))
        print(name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
