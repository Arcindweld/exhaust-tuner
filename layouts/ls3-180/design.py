import os
#!/usr/bin/env python3
"""LS3 180-degree ("bundle of snakes") headers-back exhaust: route the eight primaries with the add-in's router
against a simplified LS3 + driveline + floor keep-out scene, two 4-into-1 merge collectors that each take
cylinders 180 deg apart in the firing order, then 3 in pipes, straight-through mufflers and tips.

Frame: X forward, Y to the driver's (left) side, Z up, crank axis = X, cylinder 1 front left. All lengths cm.
Writes ls3_180.json (everything the Fusion build script needs) and a report.
Usage: python3 design.py [target_in] [collector_x_in] [collector_z_in] [collector_y_in]
"""
import sys, json, math, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'fusion-addin'))
import router as RT

IN = 2.54
args = [a for a in sys.argv[1:] if not a.startswith('--')]
TARGET_IN = float(args[0]) if len(args) > 0 else 30.5      # primary centreline, flange to merge, in
CX = float(args[1]) if len(args) > 1 else -20.0            # collector merge plane x, in
CZ = float(args[2]) if len(args) > 2 else -3.0             # collector z, in
CY = float(args[3]) if len(args) > 3 else 7.5              # collector |y|, in
OD_IN, WALL_IN = 1.875, 0.065
CLR_IN = 2.82                       # Stainless Bros 1.5D mandrel bends for 1.875 in tube
PORT_LEN_IN = 2.5                   # LS3 exhaust port, valve to flange face (estimate; enter the measured one)
COLL_OUT_IN, COLL_LEN_IN = 3.0, 5.8  # 4-1 merge, 3 in outlet (Burns MC4304-188 / Stainless Bros printed 4-1, 5.8 in OAL)

# ---------------- LS3 and driveline, simplified (inches, then cm) ----------------
BORE_SP = 4.400
DECK = 9.240
CYL_X = [1.5 * BORE_SP, 0.5 * BORE_SP, -0.5 * BORE_SP, -1.5 * BORE_SP]   # cylinders 1/2 .. 7/8 front to rear
PORT_UP = DECK + 1.6       # port centre along the bore axis from the crank
PORT_OUT = 3.6             # port centre outboard of the bore axis (the head's exhaust face)
FLOOR_Y = 10.5             # tunnel half width, in (floor, firewall and tunnel roof start here)
GROUND_Z = -13.0           # ground under the crank centreline, in
PORT_TILT = 25.0           # the exhaust face (and the port that leaves it square) tilts this far down from horizontal
HEAD_W = 7.9               # head + valve cover across, exhaust face to the intake side, in
HEAD_H = 7.2               # head + valve cover along the face, in


def bank_axes(side):
    """side +1 = left bank (+Y). Bore axis b, outward in-bank o (away from the V), both unit."""
    s = 1.0 if side > 0 else -1.0
    c = math.cos(math.radians(45.0))
    b = (0.0, s * c, c)
    o = (0.0, s * c, -c)
    return b, o


def port(cyl_index, side):
    b, o = bank_axes(side)
    x = CYL_X[cyl_index]
    p = (x, b[1] * PORT_UP + o[1] * PORT_OUT, b[2] * PORT_UP + o[2] * PORT_OUT)
    s = 1.0 if side > 0 else -1.0
    t = math.radians(PORT_TILT)
    d = (0.0, s * math.cos(t), -math.sin(t))
    return tuple(v * IN for v in p), d


def box(lo, hi):
    x0, y0, z0 = lo; x1, y1, z1 = hi
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    F = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    coords = [c for p in P for c in p]
    idx = [i for f in F for i in f]
    return coords, idx


