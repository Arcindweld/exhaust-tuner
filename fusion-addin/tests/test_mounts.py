"""mounts.py: the bracket frame from the two picks, the upright's tangent outline, the flat pattern (bend allowance,
bend line and hole positions), the plates placed in the model, clearance to synthetic keep-outs (ordinary and hot), the
straight-line tool access along a bolt axis, the foot turned away from the part, and a tube stay's cut length. Every
expected number is worked by hand in the comment beside it. When web/tests/mounts_ui.js has written
web/tests/fixtures/mounts_payload.json, the page's own flat patterns are rebuilt here and must agree."""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import mounts as M          # noqa: E402
import router as RT         # noqa: E402
from test_chargeroute import box   # noqa: E402

FAILS = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        FAILS.append(m)


def near(a, b, tol=1e-9):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def scene(meshes, lo=(-30, -30, -30), hi=(30, 30, 30)):
    sc = RT.Scene(cell=1.0, sample_len=0.3)
    for c, i in meshes:
        sc.add_mesh(c, i)
    sc.build(lo, hi, 5.0)
    return sc


# 1. the chassis normal from a scan: the top face of a box (z = 0), whichever way its triangles are wound
c, i = box((-10, -10, -2), (10, 10, 0))
nrm = M.normal_near(c, i, (0.5, 0.5, 0.0), 0.5)
ok(nrm is not None and abs(abs(nrm[2]) - 1) < 1e-9, 'normal_near: the box top reads as (0, 0, %+.0f)' % (nrm[2] if nrm else 0))

# 2. the frame: P = (3, 4, 10) cm over C = (0, 0, 0), n given as (0, 0, -1) is turned to +z (toward P);
#    h = 10 cm, the offset (3, 4) is s = 5 cm along u = (0.6, 0.8, 0); f = n x u = (0*0 - 1*0.8, 1*0.6 - 0*0, 0) = (-0.8, 0.6, 0)
ax = M.bracket_axes((3.0, 4.0, 10.0), (0.0, 0.0, 0.0), (0.0, 0.0, -1.0))
ok(near(ax['n'], (0, 0, 1)) and abs(ax['h'] - 10) < 1e-12 and abs(ax['s'] - 5) < 1e-12 and near(ax['u'], (0.6, 0.8, 0)) and near(ax['f'], (-0.8, 0.6, 0)) and ax['u_fixed'],
   'bracket_axes: h 10 cm, s 5 cm, u (0.6, 0.8, 0), f (-0.8, 0.6, 0)')
ax0 = M.bracket_axes((0.0, 0.0, 8.0), (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), u_pref=(0.0, 1.0, 0.0))
ok(not ax0['u_fixed'] and ax0['s'] == 0 and near(ax0['u'], (0, 1, 0)) and near(ax0['f'], (-1, 0, 0)), 'no offset: u from the page’s choice (0, 1, 0), f = n x u = (-1, 0, 0)')

# 3. the upright's outline: b 30, round end r 15 at (0, 80): the tangents are the straight sides x = +-15 up to y = 80
seg = M.tab_outline(30.0, 0.0, 0.0, 80.0, 15.0)
ok(near(seg[1]['b'], (15, 80), 1e-9) and near(seg[3]['a'], (-15, 80), 1e-9) and abs(seg[2]['a0']) < 1e-9 and abs(seg[2]['a1'] - math.pi) < 1e-9,
   'tab_outline, no offset: straight sides to (+-15, 80), arc from 0 to 180 deg')
seg = M.tab_outline(30.0, 0.0, 20.0, 80.0, 15.0)
T2, T1, Q = seg[1]['b'], seg[3]['a'], (20.0, 80.0)
tan_ok = all(abs(math.hypot(T[0] - Q[0], T[1] - Q[1]) - 15) < 1e-9 and abs((T[0] - Q[0]) * (T[0] - B[0]) + (T[1] - Q[1]) * (T[1] - B[1])) < 1e-6
             for T, B in ((T2, (15, 0)), (T1, (-15, 0))))
ok(tan_ok and T2[0] > T1[0], 'tab_outline, 20 mm offset: both lines touch the round end (radius 15, square to it)')

