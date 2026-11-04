"""hangers.py: the tube frame at the click, the page's flat parts put on the tube (across it, coped to its curve; along
it, a fin), a body tab beside the pipe tab, a rod's path, the grommet and the ring clamp's bolt holes. Payloads come
from web/tests/hang_ui.js when it has written them (tests/hang_payloads.json), else a small one made here."""
import json
import math
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import hangers as H

FAILS = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        FAILS.append(m)


def dist_axis(p, fr):
    d = H._sub(p, fr['S'])
    d = H._v(d, fr['Z'], -H._dot(d, fr['Z']))
    return math.sqrt(H._dot(d, d))


# a tube along a slanted axis, clicked on its side; the mount picked off to one side and along a bit
ax_p, ax_d = (10.0, -5.0, 3.0), (1.0, 2.0, 0.5)
Z = H._unit(ax_d)
side = H._unit(H._cross(Z, (0.0, 0.0, 1.0)))
Ro_cm = 3.81
click = H._v(H._v(ax_p, Z, 7.0), side, Ro_cm)
fr = H.frame(ax_p, ax_d, click)
orth = max(abs(H._dot(fr[a], fr[b])) for a, b in (('X', 'Y'), ('Y', 'Z'), ('X', 'Z')))
ok(orth < 1e-12 and abs(H._dot(H._cross(fr['X'], fr['Y']), fr['Z']) - 1.0) < 1e-12, 'the frame is right-handed and square')
ok(H._dot(H._sub(fr['S'], ax_p), Z) - 7.0 < 1e-9 and dist_axis(fr['S'], fr) < 1e-9, 'S is on the axis, level with the click')
ok(H._dot(fr['Y'], side) > 1 - 1e-12 and fr['reach_cm'] is None, 'Y points out through the click; no reach without a mount')
mount = H._v(H._v(H._v(ax_p, Z, 9.0), side, 6.0), H._cross(side, Z), 2.0)
fm = H.frame(ax_p, ax_d, click, mount)
ok(abs(fm['reach_cm'] - math.hypot(6.0, 2.0)) < 1e-9, 'the reach to the mount, square to the tube: %.4f cm' % fm['reach_cm'])
try:
    H.frame(ax_p, ax_d, H._v(ax_p, Z, 3.0))
    ok(False, 'a click on the axis with no fallback is refused')
except ValueError:
    ok(True, 'a click on the axis with no fallback is refused')

# a small weld tab made here: the coped edge is an arc of the tube's radius, centred on the tube centre
Ro = 38.1
fy = math.sqrt(Ro * Ro - 20.0 * 20.0)
a0, a1 = math.atan2(fy, -20.0), math.atan2(fy, 20.0)
tab = {'outline': [{'t': 'L', 'a': [20.0, fy], 'b': [20.0, 60.0]}, {'t': 'A', 'c': [0.0, 60.0], 'r': 20.0, 'a0': 0.0, 'a1': math.pi, 'ccw': True},
                   {'t': 'L', 'a': [-20.0, 60.0], 'b': [-20.0, fy]}, {'t': 'A', 'c': [0.0, 0.0], 'r': Ro, 'a0': a0, 'a1': a1, 'ccw': False}],
       'holes': [{'t': 'C', 'c': [0.0, 60.0], 'r': 8.73}], 'plane': 'across', 'o2': [0, 0], 'off': 0, 't': 3.175, 'name': 'Pipe tab'}
