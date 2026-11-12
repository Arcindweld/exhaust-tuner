"""Charge pipe and turbo intake routing from a scan: the router (router.py) run once per stocked bend radius for each
leg, the routes that clear the scan ranked by an estimated pressure loss at the design flow, and for the one chosen a
cut list from off-the-shelf mandrel bends, the coupler positions and the smallest clearance and where it is.

Pure Python (no numpy, no Fusion), so the tests run it on made-up scenes. Lengths are centimetres inside (the
router's unit, Fusion's internal unit) and millimetres in everything handed back to the page.

Legs (any subset, each its own start and end marker, tube, clearance and design flow)
  inlet   filter (or MAF) to the compressor inlet
  hot     compressor outlet to the intercooler inlet
  cold    intercooler outlet to the throttle body

Bend radii and angles: only what is stocked. The page sends, for each leg, the centre-line radii its parts list holds
for that tube OD (and material), each with the stocked bend angles (45, 90, 180). The router lays the leg out once per
radius (the radii nearest 1.5 D first, at most opts['max_radii']), with no bend larger than the largest stocked angle at
that radius; each bend is then cut from the smallest stocked bend that covers it. The parts list carries the supplier
pages (src) for every bend; two were read again for this module on 2026-11-11:
  https://hpsperformanceproducts.com/products/hps-3-inch-90-degree-bend-6061-aluminum-elbow-pipe-tubing-16-gauge-mandrel-bent-tube
    "Center Line Radius Options: 3" or 4-3/4"", "Wall Thickness: 16 Gauge, 0.065" (1.65mm)", "Leg length on each
    side: 6"", part AT90-300-CLR-3 (3 in OD 6061 aluminium, 90 deg)
  https://www.stainlessheaders.com/300x90-degree-aluminum-bend
    "3" x 90 Degree, 3" CLR", "16ga 6061 Aluminum mandrel bends", SKU SHM-300-090-6061
When the parts list has no bend for the tube OD the page sends the radius the user typed (default 1.5 x the inside
diameter, the minimum the Intake tab quotes from Garrett) and says that it is not a stocked radius.

"Ideal" (rank_key): among the routes that the router proves clear of the scan (router.certify against the exact
triangles, with the larger clearance to bodies marked hot), lowest estimated pressure loss at the design flow first
(to the nearest pascal), then the smaller air volume (fill time), then fewer bends, then the larger smallest clearance.
The loss is a 1-D estimate: straight-tube friction over the straights plus Crane's bend K for each bend, the formulas
of the page's Intake tab (bendK, fSmooth, visc), ported below with their sources. It is a recommendation, not a
measured or CFD loss.
"""
import math

try:
    from . import router as RT
except ImportError:
    import router as RT

LEGS = (('inlet', 'Filter to compressor inlet'), ('hot', 'Compressor outlet to intercooler inlet'),
        ('cold', 'Intercooler outlet to throttle body'))
LEG_NAME = dict(LEGS)

# ---------------------------------------------------------------------------------------------------------------
# The Intake tab's loss formulas (web/index.html), ported. Parity is tested: web/tests/chargeroute_ui.js runs the
# page's own bendK / visc on the numbers in web/tests/fixtures/chargeroute_parity.json, which
# tests/test_chargeroute.py writes from these functions.
# ---------------------------------------------------------------------------------------------------------------
R_AIR = 287.05            # J/(kg K), the page's R_AIR
KS_TUBE = 1.5e-6          # m: drawn tubing 0.0015 mm (Moody 1944, Crane TP-410 A-23), the page's calcCharge fTube
# Crane TP-410's 90 deg bend as a multiple of the fully turbulent friction factor against r/D (the page's CRANE_BEND)
CRANE_BEND = ((1.0, 20.0), (1.5, 14.0), (2.0, 12.0), (3.0, 12.0), (4.0, 14.0), (6.0, 17.0), (8.0, 24.0), (10.0, 30.0))


def visc(t_c):
    """Air viscosity, Pa s: Sutherland's law (the page's visc)."""
    T = t_c + 273.15
    return 1.716e-5 * math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4)


def rho_gas(t_c, p_pa):
    return p_pa / (R_AIR * (t_c + 273.15))


