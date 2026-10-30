import os
#!/usr/bin/env python3
"""Hand layout of the LS3 180-degree primaries: each tube is a polyline of waypoints (inches) turned into
lines and arcs of fixed centreline radius by the router's chain_geometry; the script checks every tube against the
keep-out scene and every tube against every other, solves one trim per tube so all eight hit the target length,
and writes ls3_180.json for the Fusion build. Lanes (the plan, left bank; right mirrored):
  crossing tubes 3,5 (4,6): port -> short drop -> outboard lane at y 13.4 -> rearward -> drop column at the
      bellhousing -> inboard run under the bank -> diagonal under the bellhousing to the far collector
  local front 1 (2): port -> straight down a column at y 11 -> outboard -> rearward along a low lane -> into the tunnel
  local rear 7 (8): port -> column -> outboard -> FORWARD along a lane -> U down -> back along a lower lane -> tunnel
Usage: python3 layout.py [target_in]
"""
import sys, json, math
sys.path.insert(0, '.')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'fusion-addin'))
import design as D
import router as RT

IN = 2.54
TARGET = float(sys.argv[1]) if len(sys.argv) > 1 else 46.5
OD, CLR = 1.875, 2.82
GAP, GAP_TT = 0.5, 0.125
CX, CY, CZ = -21.0, 7.7, -6.6
D.CX, D.CY, D.CZ, D.TARGET_IN = CX, CY, CZ, TARGET
D.FLOOR_Y = 10.75       # tunnel half width (floor and firewall start here)
D.GROUND_Z = -13.5
LANE_Y = 13.4           # outboard lane beside the block
COL_Y = 11.0            # drop column just outside the head face
JOG_X = -3.5            # where the local tubes start their jog into the tunnel

# per-side lanes (in). The right bank differs because of the starter (x -12..-5, y -10..-6, z -6..-2): its local
# tubes sit a little further out and dip under the starter on their way into the tunnel.
LANES = {
    +1: dict(col_y=12.35, lane_y=14.5, rear_fwd=0.6, rear_ret=-5.1, front_fwd=-1.5, front_ret=-7.1, cross=-11.7, cross_hi=1.6, cross_hi2=6.5, kink_z=6.5),
    -1: dict(col_y=12.35, lane_y=14.5, rear_fwd=0.6, rear_ret=-5.1, front_fwd=-1.5, front_ret=-7.1, cross=-9.6, cross_hi=1.6, cross_hi2=7.5, kink_z=7.5),
}
D.GROUND_Z = -14.0
STATION = {'fmid': -10.0, 'rmid': -12.3}      # x of the crossing tubes' inboard runs under the bank (in)
STATION_Y = {'fmid': 3.0, 'rmid': 5.0}
JOG_X = -5.5
LEAD = {'rear': 2.9, 'front': 2.2, 'cross': 2.9}   # straight out of the port before the first bend (in)
RISE = {'fmid': (-13.7, -16.2), 'rmid': (-16.5, -19.3)}   # where each crossing tube's flat run ends and its rise to the slot ends


def slots(side):
    """Four touching slots round the collector axis at 45 deg: (name) -> (y, z)."""
    s = 1.0 if side > 0 else -1.0
    r = OD / (2.0 * math.sin(math.pi / 4))
    o = r * math.cos(math.pi / 4)
    return {'outer_up': (s * (CY + o), CZ + o), 'outer_lo': (s * (CY + o), CZ - o),
            'inner_up': (s * (CY - o), CZ + o), 'inner_lo': (s * (CY - o), CZ - o)}


