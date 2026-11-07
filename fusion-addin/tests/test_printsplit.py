"""printsplit.py, the print split planner, without Fusion:
  - a straight tube that fits stays one piece; one that does not is cut, every piece fits standing up,
  - a 4 in cold-air intake (92.6 mm bore, 30 and 84 degree bends on 5 in radius, 881 mm long, lettering on the long
    straight) splits with every cut in a straight, clear of the lettering, every piece standing on an end with no
    outer tongue, within a 256 mm bed,
  - the lap radii leave the bore and the outside untouched,
  - filament for a volume.
   python3 tests/test_printsplit.py"""
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


def path(segs, ds=5.0):
    """Polyline and run ids from ('line', a, b) and ('arc', a, b, t1, t2, R) segments (mm)."""
    sub = lambda a, b: tuple(x - y for x, y in zip(a, b))
    add = lambda a, b: tuple(x + y for x, y in zip(a, b))
    mul = lambda a, s: tuple(x * s for x in a)
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    nrm = lambda a: mul(a, 1 / math.sqrt(dot(a, a)))
    cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
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


# a straight 4 in tube, 200 mm (fits) and 600 mm (does not)
for L, want in ((200.0, 1), (600.0, None)):
    pts, runs = path([('line', (0, 0, 0), (L, 0, 0))])
    st = PS.stations_from_polyline(pts, runs)
    p = PS.plan(st, 50.8)
    if want == 1:
        ok(p['ok'] and len(p['pieces']) == 1 and not p['cuts'], 'a 200 mm tube stays one piece')
    else:
        ok(p['ok'] and len(p['pieces']) == 3 and all(q['height'] <= 253 for q in p['pieces']),
           'a 600 mm tube: %d pieces, tallest %.0f mm' % (len(p['pieces']), max(q['height'] for q in p['pieces'])))

# the intake
I = (-673.7, -493.2, -233.9)
A1, B1 = (-592.8, -456.0, -188.4), (-532.6, -441.9, -169.7)
A2, B2 = (-128.7, -421.5, -126.6), (-10.5, -302.2, -99.3)
O = (-5.7, -181.26, -83.14)
u = lambda a, b: tuple(x / math.dist(a, b) for x in (b[0] - a[0], b[1] - a[1], b[2] - a[2]))
segs = [('line', I, A1), ('arc', A1, B1, u(I, A1), u(B1, A2), 127.0), ('line', B1, A2), ('arc', A2, B2, u(B1, A2), u(B2, O), 127.0), ('line', B2, O)]
pts, runs = path(segs)
st = PS.stations_from_polyline(pts, runs)
ok(abs(st[-1]['s'] - 880.6) < 3, 'the intake centreline is %.1f mm (881 in CAD)' % st[-1]['s'])
logo = (296.0, 433.0)
p = PS.plan(st, 50.8, keepouts=[logo, (0.0, 4.0)])
ok(p['ok'], 'the intake splits: ' + ' '.join(p['notes']))
ok(len(p['pieces']) <= 5, '%d pieces' % len(p['pieces']))
ok(all(st[c['i']]['run'] is not None for c in p['cuts']), 'every cut is in a straight')
ok(all(not (logo[0] - 20 <= c['s'] <= logo[1] + 20) for c in p['cuts']), 'no cut or lap reaches the lettering (cuts at %s mm)' % ', '.join('%.0f' % c['s'] for c in p['cuts']))
ok(all(q['height'] <= 253 and max(q['w'], q['h']) <= 250 for q in p['pieces']),
   'every piece fits a 256 mm bed: ' + '; '.join('%.0f tall, %.0f x %.0f' % (q['height'], q['w'], q['h']) for q in p['pieces']))
ok(all((q['base'] == 'start' and not q['grow_start']) or (q['base'] == 'end' and not q['grow_end']) for q in p['pieces']),
   'every piece stands on an end with no outer tongue')
ok(all(p['pieces'][k]['s1'] == p['pieces'][k + 1]['s0'] for k in range(len(p['pieces']) - 1)), 'the pieces run end to end')
ok(all((c['grower'] == 'up') == p['pieces'][k]['grow_end'] and (c['grower'] == 'down') == p['pieces'][k + 1]['grow_start']
       for k, c in enumerate(p['cuts'])), 'each cut has exactly one outer tongue')

# a tube too fat for the bed
pts, runs = path([('line', (0, 0, 0), (900, 0, 0))])
q = PS.plan(PS.stations_from_polyline(pts, runs), 140.0)
ok(not q['ok'] and q['notes'], 'a 280 mm tube cannot be split for a 256 mm bed, and says so')

j = PS.joint_radii(46.3, 50.8, 0.15)
ok(abs(j['tongue_in'] - 48.475) < 1e-9 and abs(j['tongue_out'] - 48.625) < 1e-9 and j['inner_t'] > 2 and j['outer_t'] > 2,
   'the lap: inner tongue to %.3f, outer from %.3f, both over 2 mm thick, the bore and outside untouched' % (j['tongue_in'], j['tongue_out']))
ok(j['shoulder'] == 1.5 and abs(j['tip'] - 1.6) < 1e-9, 'a 1.5 mm 45 degree shoulder, the tongue tip cleared by 1.6 mm')
f = PS.filament(1203.0, 1.23)
ok(abs(f['mass_g'] - 1479.7) < 0.1 and abs(f['length_m'] - 500.2) < 0.5, 'filament for 1,203 cm3: %.0f g, %.0f m' % (f['mass_g'], f['length_m']))

print('test_printsplit: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