# 4. the flat pattern of a 1/8 in (3.175 mm) strap: R = t, K = 0.42, foot L = 32 mm from the upright's inner face,
#    reach h = 80 mm. Flat foot L - R = 28.825; BA = (pi/2)(3.175 + 0.42 x 3.175) = 1.570796 x 4.5085 = 7.08194;
#    bend centre 28.825 + 3.54097 = 32.36597; flat upright h - (R + t) = 73.65 so the hole is at 28.825 + 7.08194 +
#    73.65 = 109.55694; the foot holes (a = 20) at L - a = 12; a lightening hole 40 mm up the upright at
#    35.90694 + 40 - 6.35 = 69.55694; developed length to the round end 109.55694 + 15 = 124.55694
D = {'name': 'B1', 'type': 'strap', 't': 3.175, 'b': 30.0, 'hole': 9.0, 'bolt': 8.0, 'R': 3.175, 'K': 0.42, 'h': 80.0, 's': 0.0,
     'foot': {'nb': 2, 'sb': 40.0, 'hole': 9.0, 'bolt': 8.0, 'a': 20.0, 'L': 32.0}, 'light': [{'y': 40.0, 'd': 12.0}]}
fp = M.flat_pattern(D)
hs = {h['what']: h['c'] for h in fp['holes']}
ok(abs(fp['bend']['start'] - 28.825) < 1e-9 and abs(fp['bend']['BA'] - 7.08194) < 1e-5 and abs(fp['bend']['centre'] - 32.36597) < 1e-5,
   'flat pattern: bend from 28.825 mm, allowance 7.0819 mm, bend line at 32.3660 mm from the foot’s end')
ok(abs(hs['part bolt'][1] - 109.55694) < 1e-5 and abs(hs['lightening hole'][1] - 69.55694) < 1e-5 and abs(fp['length'] - 124.55694) < 1e-5 and
   sorted(round(h['c'][0], 6) for h in fp['holes'] if h['what'] == 'foot bolt') == [-20.0, 20.0] and all(abs(h['c'][1] - 12) < 1e-9 for h in fp['holes'] if h['what'] == 'foot bolt'),
   'flat pattern: part hole at 109.557, lightening hole at 69.557, foot holes at (+-20, 12), 124.557 mm long')
try:
    M.flat_pattern(dict(D, h=20.0))
    ok(False, 'a reach shorter than the bend and boss is refused')
except ValueError:
    ok(True, 'a reach shorter than the bend and boss is refused (20 mm: 20 - 6.35 < 15)')

# 5. the plates in place: C at the origin, n = z, P 8 cm up; plate on +f of P (f = -x here, u = y)
ax = M.bracket_axes((0.0, 0.0, 8.0), (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), u_pref=(0.0, 1.0, 0.0))
D5 = dict(D, h=80.0, light=[])
pls = M.plates(ax, D5, foot_side=1, plate_side=1)
up, ft = pls[0], pls[1]
hc, hr = up['circles'][0]
# the upright's mid-plane is t/2 = 0.15875 cm from P along +f = -x: the hole's centre at (-0.15875, 0, 8)
ok(near(hc, (-0.15875, 0.0, 8.0), 1e-9) and abs(hr - 0.45) < 1e-12, 'upright: the hole 0.159 cm (t/2) behind P on the plate’s mid-plane, radius 0.45 cm')
# the foot runs along +f from the heel (P's face, f = 0) : inner face at f = t, holes a = 2 cm further, mid-plane t/2 up
fx = [c for c, r in ft['circles']]
ok(all(abs(p[0] - (-(0.3175 + 2.0))) < 1e-9 and abs(p[2] - 0.15875) < 1e-9 for p in fx) and sorted(round(p[1], 9) for p in fx) == [-2.0, 2.0],
   'foot: holes 2.318 cm out along f (t + a), 2 cm either side along u, on the foot’s mid-plane')
fb = M.foot_bolts(ax, D5, 1, 1)
ok(all(abs(p[2] - 0.3175) < 1e-12 for p in fb), 'foot bolts leave the foot’s top face (z = t)')

# 6. clearance: a wall 1.0 cm beyond the upright's outer face (the plate spans f 0 .. 0.3175 cm, f = -x, so x 0 ..
#    -0.3175; the wall from x = -1.3175 to -3) gives a 1.0 cm gap; marked hot with a 2.54 cm hot clearance it fails,
#    marked ordinary with 0.5 cm it passes
wall = box((-3.0, -5.0, 3.0), (-1.3175, 5.0, 12.0))
floor = box((-10, -10, -2), (10, 10, 0))
cold = scene([floor, wall])
pts = [p for pl in pls for p in M.plate_points(pl)]
skip = lambda p: p[2] < 2 * 0.3175 + 0.5
gc, gh, okc = M.clearance(pts, cold, None, 0.5, 2.54, skip)
ok(okc and abs(gc - 1.0) < 0.02, 'clearance: 1.00 cm to the wall (%.3f cm by the scan), ok at 0.5 cm' % gc)
hot = scene([wall])
gc2, gh2, okh = M.clearance(pts, scene([floor]), hot, 0.5, 2.54, skip)
ok((not okh) and abs(gh2 - 1.0) < 0.02, 'the wall marked hot: %.3f cm against 2.54 cm, not ok' % gh2)

