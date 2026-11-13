"""Turbo manifold mode (turbomani.py): the page's settings into the header router, pure Python, no Fusion.

Checks: the collector marker on the turbine flange marker's axis, the merge plus collector length back from the flange (hand:
flange at x = 40 cm, 8.56 + 15.24 = 23.80 cm back -> x = 16.20 cm); the scrolls of a divided manifold each into their own
flange marker with one shared TubeSet (owner ids 0-3 and 100-103 apart); weld elbows hold every bend to 90 deg; the runner
lengths at the page's target within the router's 0.05 cm; a clear error for a scroll list that does not match the markers;
the wastegate window reported, not routed.
Scene: a head face (a box) with four ports 9.3 cm apart pointing +x, as test_header.py; 1.875 in (4.7625 cm) tube, bend
radius 1.5 x OD, the hot clearance 1.27 cm (the scene has no hot body), target 38 cm (a length the scene allows; the
page's shortest equal length is a planar minimum to a point, the router's collector ring needs its lead-ins)."""
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

# 2. through the real router: undivided, one flange marker; divided, two
head = T.box_mesh((-6, -10, -15), (0, 40, 15), 12)
sc = RT.Scene(cell=1.0); sc.add_mesh(*head); sc.build((-10, -30, -40), (90, 60, 40), 10)
ports = [((0.0, 0.0 + 9.3 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
rspec = {'od': 4.7625, 'clr': 1.5 * 4.7625, 'gap': 1.27, 'gap_tt': 0.32, 'target': 38.0, 'lead_start': 2.54, 'lead_end': 2.54,
         'min_straight': 0.0, 'max_bend_deg': 180.0, 'tol': 0.05, 'time_budget': 1e9}
one = TMN.route(sc, ports, [((50.0, 13.95, 0.0), (1.0, 0.0, 0.0))], {'merge_len_mm': 85.6, 'collector_len_mm': 152.4, 'collector_out_mm': 61.76,
                                                                   'gate': data['gate']}, rspec)
L1 = one['lengths']
print('undivided:', one['msg'], ['%.3f' % x for x in L1])
ok(one['ok'] and len(L1) == 4 and max(abs(x - 38.0) for x in L1) <= 0.05 + 1e-9, 'undivided: four runners at 38 cm within 0.05 cm')
ok(abs(one['jobs'][0]['collector_marker'][0][0] - (50.0 - 23.80)) < 1e-9 and one['jobs'][0]['res'].get('collector') is not None, 'its collector built from the merge plane 23.80 cm before the flange')
ok(any('not routed' in n and '38.0 mm' in n and '45 deg' in n for n in one['notes']), 'the wastegate window is reported, not routed')
two = TMN.route(sc, ports, [((50.0, 13.95, 5.0), (1.0, 0.0, 0.0)), ((50.0, 13.95, -5.0), (1.0, 0.0, 0.0))], dict(data), dict(rspec, clr=1.5 * 4.7625))
L2 = two['lengths']
print('divided:', two['msg'], ['%.3f' % x for x in L2])
bends = [a for j in two['jobs'] for r in j['res']['primaries'] for a in (r.get('bend_angles') or [])]
ok(two['ok'] and len(L2) == 4 and max(abs(x - 38.0) for x in L2) <= 0.05 + 1e-9, 'divided: four runners at 38 cm, two scrolls')
ok(bends and max(bends) <= 90.5, 'weld elbows: no bend over 90 deg (the router\'s 0.5 deg tolerance) (largest %.1f)' % (max(bends) if bends else -1))
ok(two['jobs'][0]['spec']['tubes'] is two['jobs'][1]['spec']['tubes'], 'both scrolls share one TubeSet, so their runners keep clear of each other')
# tube to tube between the scrolls, brute force away from the ends
polys = [RT.path_points(r['elems'], 0.2) for j in two['jobs'] for r in j['res']['primaries']]
worst = min(RT.vdist(a, b) for a in polys[0][len(polys[0]) // 4: 3 * len(polys[0]) // 4] for b in polys[2] + polys[3])
ok(worst >= 4.7625 + 0.32 - 0.01, 'scroll 1 runner 1 keeps the tube gap from scroll 2: centres %.3f cm apart (need %.3f)' % (worst, 4.7625 + 0.32))
print('FAILS', fails)
sys.exit(1 if fails else 0)
