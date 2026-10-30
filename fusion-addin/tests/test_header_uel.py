import os
"""Unequal-length headers: one target per port (a Subaru-style 4-2-1 pairing is a length plan, the router only has to hit it)."""
import sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router as RT, test_router as T
head = T.box_mesh((-6, -10, -15), (0, 50, 15), 12)
rail = T.box_mesh((15, -20, -30), (22, 60, -24), 12)
sc = RT.Scene(cell=1.0); sc.add_mesh(*head); sc.add_mesh(*rail); sc.build((-10, -30, -80), (80, 70, 20), 10)
ports = [((0.0, 4.0 + 10.0 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
col = ((35.0, 19.0, -45.0), (0.0, 0.0, -1.0))
od = 4.128
targets = [70.0, 76.2, 88.0, 95.0]
spec = {'od': od, 'clr': 1.5 * od, 'gap': 1.27, 'gap_tt': 0.32, 'target': None, 'targets': targets, 'collector_len': 12.0, 'collector_out_d': 7.62}
t0 = time.time()
res = RT.route_header(sc, ports, col, spec, log=None)
print('ok', res['ok'], '%.1fs' % (time.time() - t0))
fails = []
for i, r in enumerate(res['primaries']):
    print(' P%d ok=%s L=%.3f target=%.1f miss=%.3f msg=%s' % (i + 1, r['ok'], r['length'], targets[i], r['length'] - targets[i], (r.get('msg') or '')[:60]))
    s = dict(spec); s.pop('targets'); s.update({'target': targets[i], 'start': ports[i][0], 'start_dir': ports[i][1], 'end': res['slots'][res['assign'][i]], 'end_dir': col[1]})
    w, gaps, turn, ee, de, tot = T.check_route(r, [head, rail], s, '  brute P%d' % (i + 1))
    if not (r['ok'] and w >= -0.01 and abs(tot - targets[i]) <= 0.05 and gaps < 1e-6 and turn < 0.05 and ee < 1e-6 and de < 0.01):
        fails.append(i)
print('FAILS', fails)