def f_tube(Re, D):
    """Darcy friction factor: 64/Re laminar, Haaland above (the page's fTube in calcCharge, roughness KS_TUBE)."""
    if Re < 2300:
        return 64.0 / Re
    return 1.0 / math.pow(-1.8 * math.log10(math.pow(KS_TUBE / D / 3.7, 1.11) + 6.9 / Re), 2)


def bend_k(deg, rd, f):
    """The page's bendK: Crane TP-410's 90 deg multiple of f against r/D (linear between the table's points, held at
    its ends; times (1/rd)^2 under 1 D), times Idelchik's angle factor A1 (0.9 sin(theta) to 70 deg, 1 at 90 deg,
    0.7 + 0.35 theta/90 from 100 deg, linear between). Includes the friction along the bend's own arc."""
    T = CRANE_BEND
    x = min(max(rd, T[0][0]), T[-1][0])
    m = T[-1][1]
    for i in range(1, len(T)):
        if x <= T[i][0]:
            m = T[i - 1][1] + (T[i][1] - T[i - 1][1]) * (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0])
            break
    if rd < 1:
        m *= math.pow(1.0 / rd, 2)
    a = max(0.0, deg)
    if a <= 70:
        A1 = 0.9 * math.sin(a * math.pi / 180)
    elif a >= 100:
        A1 = 0.7 + 0.35 * a / 90
    else:
        a70 = 0.9 * math.sin(70 * math.pi / 180)
        a100 = 0.7 + 0.35 * 100 / 90
        A1 = a70 + (1 - a70) * (a - 70) / 20 if a <= 90 else 1 + (a100 - 1) * (a - 90) / 10
    return m * f * A1


def leg_loss(length_mm, bends, id_mm, flow):
    """Estimated pressure loss of one pipe, Pa: f (Ls / D) q + sum(K_bend) q, Ls the length less every bend's arc (Crane's
    K holds the arc's own friction, as the page's calcIntake and calcCharge do). bends: [(angle deg, CLR mm)];
    flow: m_kg_s (mass flow in this pipe), T_C, p_Pa (absolute). Also the air volume and, with rho_amb, the fill
    time the page's calcCharge reports (extra mass held above outside density over the mass flow)."""
    D = id_mm / 1000.0
    A = math.pi * D * D / 4.0
    rho = rho_gas(flow['T_C'], flow['p_Pa'])
    v = flow['m_kg_s'] / (rho * A)
    q = rho * v * v / 2.0
    Re = rho * v * D / visc(flow['T_C'])
    f = f_tube(Re, D)
    arcs = sum(a * math.pi / 180.0 * c for a, c in bends)
    Ls = max(0.0, length_mm - arcs)
    ks = [bend_k(a, c / id_mm, f) for a, c in bends]
    dpF = f * (Ls / id_mm) * q
    dpB = sum(ks) * q
    V = A * length_mm / 1000.0                     # m3
    out = {'dp_Pa': dpF + dpB, 'dp_friction_Pa': dpF, 'dp_bends_Pa': dpB, 'k_bends': ks, 'f': f, 'Re': Re, 'v_m_s': v,
           'q_Pa': q, 'rho': rho, 'straight_mm': Ls, 'volume_L': V * 1000.0}
    if flow.get('rho_amb'):
        out['fill_s'] = max(0.0, V * (rho - flow['rho_amb'])) / flow['m_kg_s']
    return out


def rank_key(c):
    """Lowest loss (to the nearest pascal), then least volume, then fewest bends, then the most clearance."""
    return (round(c['dp_Pa']), round(c['volume_L'], 4), c['n_bends'], -round(c.get('min_gap_mm') or 0.0, 1))


def rank(cands):
    """Feasible candidates in rank order (each gets 'rank' 1, 2, ...), then the ones that do not fit."""
    good = sorted([c for c in cands if c.get('ok')], key=rank_key)
    for i, c in enumerate(good):
        c['rank'] = i + 1
    bad = [c for c in cands if not c.get('ok')]
    for c in bad:
        c['rank'] = None
    return good + bad


