"""Tack jig planner (jig.py): cradles under every piece of routed tubes, standing on one base level, the saddle top
never above the centreline over the block (so a piece drops in), other tubes cutting the blocks they pass through,
steep runs skipped and listed, measured sketch arcs turned into the same elements as routes."""
import math
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import router as RT
import jig as J

FAILS = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        FAILS.append(m)


def arc(p0, cen, nrm, ang_deg, R):
    """An arc from p0 about cen, turning ang_deg about nrm (right hand)."""
    a = math.radians(ang_deg)
    u0 = RT.vunit(RT.vsub(p0, cen))
    v = RT.vcross(nrm, u0)
    u1 = tuple(math.cos(a) * u0[k] + math.sin(a) * v[k] for k in range(3))
    p1 = tuple(cen[k] + R * u1[k] for k in range(3))
    return ('arc', p0, p1, cen, a, R * a, u0, u1), p1


od = 4.445                     # 1.75 in
R = 6.65                       # 2.62 in CLR
# tube A: 20 cm straight along +x at z = 10, a 90 deg bend toward +y (flat), 12 cm straight along +y
L1 = ('line', (0.0, 0.0, 10.0), (20.0, 0.0, 10.0), 20.0)
A1, pA = arc((20.0, 0.0, 10.0), (20.0, R, 10.0), (0.0, 0.0, 1.0), 90.0, R)
L2 = ('line', pA, (pA[0], pA[1] + 12.0, 10.0), 12.0)
tubeA = {'name': 'Primary 1', 'elems': [L1, A1, L2], 'od': od}
# tube B: crosses over tube A's first straight, rising at 20 deg, then a steep 75 deg rise
d = (0.0, math.cos(math.radians(20)), math.sin(math.radians(20)))
B0 = (10.0, -15.0, 8.0)
B1 = tuple(B0[k] + 30.0 * d[k] for k in range(3))
d2 = (0.0, math.cos(math.radians(75)), math.sin(math.radians(75)))
B2 = tuple(B1[k] + 15.0 * d2[k] for k in range(3))
tubeB = {'name': 'Primary 2', 'elems': [('line', B0, B1, 30.0), ('line', B1, B2, 15.0)], 'od': od}

p = J.plan([tubeA, tubeB], up=(0, 0, 1))
cs = p['cradles']
ca = [c for c in cs if c['tube'] == 'Primary 1']
cb = [c for c in cs if c['tube'] == 'Primary 2']
ok(abs(p['base'] - (min(8.0, 10.0) - od / 2 - 1.0)) < 1e-6, 'base level 1 cm under the lowest tube surface: %.3f cm' % p['base'])
ok(len(ca) == 4, 'tube A: a cradle on each piece, two on the 20 cm straight at 15 cm spacing... (%d: %s)' % (
    len(ca), ', '.join('%.1f' % c['s'] for c in ca)))
ok(all(abs(c['top'] - 10.0) < 1e-6 for c in ca), 'level tube: every saddle top at the centreline height')
ok(all(abs(c['height'] - (10.0 - p['base'])) < 1e-6 for c in ca), 'blocks reach from the base to the centreline')
bend = [c for c in ca if 20.0 < c['s'] < 20.0 + R * math.pi / 2]
ok(len(bend) == 1 and abs(bend[0]['s'] - (20.0 + R * math.pi / 4)) < 1e-6, 'one cradle at the middle of the bend piece')
if bend:
    c = bend[0]
    ok(abs(abs(c['d'][0]) - math.sqrt(0.5)) < 1e-6 and abs(abs(c['d'][1]) - math.sqrt(0.5)) < 1e-6,
       'the bend cradle points along the tangent there (45 deg)')
    # the saddle follows the arc: cut segments of tube A near the station lie on the arc to within the chord sag
    near = [s for s in c['cut'] if abs(s[2] - (od / 2 + 0.025)) < 1e-9]
    sag = max(abs(RT.vlen(RT.vsub(s[0], (20.0, R, 10.0))) - R) for s in near if abs(s[0][2] - 10.0) < 1e-9 and s[0][0] > 20.0 + 1e-9 and s[0][1] < R - 1e-9)
    ok(sag < 1e-6, 'the bend saddle is cut along the arc itself (points on the 2.62 in radius)')
ok(len(cb) >= 1 and all(c['top'] <= RT.vdot(c['centre'], (0, 0, 1)) + c['height'] / 2 + 1e-9 for c in cb), 'tube B: cradles on its 20 deg run')
ok(all(c['top'] < 8.0 + 30.0 * math.sin(math.radians(20)) for c in cb) and
   all(abs(c['top'] - (8.0 + (c['s'] - 1.0 / math.cos(math.radians(20))) * math.sin(math.radians(20)))) < 1e-6 for c in cb if c['s'] < 29.0),
   'rising tube: saddle top at the lowest centreline point under the block (its downhill end, 1 cm level from the station, '
   'so 1 / cos 20 deg along the tube)')