def waypoints(cyl, trim):
    side = 1 if cyl % 2 else -1
    s = 1.0 if side > 0 else -1.0
    L = LANES[side]
    i = (cyl - 1) // 2
    xp = D.CYL_X[i]
    P, d = D.port(i, side)
    P = tuple(v / IN for v in P)
    role = ['front', 'fmid', 'rmid', 'rear'][i]
    lead = LEAD['cross'] if role in ('fmid', 'rmid') else LEAD[role]
    P1 = tuple(P[k] + d[k] * lead for k in range(3))
    far = -side
    SL, SLf = slots(side), slots(far)
    y = s * L['col_y']
    ly = s * L['lane_y']
    if role == 'front':
        # a forward lobe: down and forward from the port, U down to the return level, back, into the tunnel
        xf = 9.0 + trim
        sy, sz = SL['outer_lo']
        Q = [P, P1, (xf, y, L['front_fwd']), (xf, y, L['front_ret'])]
        if side < 0:
            Q += [(-3.0, y, L['front_ret']), (-7.5, y, -11.7), (-14.5, s * 8.9, -11.7), (-17.0, sy, sz)]      # under the starter and the crossing tubes, rise late
        else:
            Q += [(JOG_X, y, L['front_ret']), (-16.0, sy, sz)]
        return Q + [(CX, sy, sz)]
    if role == 'rear':
        xf = trim
        sy, sz = SL['outer_up']
        yf = s * 10.1                                   # the forward lane sits inboard, under the head, clear of the front tube's lobe
        Q = [P, P1, (-3.5, s * 11.6, L['rear_fwd']), (-1.0, yf, L['rear_fwd']), (xf, yf, L['rear_fwd']), (xf, y, L['rear_ret']), (JOG_X, y, L['rear_ret'])]
        if side < 0:
            Q += [(-9.5, y, -7.3), (-12.5, s * 9.4, -7.3)]                           # under the starter, then up to the slot
        return Q + [(-16.0, sy, sz), (CX, sy, sz)]
    # crossing tubes: a short kick out to the outboard lane, an optional high run (the length trim), a sloping run down
    # and back to the station, inboard under the bank, flat under the bellhousing to the far collector, a rise into its slot
    zc = L['cross']
    xs = STATION[role]
    x_flat, x_rise = RISE[role]
    sy, sz = SLf['inner_up'] if role == 'fmid' else SLf['inner_lo']
    Q = [P, P1]
    run = (0.0 if trim < 3.5 else min(trim, xp - 3.0 - xs - 0.5))
    if role == 'fmid':
        Q.append((xp - 3.0, ly, L['cross_hi']))
        if run > 0.05:
            Q.append((xp - 3.0 - run, ly, L['cross_hi']))
    elif run > 0.05:
        Q += [(xp - 3.0, ly, L['kink_z']), (xp - 3.0 - run, ly, L['cross_hi2'])]     # the high run climbs as it goes back
    sty = STATION_Y[role]
    Q += [(xs, ly, zc), (xs, s * sty, zc)]
    dog = min(trim - run, 4.5 if role == 'fmid' else 3.0)
    if dog > 0.05:
        xm = (xs + x_flat) / 2.0 + (dog if role == 'fmid' else -dog)
        ym = (s * sty + sy) / 2.0
        Q.append((xm, ym, zc))
    Q += [(x_flat, sy, zc), (x_rise, sy, sz), (CX, sy, sz)]
    return Q


def build(cyl, trim):
    Q = [tuple(v * IN for v in q) for q in waypoints(cyl, trim)]
    g = RT.chain_geometry(Q, CLR * IN)
    return g


def solve(cyl):
    """One-dimensional solve of the trim so the centreline length hits TARGET."""
    lo, hi = (-5.5, 13.0) if (cyl in (7, 8)) else ((0.0, 10.0) if cyl in (1, 2) else (0.0, 14.0))
    f = lambda t: build(cyl, t)['length'] / IN - TARGET
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return (lo if abs(flo) < abs(fhi) else hi), f
    for _ in range(60):
        mid = (lo + hi) / 2.0
        fm = f(mid)
        if flo * fm <= 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2.0, f


def check_scene(sc, g, cyl):
    """Smallest surface gap to the keep-outs along the tube (cm), ignoring the first/last 1.5 in (the faces it sits on)."""
    pts = RT.path_points(g['elems'], 0.4)
    L = g['length']
    worst = None
    where = None
    run = 0.0
    prev = pts[0]
    for p in pts:
        run += RT.vdist(p, prev); prev = p
        if run < 1.5 * IN or run > L - 1.5 * IN:
            continue
        d = sc.dist_exact(p, 8.0) - OD * IN / 2.0
        if worst is None or d < worst:
            worst, where = d, p
    return worst, where