# 7. tool access along a foot bolt: a shelf whose underside is 5 cm above the chassis over the foot holes (x -1 to
#    -4) blocks a 1.27 cm socket at 5 - 0.3175 = 4.6825 cm above the bolt's exit; with 4 cm of tool it is clear
shelf = box((-4.0, -5.0, 5.0), (-1.0, 5.0, 6.0))
sh = scene([shelf])
clear, at = M.access(fb[0], ax['n'], 1.27, 0.8, 15.0, [sh])
ok((not clear) and abs(at - 4.6825) < 1e-6, 'access: blocked %.4f cm up the bolt axis by the shelf (4.6825 by hand)' % (at or -1))
clear2, _ = M.access(fb[0], ax['n'], 1.27, 0.8, 4.0, [sh])
ok(clear2, 'access: clear with a 4 cm tool (shorter than the shelf’s height)')
# the bracket's own upright is in the way of a socket bigger than the hole's distance from it (2 cm from the inner
# face: a 2.2 cm socket radius reaches the plate)
own = [p for p in M.plate_points(up, 0.2)]
c3, a3 = M.access(fb[0], ax['n'], 2.2, 0.8, 6.0, [own])
c4, _ = M.access(fb[0], ax['n'], 1.5, 0.8, 6.0, [own])
ok((not c3) and c4, 'access: a 2.2 cm socket hits the upright 2 cm from the hole, a 1.5 cm one clears it')

# 8. check(): the part sits over +f... the part box beside P on the -f side (x > 0 here, f = -x): plate_side +1 keeps
#    the plate off the part; with the foot on the part's side its bolts are under the part, so the foot goes the other way
part_box = M.box_points((0.0, -6.0, 4.0), (10.0, 6.0, 12.0), 0.5)
opts = {'gap_cm': 0.5, 'hot_gap_cm': 2.54, 'socket_r_cm': 1.27, 'tool_cm': 15.0, 'plate_side': 1}
pl8, rep = M.check(ax, D5, scene([floor]), None, opts, part_box)
ok(rep['foot_side'] == 1 and all(a['clear'] for a in rep['access'] if a['bolt'] == 'foot'), 'check: the foot runs away from the part (+f, the -x side), its bolts clear')
opts['plate_side'] = -1
pl9, rep9 = M.check(ax, D5, scene([floor]), None, dict(opts, plate_side=1), M.box_points((-10.0, -6.0, 4.0), (-0.0, 6.0, 12.0), 0.5))
ok(rep9['foot_side'] == -1, 'check: with the part on the other side the foot turns round (foot side -1)')

# 9. a stay: centres 25 cm apart, 1.5 in (38.1 mm) from each rod-end centre to the tube end: cut 250 - 76.2 = 173.8 mm
axs = M.bracket_axes((0.0, 15.0, 20.0), (0.0, 0.0, 0.0), (0.0, 0.0, 1.0))
st = M.stay(axs, {'name': 'S', 'stay': {'od': 19.05, 'wall': 1.651, 're': 38.1}})
ok(abs(st['centres_mm'] - 250.0) < 1e-9 and abs(st['cut_mm'] - 173.8) < 1e-9, 'stay: centres 250 mm, tube cut 173.8 mm')

# 10. a channel and a gusset build their extra plates
pc = M.plates(ax, dict(D5, type='channel', hf=15.0), 1, 1)
pg = M.plates(ax, dict(D5, type='gusset', hg=40.0), 1, 1)
ok(len(pc) == 4 and len(pg) == 3, 'channel: web, foot plate and two flanges; gusset: upright, foot, gusset')

# 11. the page's own flat patterns
fx_path = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'web', 'tests', 'fixtures', 'mounts_payload.json')
if os.path.exists(fx_path):
    pay = json.load(open(fx_path))
    for b in pay.get('brackets', []):
        if b['type'] == 'stay':
            continue
        fpp = M.flat_pattern(b)
        page = b['flat']
        same = abs(fpp['bend']['centre'] - page['bend']['centre']) < 1e-6 and abs(fpp['length'] - page['length']) < 1e-6
        ph = sorted((round(h['c'][0], 4), round(h['c'][1], 4)) for h in page['holes'])
        qh = sorted((round(h['c'][0], 4), round(h['c'][1], 4)) for h in fpp['holes'])
        ok(same and ph == qh, 'page bracket %s (%s, t %.3f mm, h %.1f mm): the add-in’s flat pattern matches, bend line %.3f mm, %d holes'
           % (b['name'], b['type'], b['t'], b['h'], fpp['bend']['centre'], len(qh)))
else:
    print('(no page payload: run web/tests/mounts_ui.js first)')
print('FAILS:', FAILS)
sys.exit(1 if FAILS else 0)
