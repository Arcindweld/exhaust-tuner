"""Two-stage header routing (router.route_triy): a Tri-Y 4-2-1 past a frame rail. The primaries of each pair reach
their Y marker at the primary length, every secondary reaches the collector at the secondary length, and no two
tubes of either stage come closer than the tube-to-tube gap away from their fixed ends."""
import os
import sys
import time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router as RT, test_router as T
head = T.box_mesh((-6, -10, -15), (0, 50, 15), 12)
rail = T.box_mesh((15, -20, -30), (22, 60, -24), 12)
sc = RT.Scene(cell=1.0); sc.add_mesh(*head); sc.add_mesh(*rail); sc.build((-10, -30, -90), (90, 70, 20), 10)
ports = [((0.0, 4.0 + 10.0 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
ymarks = [((26.0, 9.0, -14.0), RT.vunit((0.4, 0.0, -1.0))), ((26.0, 29.0, -14.0), RT.vunit((0.4, 0.0, -1.0)))]
groups = [[0, 1], [2, 3]]
col = ((40.0, 19.0, -55.0), (0.0, 0.0, -1.0))
od, sec_od = 4.128, 5.08
spec = {'od': od, 'clr': 1.5 * od, 'gap': 1.27, 'gap_tt': 0.32, 'target': 40.0, 'y_len': 2.4, 'sec_od': sec_od,
        'sec_target': 50.0, 'collector_len': 10.0, 'collector_out_d': 7.62}
t0 = time.time()
res = RT.route_triy(sc, ports, ymarks, col, groups, spec)
print('triy ok', res['ok'], '%.1fs' % (time.time() - t0))
fails = []
for i, r in enumerate(res['primaries']):
    print(' P%d ok=%s L=%.3f msg=%s' % (i + 1, r['ok'], r['length'], r['msg']))
    if not (r['ok'] and abs(r['length'] - 40.0) <= 0.05):
        fails.append('P%d' % (i + 1))
ylen = res['y_len']
print(' Y merge %.2f cm (a 2-into-1 at 15 deg), secondary target %.2f cm' % (ylen, res['sec_target']))
if abs(ylen + res['sec_target'] - (2.4 + 50.0)) > 1e-9:
    fails.append('total')
for i, r in enumerate(res['secondaries']):
    print(' S%d ok=%s L=%.3f msg=%s' % (i + 1, r['ok'], r.get('length', -1), r['msg']))
    if not (r['ok'] and abs(r['length'] - res['sec_target']) <= 0.05):
        fails.append('S%d' % (i + 1))
for gi, y in enumerate(res['ys']):
    print(' Y%d d_in %.3f d_out %.3f ok %s' % (gi + 1, y['d_in'], y['d_out'], y['ok']))
    if not (abs(RT.vdist(y['start'], ymarks[gi][0])) < 1e-9 and abs(y['d_out'] - sec_od) < 1e-9 and abs(RT.vdist(y['start'], y['end']) - ylen) < 1e-9):
        fails.append('Y%d' % (gi + 1))
# every secondary starts where its Y ends
for gi, (y, s) in enumerate(zip(res['ys'], res['secondaries'])):
    if RT.vdist(s['elems'][0][1], y['end']) > 1e-6:
        fails.append('S%d start' % (gi + 1))
# tube to tube across both stages, away from the fixed ends
tubes = [(RT.path_points(r['elems'], 0.1), od, r['elems'][0][1], r['elems'][-1][2]) for r in res['primaries']] + \
        [(RT.path_points(r['elems'], 0.1), sec_od, r['elems'][0][1], r['elems'][-1][2]) for r in res['secondaries']]
worst = 1e9
for i in range(len(tubes)):
    for j in range(i + 1, len(tubes)):
        pi, di, ai, bi = tubes[i]
        pj, dj, aj, bj = tubes[j]
        need = (di + dj) / 2.0 + 0.32
        for a in pi:
            if min(RT.vdist(a, ai), RT.vdist(a, bi)) < 2.54 + 2 * max(di, dj) + 0.5:
                continue
            for b in pj:
                if min(RT.vdist(b, aj), RT.vdist(b, bj)) < 2.54 + 2 * max(di, dj) + 0.5:
                    continue
                worst = min(worst, RT.vdist(a, b) - need)
print('worst tube-to-tube margin away from the ends: %.3f cm' % worst)
if worst < -0.01:
    fails.append('tt')
if res['collector'] is None or abs(res['collector']['d_out'] - 7.62) > 1e-9:
    fails.append('collector')
try:
    RT.route_triy(sc, ports, ymarks[:1], col, groups, spec)
    fails.append('ymarks count')
except ValueError as e:
    print('refused:', e)
print('FAILS', fails)
sys.exit(1 if fails else 0)
