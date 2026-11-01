"""Laminar developed pipe flow on a 5 deg axisymmetric sector, with the sector's sides either OpenFOAM wedge
patches or a rotational cyclic pair: a known-answer check (Hagen-Poiseuille) of the 2-D setup on any OpenFOAM
build. D = 50 mm, L = 3 m (60 D), U = 0.15 m/s, nu = 1.552e-5 (Re 483, development length ~1.5 m), 240 x 25 cells,
simpleFoam laminar with the generator's schemes, 3000 iterations.
    python3 lam_pipe.py make <case dir> wedge|cyclic
    python3 lam_pipe.py ratio <case dir>     -> developed pressure gradient over 2.0-2.8 m / Hagen-Poiseuille
On the Linux build of the reference runs (conda-forge openfoam 2412) the wedge case gives 1.25 and the cyclic one
1.008 (cfd/NOTES.md, section 4 (e))."""
import math
import os
import re
import sys

R, L, U, NU, NX, NR = 0.025, 3.0, 0.15, 1.55184336e-05, 240, 25
HALF = math.radians(2.5)
HDR = "FoamFile { version 2.0; format ascii; class %s; object %s; }\n"


def write(case, rel, cls, body):
    p = os.path.join(case, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", newline="\n") as f:
        f.write(HDR % (cls, os.path.basename(rel)) + body)


def make(case, sides):
    y, z = R * math.cos(HALF), R * math.sin(HALF)
    if sides == "wedge":
        fr, bk = "type wedge;", "type wedge;"
    elif sides == "cyclic":
        cyc = "type cyclic; neighbourPatch %s; transform rotational; rotationAxis (1 0 0); rotationCentre (0 0 0);"
        fr, bk = cyc % "back", cyc % "front"
    else:
        raise SystemExit("sides: wedge or cyclic")
    write(case, "system/blockMeshDict", "dictionary", """scale 1;
vertices ( (0 0 0) (%(L)g 0 0) (%(L)g %(y).10g %(mz).10g) (0 %(y).10g %(mz).10g) (0 %(y).10g %(z).10g) (%(L)g %(y).10g %(z).10g) );
blocks ( hex (0 1 2 3 0 1 5 4) (%(nx)d %(nr)d 1) simpleGrading (1 1 1) );
boundary
(
    inlet  { type patch; faces ((0 0 4 3)); }
    outlet { type patch; faces ((1 2 5 1)); }
    walls  { type wall;  faces ((3 4 5 2)); }
    front  { %(fr)s faces ((0 3 2 1)); }
    back   { %(bk)s faces ((0 1 5 4)); }
);
mergeType points;
""" % dict(L=L, y=y, z=z, mz=-z, nx=NX, nr=NR, fr=fr, bk=bk))
    side_bc = "type wedge;" if sides == "wedge" else "type cyclic;"
    write(case, "0/U", "volVectorField", """dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);
boundaryField { inlet { type fixedValue; value uniform (%g 0 0); } outlet { type zeroGradient; } walls { type noSlip; }
                front { %s } back { %s } }
""" % (U, side_bc, side_bc))
    write(case, "0/p", "volScalarField", """dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField { inlet { type zeroGradient; } outlet { type fixedValue; value uniform 0; } walls { type zeroGradient; }
                front { %s } back { %s } }
""" % (side_bc, side_bc))
    write(case, "constant/transportProperties", "dictionary", "transportModel Newtonian;\nnu %.9g;\n" % NU)
    write(case, "constant/turbulenceProperties", "dictionary", "simulationType laminar;\n")
    write(case, "system/controlDict", "dictionary", """application simpleFoam; startFrom latestTime; startTime 0; stopAt endTime;
endTime 3000; deltaT 1; writeControl timeStep; writeInterval 3000; purgeWrite 0; writeFormat ascii;
writePrecision 12; writeCompression off; timeFormat general; timePrecision 8; runTimeModifiable true;
""")
    write(case, "system/fvSchemes", "dictionary", """ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; limited cellLimited Gauss linear 1; grad(U) $limited; }
divSchemes { default none; div(phi,U) bounded Gauss linearUpwindV grad(U); div((nuEff*dev2(T(grad(U))))) Gauss linear; }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
""")
    write(case, "system/fvSolution", "dictionary", """solvers
{
    p { solver PCG; preconditioner DIC; tolerance 1e-12; relTol 0.01; }
    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-10; relTol 0.1; }
}
SIMPLE { nNonOrthogonalCorrectors 0; consistent no; }
relaxationFactors { fields { p 0.3; } equations { U 0.7; } }
""")


def ratio(case):
    times = [d for d in os.listdir(case) if re.fullmatch(r"\d+(\.\d+)?", d) and d != "0"]
    t = max(times, key=float)
    txt = open(os.path.join(case, t, "p"), errors="ignore").read().replace("\r", "")
    m = re.search(r"internalField\s+nonuniform\s+List<scalar>\s*(\d+)\s*\(", txt)
    n = int(m.group(1))
    p = [float(v) for v in txt[m.end():].split(")", 1)[0].split()][:n]
    xs, ps = [], []
    for c, v in enumerate(p):          # blockMesh order: axial index fastest
        x = (c % NX + 0.5) * L / NX
        if 2.0 <= x <= 2.8:
            xs.append(x)
            ps.append(v)
    mx, mp = sum(xs) / len(xs), sum(ps) / len(ps)
    slope = sum((a - mx) * (b - mp) for a, b in zip(xs, ps)) / sum((a - mx) ** 2 for a in xs)
    hp = 8.0 * NU * U / R ** 2
    print("time %s: developed dp/dx %.6g m/s2, Hagen-Poiseuille %.6g, ratio %.4f" % (t, -slope, hp, -slope / hp))
    return -slope / hp


if __name__ == "__main__":
    if sys.argv[1] == "make":
        make(sys.argv[2], sys.argv[3])
    else:
        ratio(sys.argv[2])
