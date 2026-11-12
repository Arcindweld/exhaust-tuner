"""Fabrication audit, 2026-11-11 (docs/FAB_AUDIT_2026-11-11.md): the add-in's cut and bend outputs against references
written here from the geometry, not from the add-in's formulas.

  1. bend table (router.lra_schedule): the 3-D centreline is rebuilt from the table alone (straight, rotate the bend
     plane right-handed about the feed direction, bend on the CLR) and compared with the router's own elements, end by
     end; and each rotation equals the change of the bend's turning direction in a frame carried along the tube
     (the convention tubecfd.py uses for the CFD generator's plane_deg), so the two agree in sign.
  2. tee cope depth (templates.tee_cope): each line of the branch's outside run into the main pipe by marching and
     bisection, for a square tee, a same-size tee, a branch offset from the main axis and a 45 deg lateral.
  3. merge collector (merge.py): the plate holes and ligaments, the outlet area, and the cone, spike and sleeve flat
     patterns closing round their rims at mid-wall; every DXF outline closed, in mm.
  4. tack jig (jig.plan): each saddle the tube OD plus the clearance, each block's top at the centreline's lowest point
     over its length (so no saddle wraps past half the tube and the piece lifts out), each station on the centreline.
  5. the tee note gives inches and mm.
Lengths in the add-in are cm; the tolerances below are 0.0025 cm (0.025 mm) on geometry, 0.01 deg on angles."""
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import router as RT
import templates as TPL
import merge as M
import jig as JG

FAILS = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        FAILS.append(m)


def sub(a, b):
    return tuple(a[k] - b[k] for k in range(3))


def add(a, b, s=1.0):
    return tuple(a[k] + s * b[k] for k in range(3))


def dot(a, b):
    return sum(a[k] * b[k] for k in range(3))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a):
    n = math.sqrt(dot(a, a))
    return tuple(c / n for c in a)