# ---------------------------------------------------------------------------------------------------------------
# Hot keep-outs: the scan and the hot bodies together, the hot ones kept a larger distance from
# ---------------------------------------------------------------------------------------------------------------
class UnionScene(object):
    """Two router Scenes seen as one by router.route(): the ordinary keep-outs, and the hot ones (exhaust manifold,
    turbine housing) whose distance counts extra (cm) less, so a tube keeps gap + extra from them and gap from the
    rest. Each distance is the smaller of the two; both are 1-Lipschitz, so router.certify's proof holds. It has no
    Rust copy of its own (_n None), so route() runs its search and fit in Python; each scene's distance queries still
    use the Rust core when it is loaded."""

    _n = None

    def __init__(self, cold, hot, extra):
        self.cold = cold if (cold is not None and cold.built) else None
        self.hot = hot
        self.extra = max(0.0, float(extra))
        self.built = True
        parts = [s for s in (self.cold, self.hot) if s is not None]
        self.e_cover = max(s.e_cover for s in parts)
        self.tol = max(s.tol for s in parts)
        self.ntri = sum(s.ntri for s in parts)
        self.npoints = sum(s.npoints for s in parts)

    def dist_fast(self, p, cap, planes=None):
        X = self.extra
        b = self.hot.dist_fast(p, cap + X, planes) - X
        if self.cold is None:
            return b
        return min(self.cold.dist_fast(p, cap, planes), b)

    def dist_exact(self, p, cap, planes=None):
        X = self.extra
        b = self.hot.dist_exact(p, cap + X, planes) - X
        if self.cold is None:
            return b
        return min(self.cold.dist_exact(p, cap, planes), b)

    def any_within(self, p, r, planes=None):
        if self.cold is not None and self.cold.any_within(p, r, planes):
            return True
        return self.hot.any_within(p, r + self.extra, planes)

    def min_dist(self, pts, cap, planes=None, exact=False):
        f = self.dist_exact if exact else self.dist_fast
        return min(f(p, cap, planes) for p in pts)

    def nearest(self, pts, cap, planes=None):
        best, at = cap, None
        for i, p in enumerate(pts):
            if self.dist_fast(p, cap, planes) - self.e_cover >= best:
                continue
            g = self.dist_exact(p, cap, planes)
            if g < best:
                best, at = g, i
        return best, at


# ---------------------------------------------------------------------------------------------------------------
# Stock radii, cut list, couplers, clearance report
# ---------------------------------------------------------------------------------------------------------------
def stock_radii(stock, od_cm, id_cm, n):
    """The stocked radii to try for one leg: [(clr_cm, [angles], note)], those the router can bend (more than the tube
    radius plus 0.1 mm, as cadtools' check) and at least 1 D of the inside diameter, nearest 1.5 D first (the page's
    Garrett minimum), at most n."""
    out = []
    for st in stock or []:
        c = float(st['clr_mm']) / 10.0
        angs = sorted(set(float(a) for a in (st.get('angles') or [90.0]) if float(a) > 0))
        if c < od_cm / 2.0 + 0.01 or c < id_cm - 1e-6 or not angs:
            continue
        if any(abs(c - o[0]) < 1e-6 for o in out):
            continue
        out.append((c, angs, st.get('note') or ''))
    out.sort(key=lambda t: (round(abs(t[0] / id_cm - 1.5), 9), -t[0]))      # a tie: the larger radius (less loss)
    return out[:max(1, int(n))]


def _stock_for(angle, angs):
    """The smallest stocked bend angle that covers this bend (the router allows 0.5 deg over its limit)."""
    for a in angs:
        if a >= angle - 0.5:
            return a
    return None


def cut_list(lra, angs, couplers_mid=False):
    """Pieces in build order from the router's bend schedule (router.lra_schedule rows: straight before the bend L,
    rotation R from the previous bend plane, angle A, CLR; cm). Each straight is cut from straight tube, each bend from
    the smallest stocked bend that covers it (the rest cut off). With couplers_mid each straight between two bends is
    two pieces with a coupler between them. Lengths mm."""
    pieces = []
    nrow = len(lra)
    for i, r in enumerate(lra):
        L = r['L'] * 10.0
        if L > 1e-6:
            if couplers_mid and 0 < i < nrow - 1:
                pieces.append({'kind': 'straight', 'L_mm': L / 2.0, 'note': 'to the coupler'})
                pieces.append({'kind': 'straight', 'L_mm': L / 2.0, 'note': 'from the coupler'})
            else:
                pieces.append({'kind': 'straight', 'L_mm': L})
        if r['A'] is not None:
            clr = r['CLR'] * 10.0
            pieces.append({'kind': 'bend', 'A_deg': r['A'], 'CLR_mm': clr, 'rot_deg': r['R'],
                           'L_mm': clr * math.radians(r['A']), 'from_deg': _stock_for(r['A'], angs)})
    return pieces


