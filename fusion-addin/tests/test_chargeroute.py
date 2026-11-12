"""Tests for chargeroute.py (charge pipe and turbo intake routing from a scan) on made-up scenes.

Clearance is checked independently of the router: the exact distance from points every 1 mm along the routed
centreline to every triangle of the scene, by a closest-point routine written here (Ericson, Real-Time Collision
Detection, 5.1.5), not the router's own. Losses are checked against arithmetic done by hand below.

ET_WRITE_FIXTURES=1 python3 test_chargeroute.py   writes web/tests/fixtures/chargeroute_parity.json (the loss formulas'
answers, which web/tests/chargeroute_ui.js checks the page's own bendK and visc against); without it the file is
compared with what this run computes."""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import router as RT
import chargeroute as CR

FIX = os.path.join(HERE, '..', '..', 'web', 'tests', 'fixtures', 'chargeroute_parity.json')
fails = []


def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


def box(lo, hi):
    """Closed box surface, two triangles per face."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    P = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    F = [(0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6), (0, 5, 1), (0, 4, 5), (3, 2, 6), (3, 6, 7), (0, 3, 7), (0, 7, 4),
         (1, 5, 6), (1, 6, 2)]
    coords = [c for p in P for c in p]
    idx = [i for f in F for i in f]
    return coords, idx


def scene_of(meshes, lo, hi, pad=10.0):
    sc = RT.Scene(cell=1.0, sample_len=0.4)
    for m in meshes:
        sc.add_mesh(*m)
    sc.build(lo, hi, pad)
    return sc


# ---- an independent exact point-to-triangle distance (Ericson 5.1.5, closest point on a triangle) ----
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def closest_on_tri(p, a, b, c):
    ab, ac, ap = _sub(b, a), _sub(c, a), _sub(p, a)
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        return a
    bp = _sub(p, b)
    d3, d4 = _dot(ab, bp), _dot(ac, bp)
    if d3 >= 0 and d4 <= d3:
        return b
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        return (a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2])
    cp = _sub(p, c)
    d5, d6 = _dot(ab, cp), _dot(ac, cp)
    if d6 >= 0 and d5 <= d6:
        return c
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        return (a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2])
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return (b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]))
    den = 1.0 / (va + vb + vc)
    v, w = vb * den, vc * den
    return (a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w)


def tris_of(meshes):
    out = []
    for coords, idx in meshes:
        for t in range(len(idx) // 3):
            out.append(tuple(tuple(coords[3 * idx[3 * t + k]:3 * idx[3 * t + k] + 3]) for k in range(3)))
    return out


def brute_gap(pts, meshes):
    """Smallest exact distance from any of pts to any triangle, and the point it is at."""
    T = tris_of(meshes)
    best, at = 1e18, None
    for p in pts:
        for a, b, c in T:
            q = closest_on_tri(p, a, b, c)
            d = math.sqrt(_dot(_sub(p, q), _sub(p, q)))
            if d < best:
                best, at = d, p
    return best, at


def centreline(elems, step=0.1):
    total = sum(RT.elem_len(e) for e in elems)
    n = int(math.ceil(total / step))
    return [p for _s, p in RT.sample_path(elems, total, n)]


def check_built(c, leg, opts, label):
    """What every feasible candidate must hold: stocked radii and angles only, straights at least the minimum, the cut
    list adding up to the centreline length."""
    radii = [st['clr_mm'] for st in leg['stock']]
    angs = {st['clr_mm']: max(st['angles']) for st in leg['stock']}
    rows = c['lra']
    bad_r = [r['CLR_mm'] for r in rows if r['A_deg'] is not None and min(abs(r['CLR_mm'] - x) for x in radii) > 1e-6]
    check(not bad_r, '%s: every bend on a stocked radius (%s mm): %s' % (label, radii, [round(r['CLR_mm'], 3) for r in rows if r['A_deg']]))
    over = [r['A_deg'] for r in rows if r['A_deg'] is not None and r['A_deg'] > angs[min(radii, key=lambda x: abs(x - r['CLR_mm']))] + 0.5]
    check(not over, '%s: no bend larger than the largest stocked angle at its radius (bends %s deg)' % (
        label, [round(r['A_deg'], 1) for r in rows if r['A_deg']]))
    check(all(p['from_deg'] is not None for p in c['cut'] if p['kind'] == 'bend'), '%s: each bend cut from a stocked bend' % label)
    lead_mm, ms_mm = opts['lead'] * 10, opts['min_straight'] * 10
    ends_ok = rows[0]['L_mm'] >= lead_mm - 0.2 and rows[-1]['L_mm'] >= lead_mm - 0.2
    mids = [r['L_mm'] for r in rows[1:-1]]
    check(ends_ok and all(L >= ms_mm - 0.2 for L in mids),
          '%s: end straights >= %.1f mm (half a coupler) and straights between bends >= %.1f mm: ends %.1f, %.1f, between %s' % (
              label, lead_mm, ms_mm, rows[0]['L_mm'], rows[-1]['L_mm'], [round(L, 1) for L in mids]))
    tot = sum(p['L_mm'] for p in c['cut'])
    check(abs(tot - c['length_mm']) < 1e-6, '%s: cut list adds up to the centreline length (%.4f = %.4f mm)' % (label, tot, c['length_mm']))


def main():
    t0 = time.time()
    # ------------------------------------------------------------------------------------------------------------
    # 1. Ranking by hand. One pipe, inside diameter D = 50.8 mm, design flow 0.25 kg/s at 100 C and 200 kPa absolute.
    #    rho = p / (R T) = 200000 / (287.05 x 373.15)                    = 1.86719 kg/m3
    #    mu  = 1.716e-5 (373.15/273.15)^1.5 (273.15+110.4)/(373.15+110.4) = 2.17331e-5 Pa s (Sutherland)
    #    A   = pi 0.0508^2 / 4 = 2.02683e-3 m2;  v = m / (rho A) = 66.0593 m/s;  q = rho v^2 / 2 = 4074.05 Pa
    #    Re  = rho v D / mu = 288314;  Haaland: 1/sqrt(f) = -1.8 log10((1.5e-6/0.0508/3.7)^1.11 + 6.9/Re) = 8.24926,
    #          f = 0.0146950
    #    Bend K = Crane multiple x f x Idelchik A1:
    #      90 deg on 76.2 mm (r/D 1.5): 14 x 0.014695 x 1      = 0.205730
    #      90 deg on 50.8 mm (r/D 1.0): 20 x 0.014695 x 1      = 0.293900
    #      45 deg on 101.6 mm (r/D 2.0): 12 x 0.014695 x 0.9 sin 45 (0.636396) = 0.112222
    #    Friction over the straights only (length less each arc, theta x CLR):
    #    A: 1000 mm, two 90s on 76.2: arcs 2 x pi/2 x 76.2 = 239.389; Ls 760.611
    #       dp = 0.014695 x 760.611/50.8 x 4074.05 + 2 x 0.205730 x 4074.05 = 896.39 + 1676.31 = 2572.70 Pa
    #    B: 900 mm, three 90s on 50.8: arcs 3 x pi/2 x 50.8 = 239.389; Ls 660.611
    #       dp = 778.54 + 3 x 0.293900 x 4074.05 = 778.54 + 3592.09 = 4370.63 Pa
    #    C: 1100 mm, two 45s on 101.6: arcs 2 x pi/4 x 101.6 = 159.593; Ls 940.407
    #       dp = 1108.28 + 2 x 0.112222 x 4074.05 = 1108.28 + 914.40 = 2022.68 Pa
    #    So C (the longest, with the most volume) ranks first, then A, then B (the shortest).
    flow = {'m_kg_s': 0.25, 'T_C': 100.0, 'p_Pa': 200000.0}
    hand = {'A': (1000.0, [(90.0, 76.2)] * 2, 2572.70), 'B': (900.0, [(90.0, 50.8)] * 3, 4370.63),
            'C': (1100.0, [(45.0, 101.6)] * 2, 2022.68)}
    cands = []
    for k, (L, b, dp_hand) in hand.items():
        r = CR.leg_loss(L, b, 50.8, flow)
        check(abs(r['dp_Pa'] - dp_hand) < 0.01, 'loss of %s by hand %.2f Pa, computed %.4f Pa' % (k, dp_hand, r['dp_Pa']))
        cands.append(dict(r, name=k, ok=True, n_bends=len(b), min_gap_mm=15.0))
    order = [c['name'] for c in CR.rank(cands)]
    check(order == ['C', 'A', 'B'], 'ranked by loss: %s (by hand C 2022.68 < A 2572.70 < B 4370.63 Pa)' % order)
    # a tie on loss (to the pascal) goes to the smaller volume, then fewer bends, then more clearance
    tie = [dict(cands[0], name='big', volume_L=2.5), dict(cands[0], name='small', volume_L=2.0)]
    check([c['name'] for c in CR.rank(tie)] == ['small', 'big'], 'equal loss: the smaller volume first')
    tie = [dict(cands[0], name='near', min_gap_mm=13.0), dict(cands[0], name='far', min_gap_mm=20.0)]
    check([c['name'] for c in CR.rank(tie)] == ['far', 'near'], 'equal loss, volume and bends: the larger clearance first')

    # ---- parity fixture: the page's bendK and visc must give these (web/tests/chargeroute_ui.js)
    par = {'bend_k': [], 'visc': [], 'leg_loss': []}
    for deg in (0, 30, 45, 69, 70, 80, 90, 95, 100, 135, 180):
        for rd in (0.8, 1.0, 1.25, 1.5, 2.5, 3.0, 5.0, 12.0):
            par['bend_k'].append([deg, rd, 0.0147, CR.bend_k(deg, rd, 0.0147)])
    for t in (-20.0, 25.0, 100.0, 180.0):
        par['visc'].append([t, CR.visc(t)])
    for k, (L, b, _d) in hand.items():
        r = CR.leg_loss(L, b, 50.8, dict(flow, rho_amb=1.18))
        par['leg_loss'].append({'name': k, 'length_mm': L, 'bends': b, 'id_mm': 50.8, 'flow': dict(flow, rho_amb=1.18),
                                'dp_Pa': r['dp_Pa'], 'volume_L': r['volume_L'], 'fill_s': r['fill_s']})
    if os.environ.get('ET_WRITE_FIXTURES'):
        with open(FIX, 'w') as fh:
            json.dump(par, fh, indent=1)
        print('wrote', FIX)
    else:
        try:
            old = json.load(open(FIX))
            same = all(abs(a[-1] - b[-1]) <= 1e-12 * max(1.0, abs(a[-1])) for a, b in zip(old['bend_k'], par['bend_k'])) and \
                len(old['bend_k']) == len(par['bend_k']) and \
                all(abs(a['dp_Pa'] - b['dp_Pa']) < 1e-9 for a, b in zip(old['leg_loss'], par['leg_loss']))
        except (IOError, ValueError, KeyError):
            same = False
        check(same, 'the parity fixture matches these formulas (ET_WRITE_FIXTURES=1 to rewrite it)')

    # ------------------------------------------------------------------------------------------------------------
    # 2. A wall with one window. The ends face each other through a 4 cm thick wall at x 28..32 that is closed except
    #    a 12 x 12 cm window centred 15 cm up (y -6..6, z 9..21). The tube (2.13 in OD, 50.8 mm inside) must keep
    #    R + gap = 2.705 + 1.27 = 3.975 cm from the window's edges, so at x = 30 the centreline has to be inside
    #    y -2.025..2.025, z 12.975..17.025. Around the wall's sides (y +-25) or under it (z -20) is at least 77 cm
    #    against about 67 cm through the window (2 x sqrt(30^2 + 15^2)), so by hand the best way is the window.
    walls = [box((28, -25, -20), (32, 25, 9)), box((28, -25, 21), (32, 25, 40)), box((28, -25, 9), (32, -6, 21)),
             box((28, 6, 9), (32, 25, 21))]
    sc = scene_of(walls, (-5, -30, -25), (65, 30, 45))
    stock = [{'clr_mm': 50.8, 'angles': [45, 90, 180]}, {'clr_mm': 76.2, 'angles': [45, 90]}, {'clr_mm': 101.6, 'angles': [90]},
             {'clr_mm': 25.4, 'angles': [90]}]             # under 1 D: never tried
    leg = {'kind': 'hot', 'name': 'Compressor outlet to intercooler inlet', 'start': (0, 0, 0), 'start_dir': (1, 0, 0),
           'end': (60, 0, 0), 'end_dir': (1, 0, 0), 'od': 5.4102, 'wall': 0.1651, 'gap': 1.27, 'stock': stock,
           'flow': dict(flow, rho_amb=1.18)}
    opts = {'lead': 3.81, 'min_straight': 2.54, 'time_s': 20, 'max_radii': 3, 'coupler_mm': 76.2}
    res = CR.plan(sc, None, [leg], opts)
    L = res['legs'][0]
    cs = [c for c in L['candidates'] if c['ok']]
    check(L['ok'] and len(cs) >= 3, 'window: %d feasible routes of %d tried (%s)' % (len(cs), len(L['candidates']), L['msg']))
    check(all(abs(c['clr_mm'] - 25.4) > 1e-6 for c in L['candidates']), 'window: the 25.4 mm radius (under 1 D) is not tried')
    dps = [c['dp_Pa'] for c in cs]
    check(dps == sorted(dps) and cs[0]['rank'] == 1, 'window: listed lowest loss first: %s Pa' % [round(x, 1) for x in dps])
    for c in cs:
        lab = 'window, ' + c['label']
        pts = centreline(c['_elems'], 0.1)
        g, at = brute_gap(pts, walls)
        R = leg['od'] / 2.0
        # every sample at least R + gap from every triangle (the router's own proof allows 0.1 mm under: CERT_TOL)
        check(g - R >= c['gap_mm'] / 10.0 - 0.011, '%s: independent clearance %.2f mm >= %.1f mm (every 1 mm, every triangle)' % (
            lab, (g - R) * 10, c['gap_mm']))
        check(abs((g - R) * 10 - c['min_gap_mm']) < 0.6, '%s: reported smallest clearance %.2f mm agrees (%.2f mm)' % (
            lab, c['min_gap_mm'], (g - R) * 10))
        mid = min(pts, key=lambda p: abs(p[0] - 30.0))
        check(abs(mid[1]) <= 2.025 + 0.01 and 12.975 - 0.01 <= mid[2] <= 17.025 + 0.01,
              '%s: passes through the window (at x 30: y %.2f, z %.2f cm)' % (lab, mid[1], mid[2]))
        check_built(c, leg, opts, lab)
        # the loss again from the returned lengths and bends, by the formula written out in 1.
        D = 0.0508
        rho = 200000.0 / (287.05 * 373.15)
        v = 0.25 / (rho * math.pi * D * D / 4)
        q = rho * v * v / 2
        f = 0.014695018692888119          # Re is the same for every route here (same tube, same flow): 1.
        mult = lambda rd: 20 + (14 - 20) * (rd - 1) / 0.5 if rd <= 1.5 else (14 + (12 - 14) * (rd - 1.5) / 0.5 if rd <= 2 else 12.0)
        a1 = lambda a: 0.9 * math.sin(math.radians(a)) if a <= 70 else (
            0.9 * math.sin(math.radians(70)) + (1 - 0.9 * math.sin(math.radians(70))) * (a - 70) / 20 if a <= 90 else None)
        if all(b['angle_deg'] <= 90 for b in c['bends']):
            arcs = sum(math.radians(b['angle_deg']) * b['clr_mm'] for b in c['bends'])
            dp = f * (c['length_mm'] - arcs) / 50.8 * q + sum(mult(b['clr_mm'] / 50.8) * f * a1(b['angle_deg']) for b in c['bends']) * q
            check(abs(dp - c['dp_Pa']) < 0.05, '%s: loss %.2f Pa from its own %.1f mm and bends %s by the hand formula %.2f Pa' % (
                lab, c['dp_Pa'], c['length_mm'], [round(b['angle_deg'], 1) for b in c['bends']], dp))
    # couplers: one at each end, and (welded build) an optional joint only in a straight at least a coupler long
    c0 = cs[0]
    ends = [k for k in c0['couplers'] if k['at'] in ('start', 'end')]
    check(len(ends) == 2 and abs(ends[1]['s_mm'] - c0['length_mm']) < 1e-6 and max(abs(v) for v in ends[0]['p_mm']) < 1e-6,
          'couplers at the start (0 mm) and the end (%.1f mm along)' % c0['length_mm'])
    opt = [k for k in c0['couplers'] if k['at'] == 'optional joint']
    longest = max([r['L_mm'] for r in c0['lra'][1:-1]] or [0])
    check((not opt and longest < 76.2) or (opt and longest >= 76.2), 'optional joint only where a straight between bends is a coupler long (longest %.1f mm)' % longest)
    pub = CR.public(res)
    check('_elems' not in json.dumps(pub) and json.loads(json.dumps(pub)), 'the page\'s copy is plain JSON without the build elements')
    print('window scene: %.1f s' % (time.time() - t0))

    # ------------------------------------------------------------------------------------------------------------
    # 3. Hot keep-out. A straight shot from (0,0,0) to (50,0,0), a box beside it at y 5..15 (x 15..35, z -10..10).
    #    As an ordinary keep-out it is 5 - 2.705 = 2.295 cm from the tube's outside, over the 1.27 cm asked, so by hand
    #    the best route is the straight: 500 mm, no bends, loss f (L/D) q = 0.014695 x 500/50.8 x 4074.05 = 589.25 Pa
    #    (the flow of 1.). Marked hot with 5.08 cm, the tube has to stay 2.705 + 5.08 = 7.785 cm from it.
    t1 = time.time()
    hotbox = box((15, 5, -10), (35, 15, 10))
    floor = box((-5, -30, -40), (55, 30, -36))
    leg2 = dict(leg, kind='cold', name='Intercooler outlet to throttle body', end=(50, 0, 0), stock=stock[:2])
    o2 = dict(opts, max_radii=1, roomy=False)
    cold_all = scene_of([hotbox, floor], (-5, -30, -40), (55, 30, 15))
    r1 = CR.plan(cold_all, None, [leg2], o2)['legs'][0]
    c1 = r1['candidates'][0]
    check(r1['ok'] and c1['n_bends'] == 0 and abs(c1['length_mm'] - 500.0) < 1e-6,
          'hot box as an ordinary keep-out: the straight shot, %s bends, %.3f mm' % (c1.get('n_bends'), c1.get('length_mm', 0)))
    check(abs(c1['dp_Pa'] - 589.25) < 0.01, 'straight: loss %.3f Pa = 589.25 by hand' % c1['dp_Pa'])
    cold_only = scene_of([floor], (-5, -30, -40), (55, 30, 15))
    hot_only = scene_of([hotbox], (-5, -30, -40), (55, 30, 15))
    r2 = CR.plan(cold_only, hot_only, [leg2], dict(o2, hot_gap=5.08))['legs'][0]
    c2 = next((c for c in r2['candidates'] if c['ok']), None)
    check(c2 is not None, 'hot box marked hot (50.8 mm): a route fits (%s)' % r2['msg'])
    if c2:
        pts = centreline(c2['_elems'], 0.1)
        g, _at = brute_gap(pts, [hotbox])
        gf, _ = brute_gap(pts, [floor])
        R = leg2['od'] / 2.0
        check(g - R >= 5.08 - 0.011 and c2['n_bends'] >= 2,
              'hot clearance applies: %.2f mm from the hot box (>= 50.8), %d bends to get round it' % ((g - R) * 10, c2['n_bends']))
        check(gf - R >= 1.27 - 0.011, 'and the ordinary clearance to the rest: %.1f mm from the floor' % ((gf - R) * 10))
        check(c2['hot_gap_mm'] is not None and c2['hot_gap_mm'] >= 50.8 - 0.6 and abs(c2['hot_gap_mm'] - (g - R) * 10) < 0.6,
              'reported hot clearance %.2f mm (independent %.2f)' % (c2['hot_gap_mm'] or -1, (g - R) * 10))
        check(c2['dp_Pa'] > c1['dp_Pa'], 'the detour costs loss: %.1f Pa against %.1f straight' % (c2['dp_Pa'], c1['dp_Pa']))
        check_built(c2, leg2, o2, 'hot detour')
    print('hot scene: %.1f s' % (time.time() - t1))

    # ------------------------------------------------------------------------------------------------------------
    # 4. No fit: the start marker sits in a closed box 6 cm across, less than the tube's 2 x 3.975 cm needs.
    t2 = time.time()
    cage = box((-2, -3, -3), (8, 3, 3))
    sc4 = scene_of([cage], (-5, -10, -10), (45, 10, 10))
    leg4 = dict(leg2, end=(40, 0, 0), name='Intercooler outlet to throttle body')
    r4 = CR.plan(sc4, None, [leg4], dict(o2, time_s=8))
    L4 = r4['legs'][0]
    m = L4['msg']
    check(not r4['ok'] and not L4['ok'] and L4['best'] is None, 'no fit: the plan says so')
    check('Intercooler outlet to throttle body' in m and '12.7 mm' in m and 'Lower the clearance' in m and 'markers' in m,
          'no fit: the message names the leg, the clearance and what to change: ' + m)
    print('no-fit scene: %.1f s' % (time.time() - t2))

    # ---- the stock radii picked: nearest 1.5 D first, never under 1 D or the tube radius
    rr = CR.stock_radii(stock, 5.4102, 5.08, 3)
    check([round(r[0] * 10, 1) for r in rr] == [76.2, 101.6, 50.8], 'radii tried nearest 1.5 D first: %s mm' % [round(r[0] * 10, 1) for r in rr])
    print('FAILS:', fails, '(%.1f s)' % (time.time() - t0))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