def obb(center, ex, ey, ez, half):
    """Box with its own axes (unit vectors) and half sizes."""
    P = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                P.append(tuple(center[k] + sx * half[0] * ex[k] + sy * half[1] * ey[k] + sz * half[2] * ez[k] for k in range(3)))
    # vertices ordered (sx,sy,sz) -> index = (sx+1)/2*4 + (sy+1)/2*2 + (sz+1)/2
    def I(sx, sy, sz): return ((sx + 1) // 2) * 4 + ((sy + 1) // 2) * 2 + (sz + 1) // 2
    F = []
    for axis in range(3):
        for s in (-1, 1):
            quad = []
            for a in (-1, 1):
                for b in (-1, 1):
                    v = [0, 0, 0]; v[axis] = s
                    rest = [k for k in range(3) if k != axis]
                    v[rest[0]] = a; v[rest[1]] = b
                    quad.append(I(*v))
            F += [(quad[0], quad[1], quad[3]), (quad[0], quad[3], quad[2])]
    coords = [c for p in P for c in p]
    idx = [i for f in F for i in f]
    return coords, idx


def cyl_x(x0, x1, r, cz=0.0, cy=0.0, n=24):
    P = []
    for x in (x0, x1):
        for k in range(n):
            a = 2 * math.pi * k / n
            P.append((x, cy + r * math.cos(a), cz + r * math.sin(a)))
    P.append((x0, cy, cz)); P.append((x1, cy, cz))
    F = []
    for k in range(n):
        k2 = (k + 1) % n
        F += [(k, k2, n + k2), (k, n + k2, n + k)]
        F += [(2 * n, k2, k), (2 * n + 1, n + k, n + k2)]
    coords = [c for p in P for c in p]
    idx = [i for f in F for i in f]
    return coords, idx


def solids():
    """Named keep-out solids in cm: (name, kind, params) for Fusion, plus the triangle mesh for the router."""
    out = []
    c = math.cos(math.radians(45.0))
    for side, nm in ((1, 'left'), (-1, 'right')):
        b, o = bank_axes(side)
        ex = (1.0, 0.0, 0.0)
        # bank of the block: along the bore from 2 to 9.24 in, +-2.9 in thick, 23.5 in long
        cen_b = tuple(((2.0 + DECK) / 2.0) * b[k] * IN for k in range(3)); cen_b = (0.25 * IN, cen_b[1], cen_b[2])
        out.append(('Block bank ' + nm, 'obb', dict(center=cen_b, ex=ex, ey=o, ez=b, half=(11.75 * IN, 2.9 * IN, (DECK - 2.0) / 2.0 * IN))))
        # head + valve cover as a box whose outer face is the exhaust flange face: it passes through the port
        # centres and its normal is the port direction (tilted PORT_TILT down from horizontal)
        pc, n = port(1, side)                       # a middle port, cm
        pc = tuple(v / IN for v in pc)
        s_ = 1.0 if side > 0 else -1.0
        t = math.radians(PORT_TILT)
        ez_ = (0.0, s_ * math.sin(t), math.cos(t))  # along the face, upward
        cen_h = tuple((pc[k] - n[k] * HEAD_W / 2.0 + ez_[k] * 0.8) * IN for k in range(3))
        cen_h = (0.0, cen_h[1], cen_h[2])
        out.append(('Head and valve cover ' + nm, 'obb', dict(center=cen_h, ex=ex, ey=n, ez=ez_, half=(11.3 * IN, HEAD_W / 2.0 * IN, HEAD_H / 2.0 * IN))))
    out.append(('Crankcase', 'box', dict(lo=(-11.75 * IN, -5.5 * IN, -2.5 * IN), hi=(12.0 * IN, 5.5 * IN, 3.0 * IN))))
    out.append(('Oil pan', 'box', dict(lo=(-9.0 * IN, -6.0 * IN, -8.5 * IN), hi=(12.0 * IN, 6.0 * IN, -2.5 * IN))))
    out.append(('Starter', 'box', dict(lo=(-12.0 * IN, -10.0 * IN, -6.0 * IN), hi=(-5.0 * IN, -6.0 * IN, -2.0 * IN))))
    out.append(('Bellhousing', 'cylx', dict(x0=-18.5 * IN, x1=-11.75 * IN, r=7.5 * IN, cz=0.0)))
    out.append(('Transmission', 'box', dict(lo=(-45.0 * IN, -4.5 * IN, -5.0 * IN), hi=(-18.5 * IN, 4.5 * IN, 4.0 * IN))))
    out.append(('Front crossmember', 'box', dict(lo=(8.0 * IN, -18.0 * IN, -12.0 * IN), hi=(12.0 * IN, 18.0 * IN, -9.0 * IN))))
    for s, nm in ((1, 'left'), (-1, 'right')):
        y0, y1 = sorted((s * 16.0 * IN, s * 19.0 * IN))
        out.append(('Frame rail ' + nm, 'box', dict(lo=(-60.0 * IN, y0, -8.0 * IN), hi=(15.0 * IN, y1, -3.0 * IN))))
        y0, y1 = sorted((s * FLOOR_Y * IN, s * 19.0 * IN))
        out.append(('Floor ' + nm, 'box', dict(lo=(-60.0 * IN, y0, -8.0 * IN), hi=(-14.0 * IN, y1, -5.0 * IN))))
        out.append(('Firewall ' + nm, 'box', dict(lo=(-16.0 * IN, y0, -8.0 * IN), hi=(-14.0 * IN, y1, 20.0 * IN))))
    out.append(('Tunnel roof', 'box', dict(lo=(-60.0 * IN, -FLOOR_Y * IN, 6.0 * IN), hi=(-14.0 * IN, FLOOR_Y * IN, 8.0 * IN))))
    out.append(('Ground', 'box', dict(lo=(-70.0 * IN, -30.0 * IN, (GROUND_Z - 11.0) * IN), hi=(30.0 * IN, 30.0 * IN, GROUND_Z * IN))))
    return out


def mesh_of(kind, p):
    if kind == 'box':
        return box(p['lo'], p['hi'])
    if kind == 'obb':
        return obb(p['center'], p['ex'], p['ey'], p['ez'], p['half'])
    if kind == 'cylx':
        return cyl_x(p['x0'], p['x1'], p['r'], p.get('cz', 0.0), p.get('cy', 0.0))
    raise ValueError(kind)


def main():
    t0 = time.time()
    sol = solids()
    sc = RT.Scene(cell=1.0, sample_len=0.4)
    for name, kind, p in sol:
        co, ix = mesh_of(kind, p)
        sc.add_mesh(co, ix, 0.0, name)
    lo = (-50.0 * IN, -20.0 * IN, -14.0 * IN); hi = (14.0 * IN, 20.0 * IN, 18.0 * IN)
    sc.build(lo, hi, 2.0)
    print('scene built: %d meshes, %.1f s' % (len(sol), time.time() - t0))

    # cylinders: GM numbering, left bank 1-3-5-7 front to rear, right bank 2-4-6-8
    ports = {}
    for i in range(4):
        ports[1 + 2 * i] = port(i, +1)
        ports[2 + 2 * i] = port(i, -1)
    # 180-degree pairing for the LS firing order 1-8-7-2-6-5-4-3: alternate cylinders in the order
    order = [1, 8, 7, 2, 6, 5, 4, 3]
    groupA = order[0::2]          # 1, 7, 6, 4  -> pulses at 0, 180, 360, 540 deg
    groupB = order[1::2]          # 8, 2, 5, 3
    # collector A on the left (it takes 1 and 7 from the left bank), B on the right
    collA = ((CX * IN, CY * IN, CZ * IN), (-1.0, 0.0, 0.0))
    collB = ((CX * IN, -CY * IN, CZ * IN), (-1.0, 0.0, 0.0))

    spec = {'od': OD_IN * IN, 'clr': CLR_IN * IN, 'target': TARGET_IN * IN, 'gap': 1.27, 'gap_tt': 0.32,
            'lead_start': 2.54, 'lead_end': 2.54, 'min_straight': 0.0, 'max_bend_deg': 180.0, 'tol': 0.05,
            'time_budget': 90.0, 'collector_len': COLL_LEN_IN * IN, 'collector_out_d': COLL_OUT_IN * IN}
    tubes = RT.TubeSet()
    results = {}
    log = lambda s: None
    for tag, grp, coll, base in (('A', groupA, collA, 0), ('B', groupB, collB, 10)):
        sp = dict(spec, tubes=tubes, owner_base=base, order=[2, 3, 0, 1])   # the crossing tubes first: they have the least room
        res = RT.route_header(sc, [ports[c] for c in grp], coll, sp, log=log)
        results[tag] = {'cyls': grp, 'res': res}
        for c, r in zip(grp, res['primaries']):
            L = r.get('length')
            print('collector %s cyl %d: ok=%s length=%s in  %s' % (tag, c, r.get('ok'), '%.2f' % (L / IN) if L else None,
                  (r.get('msg') or '')[:110]))
        print('collector %s: ok=%s spread=%.2f mm clock=%s  cone ok=%s min_gap=%s' % (
            tag, res['ok'], 10 * res.get('spread', 0), res['clock_deg'], res['collector']['ok'],
            res['collector']['min_gap']))
    print('routing: %.0f s' % (time.time() - t0))

    out = {'units': 'cm', 'frame': 'X forward, Y left, Z up, crank axis X, cylinder 1 front left',
           'params': {'od_in': OD_IN, 'wall_in': WALL_IN, 'clr_in': CLR_IN, 'target_in': TARGET_IN, 'port_len_in': PORT_LEN_IN,
                      'coll_out_in': COLL_OUT_IN, 'coll_len_in': COLL_LEN_IN, 'coll_x_in': CX, 'coll_y_in': CY, 'coll_z_in': CZ},
           'solids': [{'name': n, 'kind': k, 'p': p} for n, k, p in sol],
           'ports': {str(c): {'p': ports[c][0], 'd': ports[c][1]} for c in ports},
           'collectors': {}}
    for tag in ('A', 'B'):
        R = results[tag]['res']
        prim = []
        for c, r in zip(results[tag]['cyls'], R['primaries']):
            prim.append({'cyl': c, 'ok': r.get('ok'), 'length': r.get('length'), 'elems': r.get('elems'),
                         'min_gap': r.get('min_gap'), 'msg': r.get('msg'),
                         'lra': RT.lra_schedule(r['elems']) if r.get('elems') else None,
                         'fab': RT.fab_report(r['elems'], OD_IN * IN, min_clr=CLR_IN * IN - 0.01) if r.get('elems') else None})
        cb = R['collector']
        out['collectors'][tag] = {'cyls': results[tag]['cyls'], 'point': (collA if tag == 'A' else collB)[0],
                                  'dir': (-1.0, 0.0, 0.0), 'slots': R['slots'], 'assign': R['assign'], 'clock_deg': R['clock_deg'],
                                  'spread': R.get('spread'), 'ok': R['ok'], 'primaries': prim,
                                  'cone': {'start': cb['start'], 'end': cb['end'], 'd_in': cb['d_in'], 'd_out': cb['d_out'], 'min_gap': cb['min_gap'], 'ok': cb['ok']}}
    json.dump(out, open('ls3_180.json', 'w'))
    print('wrote ls3_180.json')


if __name__ == '__main__':
    main()
