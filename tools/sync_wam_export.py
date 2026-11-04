#!/usr/bin/env python3
"""Check (or, with --write OLD, update) that web/index.html embeds openwam/wam_export.js exactly.

    python3 tools/sync_wam_export.py            # exit 1 when the page's copy differs from the file
    python3 tools/sync_wam_export.py --write OLD   # OLD: the file as it was before an edit; its copy in the
                                                   # page is replaced by the file as it is now
The page carries the OpenWAM writer inline (the program has no separate script files); make_wam.py is the
reference and openwam/test_py_js.js checks the file against it byte for byte."""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
page_p, js_p = os.path.join(ROOT, "web", "index.html"), os.path.join(ROOT, "openwam", "wam_export.js")
page, js = open(page_p, encoding="utf-8").read(), open(js_p, encoding="utf-8").read().rstrip("\n")
if len(sys.argv) > 2 and sys.argv[1] == "--write":
    old = open(sys.argv[2], encoding="utf-8").read().rstrip("\n")
    if page.count(old) != 1:
        sys.exit("the page does not hold the old copy exactly once")
    open(page_p, "w", encoding="utf-8").write(page.replace(old, js))
    print("web/index.html: wam_export.js updated")
    sys.exit(0)
ok = page.count(js) == 1
print("web/index.html embeds openwam/wam_export.js: " + ("the same" if ok else "DIFFERENT"))
sys.exit(0 if ok else 1)
