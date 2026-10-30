#!/usr/bin/env python3
"""Build intake_cfd.js from intake_cfd_js_src.js by splicing in, verbatim, the three
texts that intake_cfd.py also writes: REPORT_PY (intake_report.py), README_WINDOWS and
the Python source itself (shipped inside 3-D case zips)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import intake_cfd as ic
src = open(os.path.join(HERE, "intake_cfd_js_src.js"), encoding="utf-8").read()
py = open(os.path.join(HERE, "intake_cfd.py"), encoding="utf-8").read()
def js(s):  # a JS string literal safe inside a <script> block
    return json.dumps(s, ensure_ascii=True).replace("</", "<\\/")
for tag, val in (("REPORT_PY", ic.REPORT_PY), ("README_WINDOWS", ic.README_WINDOWS), ("PY_SOURCE", py)):
    marker = "/*@%s@*/\"\"" % tag
    assert src.count(marker) == 1, tag
    src = src.replace(marker, js(val))
out = os.path.join(HERE, "intake_cfd.js")
open(out, "w", encoding="utf-8").write(src)
print("wrote", out, len(src), "bytes")
