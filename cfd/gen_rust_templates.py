#!/usr/bin/env python3
"""Writes rust/et_host/src/cfd_templates.rs: the text templates of intake_cfd.py that the Rust case generator
(rust/et_host/src/cfd_gen.rs) fills in with its Python-style % formatter, taken from the Python source itself (each
by its function and line), so the two cannot drift apart. Run it after editing intake_cfd.py; with --check it only
says whether the Rust file is current (CI runs that)."""
import ast, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import intake_cfd as ic  # noqa: E402

OUT = os.path.join(HERE, "..", "rust", "et_host", "src", "cfd_templates.rs")
# name: (function, the template's first line in intake_cfd.py, which string on that line)
WANT = {
    "FOAM_HDR": ("CaseWriter.foam", '\nFoamFile'), "FOAM_LOC": ("CaseWriter.foam", '    location'),
    "FOAM_OBJ": ("CaseWriter.foam", '    object'), "FOAM_SEP": ("CaseWriter.foam", '// * *'),
    "FOAM_END": ("CaseWriter.foam", '\n\n// ****'),
    "STL_FACET": ("write_stl_ascii", '  facet normal'), "STL_VERTEX": ("write_stl_ascii", '      vertex'),
    "STL_ENDFACET": ("write_stl_ascii", '    endloop'),
    "FF_PROV_AMB": ("field_files", 'ambient.p_pa'), "FF_PROV_TURB": ("field_files", 'inflow turbulence'),
    "FF_BODY": ("field_files", 'dimensions'), "FF_OUT_U_COMP": ("field_files", 'type            flowRateOutletVelocity;\nmassFlowRate'),
    "FF_OUT_U_INC": ("field_files", 'type            flowRateOutletVelocity;\nvolumetricFlowRate'),
    "FF_PROV_OUT_MASS": ("field_files", 'outlet: imposed mass flow'), "FF_PROV_SECTOR": ("field_files", ' (x 1/'),
    "FF_OUT_U_PR": ("field_files", 'type            pressureInletOutletVelocity;'),
    "FF_OUT_P_PR": ("field_files", 'type            uniformFixedValue;'), "FF_PROV_OUT_PR": ("field_files", 'outlet: static pressure p0/PR'),
    "FF_KIN_GAUGE": ("field_files", 'kinematic gauge'), "FF_IN_U_EXH": ("field_files", 'type            flowRateInletVelocity;'),
    "FF_OUT_U_EXH": ("field_files", 'type            inletOutlet;\ninletValue      uniform (0 0 0);'),
    "FF_FIXED_9G": ("field_files", 'type            fixedValue;\nvalue           uniform %.9g;'),
    "FF_PROV_IN_EXH": ("field_files", 'inlets: imposed'), "FF_PROV_OUT_EXH": ("field_files", 'outlet: static pressure = ambient'),
    "FF_PROV_TURB_EXH": ("field_files", 'inlet turbulence'), "FF_INOUT_9G": ("field_files", 'type            inletOutlet;\ninletValue      uniform %.9g;'),
    "FF_PROV_TGAS": ("field_files", 'gas temperature'), "FF_CALC0": ("field_files", 'type            calculated;'),
    "FF_ALPHAT_WALL": ("field_files", 'type            compressible::alphatWallFunction;'),
    "FF_PROV_PRT": ("field_files", 'turbulent Prandtl'), "FF_FIXED_6G": ("field_files", 'type            fixedValue;\nvalue           uniform %.6g;'),
    "FF_INOUT_6G": ("field_files", 'type            inletOutlet;\ninletValue      uniform %.6g;'),
    "FF_KQR": ("field_files", 'type            kqRWallFunction;'), "FF_OMEGA_WALL": ("field_files", 'type            omegaWallFunction;'),
    "FF_NUT_WALL": ("field_files", 'type            nutUSpaldingWallFunction;'),
    "FF_ATM_U": ("field_files", 'type            pressureInletOutletVelocity;'),
    "FF_ATM_P_COMP": ("field_files", 'type            totalPressure;\np0              uniform %.9g'),
    "FF_ATM_T": ("field_files", 'type            totalTemperature;'),
    "FF_ATM_P_INC": ("field_files", 'type            totalPressure;\np0              uniform 0'),
    "FF_PROV_P_INC": ("field_files", 'p is kinematic'), "FF_PROV_NUT_EXH": ("field_files", 'walls: nutUSpaldingWallFunction (valid from y+~1 to the log layer)'),
    "FF_PROV_NUT": ("field_files", 'walls: nutUSpaldingWallFunction (valid from y+~1 to the log layer, so'),
    "PH_PROV_AIR": ("physics_files", 'dry air'), "PH_PROV_SUTH": ("physics_files", 'Sutherland'),
    "PH_THERMO": ("physics_files", 'thermoType'), "PH_TRANSPORT": ("physics_files", 'transportModel'),
    "PH_PROV_INC": ("physics_files", 'incompressible: nu'), "PH_TURB": ("physics_files", 'simulationType'),
    "PH_PROV_T1": ("physics_files", 'k-omega SST'), "PH_PROV_T2": ("physics_files", 'the shear-stress'),
    "PH_PROV_T3": ("physics_files", 'gradients and'), "PH_PROV_RE": ("physics_files", 'Estimated tract Re'),
    "NU_PSOLVER_3D": ("numerics_files", 'solver          GAMG'), "NU_PSOLVER_2D": ("numerics_files", 'solver          PCG'),
    "NU_SCHEMES": ("numerics_files", 'ddtSchemes'), "NU_SOL_COMP": ("numerics_files", 'solvers\n{\n    p\n    {\n        @PSOLVER@\n        tolerance       1e-12;\n        relTol          0.01;\n    }\n    "(U|h'),
    "NU_SOL_INC": ("numerics_files", 'solvers\n{\n    p\n    {\n        @PSOLVER@\n        tolerance       1e-12;\n        relTol          0.01;\n    }\n    "(U|k'),
    "CD_BODY": ("control_dict", 'application     %s;'),
    "FO_PATCH_SUM": ("fo_patch_sum", '    %s'), "FO_PATCH_AVG": ("fo_patch_avg", '    %s'), "FO_ZONE": ("fo_zone", '    %s'),
    "FO_PLANE_SAMPLED": ("fo_plane_sampled", '    %s'), "SURF_PLANE": ("surfaces_fo", '            %s'),
    "SURF_FO": ("surfaces_fo", '    planes'),
    "ALLRUN_MESH_2D": ("allrun_text", 'run blockMesh\n'), "ALLRUN_MESH_3D": ("allrun_text", 'run blockMesh\nrun surfaceFeatureExtract'),
    "ALLRUN_HEAD": ("allrun_text", 'set -u'), "ALLRUN_TAIL": ("allrun_text", 'checkMesh > log.checkMesh'),
    "ALLCLEAN": ("allclean_text", 'cd "$(dirname'),
    "GC_YPLUS_RES": ("generate_case", '    yPlus'), "GC_DECOMPOSE": ("generate_case", 'numberOfSubdomains'),
    "M3_BLOCKMESH": ("write_3d_mesh", 'scale 1;'), "M3_SFE": ("write_3d_mesh", 'domain.stl\n{'), "M3_SHM": ("write_3d_mesh", 'castellatedMesh'),
    "MQ_INCLUDE": ("write_3d_mesh", '#includeEtc'),
    "MX_BLOCKMESH": ("write_3d_mesh_exhaust", 'scale 1;'), "MX_SFE": ("write_3d_mesh_exhaust", 'domain.stl\n{'),
    "MX_SHM": ("write_3d_mesh_exhaust", 'castellatedMesh'),
    "FF_NOSLIP": ("field_files", 'type            noSlip'), "FF_ZEROGRAD": ("field_files", 'type            zeroGradient;'),
    "FF_ADIABATIC": ("field_files", 'type            zeroGradient;   //'), "FF_CYCLIC": ("field_files", 'type cyclic;'),
    "FF_P_ABS": ("field_files", 'p is absolute'), "FF_PROV_OP": ("field_files", 'operating point: %s'),
    "FF_UNIFORM_9G": ("field_files", 'uniform %.9g'), "FF_UNIFORM_6G": ("field_files", 'uniform %.6g'), "FF_UNIFORM_0": ("field_files", 'uniform 0'),
    "FF_UNIFORM_V0": ("field_files", 'uniform (0 0 0)'), "FF_SPLIT_ITEM": ("field_files", '%s %.3f'),
    "NU_DIV_U": ("numerics_files", 'div(phi,U)'), "NU_DIV_H": ("numerics_files", 'div(phi,h)'), "NU_DIV_K": ("numerics_files", 'div(phi,K)'),
    "NU_DIV_EKP": ("numerics_files", 'div(phi,Ekp)'), "NU_DIV_PHID": ("numerics_files", 'div(phid,p)'),
    "NU_DIV_RHONU": ("numerics_files", 'div(((rho*nuEff)'), "NU_DIV_NU": ("numerics_files", 'div((nuEff'),
    "NU_DIV_KK": ("numerics_files", 'div(phi,k)'), "NU_DIV_OMEGA": ("numerics_files", 'div(phi,omega)'),
    "NU_LIM_3D": ("numerics_files", 'limited corrected 0.5'), "NU_PROV1": ("numerics_files", 'second-order'),
    "NU_PROV2": ("numerics_files", 'cell-limited'), "NU_PROV3": ("numerics_files", 'laplacian/snGrad'),
    "NU_RELAX_COMP": ("numerics_files", 'p 0.3 / rho 0.05 / U, h, k, omega 0.7'), "NU_RELAX_INC": ("numerics_files", 'p 0.3 / U, k, omega 0.7'),
    "NU_SP_COMP": ("numerics_files", 'SIMPLE, relaxation p 0.3 / rho'), "NU_SP_INC": ("numerics_files", 'SIMPLE, relaxation p 0.3 / U'),
    "NU_PSOLV": ("numerics_files", '; p solver'), "NU_SOLVER": ("numerics_files", 'solver %s: %s'),
    "NU_TRANSONIC": ("numerics_files", 'transonic formulation'), "NU_RESID": ("numerics_files", 'residual targets'),
    "NU_WATCHDOG": ("numerics_files", 'watchdog run by'),
    "CD_PROV1": ("control_dict", 'application %s chosen'), "CD_PROV2": ("control_dict", 'endTime %d'),
    "CD_PROV3": ("control_dict", 'function objects:'), "CD_PROV4": ("control_dict", 'each named plane'),
    "CD_PROV5": ("control_dict", 'Convergence stop:'), "CD_PROV6": ("control_dict", 'inflow mass flow changes'),
    "GC_TOPO_EMPTY": ("generate_case", 'actions\n(\n);\n'), "GC_TOPO_PROV_3D": ("generate_case", '3-D case: measurement planes'),
    "GC_TOPO_PROV_EXH": ("generate_case", 'exhaust component: measurement planes'), "GC_DECOMP_PROV": ("generate_case", 'numberOfSubdomains is overwritten'),
    "GC_REPORT_PROV1": ("generate_case", 'reads postProcessing/'), "GC_REPORT_PROV2": ("generate_case", 'reference plane for K and Cd'),
    "GC_MOUNT_NOTE": ("generate_case", '3-D parametric cases are meshed'),
    "M3_BPROV1": ("write_3d_mesh", 'background box: plenum'), "M3_BPROV2": ("write_3d_mesh", '  plus the tract'),
    "M3_BPROV3": ("write_3d_mesh", 'only the plenum part'), "M3_BPROV4": ("write_3d_mesh", 'its outer faces'),
    "M3_SFE_PROV": ("write_3d_mesh", 'feature edges (lip'), "M3_PROV1": ("write_3d_mesh", 'tract walls refined'),
    "M3_PROV2": ("write_3d_mesh", 'mouth region'), "M3_PROV3": ("write_3d_mesh", 'wall-function layers'),
    "M3_PROV4": ("write_3d_mesh", 'locationInMesh is inside the plenum'), "MQ_PROV": ("write_3d_mesh", 'standard snappyHexMesh quality'),
    "M3_NOTE": ("write_3d_mesh", '3-D snappyHexMesh, roughly'),
    "MX_BPROV1": ("write_3d_mesh_exhaust", "background box: the part's"), "MX_BPROV2": ("write_3d_mesh_exhaust", 'the box is discarded'),
    "MX_BPROV3": ("write_3d_mesh_exhaust", 'inlets %s extruded'), "MX_SFE_PROV": ("write_3d_mesh_exhaust", 'feature edges (merge'),
    "MX_REG_TRACT": ("write_3d_mesh_exhaust", '            tract_wall      { name'), "MX_REG_INLET": ("write_3d_mesh_exhaust", '            inlet_wall      { name'),
    "MX_REG_EXT": ("write_3d_mesh_exhaust", '            extension_wall  { name'), "MX_REG_OUTLET": ("write_3d_mesh_exhaust", '            outlet          { name'),
    "MX_REG_FMT": ("write_3d_mesh_exhaust", '            %-15s'), "MX_REF_TRACT": ("write_3d_mesh_exhaust", '                tract_wall      { level'),
    "MX_REF_INLET": ("write_3d_mesh_exhaust", '                inlet_wall      { level'), "MX_REF_EXT": ("write_3d_mesh_exhaust", '                extension_wall  { level'),
    "MX_REF_OUTLET": ("write_3d_mesh_exhaust", '                outlet          { level'), "MX_REF_FMT": ("write_3d_mesh_exhaust", '                %-15s'),
    "MX_PROV1": ("write_3d_mesh_exhaust", 'walls refined to level'), "MX_PROV2": ("write_3d_mesh_exhaust", 'wall-function layers'),
    "MX_PROV3": ("write_3d_mesh_exhaust", 'locationInMesh is inside the outlet'), "MX_NOTE": ("write_3d_mesh_exhaust", '3-D snappyHexMesh (exhaust'),
    "PV_GEN": ("CaseWriter._provenance", '%s Generated by'), "PV_INPUTS": ("CaseWriter._provenance", '%s Design inputs'),
    "PV_LINE": ("CaseWriter._provenance", '%s   %s'), "PV_DONOT": ("CaseWriter._provenance", '%s Do not edit'),
    "STL_SOLID": ("write_stl_ascii", 'solid %s'), "STL_ENDSOLID": ("write_stl_ascii", 'endsolid %s'),
}
# templates that differ only in what follows the start: matched exactly at their start, the first in source order