P = H.plan({'parts': [tab]}, fr)
pl = P['plates'][0]
cope = pl['loops'][0][3]
ok(cope[0] == 'A' and all(abs(dist_axis(q, fr) - Ro / 10) < 1e-9 for q in cope[1:]), 'across: the coped edge sits on the tube (%.4f cm from the axis)' % dist_axis(cope[2], fr))
ok(all(abs(H._dot(H._sub(q, fr['S']), fr['Z'])) < 1e-12 for sg in pl['loops'][0] for q in sg[1:]), 'across: the outline lies in the plane square to the tube')
ok(abs(H._dot(H._sub(cope[2], fr['S']), fr['Y']) - Ro / 10) < 1e-9, 'the middle of the cope is the top of the tube, toward the mount')
hc = pl['circles'][0][0]
ok(abs(H._dot(H._sub(hc, fr['S']), fr['Y']) - 6.0) < 1e-9, 'the hole is 60 mm out along Y')
# along: a fin, its base on the tube's top line
fin = dict(tab, plane='along', outline=[{'t': 'L', 'a': [-25.0, Ro], 'b': [25.0, Ro]}, {'t': 'L', 'a': [25.0, Ro], 'b': [0.0, 70.0]}, {'t': 'L', 'a': [0.0, 70.0], 'b': [-25.0, Ro]}])
pf = H.plan({'parts': [fin]}, fr)['plates'][0]
base = pf['loops'][0][0]
ok(abs(H._dot(H._sub(base[2], base[1]), fr['Z']) - 5.0) < 1e-9 and all(abs(dist_axis(q, fr) - Ro / 10) < 1e-9 for q in base[1:]),
   'along: the straight weld edge runs along the tube on its top line')
ok(pf['normal'] == fr['X'], 'along: extruded across the tube (normal X)')
# a body tab offset beside it, its hole on the pipe tab's
bt = dict(tab, name='Body tab', o2=[0.0, 60.0], off=9.0)
pb = H.plan({'parts': [bt]}, fr)['plates'][0]
ok(abs(H._dot(H._sub(pb['plane3'][0], fr['S']), fr['Z']) - 0.9) < 1e-12 and abs(H._dot(H._sub(pb['plane3'][0], fr['S']), fr['Y']) - 6.0) < 1e-12,
   'the body tab sits 9 mm along the tube from the pipe tab, its origin on the pipe tab’s hole')
# a rod: its path in the plane along the tube through Y
rod = {'path': [{'t': 'L', 'a': [0.0, Ro + 4.76], 'b': [50.0, Ro + 4.76]}], 'd': 9.525}
pr = H.plan({'rods': [rod]}, fr)['rods'][0]
ok(abs(dist_axis(pr['path'][0][1], fr) - (Ro + 4.76) / 10) < 1e-9 and abs(pr['d'] - 0.9525) < 1e-12, 'the rod’s weld leg lies on the tube, its centre a radius out')
# the page's own payloads, when web/tests/hang_ui.js has written them
pj = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hang_payloads.json')
if os.path.exists(pj):
    pays = json.load(open(pj))
    for name, pay in pays.items():
        Q = H.plan(pay, fr)
        n = len(Q['plates']) + len(Q['rods'])
        good = n > 0
        for pl in Q['plates']:
            for loop in pl['loops']:
                for i, sg in enumerate(loop):
                    nxt = loop[(i + 1) % len(loop)]
                    good &= math.sqrt(H._dot(*(2 * [H._sub(sg[-1], nxt[1])]))) < 1e-6
        for pl in Q['plates']:
            if 'Pipe tab' in pl['name'] and pay['parts'][0]['plane'] == 'across':
                arc = [sg for sg in pl['loops'][0] if sg[0] == 'A' and abs(dist_axis(sg[2], fr) - pay['od_mm'] / 20.0) < 1e-6]
                good &= len(arc) == 1
        ok(good, 'page payload %s: %d plates, %d rods, %d visual cylinders, %d cuts; every loop closed%s' % (
            name, len(Q['plates']), len(Q['rods']), len(Q['cyls']), len(Q['cuts']), ', the cope on the tube' if pay['parts'] and pay['parts'][0]['plane'] == 'across' and 'tab' in name else ''))
else:
    print('(no page payloads: run web/tests/hang_ui.js first)')
print('FAILS:', FAILS)
sys.exit(1 if FAILS else 0)