def couplers(elems, lra, coupler_mm, mid=False):
    """Where the couplers go, as distance along the centreline from the leg's start (mm) and the point (mm): one at
    each end (to the compressor, intercooler or throttle), and with mid one in the middle of every straight between
    bends; otherwise, as a suggestion, the middle of the longest straight between bends if it is at least one coupler
    long (a joint there lets the pipe come out in two pieces)."""
    total = sum(RT.elem_len(e) for e in elems)
    out = [{'s_mm': 0.0, 'at': 'start'}, {'s_mm': total * 10.0, 'at': 'end'}]
    s = 0.0
    mids = []
    for i, r in enumerate(lra):
        if 0 < i < len(lra) - 1:
            mids.append((r['L'], s + r['L'] / 2.0))
        s += r['L']
        if r['A'] is not None:
            s += r['CLR'] * math.radians(r['A'])
    if mid:
        out[1:1] = [{'s_mm': m * 10.0, 'at': 'between bends'} for L, m in mids if L > 0]
    else:
        big = [t for t in mids if t[0] * 10.0 >= coupler_mm]
        if big:
            L, m = max(big)
            out.insert(1, {'s_mm': m * 10.0, 'at': 'optional joint', 'note': 'longest straight between bends'})
    for c in out:
        p = _point_at(elems, c['s_mm'] / 10.0)
        c['p_mm'] = [round(v * 10.0, 2) for v in p]
    return out


def _point_at(elems, s):
    cum = 0.0
    for e in elems:
        L = RT.elem_len(e)
        if cum + L >= s - 1e-9:
            return RT.elem_point(e, 0.0 if L <= 0 else min(1.0, max(0.0, (s - cum) / L)))
        cum += L
    return elems[-1][2]


def clearance_report(scene, s, elems, step=0.1):
    """The smallest gap from the tube's outside to a scene, mm, and where (mm), sampled every step cm along the
    centreline with exact triangle distances (scene.nearest), the surfaces behind each end's mounting face left out
    near that end as the router does. Between two samples the gap can be at most step/2 smaller (1-Lipschitz), so the
    figure is good to step/2 (0.5 mm at the default). None when nothing is within 10 cm of the clearance asked."""
    if scene is None or not elems:
        return None, None
    C = RT._Clearance(None, s, None, None)
    total = sum(RT.elem_len(e) for e in elems)
    n = max(2, int(math.ceil(total / step)))
    zones = {'s': [], 'm': [], 'e': []}
    for k, (sp, p) in enumerate(RT.sample_path(elems, total, n)):
        zones[C.zone(sp, total)].append(p)
    cap = C.req + 10.0
    best, at = cap, None
    for z, pts in zones.items():
        if not pts:
            continue
        d, i = scene.nearest(pts, cap, C.planes(z))
        if i is not None and d < best:
            best, at = d, pts[i]
    if at is None:
        return None, None
    return (best - s['R']) * 10.0, [round(v * 10.0, 1) for v in at]


# ---------------------------------------------------------------------------------------------------------------
# One leg, all legs
# ---------------------------------------------------------------------------------------------------------------
def _mm(v):
    return None if v is None else v * 10.0


