"""Turbo manifold mode (turbomani.py): the page's settings into the header router, pure Python, no Fusion.

Checks: the collector marker on the turbine flange marker's axis, the merge plus collector length back from the flange (hand:
flange at x = 40 cm, 8.56 + 15.24 = 23.80 cm back -> x = 16.20 cm); the scrolls of a divided manifold each into their own
flange marker with one shared TubeSet (owner ids 0-3 and 100-103 apart); weld elbows hold every bend to 90 deg; the runner
lengths at the page's target within the router's 0.05 cm; a clear error for a scroll list that does not match the markers;
the wastegate window reported, not routed.
Scene: test_header.py's (a head face and a frame rail, four ports 10 cm apart pointing +x), 1.625 in (4.128 cm) tube, bend
radius 1.5 x OD, the clearance 1.27 cm (the scene has no hot body), target 76.2 cm; the routing itself is test_header's,
this checks the turbo glue around it. time_budget 1e9: no wall-clock limit, deterministic (as test_header_uel)."""
import os
import sys
import math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router as RT, test_router as T, turbomani as TMN

fails = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)

# 1. the pure glue
p, d = TMN.merge_marker((40.0, 13.95, -10.0), (2.0, 0.0, 0.0), 23.80)
ok(abs(p[0] - 16.20) < 1e-12 and p[1] == 13.95 and abs(d[0] - 1.0) < 1e-12, 'collector marker 23.80 cm back on the flange axis: %s' % (p,))
data = {'merge_len_mm': 85.6, 'collector_len_mm': 152.4, 'collector_out_mm': 61.76, 'elbows': True, 'scrolls': [[0, 3], [1, 2]],
        'gate': {'bore_mm': 38.0, 'lo_mm': 27, 'hi_mm': 126}}
sp = TMN.spec_for({'od': 4.7625, 'clr': 7.14, 'target': 30.0}, data)
ok(abs(sp['collector_len'] - 23.80) < 1e-12 and abs(sp['collector_out_d'] - 6.176) < 1e-12 and sp['max_bend_deg'] == 90.0, 'spec: collector 8.56 + 15.24 cm, out 6.176 cm, elbows at most 90 deg')
ok(TMN.groups(data, 4) == [[0, 3], [1, 2]] and TMN.groups({}, 4) == [[0, 1, 2, 3]], 'scroll groups, or one group of all ports')
try:
    TMN.groups({'scrolls': [[0, 3], [1]]}, 4); ok(False, 'a scroll list that misses a port is refused')
except ValueError as e:
    ok('cylinder order' in str(e), 'a scroll list that misses a port is refused: ' + str(e)[:80])

# 2. through the real router: the scene of test_header.py (a head face, a frame rail, ports 10 cm apart pointing +x, the
# merge at (35, 19, -45) going -z), the turbine flange marker 23.80 cm further on; undivided, then two scrolls, each with its
# own flange marker. The glue does not care which ports a scroll takes (the page's pairing is tested in turbomani_ui.js), so
# the scrolls here are ports 1+2 and 3+4 beside their own markers: a 1+4 / 2+3 split makes the runners cross, which this
# box scene makes the router search for many minutes on a loaded 2-core machine (seen: over 20 min)
head = T.box_mesh((-6, -10, -15), (0, 50, 15), 12)
rail = T.box_mesh((15, -20, -30), (22, 60, -24), 12)
sc = RT.Scene(cell=1.0); sc.add_mesh(*head); sc.add_mesh(*rail); sc.build((-10, -30, -100), (80, 70, 20), 10)
ports = [((0.0, 4.0 + 10.0 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
od = 4.128
rspec = {'od': od, 'clr': 1.5 * od, 'gap': 1.27, 'gap_tt': 0.32, 'target': 76.2, 'lead_start': 2.54, 'lead_end': 2.54,
         'min_straight': 0.0, 'max_bend_deg': 180.0, 'tol': 0.05, 'time_budget': 1e9}
TGT = 76.2
one = TMN.route(sc, ports, [((35.0, 19.0, -45.0 - 23.80), (0.0, 0.0, -1.0))], {'merge_len_mm': 85.6, 'collector_len_mm': 152.4, 'collector_out_mm': 61.76,
                                                                         'gate': data['gate']}, rspec)
L1 = one['lengths']
print('undivided:', one['msg'], ['%.3f' % x for x in L1])
ok(one['ok'] and len(L1) == 4 and max(abs(x - TGT) for x in L1) <= 0.05 + 1e-9, 'undivided: four runners at 76.2 cm within 0.05 cm')
ok(max(abs(a - b) for a, b in zip(one['jobs'][0]['collector_marker'][0], (35.0, 19.0, -45.0))) < 1e-9 and one['jobs'][0]['res'].get('collector') is not None,
   'its collector built from the merge plane 23.80 cm before the flange marker')
ok(any('not routed' in n and '38.0 mm' in n and '45 deg' in n for n in one['notes']), 'the wastegate window is reported, not routed')
two = TMN.route(sc, ports, [((35.0, 9.0, -45.0 - 23.80), (0.0, 0.0, -1.0)), ((35.0, 29.0, -45.0 - 23.80), (0.0, 0.0, -1.0))], dict(data, scrolls=[[0, 1], [2, 3]]), dict(rspec))
L2 = two['lengths']
print('divided:', two['msg'], ['%.3f' % x for x in L2])
ok(two['ok'] and len(L2) == 4 and max(abs(x - TGT) for x in L2) <= 0.05 + 1e-9, 'divided: four runners at 76.2 cm, two scrolls')
bends = [a for j in two['jobs'] for r in j['res']['primaries'] for a in (r.get('bend_angles') or [])]
ok(two['ok'] and len(L2) == 4 and max(abs(x - 38.0) for x in L2) <= 0.05 + 1e-9, 'divided: four runners at 38 cm, two scrolls')
ok(bends and max(bends) <= 90.5, 'weld elbows: no bend over 90 deg (the router\'s 0.5 deg tolerance) (largest %.1f)' % (max(bends) if bends else -1))
ok(two['jobs'][0]['spec']['tubes'] is two['jobs'][1]['spec']['tubes'], 'both scrolls share one TubeSet, so their runners keep clear of each other')
# tube to tube between the scrolls, brute force away from the ends
polys = [RT.path_points(r['elems'], 0.2) for j in two['jobs'] for r in j['res']['primaries'] if r and r.get('elems')]
worst = min(RT.vdist(a, b) for a in polys[1][len(polys[1]) // 4: 3 * len(polys[1]) // 4] for b in polys[2] + polys[3]) if len(polys) == 4 else 0
ok(worst >= od + 0.32 - 0.01, 'scroll 1 runner 2 keeps the tube gap from scroll 2: centres %.3f cm apart (need %.3f)' % (worst, od + 0.32))
print('FAILS', fails)
sys.exit(1 if fails else 0)
