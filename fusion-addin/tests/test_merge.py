"""The merge collector and Y merge as one welded part (merge.plan): the plate's holes sit on the router's tube ends with
a full wall of metal between neighbours and a wall to the rim, the spike stands clear of every hole, the open area
never grows from the plate to the outlet, the shell's section is the sleeve and the cone with the wall the tubes
have, and tube ends off the inlet plane or off one ring are refused (the add-in then builds a plain cone)."""
import math
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import merge as M
import router as RT

fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def d3(a, b):
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in range(3)))


def case(n, od, wall, out_d, length, axis=(0.3, -0.2, -1.0), start=(12.0, 4.0, -30.0)):
    ax = RT.vunit(axis)
    slots = RT.collector_slots(start, ax, n, od, 17.0)
    col = RT.collector_body(start, ax, n, od, length, out_d, None, 1.0)
    return M.plan(start, ax, slots, od, wall, col['d_in'], col['d_out'], length, lead_end=2.54), slots, col


IN = 2.54
for n, od_in, out_in, L_in, spike in ((4, 1.625, 3.0, 4.0, True), (2, 1.625, 2.0, 2.4 / IN * 2.54 * 1.6, False),
                                      (8, 1.75, 3.5, 6.0, True), (3, 1.75, 2.5, 4.0, False), (6, 1.5, 3.0, 5.0, True)):
    od, wall = od_in * IN, 0.065 * IN
    p, slots, col = case(n, od, wall, out_in * IN, L_in * IN)
    tag = '%d into 1, %.3f in tubes into %.1f in' % (n, od_in, out_in)
    pl = p['plate']
    # holes on the tubes' own ends, bore size
    ok(all(d3(c, s) < 1e-9 and abs(r - (od / 2 - wall)) < 1e-9 for (c, r), s in zip(pl['holes'], slots)),
       tag + ': a bore-size hole on each tube end')
    # metal between neighbouring holes and to the rim, measured from the circles themselves
    cs = [c for c, _r in pl['holes']]
    rr = pl['holes'][0][1]
    between = min(d3(a, b) for i, a in enumerate(cs) for b in cs[i + 1:]) - 2 * rr
    rim = min(pl['r'] - math.sqrt(max(0.0, d3(c, p['start']) ** 2)) - rr for c in cs)
    ok(abs(between - 2 * wall) < 1e-6 and abs(rim - wall) < 1e-6 and abs(pl['lig_between'] - between) < 1e-6 and abs(pl['lig_rim'] - rim) < 1e-6,
       tag + ': %.3f in of plate between holes (two walls), %.3f in to the rim (one wall)' % (between / IN, rim / IN))
    ok(abs(pl['r'] - col['d_in'] / 2) < 1e-9 and abs(p['Ro0'] - p['Ri0'] - wall) < 1e-9 and abs(p['Ro1'] - out_in * IN / 2) < 1e-9 and abs(p['Ro1'] - p['Ri1'] - wall) < 1e-9,
       tag + ': the sleeve takes the bundle, the outlet is %.1f in outside, one wall throughout' % out_in)
    ok(p['sleeve'] <= 0.9 * 2.54 + 1e-9 and p['plate_t'] in M.PLATE_STOCK_CM and p['plate_t'] >= 1.5 * wall, tag + ': sleeve inside the tubes\' last straight, plate cut from %.4f in stock' % (p['plate_t'] / IN))
    sp = p['spike']
    ok(bool(sp) == spike, tag + (': a merge spike (%.2f in long, %.2f in base)' % (sp['len'] / IN, 2 * sp['r'] / IN) if sp else ': no spike (no room in the middle)'))
    if sp:
        clear = min(d3(c, p['start']) for c in cs) - rr - sp['r']
        ok(clear >= 0.5 * wall - 1e-9, tag + ': the spike\'s foot clears every hole by %.3f in' % (clear / IN))
        ok(sp['len'] <= 0.9 * (p['length'] - p['plate_t']) + 1e-9, tag + ': the spike ends inside the cone')
    A = p['area']
    ok(all(A[i + 1] <= A[i] + 1e-9 for i in range(len(A) - 1)) and p['area_growth'] < 1e-9,
       tag + ': the open area falls from %.2f to %.2f times the bores, never growing' % (p['area_merge'] / p['area_bores'], p['area_out'] / p['area_bores']))
    ok(abs(A[-1] - math.pi * p['Ri1'] ** 2) < 1e-9, tag + ': the outlet area is the outlet bore')
    sec = p['section']
    ok(len(sec) == 6 and all(r > 0 for _x, r in sec) and sec[0][0] < 0 < sec[2][0] < sec[3][0], tag + ': the half section is the sleeve then the cone, off the axis')
    inc = 2 * math.degrees(math.atan((p['Ri0'] - p['Ri1']) / (p['length'] - p['plate_t'])))
    ok(abs(p['taper_deg'] - inc) < 1e-9 and (any('Burns' in s for s in p['notes']) == (not 7 <= inc <= 18)), tag + ': cone %.1f deg included, a note only outside 7 to 18 deg' % inc)
    print('   ' + M.summary(p, 'Collector'))