ok(any(k['tube'] == 'Primary 2' and k['s'] > 30.0 for k in p['skipped']) and any('from level' in n for n in p['notes']),
   'the 75 deg rise gets no cradle, and the note says where')
# a tube C crossing under tube A at x = 15, through the block there (it would cut it in pieces: seen live in Fusion,
# 3 lumps): the cradle slides along tube A clear of C
tubeC = {'name': 'Crossover', 'elems': [('line', (15.0, -10.0, 6.0), (15.0, 10.0, 6.0), 20.0)], 'od': 5.08}
pc = J.plan([tubeA, tubeC])
pa = [c for c in pc['cradles'] if c['tube'] == 'Primary 1']
moved = [c for c in pa if 9.0 < c['s'] < 21.0]
ok(len(moved) == 1 and abs(moved[0]['s'] - 15.0) >= 2.0 - 1e-9 and abs(moved[0]['centre'][0] - 15.0) > (2.0 + 5.08) / 2,
   'the cradle over the crossing tube slides clear of it (to %.1f cm)' % (moved[0]['s'] if moved else -1))
ok(len(pa) == 4, 'tube A still has a cradle on each piece (%d)' % len(pa))
# a tube right beside a block (not through it) still cuts what it touches: a parallel tube 3 cm to the side
tubeD = {'name': 'Beside', 'elems': [('line', (0.0, 3.6, 10.0), (20.0, 3.6, 10.0), 20.0)], 'od': 4.445}
pd = J.plan([tubeA, tubeD])
da = [c for c in pd['cradles'] if c['tube'] == 'Primary 1' and c['s'] < 20.0]
ok(len(da) == 2 and all(abs(c['s'] - x) < 1e-9 for c, x in zip(da, (5.0, 15.0))) and
   all(any(abs(sg[0][1] - 3.6) < 1e-9 for sg in c['cut']) for c in da),
   'a tube beside the block (a header bundle) does not move it: it notches the side wall (the cradle holds both)')
ok(all(len(c['foot']['holes']) == 2 and abs(c['foot']['width'] - (od + 1.6 + 4.8)) < 1e-9 for c in cs), 'each foot: two M6 holes')
# a crossing tube under a level run that turns steep within a block length or two: the cradle may not slide onto the
# steep part, and the note must say a tube runs under it, not quote the level run's angle (seen live on a Tri-Y)
L1e = ('line', (0.0, 0.0, 10.0), (16.0, 0.0, 10.0), 16.0)
up70 = (math.cos(math.radians(70)), 0.0, math.sin(math.radians(70)))
L2e = ('line', (16.0, 0.0, 10.0), tuple((16.0, 0.0, 10.0)[k] + 20.0 * up70[k] for k in range(3)), 20.0)
tubeE = {'name': 'Kinked', 'elems': [L1e, L2e], 'od': od}
tubeF = {'name': 'Under', 'elems': [('line', (8.0, -10.0, 6.0), (8.0, 10.0, 6.0), 20.0), ('line', (8.0, 10.0, 6.0), (12.0, 10.0, 6.0), 4.0)], 'od': 5.08}
pe = J.plan([tubeE, tubeF])
why = [k['why'] for k in pe['skipped'] if k['tube'] == 'Kinked' and k['s'] < 16.0]
ce = [c for c in pe['cradles'] if c['tube'] == 'Kinked' and c['s'] < 16.0]
ok(all('runs under' in w for w in why) and all(RT.vdot(c['d'], (0, 0, 1)) < 0.5 for c in ce),
   'a blocked cradle on a level run never lands on the steep part, and its note names the tube under it: %s' % (why or [c['s'] for c in ce]))
s = J.summary(p)
ok(s['count'] == len(cs) and s['per_tube']['Primary 1'] == 4, 'summary: %d cradles, tallest %.1f cm' % (s['count'], s['tallest']))

# a measured sketch (cadtools segs) becomes the same elements
segs = [{'kind': 'line', 'p0': (0, 0, 0), 'p1': (10, 0, 0), 't0': (1, 0, 0), 'length': 10.0, 'radius': None},
        {'kind': 'arc', 'p0': (10, 0, 0), 'p1': (10 + R, R, 0), 't0': (1, 0, 0), 'length': R * math.pi / 2, 'radius': R}]
el = J.segs_to_elems(segs)
ok(el[1][0] == 'arc' and RT.vlen(RT.vsub(el[1][3], (10, R, 0))) < 1e-9 and abs(el[1][4] - math.pi / 2) < 1e-9,
   'a sketch arc: centre (10, R, 0), 90 deg')
mid = RT.elem_point(el[1], 0.5)
ok(abs(RT.vlen(RT.vsub(mid, (10, R, 0))) - R) < 1e-9 and mid[0] > 10 and mid[1] < R, 'its middle point on the arc')
try:
    J.plan([])
    ok(False, 'no tubes refused')
except ValueError as e:
    ok('No tubes' in str(e), 'no tubes refused: ' + str(e))
print('FAILS:', FAILS)
sys.exit(1 if FAILS else 0)
