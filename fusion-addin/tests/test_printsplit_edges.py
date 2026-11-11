"""printsplit.py edge cases, without Fusion:
  - very short straights between bends get no cut; a tube that is all bend fits in one piece or fails with a clear note,
  - unequal beds (180 x 180 x 180, 350 x 320 x 325, 256 x 256 x 256): every piece fits the bed it was planned for,
  - a lap longer than any straight, keep-outs over nearly everything, a wall too thin for the tongues: clear notes,
  - the path given in reverse plans as well as forwards; a U bend that fits is not pruned by its arc length,
  - the owner's 4 in tube with a 3/16 in wall still splits with no warnings,
  - the gluing check list: joints, bond area (cm2 and in2) and bond-line volume (mL).
   python3 tests/test_printsplit_edges.py"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import printsplit as PS   # noqa: E402

FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


sub = lambda a, b: tuple(x - y for x, y in zip(a, b))
add = lambda a, b: tuple(x + y for x, y in zip(a, b))
mul = lambda a, s: tuple(x * s for x in a)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))
nrm = lambda a: mul(a, 1 / math.sqrt(dot(a, a)))
cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
u = lambda a, b: tuple(x / math.dist(a, b) for x in sub(b, a))


def path(segs, ds=5.0):
    """Polyline and run ids from ('line', a, b) and ('arc', a, b, t1, t2, R) segments (mm), as test_printsplit."""
    pts, runs = [], []
    for k, sg in enumerate(segs):
        if sg[0] == 'line':
            a, b = sg[1], sg[2]
            n = max(1, int(math.dist(a, b) / ds))
            for i in range(n):
                pts.append(add(a, mul(sub(b, a), i / n))); runs.append(k)
        else:
            a, b, t1, t2, R = sg[1:]
            ax = nrm(cross(t1, t2)); th = math.acos(max(-1, min(1, dot(t1, t2))))
            c = add(a, mul(nrm(cross(ax, t1)), R))
            n = max(2, int(R * th / ds))
            for i in range(n):
                f = th * i / n; r0 = sub(a, c)
                pts.append(add(c, add(mul(r0, math.cos(f)), mul(cross(ax, r0), math.sin(f))))); runs.append(None)
    pts.append(segs[-1][2]); runs.append(runs[-1])
    return pts, runs


def arc_end(a, t, R, deg, side=(0, 0, 1)):
    """End point and tangent of an arc from a with tangent t, radius R, turning deg about axis `side`."""
    n = nrm(cross(side, t))
    c = add(a, mul(n, R))
    r0 = sub(a, c)
    th = math.radians(deg)
    ax = nrm(side)
    e = add(c, add(mul(r0, math.cos(th)), mul(cross(ax, r0), math.sin(th))))
    t2 = add(mul(t, math.cos(th)), mul(cross(ax, t), math.sin(th)))
    return e, nrm(t2)


def valid(p, st, bed, edge=3.0, L=20.0):
    """Every rule of a plan: cuts in straights, pieces end to end, one tongue per cut, standing on a tongue-free end,
    inside the usable bed."""
    ux, uy, uz = bed[0] - 2 * edge, bed[1] - 2 * edge, bed[2] - edge
    pcs = p['pieces']
    return (all(st[c['i']]['run'] is not None for c in p['cuts'])
            and all(pcs[k]['s1'] == pcs[k + 1]['s0'] for k in range(len(pcs) - 1))
            and all((c['grower'] == 'up') == pcs[k]['grow_end'] and (c['grower'] == 'down') == pcs[k + 1]['grow_start']
                    for k, c in enumerate(p['cuts']))
            and all((q['base'] == 'start' and not q['grow_start']) or (q['base'] == 'end' and not q['grow_end']) for q in pcs)
            and all(q['height'] <= uz + 1e-6 and ((q['w'] <= ux and q['h'] <= uy) or (q['w'] <= uy and q['h'] <= ux)) for q in pcs))


def stations(segs):
    pts, runs = path(segs)
    return PS.stations_from_polyline(pts, runs)


# the owner's intake (as test_printsplit)
I = (-673.7, -493.2, -233.9)
A1, B1 = (-592.8, -456.0, -188.4), (-532.6, -441.9, -169.7)
A2, B2 = (-128.7, -421.5, -126.6), (-10.5, -302.2, -99.3)
O = (-5.7, -181.26, -83.14)
INTAKE = [('line', I, A1), ('arc', A1, B1, u(I, A1), u(B1, A2), 127.0), ('line', B1, A2), ('arc', A2, B2, u(B1, A2), u(B2, O), 127.0), ('line', B2, O)]
LOGO = (296.0, 433.0)
R_OUT, R_IN_316 = 50.8, 50.8 - 0.1875 * 25.4

# --- very short straight between two bends: never cut there
a0, t0 = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)
p1 = (300.0, 0.0, 0.0)
p2, t2 = arc_end(p1, t0, 60.0, 90)
p3 = add(p2, mul(t2, 30.0))
p4, t4 = arc_end(p3, t2, 60.0, 90)
p5 = add(p4, mul(t4, 300.0))
segs = [('line', a0, p1), ('arc', p1, p2, t0, t2, 60.0), ('line', p2, p3), ('arc', p3, p4, t2, t4, 60.0), ('line', p4, p5)]
st = stations(segs)
p = PS.plan(st, 25.4)
short_run = 2
ok(p['ok'] and valid(p, st, (256, 256, 256)) and all(st[c['i']]['run'] != short_run for c in p['cuts']),
   'a 2 in tube: a 30 mm (1.18 in) straight between two bends gets no cut: %d pieces, cuts at %s mm' % (len(p['pieces']), ', '.join('%.0f' % c['s'] for c in p['cuts'])))
# the same on the 4 in tube on 127 mm bends: the bends and short straight span 285 mm (11.2 in), so no piece can hold them
p2, t2 = arc_end(p1, t0, 127.0, 90)
p3 = add(p2, mul(t2, 30.0))
p4, t4 = arc_end(p3, t2, 127.0, 90)
p5 = add(p4, mul(t4, 300.0))
st = stations([('line', a0, p1), ('arc', p1, p2, t0, t2, 127.0), ('line', p2, p3), ('arc', p3, p4, t2, t4, 127.0), ('line', p4, p5)])
p = PS.plan(st, R_OUT)
ok(not p['ok'] and 'fits the bed' in p['notes'][0], 'a 4 in tube whose two bends cannot share any 256 mm bed: refused, "%s"' % p['notes'][0][:70])

# --- all bend, no straight
e, te = arc_end((0, 0, 0), (1, 0, 0), 300.0, 180)
st = stations([('arc', (0.0, 0.0, 0.0), e, (1.0, 0.0, 0.0), te, 300.0)])
p = PS.plan(st, R_OUT)
ok(not p['ok'] and p['notes'] and 'no straight' in p['notes'][0], 'a 180 degree bend on 300 mm (11.8 in) radius, no straight: refused, "%s"' % (p['notes'] or [''])[0][:80])
e, te = arc_end((0, 0, 0), (1, 0, 0), 127.0, 90)
st = stations([('arc', (0.0, 0.0, 0.0), e, (1.0, 0.0, 0.0), te, 127.0)])
p = PS.plan(st, R_OUT)
ok(p['ok'] and len(p['pieces']) == 1, 'a lone 90 degree bend on 127 mm (5 in) radius fits in one piece (%.0f mm tall)' % (p['pieces'][0]['height'] if p['ok'] else 0))

# --- beds, unequal
st = stations(INTAKE)
res = {}
for bed in ((180.0, 180.0, 180.0), (350.0, 320.0, 325.0), (256.0, 256.0, 256.0), (256.0, 180.0, 300.0)):
    p = PS.plan(st, R_OUT, keepouts=[LOGO, (0.0, 4.0)], bed=bed)
    res[bed] = p
    if p['ok']:
        ok(valid(p, st, bed) and all(not (LOGO[0] - 20 <= c['s'] <= LOGO[1] + 20) for c in p['cuts']),
           'the intake on a %.0f x %.0f x %.0f mm bed: %d pieces, each fits (%s)' % (
               bed + (len(p['pieces']), '; '.join('%.0f tall %.0f x %.0f' % (q['height'], q['w'], q['h']) for q in p['pieces']))))
    else:
        ok(bool(p['notes']), 'the intake on a %.0f x %.0f x %.0f mm bed: refused with a note, "%s"' % (bed + (p['notes'][0][:70],)))
big, mid = res[(350.0, 320.0, 325.0)], res[(256.0, 256.0, 256.0)]
ok(big['ok'] and mid['ok'] and len(big['pieces']) <= len(mid['pieces']),
   'a bigger bed never needs more pieces (%d on 350 x 320 x 325, %d on 256 cubed)' % (len(big['pieces']), len(mid['pieces'])))

# --- the path in reverse
pts, runs = path(INTAKE)
N = len(pts) - 1
rpts = pts[::-1]
rruns = [runs[N - 1 - j] for j in range(N)] + [runs[0]]
rst = PS.stations_from_polyline(rpts, rruns)
tot = st[-1]['s']
rlogo = (tot - LOGO[1], tot - LOGO[0])
rp = PS.plan(rst, R_OUT, keepouts=[rlogo, (tot - 4.0, tot)])
ok(rp['ok'] and valid(rp, rst, (256, 256, 256)) and len(rp['pieces']) == len(mid['pieces'])
   and all(not (rlogo[0] - 20 <= c['s'] <= rlogo[1] + 20) for c in rp['cuts']),
   'the intake given outlet first: %d pieces like the forward plan (%d), cuts at %s mm' % (len(rp['pieces']), len(mid['pieces']), ', '.join('%.0f' % c['s'] for c in rp['cuts'])))

# --- a lap longer than any straight
p = PS.plan(st, R_OUT, keepouts=[LOGO], L=250.0)
ok(not p['ok'] and 'long enough' in p['notes'][0], 'a 250 mm (9.84 in) lap: refused, "%s"' % p['notes'][0][:90])

# --- keep-outs over nearly everything
st6 = stations([('line', (0, 0, 0), (600, 0, 0))])
p = PS.plan(st6, R_OUT, keepouts=[(30.0, 570.0)])
ok(not p['ok'] and 'covered' in p['notes'][0], 'a 600 mm tube with lettering from 30 to 570 mm: refused, "%s"' % p['notes'][0][:80])

# --- thin walls
c1 = PS.check_joint(50.8 - 0.9, 50.8)
ok(not c1['ok'] and 'too thin' in c1['notes'][0], 'a 0.9 mm (0.035 in) wall is refused: ' + c1['notes'][0][:110])
p = PS.plan(st6, R_OUT, r_in=50.8 - 1.6)
ok(not p['ok'] and 'too thin' in p['notes'][0], 'a 1.6 mm (0.063 in) wall (0.73 mm tongues) is refused by the plan')
c2 = PS.check_joint(50.8 - 2.3, 50.8)
ok(c2['ok'] and c2['notes'] and 'perimeters' in c2['notes'][0], 'a 2.3 mm (0.091 in) wall (1.08 mm tongues) is allowed with a warning')
c3 = PS.check_joint(50.8 - 2.6, 50.8)
ok(c3['ok'] and not c3['notes'], 'a 2.6 mm (0.102 in) wall (1.23 mm tongues) needs no warning')
ok(not PS.check_joint(50.8, 50.8)['ok'], 'a bore as big as the outside is refused, not a crash')

# --- the owner's 4 in x 3/16 in tube
p = PS.plan(st, R_OUT, keepouts=[LOGO, (0.0, 4.0)], r_in=R_IN_316)
j = PS.joint_radii(R_IN_316, R_OUT)
ok(p['ok'] and not p['notes'] and valid(p, st, (256, 256, 256)) and j['inner_t'] > 2.2 and j['outer_t'] > 2.2,
   'the 4 in x 3/16 in (101.6 x 4.76 mm) intake: %d pieces, tongues %.2f and %.2f mm (%.3f, %.3f in), no warnings' % (
       len(p['pieces']), j['inner_t'], j['outer_t'], j['inner_t'] / 25.4, j['outer_t'] / 25.4))

# --- a U bend whose arc is longer than the bed's diagonal but fits it spun 45 degrees: the reach check uses the chord
# (it used the arc length and refused this tube outright)
b0, tb = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)
b1 = (400.0, 0.0, 0.0)
b2, tb2 = arc_end(b1, tb, 120.0, 180)
b3 = add(b2, mul(tb2, 400.0))
segs = [('line', b0, b1), ('arc', b1, b2, tb, tb2, 120.0), ('line', b2, b3)]
stU = stations(segs)
pU = PS.plan(stU, 25.4, bed=(256, 256, 256))
whole_bend = any(stU[q['i0']]['s'] < 400 - 1 and stU[q['i1']]['s'] > 400 + math.pi * 120 + 1 for q in pU['pieces']) if pU['ok'] else False
ok(pU['ok'] and valid(pU, stU, (256, 256, 256)) and whole_bend,
   'a 2 in tube with a 180 degree U on 120 mm (4.72 in) radius (377 mm of arc, past the bed diagonal): the U prints whole, spun diagonal (%d pieces)' % len(pU['pieces']))

# --- a repeated point does not break the tangents
pts, runs = path([('line', (0, 0, 0), (100, 0, 0))])
pts.insert(3, pts[3]); runs.insert(3, runs[3])
st7 = PS.stations_from_polyline(pts, runs)
ok(all(abs(math.sqrt(dot(q['t'], q['t'])) - 1) < 1e-9 for q in st7), 'a repeated centreline point keeps a unit tangent')

# --- units in what the owner reads
ok(PS.mm_in(101.6) == '101.6 mm (4.000 in)' and PS.mm_in(4.7625, 2) == '4.76 mm (0.188 in)', 'lengths print in mm and inches')

# --- the gluing check list
sh = PS.assembly_sheet(mid, 46.3, 50.8, 0.15, 20.0)
jr = PS.joint_radii(46.3, 50.8, 0.15)
area = (2 * math.pi * (jr['tongue_in'] + jr['tongue_out']) * 20 + math.pi * (jr['tongue_in'] ** 2 - 46.3 ** 2) + math.pi * (50.8 ** 2 - jr['tongue_out'] ** 2)) / 100
vol = math.pi * (jr['tongue_out'] ** 2 - jr['tongue_in'] ** 2) * 20 / 1000
ok(len(sh['joints']) == len(mid['cuts']) and len(sh['pieces']) == len(mid['pieces']), 'the check list: %d joints, %d pieces' % (len(sh['joints']), len(sh['pieces'])))
ok(all(abs(x['area_cm2'] - area) < 0.06 and abs(x['area_in2'] - area / 6.4516) < 0.006 and abs(x['bond_ml'] - vol) < 0.006 for x in sh['joints']),
   'each 4 in joint bonds %.1f cm2 (%.2f in2) with %.2f mL in the 0.15 mm gap' % (area, area / 6.4516, vol))
ok(abs(vol - 0.915) < 0.005, 'the bond line is 2 pi r_mid x gap x lap: 0.915 mL')
roles = PS.joint_roles(mid['cuts'])
ok(all(mid['pieces'][r['grower']]['grow_end' if r['grower'] == n else 'grow_start'] for n, r in enumerate(roles))
   and all(sh['joints'][n]['grower'] == 'Piece %d' % (r['grower'] + 1) for n, r in enumerate(roles)),
   'the check list names the piece that carries each outer tongue')
ok(sh['pieces'][0]['ends'][0].startswith('start end at 0 mm: plain end') and 'tongue' in sh['pieces'][0]['ends'][1],
   'piece 1: ' + ' | '.join(sh['pieces'][0]['ends']))

print('test_printsplit_edges: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