# without the spike the 4-into-1's open area jumps at the plate and then only falls; with one too short it would grow
od, wall = 1.625 * IN, 0.065 * IN
p, slots, col = case(4, od, wall, 3.0 * IN, 4.0 * IN)
q = M.plan(p['start'], p['axis'], slots, od, wall, col['d_in'], col['d_out'], 4.0 * IN, spike=False)
ok(q['spike'] is None and q['area_merge'] > p['area_merge'], 'the spike takes %.0f%% off the open area at the plate' % (100 * (1 - p['area_merge'] / q['area_merge'])))
need = p['spike']['r'] ** 2 / (p['Ri0'] * abs((p['Ri1'] - p['Ri0']) / (p['length'] - p['plate_t'])))
ok(p['spike']['len'] >= need, 'the spike (%.2f in) is longer than the %.2f in the area rule needs' % (p['spike']['len'] / IN, need / IN))
# a cylinder (no taper): any spike gives area back, so the plan says so through its numbers
cyl = M.plan(p['start'], p['axis'], slots, od, wall, col['d_in'], col['d_in'] + 2 * wall, 4.0 * IN, spike=True)
ok(cyl['spike'] and cyl['growth_ratio'] > 1.0, 'a straight collector with a spike: the open area grows behind it (x%.3f per step), as it must' % cyl['growth_ratio'])
# one tube: a plain reducer
one = M.plan((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), [(0.0, 0.0, 0.0)], od, wall, od, 2.0 * IN, 3.0 * IN)
ok(one['plate'] is None and one['spike'] is None and one['plate_t'] == 0.0, 'one tube: no plate, no spike')
# refused: an end off the plane, ends off one ring
bad = list(slots)
bad[1] = RT.vadd(bad[1], RT.vmul(p['axis'], 0.3))
try:
    M.plan(p['start'], p['axis'], bad, od, wall, col['d_in'], col['d_out'], 4.0 * IN)
    ok(False, 'an end 3 mm off the inlet plane is refused')
except ValueError as ex:
    ok('off the collector' in str(ex), 'an end 3 mm off the inlet plane is refused: ' + str(ex))
bad = list(slots)
bad[2] = RT.vadd(p['start'], RT.vmul(RT.vsub(bad[2], p['start']), 0.8))
try:
    M.plan(p['start'], p['axis'], bad, od, wall, col['d_in'], col['d_out'], 4.0 * IN)
    ok(False, 'ends off one ring are refused')
except ValueError as ex:
    ok('one ring' in str(ex), 'ends off one ring are refused: ' + str(ex))
try:
    M.plan(p['start'], p['axis'], slots, od, wall, col['d_in'], col['d_out'], 0.3)
    ok(False, 'a collector shorter than its plate is refused')
except ValueError as ex:
    ok('merge plate' in str(ex), 'a collector shorter than its plate is refused')

# the cut files: read back as a cutter would (group codes), the plate's holes on the tubes, the flat patterns rolled
# at the middle of the wall back to the circumferences they must make
def dxf_ents(text):
    w = text.split('\r\n')
    ents, i = [], 0
    while i < len(w) - 1:
        if w[i] == '0' and w[i + 1] in ('LINE', 'CIRCLE', 'ARC'):
            kind, d, i = w[i + 1], {}, i + 2
            while not (w[i] == '0'):
                d[w[i]] = w[i + 1]
                i += 2
            ents.append((kind, {k: (float(v) if k != '8' else v) for k, v in d.items()}))
        else:
            i += 1
    return ents


p, slots, col = case(4, od, wall, 3.0 * IN, 4.0 * IN)
F = M.cut_files(p, 'Merge collector')
ok([f['name'] for f in F] == ['merge_collector_plate_0.125in.dxf', 'merge_collector_cone_and_sleeve_0.065in.dxf'],
   'two cut files, one per sheet thickness: ' + ', '.join(f['name'] for f in F))
E = dxf_ents(F[0]['text'])
ok(all(e[1]['8'] == 'CUT' for e in E) and '$INSUNITS\r\n70\r\n4' in F[0]['text'], 'every entity on the CUT layer, millimetres')
C = sorted([e[1] for e in E if e[0] == 'CIRCLE'], key=lambda d: -d['40'])
rim, holes = C[0], C[1:]
ok(len(holes) == 4 and all(abs(h['40'] - 10 * (od / 2 - wall)) < 1e-3 for h in holes), 'plate: four bore-size holes, %.2f mm' % (2 * holes[0]['40']))
ok(abs(rim['40'] - (10 * col['d_in'] / 2 - 0.075)) < 1e-3, 'plate: %.2f mm across, 0.15 mm under the sleeve bore' % (2 * rim['40']))
cen = [((h['10'] - rim['10']), (h['20'] - rim['20'])) for h in holes]
ok(all(abs(math.hypot(*c) - 10 * od / (2 * math.sin(math.pi / 4))) < 1e-3 for c in cen) and
   abs(min(math.hypot(a[0] - b[0], a[1] - b[1]) for i, a in enumerate(cen) for b in cen[i + 1:]) - 10 * od) < 1e-3,
   'plate: the holes on the tubes\' ring, one tube diameter apart')