def plan_leg(cold, hot, leg, opts, tubes=None, log=None):
    """Route one leg once per stocked radius (and once more with twice the clearance at the best radius, opts['roomy']),
    and rank the routes. leg (cm): kind, name, start, start_dir, end, end_dir, od, wall, gap, stock, flow.
    Returns {kind, name, candidates (ranked), best (index or None), msg, ok}."""
    od, wall = float(leg['od']), float(leg['wall'])
    idc = od - 2.0 * wall
    gap = float(leg['gap'])
    hot_gap = max(gap, float(opts.get('hot_gap') or gap))
    scene = cold
    if hot is not None:
        scene = UnionScene(cold, hot, hot_gap - gap)
    radii = stock_radii(leg.get('stock'), od, idc, opts.get('max_radii', 3))
    name = leg.get('name') or LEG_NAME.get(leg['kind'], leg['kind'])
    if not radii:
        return {'kind': leg['kind'], 'name': name, 'candidates': [], 'best': None, 'ok': False,
                'msg': '%s: no bend radius to use. The stocked radii for this tube are all under 1 D or the tube '
                       'radius; enter a bend radius.' % name}
    lead = float(opts.get('lead') or 2.54)
    base = {'start': leg['start'], 'start_dir': leg['start_dir'], 'end': leg['end'], 'end_dir': leg['end_dir'],
            'od': od, 'gap': gap, 'gap_tt': float(opts.get('gap_tt') or 0.32), 'lead_start': lead, 'lead_end': lead,
            'min_straight': float(opts.get('min_straight') or 0.0), 'time_budget': float(opts.get('time_s') or 30.0),
            'seed_min_straight': 0.0}       # see router._route's repair
    runs = [(c, angs, note, gap, '') for c, angs, note in radii]
    if opts.get('roomy', True):
        c, angs, note = radii[0]
        runs.append((c, angs, note, 2.0 * gap, 'twice the clearance'))
    cands = []
    for k, (c, angs, note, g, tag) in enumerate(runs):
        mx = min(180.0, max(angs))
        spec = dict(base, clr=c, max_bend_deg=mx, gap=g)
        if log:
            log('%s: routing on a %.1f mm bend radius%s' % (name, c * 10.0, (', ' + tag) if tag else ''))
        # the roomier run keeps the larger of its own clearance and the hot one from the hot bodies
        sc = scene if (g == gap or hot is None) else UnionScene(cold, hot, max(0.0, hot_gap - g))
        r = RT.route(sc, spec, tubes, owner=leg['kind'], log=None)
        cands.append(_candidate(k, r, leg, opts, c, angs, mx, note, tag, spec, cold, hot, hot_gap, idc))
    ranked = rank(cands)
    ok = [c for c in ranked if c['ok']]
    if ok:
        msg = '%s: %d route%s fit; the lowest loss is %s.' % (name, len(ok), '' if len(ok) == 1 else 's', ok[0]['label'])
        return {'kind': leg['kind'], 'name': name, 'candidates': ranked, 'best': 0, 'ok': True, 'msg': msg}
    return {'kind': leg['kind'], 'name': name, 'candidates': ranked, 'best': None, 'ok': False,
            'msg': no_fit_msg(name, ranked, gap, hot_gap if hot is not None else None, od)}


def no_fit_msg(name, cands, gap, hot_gap, od):
    """Which leg, what was asked, how close the best try came (to which kind of body), and what to change."""
    tried = ', '.join(sorted(set('%.1f mm' % c['clr_mm'] for c in cands)))
    m = '%s: no route keeps %.1f mm from the scan%s on the stocked bend radii tried (%s).' % (
        name, gap * 10.0, (' and %.1f mm from the hot bodies' % (hot_gap * 10.0)) if hot_gap is not None else '', tried)
    best = None
    for c in cands:
        if c.get('slack_mm') is not None and (best is None or c['slack_mm'] > best['slack_mm']):
            best = c
    if best is not None:
        m += ' The closest try (%s) came %.1f mm short' % (best['label'], -best['slack_mm'])
        if best.get('short_of') == 'hot':
            m += ' of the hot clearance'
        if best.get('worst_at_mm'):
            m += ' near (%.0f, %.0f, %.0f) mm' % tuple(best['worst_at_mm'])
        m += '.'
    elif cands and cands[0].get('note'):
        m += ' ' + cands[0]['note']
    m += (' Lower the clearance for this leg%s, use a smaller tube than %.1f mm OD, move its markers, or check that '
          'they sit outside the scan.' % (' or the hot clearance' if hot_gap is not None else '', od * 10.0))
    return m


