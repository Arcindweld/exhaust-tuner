"""Libraries (source folders) the Exhaust Tuner CFD cases need, in an order where every library comes after the
libraries it links to. Reads Make/files (LIB = ...) and Make/options (EXE_LIBS / LIB_LIBS) of the OpenFOAM source.
    python3 libs_for_apps.py OPENFOAM_DIR app_dir... > order.txt
    python3 libs_for_apps.py OPENFOAM_DIR --shard 2/4 app_dir...
The second form splits the compile work (src/OpenFOAM, the libraries and the programs) into n parts of about the
same size, for compile-only CI jobs that run side by side and fill one compiler cache (linking needs the whole set
and runs afterwards). Sizes are source-file counts times a rough cost per file for the template-heavy libraries.
Libraries with a ThirdParty and a dummy implementation (scotch, metis, kahip, ptscotch) use the dummy one."""
import os, re, sys

of = sys.argv[1]
args = sys.argv[2:]
shard = None
if args[:1] == ["--shard"]:
    i, n = (int(x) for x in args[1].split("/"))
    shard, args = (i, n), args[2:]
apps = args
CASE_LIBS = ["fieldFunctionObjects", "utilityFunctionObjects", "sampling"]   # loaded by the cases' controlDict
SPECIAL = {"OpenFOAM", "Pstream", "OSspecific"}   # built first by build_mingw.sh, as src/Allwmake does for Mingw

libdir = {}
for d, _, fs in os.walk(os.path.join(of, "src")):
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
if shard is None:
    print("\n".join(libs))
    sys.exit(0)

# relative compile cost per source file (mostly instantiations of large templates); 1 for anything else
COST = {"src/TurbulenceModels/compressible": 60, "src/TurbulenceModels/incompressible": 15,
        "src/TurbulenceModels/schemes": 10, "src/TurbulenceModels/turbulenceModels": 2,
        "src/thermophysicalModels/basic": 10, "src/thermophysicalModels/reactionThermo": 12,
        "src/thermophysicalModels/chemistryModel": 20, "src/thermophysicalModels/specie": 5,
        "src/thermophysicalModels/solidThermo": 10, "src/thermophysicalModels/solidSpecie": 10,
        "src/thermophysicalModels/SLGThermo": 5, "src/thermophysicalModels/radiation": 2,
        "src/combustionModels": 6, "src/phaseSystemModels/reactingEuler/multiphaseSystem": 3,
        "src/phaseSystemModels/multiphaseInter/phasesSystem": 6, "src/phaseSystemModels/reactingEuler/saturationModels": 2,
        "src/finiteVolume": 1.5, "src/functionObjects/field": 2, "src/fvOptions": 3, "src/atmosphericModels": 2,
        "src/thermoTools": 3, "applications/solvers/compressible/rhoSimpleFoam": 25,
        "applications/solvers/incompressible/simpleFoam": 12, "applications/utilities/mesh/generation/snappyHexMesh": 8}

def size(d):
    files = open(os.path.join(of, d, "Make", "files")).read()
    n = len(re.findall(r"\.(C|cxx|cc|c|L|lyy|lyy-m4)\s*$", files, re.M))
    return max(n, 1) * COST.get(d, 3 if d.startswith("applications/") else 1)

work = ["src/OpenFOAM"] + libs + apps
load, part = [0.0] * shard[1], {}
for d in sorted(work, key=size, reverse=True):        # longest first, onto the least loaded part
    k = load.index(min(load))
    load[k] += size(d)
    part[d] = k
mine = [d for d in work if part[d] == shard[0] - 1]
sys.stderr.write("part %d/%d: %d folders, size %.0f of %.0f\n" % (shard[0], shard[1], len(mine), load[shard[0] - 1], sum(load)))
print("\n".join(mine))