ok(min(rim['10'], rim['20']) - rim['40'] > -1e-6, 'plate: in the first quadrant')
E = dxf_ents(F[1]['text'])
arcs = sorted([e[1] for e in E if e[0] == 'ARC'], key=lambda d: -d['40'])
ra, rb = p['Ri0'] + wall / 2, p['Ri1'] + wall / 2
sweep = lambda a: ((a['51'] - a['50']) % 360.0) * math.pi / 180
arcs = sorted(arcs, key=lambda d: -d['40'])
ok(len(arcs) == 2 and not p['spike']['hollow'] and 'turned from round bar' in M.summary(p, 'x'), 'the 4-into-1\'s %.1f mm spike is turned from bar, so not in the sheet file' % (20 * p['spike']['r']))
ok(len(arcs) == 2 and abs(arcs[0]['40'] * sweep(arcs[0]) - 2 * math.pi * 10 * ra) < 1e-2 and abs(arcs[1]['40'] * sweep(arcs[1]) - 2 * math.pi * 10 * rb) < 1e-2,
   'cone: rolls to %.2f and %.2f mm round the middle of the wall (%.1f and %.1f mm arcs)' % (2 * 10 * ra, 2 * 10 * rb, arcs[0]['40'] * sweep(arcs[0]), arcs[1]['40'] * sweep(arcs[1])))
h_ax = 10 * (p['length'] - p['plate_t'])
ok(abs(arcs[0]['40'] - arcs[1]['40'] - math.hypot(h_ax, 10 * (ra - rb))) < 1e-3, 'cone: the slant between the arcs is the cone\'s own, %.2f mm' % (arcs[0]['40'] - arcs[1]['40']))
lines = [e[1] for e in E if e[0] == 'LINE']
xs = [v for d in lines for v in (d['10'], d['11'])]
ok(len(lines) == 6 and min(xs) > -1e-6, 'cone sector and sleeve rectangle side by side')
p6, s6, c6 = case(6, 1.5 * IN, wall, 3.0 * IN, 5.0 * IN)
S6 = p6['spike']
al = math.atan(S6['r'] / S6['len'])
ok(S6['hollow'] and abs(S6['r'] - S6['r_in'] - wall / math.cos(al)) < 1e-9 and abs(S6['r_in'] / S6['len_in'] - S6['r'] / S6['len']) < 1e-9,
   '6-into-1: its %.1f mm spike is a rolled cone one wall thick (inside %.1f mm, the same angle)' % (20 * S6['r'], 20 * S6['r_in']))
A6 = sorted([e[1] for e in dxf_ents(M.cut_files(p6, 'Merge collector')[1]['text']) if e[0] == 'ARC'], key=lambda d: d['40'] * sweep(d))
rm = (S6['r'] + S6['r_in']) / 2
ok(len(A6) == 3 and abs(A6[0]['40'] * sweep(A6[0]) - 2 * math.pi * 10 * rm) < 1e-2 and abs(A6[0]['40'] - 10 * rm / math.sin(al)) < 1e-3,
   '6-into-1: the spike\'s flat pattern rolls to %.1f mm round the middle of its wall, slant %.1f mm' % (20 * rm, A6[0]['40']))
_, si = M.sleeve_flat(p)
ok(abs(si['w_mm'] - 2 * math.pi * 10 * ra) < 1e-6 and abs(si['h_mm'] - 10 * (p['sleeve'] + p['plate_t'])) < 1e-9, 'sleeve: %.1f × %.1f mm' % (si['w_mm'], si['h_mm']))
# a straight collector rolls from a band
cf, ci = M.cone_flat(M.plan(p['start'], p['axis'], slots, od, wall, col['d_in'], col['d_in'] + 2 * wall, 4.0 * IN, spike=False))
ok(ci['kind'] == 'band' and abs(ci['w_mm'] - 2 * math.pi * 10 * ra) < 1e-6, 'no taper: the cone is a band')
# the page's fixture: what the add-in sends back for a 4-into-1 (tests in web/tests/merge_files_ui.js)
import json
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'tests', 'fixtures', 'merge_route.json')
json.dump({'ok': True, 'msg': 'Built 4 primaries into the collector.', 'route_ok': True,
           'items': [{'kind': 'merge', 'name': 'Merge collector', 'ok': True, 'note': M.summary(p, 'Merge collector')}],
           'files': [{k: f[k] for k in ('name', 'text', 'what')} for f in F]}, open(fx, 'w'), indent=1)
print('failures:', len(fails))
sys.exit(1 if fails else 0)
