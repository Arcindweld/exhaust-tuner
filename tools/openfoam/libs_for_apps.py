"""Libraries (source folders) the Exhaust Tuner CFD cases need, in an order where every library comes after the
libraries it links to. Reads Make/files (LIB = ...) and Make/options (EXE_LIBS / LIB_LIBS) of the OpenFOAM source.
    python3 libs_for_apps.py OPENFOAM_DIR app_dir... > order.txt
    python3 libs_for_apps.py OPENFOAM_DIR --shard 2/4 app_dir...
The second form splits the compile work (src/OpenFOAM, the libraries and the programs) into n parts of about the
same size, for compile-only CI jobs that run side by side and fill one compiler cache (linking needs the whole set
and runs afterwards). Sizes are the compile times measured on a CI runner (SECONDS); finiteVolume alone is an hour.
Libraries with a ThirdParty and a dummy implementation (scotch, metis, kahip, ptscotch) use the dummy one."""
import os, re, sys

of = sys.argv[1]
args = sys.argv[2:]
shard = None
lninclude = False
if args[:1] == ["--shard"]:
    i, n = (int(x) for x in args[1].split("/"))
    shard, args = (i, n), args[2:]
elif args[:1] == ["--lninclude"]:
    lninclude, args = True, args[1:]
apps = args
CASE_LIBS = ["fieldFunctionObjects", "utilityFunctionObjects", "sampling"]   # loaded by the cases' controlDict
SPECIAL = {"OpenFOAM", "Pstream", "OSspecific"}   # built first by build_mingw.sh, as src/Allwmake does for Mingw

libdir = {}
# libraries in src/, then the ones that live with an application (surfaceFeatureExtract's extractionMethod), src first
for top in ("src", "applications"):
    for d, _, fs in sorted(os.walk(os.path.join(of, top))):
        if d.endswith(os.sep + "Make") and "files" in fs:
            t = open(os.path.join(d, "files")).read()
            m = re.search(r"^\s*LIB\s*=\s*\$\((?:FOAM_LIBBIN|FOAM_MPI_LIBBIN)\)/(?:\S*/)?lib(\S+)", t, re.M)
            if m:
                libdir.setdefault(m.group(1), []).append(os.path.relpath(d[:-5], of))

def pick(name):
    ds = libdir[name]
    dummy = [d for d in ds if "dummyThirdParty" in d]
    return dummy[0] if dummy else ds[0]

def deps_of(srcdir):
    p = os.path.join(of, srcdir, "Make", "options")
    if not os.path.exists(p):
        return []
    t = open(p).read().replace("\\\n", " ")
    out = []
    for key in ("EXE_LIBS", "LIB_LIBS"):
        for m in re.finditer(key + r"\s*=([^\n]*)", t):
            out += [l for l in re.findall(r"-l(\w[\w\-]*)", m.group(1)) if l in libdir]
    return out

need, stack = set(), [l for a in apps for l in deps_of(a)] + CASE_LIBS
while stack:
    l = stack.pop()
    if l in need or l not in libdir:
        continue
    need.add(l)
    stack += deps_of(pick(l))

order, state = [], {}
def visit(l):
    if state.get(l) == 2:
        return
    if state.get(l) == 1:
        return            # a cycle (OpenFOAM <-> Pstream): handled by the special first steps
    state[l] = 1
    for d in deps_of(pick(l)):
        if d in need:
            visit(d)
    state[l] = 2
    order.append(l)
for l in sorted(need):
    visit(l)
libs = [pick(l) for l in order if l not in SPECIAL]
if lninclude:
    # every folder a compile needs an lnInclude/ for: each src library, the header-only folders the libraries'
    # Make/options point at (TurbulenceModels/phaseCompressible ...), and folders local to a library or program
    # (-IextractionMethod/lnInclude). src/Allwmake and the libraries' own Allwmake scripts make these in a full build.
    out = set()
    for d, dirs, fs in os.walk(os.path.join(of, "src")):
        if "Make" in dirs:
            out.add(os.path.relpath(d, of))
    for d in libs + apps + ["src/OpenFOAM"]:
        p = os.path.join(of, d, "Make", "options")
        if not os.path.exists(p):
            continue
        t = open(p).read()
        for m in re.finditer(r"-I\$\(LIB_SRC\)/([\w/.\-]+?)/lnInclude", t):
            if os.path.isdir(os.path.join(of, "src", m.group(1))):
                out.add(os.path.join("src", m.group(1)))
        for m in re.finditer(r"-I(?!\$)([\w/.\-]+?)/lnInclude", t):
            q = os.path.normpath(os.path.join(d, m.group(1)))
            if os.path.isdir(os.path.join(of, q)):
                out.add(q)
    print("\n".join(sorted(out)))
    sys.exit(0)
