#!/usr/bin/env python3
"""Check (or, with --write OLD, update) that web/index.html embeds openwam/wam_export.js and openwam/wam2t_export.js
exactly.

    python3 tools/sync_wam_export.py                  # exit 1 when a page copy differs from its file
    python3 tools/sync_wam_export.py --write OLD [NAME]   # OLD: the file as it was before an edit; its copy in the
                                                     # page is replaced by the file as it is now (NAME:
                                                     # wam_export.js, the default, or wam2t_export.js)
The page carries the OpenWAM writers inline (the program has no separate script files); make_wam.py and
make_wam2t.py are the references, and openwam/test_py_js.js and openwam/test_py_js_2t.js check the files against
them byte for byte."""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
page_p = os.path.join(ROOT, "web", "index.html")
NAMES = ["wam_export.js", "wam2t_export.js"]
page = open(page_p, encoding="utf-8").read()
read = lambda n: open(os.path.join(ROOT, "openwam", n), encoding="utf-8").read().rstrip("\n")
if len(sys.argv) > 2 and sys.argv[1] == "--write":
    name = sys.argv[3] if len(sys.argv) > 3 else NAMES[0]
    old = open(sys.argv[2], encoding="utf-8").read().rstrip("\n")
    if page.count(old) != 1:
        sys.exit("the page does not hold the old copy exactly once")
    open(page_p, "w", encoding="utf-8").write(page.replace(old, read(name)))
    print("web/index.html: %s updated" % name)
    sys.exit(0)
bad = 0
for n in NAMES:
    ok = page.count(read(n)) == 1
    bad += not ok
    print("web/index.html embeds openwam/%s: %s" % (n, "the same" if ok else "DIFFERENT"))
sys.exit(1 if bad else 0)