def rot(v, axis, deg):
    """Rodrigues: v turned deg about the unit axis, right-handed."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    kv = cross(axis, v)
    kd = dot(axis, v)
    return tuple(v[i] * c + kv[i] * s + axis[i] * kd * (1 - c) for i in range(3))


# ---------------------------------------------------------------- 1. bend table round trip
def rebuild(rows, p0, t0, b0):
    """Centreline from the table: run L along t, turn the bend normal b by R about t, bend A on CLR toward b x t.
    Returns the point and tangent after each bend and at the end."""
    p, t, b, out = p0, t0, b0, []
    for r in rows:
        p = add(p, t, r['L'])
        if r['A'] is None:
            out.append((p, t))
            break
        if r['R'] is not None:
            b = rot(b, t, r['R'])
        k = cross(b, t)                      # the way the tube turns
        A, C = math.radians(r['A']), r['CLR']
        c = add(p, k, C)
        p = add(c, add(tuple(-x * math.cos(A) for x in k), tuple(x * math.sin(A) for x in t)), C)
        t = unit(add(tuple(x * math.sin(A) for x in k), tuple(x * math.cos(A) for x in t)))
        out.append((p, t))
    return out


PATHS = [
    ('planar S, 40 mm CLR', [(0, 0, 0), (20, 0, 0), (30, 15, 0), (50, 15, 0)], 4.0),
    ('3-D header-like run, four bends clocked every way', [(0, 0, 0), (15, 0, 0), (25, 10, 5), (25, 25, 15), (10, 35, 10), (0, 35, 30)], 3.0),
    ('awkward: a 165 deg near-U-turn, then a bend clocked about -120 deg', [(0, 0, 0), (30, 0, 0), (2, 6, 3), (4, 30, -12), (25, 34, -12)], 1.5),
]
for name, Q, R in PATHS:
    g = RT.chain_geometry(Q, R)
    ok(min(g['avail']) >= -1e-9, '%s: the bends fit between the corners' % name)
    rows = RT.lra_schedule(g['elems'])
    arcs = [e for e in g['elems'] if e[0] == 'arc']
    d0 = unit(sub(Q[1], Q[0]))
    b0 = unit(cross(d0, unit(sub(Q[2], Q[1]))))
    got = rebuild(rows, Q[0], d0, b0)
    want = [(e[2], RT.elem_tangent(e, 1.0)) for e in arcs] + [(Q[-1], unit(sub(Q[-1], Q[-2])))]
    wp = max(math.sqrt(dot(sub(a[0], b[0]), sub(a[0], b[0]))) for a, b in zip(got, want))
    wt = max(math.degrees(math.acos(max(-1.0, min(1.0, dot(a[1], b[1]))))) for a, b in zip(got, want))
    ok(len(got) == len(want) and wp < 0.0025 and wt < 0.01,
       '%s: rebuilt from the table, every bend end and the tube end within %.5f mm and %.5f deg' % (name, 10 * wp, wt))
    # the same table with every rotation's sign flipped misses (a planar path cannot tell, the 3-D ones must)
    flip = [dict(r, R=(-r['R'] if r['R'] is not None else None)) for r in rows]
    gf = rebuild(flip, Q[0], d0, b0)
    miss = math.sqrt(dot(sub(gf[-1][0], Q[-1]), sub(gf[-1][0], Q[-1])))
    if any(r['R'] not in (None,) and abs(r['R']) > 1 and abs(abs(r['R']) - 180) > 1 for r in rows):
        ok(miss > 1.0, '%s: with the rotations negated the end lands %.0f mm away, so the sign is pinned down' % (name, 10 * miss))
    # carried-frame plane angle (tubecfd's plane_deg): transport (k1, k1 x t) along the tube, read each turning direction
    t = d0
    u = unit(cross(b0, d0))                  # bend 1's turning direction sets the frame
    phis = []
    for e in arcs:
        tin = RT.elem_tangent(e, 0.0)
        nrm = unit(cross(e[6], e[7]))
        k = cross(nrm, tin)
        phis.append(math.degrees(math.atan2(dot(k, cross(tin, u)), dot(k, u))))
        u = rot(u, nrm, math.degrees(e[4]))
    bends = [r for r in rows if r['A'] is not None]
    dev = max([abs(((phis[i] - phis[i - 1]) - bends[i]['R'] + 180.0) % 360.0 - 180.0) for i in range(1, len(bends))] + [0.0])
    ok(dev < 0.01, '%s: each rotation is the change of plane angle in the carried frame (tubecfd\'s convention), within %.5f deg; rotations %s'
       % (name, dev, ', '.join('%.1f' % r['R'] for r in bends[1:])))


# ---------------------------------------------------------------- 2. tee cope depth by brute force
def enter(q, d, R):
    """How far down the line q - t d (main pipe on the x axis, radius R) first enters the pipe: march then bisect."""
    f = lambda t: (q[1] - t * d[1]) ** 2 + (q[2] - t * d[2]) ** 2 - R * R
    t, h = -3 * R, R / 2000.0
    while f(t) > 0 and t < 5 * R:
        t += h
    if t >= 5 * R:
        return None
    lo, hi = t - h, t
    for _ in range(60):
        m = (lo + hi) / 2
        if f(m) > 0:
            lo = m
        else:
            hi = m
    return hi


def ref_depth(start, d, r, R, n=360):
    d = unit(d)
    e1 = unit(cross(d, (1.0, 0.0, 0.0)) if abs(d[0]) < 0.9 else cross(d, (0.0, 1.0, 0.0)))
    e2 = cross(d, e1)
    deep = 0.0
    for k in range(n):
        ph = 2 * math.pi * k / n
        q = add(start, add(tuple(x * r * math.cos(ph) for x in e1), tuple(x * r * math.sin(ph) for x in e2)))
        t = enter(q, d, R)
        if t is None:
            return None
        deep = max(deep, t)
    return deep


R0 = 3.175           # 2.5 in main pipe OD, cm
COPES = [
    ('square tee, 1.5 in on 2.5 in', (0, 0, R0), (0, 0, 1), 1.905, R0),
    ('same size, 2.5 in on 2.5 in', (0, 0, R0), (0, 0, 1), R0, R0),
    ('1.25 in branch offset 0.5 in from the main axis', (0, 1.27, math.sqrt(R0 ** 2 - 1.27 ** 2)), (0, 0, 1), 1.5875, R0),
    ('45 deg lateral, 1.5 in on 2.5 in', (0, 0, R0), (math.sin(math.radians(45)), 0, math.cos(math.radians(45))), 1.905, R0),
]
for name, st, d, r, R in COPES:
    c = TPL.tee_cope({'p': (0.0, 0.0, 0.0), 'd': (1.0, 0.0, 0.0), 'R': R}, st, d, r)
    ref = ref_depth(st, d, r, R)
    closed = R - math.sqrt(R * R - r * r) if d == (0, 0, 1) and st[1] == 0 else None
    ok(ref is not None and abs(c['depth'] - ref) < 0.0025 and (closed is None or abs(c['depth'] - closed) < 0.0025),
       '%s: the fishmouth reaches %.3f in (%.2f mm) below the start; marched %.2f mm%s' % (
           name, c['depth'] / 2.54, 10 * c['depth'], 10 * ref, '' if closed is None else ', R - sqrt(R^2 - r^2) %.2f mm' % (10 * closed)))


# ---------------------------------------------------------------- 3. merge collector
def dxf_ents(txt):
    t = txt.split('\r\n')
    hdr = {t[i + 1]: t[i + 3] for i in range(0, len(t) - 3, 2) if t[i] == '9'}
    ents, i = [], 0
    while i < len(t) - 1:
        if t[i] == '0' and t[i + 1] in ('LINE', 'ARC', 'CIRCLE'):
            e, j = {'type': t[i + 1]}, i + 2
            while j < len(t) - 1 and t[j] != '0':
                e[t[j]] = float(t[j + 1]) if t[j] != '8' else t[j + 1]
                j += 2
            ents.append(e)
            i = j
        else:
            i += 2
    return hdr, ents


def closed(ents):
    pts = []
    for e in ents:
        if e['type'] == 'LINE':
            pts += [(e['10'], e['20']), (e['11'], e['21'])]
        elif e['type'] == 'ARC':
            for a in (e['50'], e['51']):
                pts.append((e['10'] + e['40'] * math.cos(math.radians(a)), e['20'] + e['40'] * math.sin(math.radians(a))))
    return all(any(j != i and math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3 for j, q in enumerate(pts)) for i, p in enumerate(pts))


MERGES = [('4 into 1, 1.75 in 16 ga into 3 in', 4, 4.445, 0.1651, 7.62, 15.0),
          ('3 into 1, 1.875 in into 3 in', 3, 4.7625, 0.1651, 7.62, 14.0),
          ('6 into 1 (a rolled spike), 2 in into 4.5 in', 6, 5.08, 0.1651, 11.43, 25.0),
          ('2 into 1 Y merge, 1.75 in into 2.5 in', 2, 4.445, 0.1651, 6.35, 10.0)]
for name, n, od, w, dout, L in MERGES:
    ax, st = (0.0, 0.0, 1.0), (0.0, 0.0, 0.0)
    slots = RT.collector_slots(st, ax, n, od, 0.0)
    col = RT.collector_body(st, ax, n, od, L, dout, None, 1.0)
    p = M.plan(st, ax, slots, od, w, col['d_in'], col['d_out'], L)
    gaps = sorted(math.sqrt(dot(sub(a, b), sub(a, b))) for i, a in enumerate(slots) for b in slots[i + 1:])
    idr = od / 2 - w
    ok(abs(gaps[0] - od) < 1e-9 and all(abs(r - idr) < 1e-12 for _, r in p['plate']['holes'])
       and abs(p['plate']['lig_between'] - 2 * w) < 1e-9 and abs(p['plate']['lig_rim'] - (w + M.SLEEVE_FIT_CM / 2)) < 1e-9,
       '%s: tubes touch on the ring, holes the bore %.2f mm, %.2f mm of plate between holes (two walls) and %.2f mm to the rim'
       % (name, 20 * idr, 10 * p['plate']['lig_between'], 10 * p['plate']['lig_rim']))
    ok(abs(p['area_out'] - math.pi * (dout / 2 - w) ** 2) < 1e-9, '%s: outlet open area %.0f mm^2 = pi (OD/2 - wall)^2' % (name, 100 * p['area_out']))
    files = M.cut_files(p, 'Collector')
    for f in files:
        hdr, ents = dxf_ents(f['text'])
        ok(hdr.get('$INSUNITS') == '4' and f['name'].endswith('_mm.dxf') and closed(ents), '%s: %s is mm and every outline is closed' % (name, f['name']))
    cf, ci = M.cone_flat(p)
    ra, rb = 10 * (p['Ri0'] + w / 2), 10 * (p['Ri1'] + w / 2)
    slant = math.hypot(10 * (L - p['plate_t']), ra - rb)
    th = math.radians(ci['angle_deg'])
    ok(abs(ci['R_mm'] * th - 2 * math.pi * max(ra, rb)) < 0.25 and abs(ci['r_mm'] * th - 2 * math.pi * min(ra, rb)) < 0.25
       and abs(ci['R_mm'] - ci['r_mm'] - slant) < 0.25,
       '%s: cone pattern %.1f / %.1f mm over %.1f deg closes round both rims at mid-wall, slant %.1f mm' % (name, ci['r_mm'], ci['R_mm'], ci['angle_deg'], slant))
    sf, si = M.sleeve_flat(p)
    ok(abs(si['w_mm'] - 2 * math.pi * ra) < 0.01 and abs(si['h_mm'] - 10 * (p['sleeve'] + p['plate_t'])) < 1e-9,
       '%s: sleeve %.1f x %.1f mm, the mid-wall circumference by sleeve + plate' % (name, si['w_mm'], si['h_mm']))
    sp = p['spike']
    if sp and sp['hollow']:
        kf, ki = M.spike_flat(p)
        al = math.atan(sp['r'] / sp['len'])
        rm = 10 * (sp['r'] - (w / 2) / math.cos(al))       # mid-wall radius at the plate
        ok(abs(ki['R_mm'] * math.radians(ki['angle_deg']) - 2 * math.pi * rm) < 0.25 and abs(ki['R_mm'] - rm / math.sin(al)) < 0.25,
           '%s: rolled spike pattern %.1f mm over %.1f deg closes round its base at mid-wall (%.1f mm across)' % (name, ki['R_mm'], ki['angle_deg'], 2 * rm))


# ---------------------------------------------------------------- 4. tack jig cradles
def walk(elems, s):
    for e in elems:
        L = RT.elem_len(e)
        if s <= L:
            if e[0] == 'line':
                return add(e[1], sub(e[2], e[1]), s / L)
            cen, a, u0, u1 = e[3], e[4], e[6], e[7]
            nrm = unit(cross(u0, u1))
            return add(cen, rot(u0, nrm, math.degrees(a * s / L)), e[5] / a)
        s -= L
    return elems[-1][2]


JIGS = [('level S with a 20 deg climb', [(0, 0, 0), (25, 0, 0), (40, 12, 5), (70, 12, 5)], 4.0, 4.445),
        ('steep run (passes over 60 deg) and a drop', [(0, 0, 10), (20, 0, 10), (24, 2, 30), (40, 20, 2)], 3.0, 5.08)]
for name, Q, R, od in JIGS:
    g = RT.chain_geometry(Q, R)
    pl = JG.plan([{'name': 'T', 'elems': g['elems'], 'od': od}])
    o = pl['opts']
    worst_top, worst_wrap, worst_st = 0.0, -1.0, 0.0
    for c in pl['cradles']:
        half = o['block_len'] / 2
        hs = [walk(g['elems'], c['s'] - half + o['block_len'] * k / 200.0)[2] for k in range(201)]
        p = walk(g['elems'], c['s'])
        worst_top = max(worst_top, abs(c['top'] - min(hs)))
        worst_wrap = max(worst_wrap, c['top'] - p[2])           # <= 0: the block's top is at or below the centreline here
        worst_st = max(worst_st, math.hypot(c['centre'][0] - p[0], c['centre'][1] - p[1]))
    ok(pl['cradles'] and all(abs(c['r'] - (od / 2 + o['clearance'])) < 1e-12 for c in pl['cradles']),
       '%s: %d cradles, every saddle radius the tube OD / 2 + %.2f mm clearance' % (name, len(pl['cradles']), 10 * o['clearance']))
    ok(worst_top < 0.003 and worst_wrap <= 1e-9 and worst_st < 1e-6,
       '%s: block tops at the lowest centreline point over the block (within %.3f mm), never above the centreline at the station '
       '(no saddle past half the tube), stations on the centreline (%.1e mm)' % (name, 10 * worst_top, 10 * worst_st))
    if pl['skipped']:
        ok(all('deg from level' in k['why'] or 'under it' in k['why'] for k in pl['skipped']), '%s: places left out say why: %s' % (
            name, '; '.join(k['why'] for k in pl['skipped'])))


# ---------------------------------------------------------------- 5. the tee note, both units
adsk = types.ModuleType('adsk')
core = types.ModuleType('adsk.core')
fusion = types.ModuleType('adsk.fusion')
adsk.core, adsk.fusion = core, fusion
for nm in ('HTMLEventHandler', 'CommandCreatedEventHandler', 'CommandEventHandler', 'ApplicationEventHandler'):
    setattr(core, nm, object)
saved = {k: sys.modules.get(k) for k in ('adsk', 'adsk.core', 'adsk.fusion')}
sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})
import cadtools as CT
c = TPL.tee_cope({'p': (0.0, 0.0, 0.0), 'd': (1.0, 0.0, 0.0), 'R': R0}, (0, 0, R0), (0, 0, 1), 1.905)
s = CT._tee_note('J-pipe', {'how': 'scan', 'name': 'main'}, c, length=30.0)
ok(('%.3f in (%.1f mm) below' % (c['depth'] / 2.54, 10 * c['depth'])) in s and ('%.3f in (%.1f mm) long' % ((30 + c['depth']) / 2.54, 10 * (30 + c['depth']))) in s,
   'the tee note gives the fishmouth depth and the cut length in inches and mm: ' + s[:160])
for k, v in saved.items():
    if v is None:
        sys.modules.pop(k, None)

print('test_fabaudit: %s' % ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
