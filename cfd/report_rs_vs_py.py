#!/usr/bin/env python3
"""The case report in Rust (rust/et_host/src/cfd_report.rs, what the program runs) against intake_report.py (the
REPORT_PY text in intake_cfd.py, what a case run by hand uses), byte for byte: results.json, results.txt and the
printed text, on the results of a real OpenFOAM run (tests/report_case: a 2-D sector intake with nine sampled planes)
and on variants of it that reach the other paths (incompressible, an exhaust component with one or two inlets and an
inlet without data, no sampled planes, labels and areas of every type with non-ASCII names, no results at all).

    python3 cfd/report_rs_vs_py.py [path to exhaust-tuner-host]

Needs Python 3.12 or later: sum() of floats there adds with Neumaier's compensation, as the Python the program
bundles does and as the Rust report does; on an older Python the sums can differ in the last digit, so the test
says so and stops."""
import json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import intake_cfd as ic  # noqa: E402

if sys.version_info < (3, 12):
    print("report_rs_vs_py: Python %d.%d adds sums without compensation; needs 3.12 or later" % sys.version_info[:2])
    print("skipped")
    sys.exit(0)
host = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "rust", "target", "release",
                                                          "exhaust-tuner-host" + (".exe" if os.name == "nt" else ""))
if not os.path.isfile(host):
    print("report_rs_vs_py: host program not built (%s)" % host)
    print("skipped")
    sys.exit(0)
BASE = os.path.join(HERE, "tests", "report_case")
info0 = json.load(open(os.path.join(BASE, "case_info.json")))
names = [p["name"] for p in info0["planes"]]
tdir = sorted(os.listdir(os.path.join(BASE, "postProcessing", "planes")))[-1]
fails = []


def mv(a, b):
    if os.path.isdir(b):
        shutil.rmtree(b)
    os.rename(a, b)


def exh(i, d):
    a, b = names[0], names[-1]
    i.update(kind="exhaust", inlets=[a, "nowhere"], A_in_total_m2=3.1e-4, inlet_areas_m2={a: 3.1e-4}, split={a: 1.0})
    for p in i["planes"]:
        if p["name"] == b:
            p["name"] = "exit"
    pl = os.path.join(d, "postProcessing", "planes", tdir)
    os.rename(os.path.join(pl, b + ".vtk"), os.path.join(pl, "exit.vtk"))
    for pre in ("p_", "mdot_"):
        s = os.path.join(d, "postProcessing", pre + b)
        if os.path.isdir(s):
            mv(s, os.path.join(d, "postProcessing", pre + "exit"))
    mv(os.path.join(d, "postProcessing", "mdot_atmosphere"), os.path.join(d, "postProcessing", "mdot_" + a))


def exh2(i, d):
    exh(i, d)
    i.update(inlets=[names[0], names[1]], A_in_total_m2=5.1e-4, split={names[0]: 0.6, names[1]: 0.4})
    i["inlet_areas_m2"][names[1]] = 2.0e-4


def labels(i, d):
    for k, p in enumerate(i["planes"]):
        p["label"] = ["1D", None, 3, "x"][k % 4]
        if k == 1:
            p["area_geometric_m2"] = 0
        if k == 2:
            p["area_geometric_m2"] = 4.2e-4
    i.update(name="café “test”", reference_plane=names[2], conv_window=50.0)


VARIANTS = [
    ("the run as it is", lambda i, d: None),
    ("incompressible", lambda i, d: i.update(compressible=False)),
    ("exhaust, one inlet and one without data", exh),
    ("exhaust, two inlets", exh2),
    ("no sampled planes, an int flow_scale", lambda i, d: (shutil.rmtree(os.path.join(d, "postProcessing", "planes")), i.update(flow_scale=36))),
    ("labels and areas of every type", labels),
    ("no results yet", lambda i, d: shutil.rmtree(os.path.join(d, "postProcessing", "mdot_outlet"))),
]
tmp = tempfile.mkdtemp(prefix="report_rs_vs_py_")
# UTF-8 as the Rust writes: Windows Python otherwise writes results.txt in the ANSI code page (cp1252) and reads the
# program's printed text with it
env = dict(os.environ, PYTHONUTF8="1")
for tag, f in VARIANTS:
    outs = {}
    for who in ("py", "rs"):
        d = os.path.join(tmp, tag.replace(" ", "_").replace(",", ""), who)
        shutil.copytree(os.path.join(BASE, "postProcessing"), os.path.join(d, "postProcessing"))
        info = json.loads(json.dumps(info0))
        f(info, d)
        json.dump(info, open(os.path.join(d, "case_info.json"), "w"), indent=1)
        if who == "py":
            open(os.path.join(d, "intake_report.py"), "w", encoding="utf-8").write(ic.REPORT_PY.lstrip("\n"))
            r = subprocess.run([sys.executable, "intake_report.py"], cwd=d, capture_output=True, text=True, encoding="utf-8", env=env)
        else:
            r = subprocess.run([host, "--cfd-report", d], capture_output=True, text=True, encoding="utf-8", env=env)
        read = lambda n: open(os.path.join(d, n), "rb").read() if os.path.exists(os.path.join(d, n)) else None
        # the script's last stdout line when it stops is its reason (a traceback otherwise, on stderr)
        outs[who] = (r.returncode, r.stdout, read("results.json"), read("results.txt"))
    py, rs = outs["py"], outs["rs"]
    same = py == rs
    why = "" if same else " (exit %s vs %s; json %s; txt %s; printed %s)" % (
        py[0], rs[0], "same" if py[2] == rs[2] else "differs", "same" if py[3] == rs[3] else "differs",
        "same" if py[1] == rs[1] else "differs")
    print(("PASS " if same else "FAIL ") + tag + ": the same bytes" + why +
          ("" if py[2] else " (no results.json: " + py[1].strip()[:60] + ")"))
    if not same:
        fails.append(tag)
shutil.rmtree(tmp, ignore_errors=True)
print("FAILS: %s" % fails if fails else "all passed")
sys.exit(1 if fails else 0)