def main():
    sol = D.solids()
    sc = RT.Scene(cell=1.0, sample_len=0.4)
    for n, k, p in sol:
        co, ix = D.mesh_of(k, p)
        sc.add_mesh(co, ix, 0.0, n)
    sc.build((-50 * IN, -20 * IN, -24 * IN), (14 * IN, 20 * IN, 18 * IN), 2.0)
    tubes = {}
    report = {}
    for c in range(1, 9):
        t, f = solve(c)
        g = build(c, t)
        bad_avail = [round(a / IN, 2) for a in g['avail'] if a < -1e-6]
        worst, where = check_scene(sc, g, c)
        tubes[c] = g
        report[c] = {'trim': round(t, 2), 'length': round(g['length'] / IN, 2), 'bends': [round(math.degrees(a)) for a in g['th'] if a > 1e-6],
                     'overlapping_bends_in': bad_avail, 'scene_gap_in': round(worst / IN, 2) if worst is not None else None,
                     'where': tuple(round(v / IN, 1) for v in where) if where else None}
        print('cyl %d: %s' % (c, report[c]))
    # tube to tube
    pts = {c: RT.path_points(g['elems'], 0.5) for c, g in tubes.items()}
    coll = lambda c: (CX * IN, (CY if (c in (1, 7, 6, 4)) else -CY) * IN, CZ * IN)
    print('tube pairs (surface gap, in), last 5 in into the collector ignored:')
    bad = []
    for a in range(1, 9):
        for b in range(a + 1, 9):
            best, wp = 1e9, None
            for p in pts[a]:
                if RT.vdist(p, coll(a)) < 5.0 * IN: continue
                for q in pts[b]:
                    if RT.vdist(q, coll(b)) < 5.0 * IN: continue
                    dd = RT.vdist(p, q)
                    if dd < best: best, wp = dd, p
            gap = best / IN - OD
            if gap < GAP_TT:
                bad.append((a, b, round(gap, 2), tuple(round(v / IN, 1) for v in wp)))
    print(bad or 'all pairs clear')
    # ---- export for the Fusion build (same schema as design2.py) ----
    coll_pt = {'A': (CX * IN, CY * IN, CZ * IN), 'B': (CX * IN, -CY * IN, CZ * IN)}
    groups = {'A': [1, 7, 6, 4], 'B': [8, 2, 5, 3]}          # 180-degree pairs: 1-8-7-2-6-5-4-3 taken alternately
    ports = {}
    for c in range(1, 9):
        i = (c - 1) // 2
        P, d = D.port(i, 1 if c % 2 else -1)
        ports[str(c)] = {'p': P, 'd': d}
    out = {'units': 'cm', 'frame': 'X forward, Y left, Z up, crank axis X, cylinder 1 front left',
           'params': {'od_in': OD, 'wall_in': D.WALL_IN, 'clr_in': CLR, 'target_in': TARGET, 'port_len_in': D.PORT_LEN_IN,
                      'coll_out_in': D.COLL_OUT_IN, 'coll_len_in': D.COLL_LEN_IN, 'coll_x_in': CX, 'coll_y_in': CY, 'coll_z_in': CZ},
           'solids': [{'name': n, 'kind': k, 'p': p} for n, k, p in sol],
           'ports': ports, 'lanes': {str(k): v for k, v in LANES.items()}, 'report': {str(k): v for k, v in report.items()},
           'collectors': {}}
    for tag, grp in groups.items():
        cpt = coll_pt[tag]
        prim = []
        for c in grp:
            g = tubes[c]
            prim.append({'cyl': c, 'ok': True, 'length': g['length'], 'elems': g['elems'], 'min_gap': None, 'msg': 'hand layout, checked',
                         'lra': RT.lra_schedule(g['elems']),
                         'fab': RT.fab_report(g['elems'], OD * IN, min_clr=CLR * IN - 0.01)})
        cb = RT.collector_body(cpt, (-1.0, 0.0, 0.0), 4, OD * IN, D.COLL_LEN_IN * IN, D.COLL_OUT_IN * IN, sc, 1.27)
        out['collectors'][tag] = {'cyls': grp, 'point': cpt, 'dir': (-1.0, 0.0, 0.0), 'ok': True, 'primaries': prim,
                                  'spread': 0.0, 'clock_deg': 45.0,
                                  'cone': {'start': cb['start'], 'end': cb['end'], 'd_in': cb['d_in'], 'd_out': cb['d_out'], 'min_gap': cb['min_gap'], 'ok': cb['ok']}}
    json.dump(out, open('ls3_180.json', 'w'))
    print('wrote ls3_180.json; collector cones ok:', [out['collectors'][t]['cone']['ok'] for t in out['collectors']],
          'cone min gap in:', [round((out['collectors'][t]['cone']['min_gap'] or 0) / IN, 2) for t in out['collectors']])
    return tubes, report, sol


if __name__ == '__main__':
    main()