def funcs(node, prefix=""):
    for n in ast.iter_child_nodes(node):
        if isinstance(n, ast.FunctionDef):
            yield prefix + n.name, n
        elif isinstance(n, ast.ClassDef):
            yield from funcs(n, n.name + ".")


def strings(fn):
    out = [c for c in ast.walk(fn) if isinstance(c, ast.Constant) and isinstance(c.value, str)]
    out.sort(key=lambda c: (c.lineno, c.col_offset))
    return [c.value for c in out]


def rust_str(s):
    hashes = 1
    while ('"' + "#" * hashes) in s:
        hashes += 1
    return "r" + "#" * hashes + '"' + s + '"' + "#" * hashes


def build():
    tree = ast.parse(open(os.path.join(HERE, "intake_cfd.py"), encoding="utf-8").read())
    by = dict(funcs(tree))
    lines = ["// Generated by cfd/gen_rust_templates.py from cfd/intake_cfd.py: do not edit; run the script after changing",
             "// the Python. The Python's own %-format templates, filled in by cfd_gen.rs with pyfmt::pct.", ""]
    for name, (fn, start) in WANT.items():
        cands = [s for s in strings(by[fn]) if s.startswith(start)]
        if not cands:
            sys.exit("no template in %s starting %r (%s)" % (fn, start, name))
        lines.append("pub const %s: &str = %s;" % (name, rust_str(cands[0])))
    for name in ("FOAM_BANNER", "README_WINDOWS", "REPORT_PY", "GENERATOR", "VERSION", "FOAM_VERSION"):
        lines.append("pub const %s: &str = %s;" % (name, rust_str(getattr(ic, name))))
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    text = build()
    if "--check" in sys.argv:
        cur = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if cur != text:
            print("FAIL rust/et_host/src/cfd_templates.rs is out of date: run python3 cfd/gen_rust_templates.py")
            sys.exit(1)
        print("cfd_templates.rs is current")
    else:
        open(OUT, "w", encoding="utf-8", newline="\n").write(text)
        print("wrote", OUT, len(text), "bytes")