def _candidate(k, r, leg, opts, clr, angs, mx, note, tag, spec, cold, hot, hot_gap, idc):
    od = float(leg['od'])
    label = '%.1f mm (%.2f D) bend radius%s' % (clr * 10.0, clr / idc, (', ' + tag) if tag else '')
    c = {'id': k, 'label': label, 'clr_mm': clr * 10.0, 'clr_d': clr / idc, 'stock_angles': angs,
         'max_bend_deg': mx, 'gap_mm': spec['gap'] * 10.0, 'stock_note': note, 'ok': bool(r.get('ok')),
         'note': r.get('msg') or '', 'tag': tag}
    if r.get('slack') is not None:
        c['slack_mm'] = r['slack'] * 10.0
    if not r.get('elems'):
        c['ok'] = False
        return c
    elems = r['elems']
    lra = r.get('lra') or RT.lra_schedule(elems)
    bends = [(x['A'], x['CLR'] * 10.0) for x in lra if x['A'] is not None]
    length = sum(RT.elem_len(e) for e in elems) * 10.0
    c.update({'length_mm': length, 'n_bends': len(bends), 'bends': [{'angle_deg': a, 'clr_mm': cl} for a, cl in bends],
              'turn_deg': sum(a for a, _ in bends)})
    loss = leg_loss(length, bends, idc * 10.0, leg['flow']) if leg.get('flow') else None
    if loss:
        c.update(loss)
    else:
        c.update({'dp_Pa': 0.0, 'volume_L': math.pi * (idc * 10.0) ** 2 / 4.0 * length / 1e6})
    s = RT._spec(dict(spec))
    g_cold, at_cold = clearance_report(cold, s, elems) if cold is not None and cold.built else (None, None)
    g_hot, at_hot = clearance_report(hot, s, elems) if hot is not None else (None, None)
    c['min_gap_mm'], c['min_gap_at_mm'] = g_cold, at_cold
    c['hot_gap_mm'], c['hot_gap_at_mm'] = g_hot, at_hot
    if g_cold is None and g_hot is not None:
        c['min_gap_mm'], c['min_gap_at_mm'] = g_hot, at_hot
    elif g_hot is not None and g_hot < g_cold:
        c['min_gap_mm'], c['min_gap_at_mm'] = g_hot, at_hot
    # which rule is the short one (for the no-fit message)
    if not c['ok'] and c.get('slack_mm') is not None and c['slack_mm'] < 0:
        sh_c = (g_cold - spec['gap'] * 10.0) if g_cold is not None else 1e9
        sh_h = (g_hot - hot_gap * 10.0) if g_hot is not None else 1e9
        c['short_of'] = 'hot' if sh_h < sh_c else 'scan'
        c['worst_at_mm'] = at_hot if sh_h < sh_c else at_cold
    mid = opts.get('joints') == 'coupler'
    c['cut'] = cut_list(lra, angs, mid)
    c['couplers'] = couplers(elems, lra, float(opts.get('coupler_mm') or 76.2), mid)
    c['lra'] = [{'L_mm': x['L'] * 10.0, 'R_deg': x['R'], 'A_deg': x['A'], 'CLR_mm': _mm(x['CLR'])} for x in lra]
    c['_elems'] = elems                     # kept for the build; not sent to the page
    fab = RT.fab_report(elems, od)
    c['flags'] = fab['flags']
    if clr / idc < 1.5 - 1e-6:
        c['flags'] = c['flags'] + ['Tighter than 1.5 D, the smallest radius the Intake tab quotes from Garrett.']
    over = [b for b in c['cut'] if b['kind'] == 'bend' and b['from_deg'] is None]
    if over:
        c['ok'] = False
        c['note'] = (c['note'] + ' A bend is larger than any stocked bend at this radius.').strip()
    return c


def plan(cold, hot, legs, opts, log=None):
    """Every leg in turn; each leg's lowest-loss route is added as a tube the later legs keep clear of."""
    tubes = RT.TubeSet(cell=2.0)
    out = []
    for leg in legs:
        res = plan_leg(cold, hot, leg, opts, tubes if tubes.segs else None, log)
        if res['best'] is not None:
            best = res['candidates'][res['best']]
            tubes.add_polyline(RT.path_points(best['_elems'], 0.5), float(leg['od']) / 2.0, leg['kind'])
        out.append(res)
    ok = all(r['ok'] for r in out)
    return {'ok': ok, 'legs': out}


def public(plan_res):
    """The plan as the page gets it: no element tuples (they stay in the add-in for the build)."""
    legs = []
    for L in plan_res['legs']:
        cs = [{k: v for k, v in c.items() if not k.startswith('_')} for c in L['candidates']]
        legs.append(dict(L, candidates=cs))
    return dict(plan_res, legs=legs)
