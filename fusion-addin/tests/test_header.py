import os
import sys, math, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router as RT, test_router as T
head = T.box_mesh((-6, -10, -15), (0, 50, 15), 12)        # head face at x = 0, ports on it
rail = T.box_mesh((15, -20, -30), (22, 60, -24), 12)       # a frame rail to get past
sc = RT.Scene(cell=1.0); sc.add_mesh(*head); sc.add_mesh(*rail); sc.build((-10, -30, -80), (80, 70, 20), 10)
ports = [((0.0, 4.0 + 10.0 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
col = ((35.0, 19.0, -45.0), (0.0, 0.0, -1.0))
od = 4.128
spec = {'od': od, 'clr': 1.5 * od, 'gap': 1.27, 'gap_tt': 0.32, 'target': 76.2, 'collector_len': 12.0, 'collector_out_d': 7.62}
t0 = time.time()
res = RT.route_header(sc, ports, col, spec, log=None)
print('header ok', res['ok'], 'spread %.4f' % res.get('spread', -1), 'clock', res['clock_deg'], 'assign', res['assign'], '%.1fs' % (time.time() - t0))
fails = []
polys = []
for i, r in enumerate(res['primaries']):
    print(' P%d ok=%s L=%.3f slack=%.3f tt=%s bends=%s msg=%s t=%.1f' % (i + 1, r['ok'], r['length'], r['slack'], r['tt_slack'] and round(r['tt_slack'], 3), [round(a) for a in r['bend_angles']], r['msg'], r['time']))
    s = dict(spec); s.update({'start': ports[i][0], 'start_dir': ports[i][1], 'end': res['slots'][res['assign'][i]], 'end_dir': col[1]})
    w, gaps, turn, ee, de, tot = T.check_route(r, [head, rail], s, '  brute P%d' % (i + 1))
    if not (r['ok'] and w >= -0.01 and abs(tot - 76.2) <= 0.05 and gaps < 1e-6 and turn < 0.05 and ee < 1e-6 and de < 0.01):
        fails.append(i)
    polys.append(RT.path_points(r['elems'], 0.1))
# tube to tube, brute force: away from the collector ramp the centres must be od + gap_tt apart
worst = 1e9
for i in range(4):
    for j in range(i + 1, 4):
        for a in polys[i]:
            if RT.vdist(a, res['slots'][res['assign'][i]]) < 2.54 + 2 * od + 0.5: continue
            if RT.vdist(a, ports[i][0]) < 2.54 + 2 * od + 0.5: continue
            for b in polys[j]:
                d = RT.vdist(a, b)
                if d < worst: worst = d
print('tube-to-tube centre distance away from the ends: %.3f (need >= %.3f)' % (worst, od + 0.32))
if worst < od + 0.32 - 0.01: fails.append('tt')
print('collector', {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res['collector'].items() if k in ('d_in', 'd_out', 'min_gap', 'ok')})
print('FAILS', fails)
sys.exit(1 if fails else 0)   # a failing check fails the run (the README chains these with &&)