if shard is None:
    print("\n".join(libs))
    sys.exit(0)

# compile seconds per folder, measured on a GitHub 2-core Ubuntu runner (compile only, cold cache, run of
# 2026-10-31); a folder not in the table counts 3 s per source file
SECONDS = {
    "src/finiteVolume": 3502, "src/OpenFOAM": 627, "src/functionObjects/field": 618, "src/meshTools": 526,
    "src/sampling": 468, "src/finiteArea": 394, "src/dynamicMesh": 297, "src/thermophysicalModels/radiation": 256,
    "src/fvMotionSolver": 255, "src/TurbulenceModels/turbulenceModels": 248, "src/fvOptions": 231,
    "src/thermophysicalModels/reactionThermo": 196, "src/thermophysicalModels/chemistryModel": 182,
    "src/atmosphericModels": 178, "src/surfMesh": 171, "src/thermophysicalModels/basic": 168, "src/overset": 163,
    "src/mesh/snappyHexMesh": 145, "src/combustionModels": 124, "src/regionFaModels": 112, "src/thermoTools": 109,
    "src/functionObjects/utilities": 98, "src/transportModels/geometricVoF": 89, "src/TurbulenceModels/incompressible": 84,
    "src/transportModels/incompressible": 69, "src/fileFormats": 63, "src/phaseSystemModels/multiphaseInter/phasesSystem": 62,
    "src/parallel/decompose/decompose": 58, "src/mesh/blockMesh": 52, "src/thermophysicalModels/thermophysicalProperties": 51,
    "src/thermophysicalModels/solidThermo": 44, "src/TurbulenceModels/compressible": 44, "src/thermophysicalModels/specie": 43,
    "src/faOptions": 42, "src/dynamicFvMesh": 39, "src/ODE": 33, "src/parallel/reconstruct/reconstruct": 30,
    "src/parallel/decompose/decompositionMethods": 30, "src/conversion": 30, "src/transportModels/twoPhaseProperties": 24,
    "src/mesh/extrudeModel": 23, "src/TurbulenceModels/schemes": 23, "src/transportModels/interfaceProperties": 23,
    "src/parallel/distributed": 21, "src/lagrangian/distributionModels": 20, "src/phaseSystemModels/reactingEuler/saturationModels": 19,
    "src/lagrangian/basic": 14, "src/transportModels/twoPhaseMixture": 6, "src/dummyThirdParty/kahipDecomp": 4,
    "src/thermophysicalModels/SLGThermo": 4, "src/thermophysicalModels/solidSpecie": 3,
    "src/fvAgglomerationMethods/pairPatchAgglomeration": 3, "src/dummyThirdParty/ptscotchDecomp": 3,
    "src/dummyThirdParty/scotchDecomp": 2, "src/transportModels/compressible": 1, "src/dummyThirdParty/metisDecomp": 1,
    "applications/utilities/mesh/manipulation/checkMesh": 20, "applications/solvers/compressible/rhoSimpleFoam": 18,
    "applications/utilities/mesh/generation/snappyHexMesh": 14, "applications/solvers/incompressible/simpleFoam": 10,
    "applications/utilities/mesh/manipulation/topoSet": 5, "applications/utilities/mesh/generation/blockMesh": 4,
    "applications/utilities/miscellaneous/foamDictionary": 1,
}


def size(d):
    if d in SECONDS:
        return SECONDS[d]
    files = open(os.path.join(of, d, "Make", "files")).read()
    n = len(re.findall(r"\.(C|cxx|cc|c|L|lyy|lyy-m4)\s*$", files, re.M))
    return 3.0 * max(n, 1)


work = ["src/OpenFOAM"] + libs + apps
load, part = [0.0] * shard[1], {}
for d in sorted(work, key=size, reverse=True):        # longest first, onto the least loaded part
    k = load.index(min(load))
    load[k] += size(d)
    part[d] = k
mine = [d for d in work if part[d] == shard[0] - 1]
sys.stderr.write("part %d/%d: %d folders, about %.0f of %.0f compile seconds\n" % (shard[0], shard[1], len(mine), load[shard[0] - 1], sum(load)))
print("\n".join(mine))
