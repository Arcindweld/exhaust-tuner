"""Variants of a generated intake case for tracking down a platform difference: each variant changes one boundary
condition, scheme or model, so the first iterations on two OpenFOAM builds can be compared per variant (the variant
whose residuals agree points at what differs). The physics of a variant is not meant to be right, only identical on
both builds.
    python make_variants.py <meshed case dir> <out root> [iterations]
The case must already have its mesh (blockMesh, topoSet run). Writes <out root>/<variant>/ for every variant.

Compare a Windows round only with Linux runs of the SAME variant folders (linux_rerun.sh on the downloaded
diag-variants artifact, then compare_variants.py), never with variants generated separately on Linux: one round was
compared with Linux variants generated before the incompressible cases moved from SIMPLEC to SIMPLE, so every
difference in it was the settings change, not the build."""
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


CYCLIC_SIDE = (r"        type cyclic;\n        neighbourPatch \w+;\n        transform rotational;\n"
               r"        rotationAxis \(1 0 0\);\n        rotationCentre \(0 0 0\);\n")


def sides(new):
    """blockMeshDict edit: the generator's front/back rotational cyclic pair becomes `new` (e.g. a wedge pair)."""
    def f(t):
        for nm in ("front", "back"):
            t, n = re.subn(r"(\n    %s\n    \{\n)" % nm + CYCLIC_SIDE, lambda m: m.group(1) + new, t)
            if n != 1:
                raise ValueError("front/back cyclic pair not found")
        return t
    return f


def fields_side(new_type, fields=("U", "p", "k", "omega", "nut")):
    return [("0/" + f, lambda t, nt=new_type: t.replace("type cyclic;", "type %s;" % nt)) for f in fields]


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
    # the generator's 2-D sector has a rotational cyclic pair for sides; these put the old wedge pair back
    # (re-meshed): with wedges the explicit dev2(T(grad(U))) term sustains an axial odd-even velocity mode (laminar
    # Poiseuille pressure gradient 1.25x on Linux) and the two builds part at iteration 2 (~3e-4), against
    # iteration 3 (~1e-5) for the cyclic pair
    "wedge": [("system/blockMeshDict", sides("        type wedge;\n")), ("REMESH", None)] + fields_side("wedge"),
    "lam_wedge": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                  ("system/blockMeshDict", sides("        type wedge;\n")), ("REMESH", None)] + fields_side("wedge"),
    # per-cell initial residual fields of U and p every iteration (solverInfo writeResidualFields)
    "lam_resfields": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                      ("system/controlDict", sub1(r"^functions\s*\n\{", "functions\n{\n    residualFields\n    {\n        type            solverInfo;\n"
                       "        libs            (utilityFunctionObjects);\n        fields          (U p);\n        writeResidualFields yes;\n"
                       "        writeControl    timeStep;\n        writeInterval   1;\n    }"))],
    # the sector's sides as symmetry planes: a thin slab instead of an axisymmetric pipe, but the same on both builds
    "lam_symmetry": [("constant/turbulenceProperties", sub1(r"^(\s*simulationType\s+)\w+;", r"\1laminar;")),
                     ("system/blockMeshDict", sides("        type symmetry;\n")), ("REMESH", None)]
                    + fields_side("symmetry", ("U", "p")),
}


def main(src, root, iters=3):
    os.makedirs(root, exist_ok=True)
    for name, edits in VARIANTS.items():
        d = os.path.join(root, name)
        if os.path.exists(d):
            shutil.rmtree(d)
        shutil.copytree(src, d, ignore=shutil.ignore_patterns("log.*", "processor*", "postProcessing", "[1-9]*"))
        for rel, fn in edits:
            if fn is None:      # a marker: re-mesh this variant (blockMesh + topoSet) before the solver
                open(os.path.join(d, rel), "w").write("re-mesh\n")
                shutil.rmtree(os.path.join(d, "constant", "polyMesh"), ignore_errors=True)
                continue
            edit(os.path.join(d, rel), fn)
        edit(os.path.join(d, "system", "controlDict"), lambda t: re.sub(r"^endTime\s+\S+;", "endTime         %d;" % iters,
             re.sub(r"^writeInterval\s+\S+;", "writeInterval   1;", re.sub(r"^purgeWrite\s+\S+;", "purgeWrite      0;",
             re.sub(r"^writePrecision\s+\S+;", "writePrecision  17;", t, flags=re.M), flags=re.M), flags=re.M), flags=re.M))
        print(name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
