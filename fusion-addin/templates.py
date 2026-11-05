# -*- coding: utf-8 -*-
"""Layout templates for whole header systems: plans a fabricator would draw, laid out as waypoint polylines,
turned into lines and arcs of fixed bend radius (router.chain_geometry), length-matched by one trim per tube,
and checked numerically against the keep-out scene and tube to tube.

bundle_180(): true 180-degree headers for a 90-degree cross-plane V8 in a front-engine bay. Each collector takes
the cylinders that fire 180 degrees apart (alternate cylinders in the firing order). The front and rear tube of
each bank stay on their side ("local"); the two middle tubes cross under the bellhousing to the far collector on
two levels (one per bank) so the pairs pass over each other. The front tube makes up its length with a forward
lobe, the rear with a forward run and a U-turn; the crossing tubes with a high run and a dogleg.

Frame: X forward, Y to the driver's side, Z up, crank axis on X. Lengths inside are inches (the bay numbers a
fabricator thinks in); the inputs and outputs are cm like the rest of the add-in.
"""
import math

try:
    from . import router as RT
except Exception:  # pragma: no cover - run as a plain module
    import router as RT

IN = 2.54

# The lane plan, as offsets from things the markers give: port y (outboard of centre), port z, collector x/z.
# Every number is in inches and can be overridden through params.
DEFAULTS = {
    'col_dy': 2.14,        # local tubes' column / return lane: this far outboard of the port centre
    'lane_dy': 4.29,       # crossing tubes' outboard lane
    'rear_fwd_dy': -0.11,  # the rear tube's forward lane sits this far INBOARD of the port (under the head)
    'rear_fwd_dz': 7.2,    # heights relative to the collector axis z
    'rear_ret_dz': 1.5,
    'front_fwd_dz': 5.1,
    'front_ret_dz': -0.5,
    'cross_deep_dz': -5.1,
    'cross_shallow_dz': -3.0,
    'cross_hi_dz': -3.5,   # crossing tubes' kick-out height relative to the port z (front-middle)
    'hi2_deep_dz': 1.4,    # rear-middle high run, deep side / shallow side, relative to the port z
    'hi2_shallow_dz': 2.4,
    'station_fmid_dx': 11.0,   # inboard runs, x relative to the collector merge plane
    'station_rmid_dx': 8.7,
    'station_y_fmid': 3.0,     # inboard run ends this far off centre
    'station_y_rmid': 5.0,
    'rise_fmid': (7.3, 4.8),   # flat run end / rise end, x relative to the collector
    'rise_rmid': (4.5, 1.7),
    'jog_dx': 15.5,            # local tubes start their jog into the tunnel this far ahead of the collector
    'jog_end_dx': 5.0,
    'lead_front': 2.2, 'lead_rear': 2.9, 'lead_cross': 2.9,
    'lobe_x0': 9.0,            # front lobe starts here (x, in) plus the trim
    'gap': 0.5, 'gap_tt': 0.125,
    'dip_dz': 2.2,             # how far a local tube dips under an obstacle on its jog
}


def _slots(cy, cz, od, side):
    s = 1.0 if side > 0 else -1.0
    r = od / (2.0 * math.sin(math.pi / 4))
    o = r * math.cos(math.pi / 4)
    return {'outer_up': (s * (cy + o), cz + o), 'outer_lo': (s * (cy + o), cz - o),
            'inner_up': (s * (cy - o), cz + o), 'inner_lo': (s * (cy - o), cz - o)}


def groups_180(order):
    """Alternate cylinders in the firing order: two groups whose pulses are 180 degrees apart."""
    return [list(order[0::2]), list(order[1::2])]


class Bundle180(object):
    def __init__(self, ports, coll_a, coll_b, order, od_in, clr_in, scene=None, params=None, log=None):
        """ports: {cyl: ((x,y,z) cm, (dx,dy,dz))}; coll_a/coll_b: ((x,y,z) cm, dir) merge planes, A on +Y.
        order: firing order (cylinder numbers). od_in/clr_in in inches."""
        self.P = dict(DEFAULTS)
        if params:
            self.P.update(params)
        self.od, self.clr = float(od_in), float(clr_in)
        self.scene = scene
        self.log = log or (lambda s: None)
        self.ports = {c: (tuple(v / IN for v in p), tuple(d)) for c, (p, d) in ports.items()}
        ca, cb = coll_a[0], coll_b[0]
        self.CX = (ca[0] + cb[0]) / 2.0 / IN
        self.CY = (abs(ca[1]) + abs(cb[1])) / 2.0 / IN
        self.CZ = (ca[2] + cb[2]) / 2.0 / IN
        self.order = list(order)
        # sides and roles from the marker positions
        self.side = {c: (1 if self.ports[c][0][1] > 0 else -1) for c in self.ports}
        self.role = {}
        for sd in (1, -1):
            cs = sorted([c for c in self.ports if self.side[c] == sd], key=lambda c: -self.ports[c][0][0])
            if len(cs) != 4:
                raise ValueError('The 180-degree template needs four ports on each bank (got %d on one side).' % len(cs))
            for c, r in zip(cs, ('front', 'fmid', 'rmid', 'rear')):
                self.role[c] = r
        ga, gb = groups_180(self.order)
        # the group that holds a bank's front and rear tubes gets that bank's collector
        def locals_of(g, sd):
            return [c for c in g if self.side[c] == sd and self.role[c] in ('front', 'rear')]
        if len(locals_of(ga, 1)) == 2 and len(locals_of(gb, -1)) == 2:
            self.groups = {'A': ga, 'B': gb}
        elif len(locals_of(gb, 1)) == 2 and len(locals_of(ga, -1)) == 2:
            self.groups = {'A': gb, 'B': ga}
        else:
            raise ValueError('With this firing order the 180-degree pairs do not split into front+rear local tubes and '
                             'crossing middle tubes on each bank, so this template does not apply.')
        self.coll_of = {}
        for tag, g in self.groups.items():
            for c in g:
                self.coll_of[c] = tag
        # which bank crosses deep: decided by the repair loop (default: the driver's side deep)
        self.deep_side = 1
        self.dips = {1: set(), -1: set()}
        self.target = None
        self.trim = {}

    # ---------------------------------------------------------------- plan
    def lanes(self, side):
        P, pz = self.P, self.ports[[c for c in self.ports if self.side[c] == side][0]][0][2]
        py = abs(self.ports[[c for c in self.ports if self.side[c] == side][0]][0][1])
        deep = (side == self.deep_side)
        return dict(col_y=py + P['col_dy'], lane_y=py + P['lane_dy'], rear_fwd_y=py + P['rear_fwd_dy'],
                    rear_fwd=self.CZ + P['rear_fwd_dz'], rear_ret=self.CZ + P['rear_ret_dz'],
                    front_fwd=self.CZ + P['front_fwd_dz'], front_ret=self.CZ + P['front_ret_dz'],
                    cross=self.CZ + (P['cross_deep_dz'] if deep else P['cross_shallow_dz']),
                    cross_hi=pz + P['cross_hi_dz'], cross_hi2=pz + (P['hi2_deep_dz'] if deep else P['hi2_shallow_dz']))

    def waypoints(self, cyl, trim):
        P = self.P
        side = self.side[cyl]
        s = 1.0 if side > 0 else -1.0
        L = self.lanes(side)
        role = self.role[cyl]
        pt, d = self.ports[cyl]
        xp = pt[0]
        lead = P['lead_cross'] if role in ('fmid', 'rmid') else P['lead_' + role]
        P1 = tuple(pt[k] + d[k] * lead for k in range(3))
        CX, CY, CZ, od = self.CX, self.CY, self.CZ, self.od
        SL, SLf = _slots(CY, CZ, od, side), _slots(CY, CZ, od, -side)
        y, ly = s * L['col_y'], s * L['lane_y']
        jog_x, jog_end = CX + P['jog_dx'], CX + P['jog_end_dx']
        deep_z = self.CZ + P['cross_deep_dz']
        if role == 'front':
            xf = P['lobe_x0'] + trim
            sy, sz = SL['outer_lo']
            Q = [pt, P1, (xf, y, L['front_fwd']), (xf, y, L['front_ret'])]
            if 'front' in self.dips[side]:
                zd = deep_z                                         # under the obstacle and under the crossing tubes
                Q += [(jog_x + 2.5, y, L['front_ret']), (jog_x - 2.0, y, zd), (jog_end + 1.5, s * (CY + 1.2), zd), (jog_end - 1.0, sy, sz)]
            else:
                Q += [(jog_x, y, L['front_ret']), (jog_end, sy, sz)]
            return Q + [(CX, sy, sz)]
        if role == 'rear':
            xf = trim
            sy, sz = SL['outer_up']
            yf = s * L['rear_fwd_y']
            Q = [pt, P1, (-3.5, s * (L['col_y'] - 0.75), L['rear_fwd']), (-1.0, yf, L['rear_fwd']), (xf, yf, L['rear_fwd']),
                 (xf, y, L['rear_ret']), (jog_x, y, L['rear_ret'])]
            if 'rear' in self.dips[side]:
                zd = L['rear_ret'] - P['dip_dz']
                Q += [(jog_x - 4.0, y, zd), (jog_end + 3.5, s * (CY + 1.7), zd)]
            return Q + [(jog_end, sy, sz), (CX, sy, sz)]
        # crossing tubes
        zc = L['cross']
        xs = CX + (P['station_fmid_dx'] if role == 'fmid' else P['station_rmid_dx'])
        x_flat, x_rise = [CX + v for v in (P['rise_fmid'] if role == 'fmid' else P['rise_rmid'])]
        sy, sz = SLf['inner_up'] if role == 'fmid' else SLf['inner_lo']
        Q = [pt, P1]
        run = 0.0 if trim < 3.5 else min(trim, xp - 3.0 - xs - 0.5)
        if role == 'fmid':
            Q.append((xp - 3.0, ly, L['cross_hi']))
            if run > 0.05:
                Q.append((xp - 3.0 - run, ly, L['cross_hi']))
        elif run > 0.05:
            Q += [(xp - 3.0, ly, L['cross_hi2']), (xp - 3.0 - run, ly, L['cross_hi2'])]
        sty = P['station_y_fmid'] if role == 'fmid' else P['station_y_rmid']
        Q += [(xs, ly, zc), (xs, s * sty, zc)]
        dog = min(trim - run, 4.5 if role == 'fmid' else 3.0)
        if dog > 0.05:
            Q.append(((xs + x_flat) / 2.0 + (dog if role == 'fmid' else -dog), (s * sty + sy) / 2.0, zc))
        Q += [(x_flat, sy, zc), (x_rise, sy, sz), (CX, sy, sz)]
        return Q

    def build(self, cyl, trim):
        Q = [tuple(v * IN for v in q) for q in self.waypoints(cyl, trim)]
        return RT.chain_geometry(Q, self.clr * IN)

    def trim_range(self, cyl):
        r = self.role[cyl]
        return (-5.5, 13.0) if r == 'rear' else ((0.0, 10.0) if r == 'front' else (0.0, 14.0))

    def length_range(self, cyl):
        lo, hi = self.trim_range(cyl)
        vals = [self.build(cyl, lo + (hi - lo) * k / 12.0)['length'] / IN for k in range(13)]
        return min(vals), max(vals)

    def solve(self, cyl, target):
        lo, hi = self.trim_range(cyl)
        f = lambda t: self.build(cyl, t)['length'] / IN - target
        flo, fhi = f(lo), f(hi)
        if flo * fhi > 0:
            return lo if abs(flo) < abs(fhi) else hi
        for _ in range(60):
            mid = (lo + hi) / 2.0
            fm = f(mid)
            if flo * fm <= 0:
                hi, fhi = mid, fm
            else:
                lo, flo = mid, fm
        return (lo + hi) / 2.0

    # ---------------------------------------------------------------- checks
    def scene_gap(self, g):
        if self.scene is None or not self.scene.built:
            return None, None
        pts = RT.path_points(g['elems'], 0.4)
        L = g['length']
        worst, where, run, prev = None, None, 0.0, pts[0]
        for p in pts:
            run += RT.vdist(p, prev)
            prev = p
            if run < 1.5 * IN or run > L - 1.5 * IN:
                continue
            dd = self.scene.dist_exact(p, 8.0) - self.od * IN / 2.0
            if worst is None or dd < worst:
                worst, where = dd, p
        return worst, where

    def bundle_len_in(self):
        """Length of the bundle ahead of the merge. Over the jog the tubes converge from lane pitch (OD + 1/8 in) to the
        collector slot pitch (OD, touching), so from the start of the jog they are closer than the tube-to-tube rule."""
        return float(self.P['jog_dx'])

    def tube_gaps(self, geos):
        pts = {c: RT.path_points(g['elems'], 0.5) for c, g in geos.items()}
        coll = lambda c: ((self.CX * IN, (self.CY if self.coll_of[c] == 'A' else -self.CY) * IN, self.CZ * IN))
        out = {}
        cyls = sorted(pts)
        for i, a in enumerate(cyls):
            for b in cyls[i + 1:]:
                best, wp = 1e9, None
                same = self.coll_of[a] == self.coll_of[b]
                # Tubes into one collector are at slot pitch (touching) from the end of their jog to the merge; the
                # fabricator tacks that bundle together, so the check starts outside it. Other pairs: last 5 in only.
                skip = (self.bundle_len_in() if same else 5.0) * IN
                for p in pts[a]:
                    if RT.vdist(p, coll(a)) < skip:
                        continue
                    for q in pts[b]:
                        if RT.vdist(q, coll(b)) < skip:
                            continue
                        dd = RT.vdist(p, q)
                        if dd < best:
                            best, wp = dd, p
                out[(a, b)] = (best - self.od * IN, wp)
        return out

    # ---------------------------------------------------------------- run
    def layout(self, target_in=None):
        """Returns {'target','tubes':{cyl:{'elems','length','trim','scene_gap','where'}}, 'pairs', 'ok', 'notes'}."""
        notes = []
        P = self.P
        for attempt in range(4):
            # target: the longest of the tubes' shortest lengths, plus a little, unless given
            if target_in is None:
                lo_hi = {c: self.length_range(c) for c in self.ports}
                need = max(v[0] for v in lo_hi.values()) + 0.3
                cap = min(v[1] for v in lo_hi.values())
                target = need if need <= cap else need
                if need > cap:
                    notes.append('No single length fits every tube with this plan (needs %.1f in, one tube tops out at %.1f in).' % (need, cap))
            else:
                target = float(target_in)
            geos, rep = {}, {}
            for c in self.ports:
                t = self.solve(c, target)
                g = self.build(c, t)
                worst, where = self.scene_gap(g)
                bad = [a for a in g['avail'] if a < -0.25]      # bends overlapping by more than 0.1 in
                rep[c] = {'trim': t, 'length': g['length'], 'scene_gap': worst, 'where': where, 'bend_overlap': bool(bad)}
                geos[c] = g
            pairs = self.tube_gaps(geos)
            # repair: a local tube too close to the scene on its jog -> dip it; the dipped side takes the shallow crossing
            changed = False
            for c in self.ports:
                r = rep[c]
                if r['scene_gap'] is not None and r['scene_gap'] < 0.6 * P['gap'] * IN and self.role[c] in ('front', 'rear') \
                        and self.role[c] not in self.dips[self.side[c]] and r['where'] is not None and r['where'][0] < (self.CX + P['jog_dx'] + 1.0) * IN:
                    self.dips[self.side[c]].add(self.role[c])
                    self.dips[self.side[c]].add('front')          # a dipped rear jog takes the front tube's lane, so the front dips too
                    self.deep_side = -self.side[c]
                    notes.append('Cylinder %d: %.2f in from a keep-out on its way into the tunnel; its jog now dips %s and the %s bank crosses deep.' % (
                        c, r['scene_gap'] / IN, 'under it', 'other'))
                    changed = True
            if not changed:
                break
        tubes = {}
        for c, g in geos.items():
            tubes[c] = dict(rep[c], elems=g['elems'], lra=RT.lra_schedule(g['elems']),
                            fab=RT.fab_report(g['elems'], self.od * IN, min_clr=self.clr * IN - 0.01))
        notes.append('Tubes into the same collector close from 1/8 in apart to touching over the last %.1f in before the merge '
                     '(the jog into the collector slots); tack that bundle on the bench. Tube-to-tube clearance is checked '
                     'outside it, and against the other collector\'s tubes everywhere but the last 5 in.' % self.bundle_len_in())
        worst_pair = min(pairs.values(), key=lambda v: v[0]) if pairs else (None, None)
        ok = all(not t['bend_overlap'] and (t['scene_gap'] is None or t['scene_gap'] >= P['gap'] * IN * 0.6) for t in tubes.values()) \
            and (worst_pair[0] is None or worst_pair[0] >= P['gap_tt'] * IN * 0.8)
        return {'target_in': target, 'tubes': tubes, 'pairs': {str(k): v for k, v in pairs.items()}, 'ok': ok, 'notes': notes,
                'groups': self.groups, 'deep_side': self.deep_side, 'dips': {str(k): sorted(v) for k, v in self.dips.items()}}


# ---------------------------------------------------------------------------------------------------------------
# Drone fixes: the tee on the main pipe, the J-pipe's cap and the Helmholtz can. Pure geometry in cm (cm^3 for
# volumes) like the rest of the add-in; cadtools turns it into Fusion bodies. A branch "start" is the point on the
# main pipe's outside where the branch centreline leaves it, and d is the way the branch leaves.
# ---------------------------------------------------------------------------------------------------------------

def _hits(q, d, axis_p, axis_d, R):
    """Where the line q - t d (growing t runs into the main pipe) crosses the cylinder of radius R about the axis:
    (t_in, t_out), or None when it misses. A grazing line (one touching point) counts as a hit."""
    a = RT.vunit(axis_d)
    w0 = RT.vsub(q, axis_p)
    w0p = RT.vsub(w0, RT.vmul(a, RT.vdot(w0, a)))
    dp = RT.vsub(d, RT.vmul(a, RT.vdot(d, a)))
    A = RT.vdot(dp, dp)
    if A < 1e-12:
        return None                     # running along the main pipe: never meets it
    B = 2.0 * RT.vdot(w0p, dp)          # |w0p - t dp|^2 = R^2  ->  A t^2 - B t + C = 0
    C = RT.vdot(w0p, w0p) - R * R
    disc = B * B - 4.0 * A * C
    if disc < -1e-9 * max(1.0, B * B):
        return None
    s = math.sqrt(max(0.0, disc))
    return (B - s) / (2.0 * A), (B + s) / (2.0 * A)


def _graze(q, d, axis_p, axis_d, R, tol):
    """For a line that misses the cylinder: (t, t) at its closest approach to the axis when it passes within tol of
    the cylinder's surface, else None."""
    a = RT.vunit(axis_d)
    w0 = RT.vsub(q, axis_p)
    w0p = RT.vsub(w0, RT.vmul(a, RT.vdot(w0, a)))
    dp = RT.vsub(d, RT.vmul(a, RT.vdot(d, a)))
    A = RT.vdot(dp, dp)
    if A < 1e-12:
        return None
    t = RT.vdot(w0p, dp) / A
    c = RT.vsub(w0p, RT.vmul(dp, t))
    if math.sqrt(RT.vdot(c, c)) > R + tol:
        return None
    return t, t


def _radial_cos(main, start, d):
    """Cosine between the branch direction and the main pipe's outward normal at the start (1 for a square tee)."""
    a = RT.vunit(main['d'])
    w = RT.vsub(start, main['p'])
    n = RT.vsub(w, RT.vmul(a, RT.vdot(w, a)))
    if RT.vdot(n, n) < 1e-18:
        return 0.0
    return RT.vdot(RT.vunit(d), RT.vunit(n))


def tee_cope(main, start, d, r_out, n=96, tip=0.25):
    """The fishmouth of a branch tube of outside radius r_out cut to fit the main pipe's outside.
    main: {'p': a point on its axis, 'd': axis direction, 'R': outside radius}. The branch leaves the start (on the
    main pipe's outside, on the branch centreline) heading d; t below runs down the branch into the main pipe.
    Returns
      R      the main pipe radius used: a branch at most 1 % (and at least 0.5 mm) wider than the main pipe is
             taken as the same size, since a radius read from a scan comes out a hair under the true one
      depth  how far below the start the cut reaches at its deepest (the sides of a square tee)
      top    how far above the start the branch's outline is still inside the main pipe: 0 for a square tee, more
             for a marker off square or a lateral; the builder cuts the tube's first part to the main pipe too
      room   how far the tube can run in before any of its outline reaches the far side of the main pipe
      full   False when the end cannot be coped from here; why says so: 'wider' (the branch is wider than the
             main pipe), 'side' (it leans across the main pipe so one side passes beside it, by more than the same-size
             allowance), 'along' (it runs along the main pipe), 'into' (it points into the main pipe or along its
             surface), 'steep' (so far off square that one straight piece cannot reach the main pipe all round)
      axis   how far down the branch centreline passes closest to the main axis
      stub   the coped piece's length below the start: 0.5 mm past the deepest point, but kept tip (2.5 mm) short
             of the far side, so where a same-size branch meets the main pipe tangentially (its tips) the solid
             ends in a small flat instead of a knife edge; trim is how much of the deepest point that leaves off
    For a square tee, depth = R - sqrt(R^2 - r^2)."""
    d = RT.vunit(d)
    R = main['R']
    tol = max(0.05, 0.01 * R)
    if R < r_out <= R + tol:
        R = r_out
    m = dict(main, R=R)
    out = {'R': R, 'depth': 0.0, 'top': 0.0, 'room': 0.0, 'full': False, 'why': '', 'axis': 0.0, 'stub': 0.0, 'trim': 0.0}
    a = RT.vunit(main['d'])
    dp = RT.vsub(d, RT.vmul(a, RT.vdot(d, a)))
    A = RT.vdot(dp, dp)
    if A < 1e-6:
        out['why'] = 'along'
        return out
    w0 = RT.vsub(start, main['p'])
    w0p = RT.vsub(w0, RT.vmul(a, RT.vdot(w0, a)))
    out['axis'] = RT.vdot(w0p, dp) / A
    if _radial_cos(main, start, d) < 0.15:
        out['why'] = 'into'
        return out
    if r_out > R:
        out['why'] = 'wider'
        return out
    e1, e2 = RT.perp_basis(d)
    depth, top, room = 0.0, 0.0, float('inf')
    for k in range(n):
        ph = 2.0 * math.pi * k / n
        q = RT.vadd(start, RT.vadd(RT.vmul(e1, r_out * math.cos(ph)), RT.vmul(e2, r_out * math.sin(ph))))
        h = _hits(q, d, m['p'], m['d'], R)
        if h is None:
            # A same-size branch meets the main pipe tangentially at its sides, so a marker a hair off square across
            # the pipe (a scan's fitted axis is never exact) passes its side just beside the main pipe. A side that
            # misses by no more than the same-size allowance is taken as touching it where it comes closest.
            h = _graze(q, d, m['p'], m['d'], R, tol)
        if h is None:
            out['why'] = 'side'
            return out
        depth = max(depth, h[0])
        if h[0] < 0.0:
            top = max(top, -h[0])
        room = min(room, h[1])
    stub = min(depth + 0.05, room - tip)
    out.update({'depth': depth, 'top': top, 'room': room})
    if room <= 0.0 or stub < depth - 0.3:
        out['why'] = 'steep'
        return out
    out.update({'full': True, 'stub': stub, 'trim': max(0.0, depth - stub)})
    return out


def tee_hole(main, start, d, r_in, R_in, n=96, tip=0.25):
    """Where a tool for the hole in the main pipe has to run along the branch: the branch's bore (radius r_in)
    through the main pipe's wall (outside radius main['R'], bore R_in). Returns {'bottom', 'top'}: the tool runs
    from bottom below the start to top above it, past the wall everywhere round the bore but kept tip short of the
    main pipe's far wall (a same-size bore meets the main pipe's bore tangentially at its sides). None when the
    branch's bore does not cross the main pipe's wall all round (a bore wider than the main pipe)."""
    d = RT.vunit(d)
    e1, e2 = RT.perp_basis(d)
    deep, top, far = 0.0, 0.0, float('inf')
    for k in range(n):
        ph = 2.0 * math.pi * k / n
        q = RT.vadd(start, RT.vadd(RT.vmul(e1, r_in * math.cos(ph)), RT.vmul(e2, r_in * math.sin(ph))))
        ho = _hits(q, d, main['p'], main['d'], main['R'])
        hi = _hits(q, d, main['p'], main['d'], R_in)
        if ho is None:
            return None
        top = max(top, -ho[0])
        if hi is None:                  # this line passes beside the main pipe's bore: through the wall only
            deep = max(deep, ho[1])
            far = min(far, ho[1] + 1.0)
        else:
            deep = max(deep, hi[0])
            far = min(far, hi[1])
    bottom = min(deep + 0.05, far - tip)
    if bottom <= 0.0:
        return None
    return {'bottom': bottom, 'top': max(0.05, top + 0.05)}


def helm_can(neck_id, neck_wall, neck_len, can_id, volume, can_wall, neck_into=0.0):
    """A Helmholtz can on a straight neck, the can's axis along the neck. z runs along the neck from the branch start
    on the main pipe's outside (z = 0). The neck is neck_len long from there to its open end in the can, the last
    neck_into of it inside the can. The can's inside length is set so the gas around the neck is exactly the target
    volume: a neck that runs in takes up room, so the can grows by the neck's outside area x neck_into over the can's
    area. Returns the stations, the closed half-sections (r, z) of the can and the neck for a revolve, the gas volume
    as built and 'gap', how far the can's near end sits above the start plane (above the main pipe for a square tee).
    Raises ValueError with the reason when the sizes do not make a can."""
    vals = (neck_id, neck_wall, neck_len, can_id, volume, can_wall, neck_into)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        raise ValueError('Fill in the neck, the can and the volume on the Mufflers tab first.')
    if neck_id <= 0 or neck_wall <= 0 or can_wall <= 0 or can_id <= 0 or volume <= 0:
        raise ValueError('The neck, the can and their walls need sizes above zero.')
    r_ni = neck_id / 2.0
    r_no = r_ni + neck_wall
    Rc = can_id / 2.0
    if r_no >= Rc - 0.2:
        raise ValueError('The neck is about as wide as the can. Use a wider can or a smaller neck.')
    if neck_into < 0 or neck_into >= neck_len:
        raise ValueError('The neck has to run into the can by less than its own length.')
    z_in = neck_len - neck_into                     # the can's near inside face
    z0 = z_in - can_wall                            # its near outside face
    if z0 <= 0.0:
        raise ValueError('The can would sit on the main pipe: make the neck longer than %.2f in, or run less of it '
                         'into the can.' % ((neck_into + can_wall) / IN))
    L_in = (volume + math.pi * r_no ** 2 * neck_into) / (math.pi * Rc ** 2)
    if neck_into > L_in - 1.0:
        raise ValueError('The neck would reach the far end of the can. Run less of it into the can.')
    z1 = z_in + L_in + can_wall                     # far outside face
    Rco = Rc + can_wall
    section = [(r_no, z0), (Rco, z0), (Rco, z1), (0.0, z1), (0.0, z1 - can_wall), (Rc, z1 - can_wall), (Rc, z_in), (r_no, z_in)]
    neck = [(r_ni, 0.0), (r_no, 0.0), (r_no, neck_len), (r_ni, neck_len)]
    gas = math.pi * Rc ** 2 * L_in - math.pi * r_no ** 2 * neck_into
    return {'z_in': z_in, 'L_in': L_in, 'z0': z0, 'z1': z1, 'R_in': Rc, 'R_out': Rco, 'r_hole': r_no,
            'section': section, 'neck': neck, 'gas': gas, 'gap': z0, 'outside_len': z1 - z0,
            'grow': L_in - volume / (math.pi * Rc ** 2)}


def section_area(sec):
    """Area of a closed (r, z) polygon (shoelace), to check a half-section before it is revolved."""
    a = 0.0
    for i in range(len(sec)):
        r0, z0 = sec[i]
        r1, z1 = sec[(i + 1) % len(sec)]
        a += r0 * z1 - r1 * z0
    return abs(a) / 2.0


def revolved_volume(sec):
    """Volume of the solid swept by a closed (r, z) polygon about the z axis (Pappus: 2 pi x centroid r x area)."""
    v = 0.0
    for i in range(len(sec)):
        r0, z0 = sec[i]
        r1, z1 = sec[(i + 1) % len(sec)]
        v += (r0 * r0 + r0 * r1 + r1 * r1) * (z1 - z0)
    return abs(math.pi * v / 3.0)


def _ring_pts(c, d, r, z, step, out):
    e1, e2 = RT.perp_basis(d)
    o = RT.vadd(c, RT.vmul(d, z))
    if r < 1e-9:
        out.append(o)
        return
    n = max(8, int(math.ceil(2.0 * math.pi * r / step)))
    for k in range(n):
        ph = 2.0 * math.pi * k / n
        out.append(RT.vadd(o, RT.vadd(RT.vmul(e1, r * math.cos(ph)), RT.vmul(e2, r * math.sin(ph)))))


def helm_samples(start, d, lay, step=0.4, lift=1.5, neck=True):
    """Points on the outside of the can, and of the neck from lift above the main pipe up to the can (neck=False
    leaves the neck out: next to the main pipe it is always about lift from it), about step apart. Returns
    (points, err): no point of those surfaces is further than err from a sample, so a gap measured from the samples,
    less err, never reads high."""
    d = RT.vunit(d)
    pts = []
    z0, z1, Ro = lay['z0'], lay['z1'], lay['R_out']
    nz = max(2, int(math.ceil((z1 - z0) / step)))
    for i in range(nz + 1):
        _ring_pts(start, d, Ro, z0 + (z1 - z0) * i / nz, step, pts)
    nr = max(2, int(math.ceil(Ro / step)))
    for j in range(nr + 1):
        _ring_pts(start, d, Ro * j / nr, z1, step, pts)                       # far end
        r = lay['r_hole'] + (Ro - lay['r_hole']) * j / nr
        _ring_pts(start, d, r, z0, step, pts)                                 # near end, round the neck
    if neck and z0 > lift:
        nn = max(2, int(math.ceil((z0 - lift) / step)))
        for i in range(nn + 1):
            _ring_pts(start, d, lay['r_hole'], lift + (z0 - lift) * i / nn, step, pts)
    return pts, step * 0.75


def cylinder_samples(start, d, R, z0, z1, step=0.4):
    """Points on the outside of a closed cylinder of radius R from z0 to z1 along d from start (an inline chamber's
    shell and end plates), about step apart; returns (points, err) as helm_samples does."""
    d = RT.vunit(d)
    pts = []
    nz = max(2, int(math.ceil((z1 - z0) / step)))
    for i in range(nz + 1):
        _ring_pts(start, d, R, z0 + (z1 - z0) * i / nz, step, pts)
    nr = max(2, int(math.ceil(R / step)))
    for j in range(nr + 1):
        _ring_pts(start, d, R * j / nr, z0, step, pts)
        _ring_pts(start, d, R * j / nr, z1, step, pts)
    return pts, step * 0.75


def scene_points_near(scene, c, rad, cap=6000):
    """Scan sample points (the router's Scene) within rad of c, thinned evenly to at most cap."""
    out = scene.points_near(c, rad)
    if len(out) > cap:
        s = len(out) / float(cap)
        out = [out[int(i * s)] for i in range(cap)]
    return out


def fit_main_pipe(points, start, d, R0, max_rms=0.15, native=None):
    """The main pipe under a branch start, from scan points: a round pipe of any radius near R0 (the page's main
    pipe) whose axis passes near start - d R0. All five numbers of a cylinder are fitted (axis direction, where the
    axis sits, radius), starting from a square tee drawn on the surface, so a marker drawn a little off the surface
    or a little off square is fine. Points further than a fifth of R0 off the surface are not counted (a floor or a
    bracket near the pipe). Returns {'p', 'd', 'R', 'rms', 'n', 'frac', 'cover', 'off', 'ok', 'why'}: cover is how
    much of the way round the pipe the scan shows near the tee (degrees), off how far the start marker sits off the
    fitted surface (cm, + outside). The cost is added up in the Rust core when it is loaded (native=False: here),
    with the same result."""
    d = RT.vunit(d)
    e1, e2 = RT.perp_basis(d)
    c0 = RT.vsub(start, RT.vmul(d, R0))
    rad = 2.2 * R0
    P = [p for p in points if RT.vdist(p, c0) <= rad]
    if len(P) > 2500:                   # plenty for five numbers, and it keeps the fit to a second or two
        s = len(P) / 2500.0
        P = [P[int(i * s)] for i in range(2500)]
    T = max(0.2 * R0, 0.3)
    out = {'ok': False, 'n': len(P), 'R': R0, 'rms': None, 'frac': 0.0, 'cover': 0.0, 'off': 0.0,
           'p': c0, 'd': e1, 'why': ''}
    if len(P) < 30:
        out['why'] = 'too few scan points near the tee (%d)' % len(P)
        return out

    def geom(x):
        th, tau, dl, s, R = x
        a = RT.vunit(RT.vadd(RT.vadd(RT.vmul(e1, math.cos(th)), RT.vmul(e2, math.sin(th))), RT.vmul(d, tau)))
        b = RT.vunit(RT.vcross(a, d))
        c = RT.vadd(RT.vsub(start, RT.vmul(d, R + dl)), RT.vmul(b, s))
        return a, c, R

    def resid(x):
        a, c, R = geom(x)
        out_ = []
        for q in P:
            w0, w1, w2 = q[0] - c[0], q[1] - c[1], q[2] - c[2]
            t = w0 * a[0] + w1 * a[1] + w2 * a[2]
            out_.append(math.sqrt(max(0.0, w0 * w0 + w1 * w1 + w2 * w2 - t * t)) - R)
        return out_

    NP = [RT.NV.Points(P) if (RT.NV is not None and native is not False) else None]

    def cost(x):
        if NP[0] is not None:
            a, c, R = geom(x)
            try:
                return NP[0].cyl_cost(a, c, R, T)
            except RT.CoreError as ex:       # the same sum here, from now on (the router does the same)
                RT.core_failed(ex)
                NP[0] = None
        s = 0.0
        for r in resid(x):
            s += r * r if r * r < T * T else T * T
        return s

    def golden(f, a, b, it=24):
        g = (math.sqrt(5.0) - 1.0) / 2.0
        x1, x2 = b - g * (b - a), a + g * (b - a)
        f1, f2 = f(x1), f(x2)
        for _ in range(it):
            if f1 < f2:
                b, x2, f2 = x2, x1, f1
                x1 = b - g * (b - a)
                f1 = f(x1)
            else:
                a, x1, f1 = x1, x2, f2
                x2 = a + g * (b - a)
                f2 = f(x2)
        return (a + b) / 2.0

    step = math.radians(2.0)
    th0 = min((k * step for k in range(90)), key=lambda t: cost((t, 0.0, 0.0, 0.0, R0)))
    x = [th0, 0.0, 0.0, 0.0, R0]
    span = [2 * step, 0.25, 0.25 * R0, 0.25 * R0, 0.25 * R0]
    for rnd in range(5):
        for i in range(5):
            lo, hi = x[i] - span[i], x[i] + span[i]
            if i == 4:
                lo, hi = max(lo, 0.7 * R0), min(hi, 1.3 * R0)

            def f(v, i=i):
                y = list(x)
                y[i] = v
                return cost(y)
            x[i] = golden(f, lo, hi)
        span = [s * 0.5 for s in span]
    a, c, R = geom(x)
    res = resid(x)
    inl = [i for i, r in enumerate(res) if abs(r) < T]
    rms = math.sqrt(sum(res[i] ** 2 for i in inl) / len(inl)) if inl else None
    frac = len(inl) / float(len(res))
    bins = set()                    # how far round the pipe the scan reaches, in 10 degree bins
    b2 = RT.vunit(RT.vcross(a, d))
    dd = RT.vunit(RT.vsub(d, RT.vmul(a, RT.vdot(d, a))))
    for i in inl:
        w = RT.vsub(P[i], c)
        w = RT.vsub(w, RT.vmul(a, RT.vdot(w, a)))
        bins.add(int(math.floor((math.degrees(math.atan2(RT.vdot(w, b2), RT.vdot(w, dd))) + 180.0) / 10.0)) % 36)
    w = RT.vsub(start, c)
    off = math.sqrt(max(0.0, RT.vdot(w, w) - RT.vdot(w, a) ** 2)) - R
    out.update({'p': c, 'd': a, 'R': R, 'rms': rms, 'frac': frac, 'cover': 10.0 * len(bins), 'off': off})
    if rms is None or rms > max_rms:
        out['why'] = 'the scan does not look like a round pipe here (%s mm off)' % ('%.1f' % (rms * 10) if rms is not None else 'all points')
    elif frac < 0.4:
        out['why'] = 'most scan points near the tee are not on one pipe (%.0f %%)' % (100 * frac)
    elif out['cover'] < 60.0:
        out['why'] = 'the scan shows only %.0f deg of the way round the pipe at the tee' % out['cover']
    else:
        out['ok'] = True
    return out


def clearance(scene, pts, err, cap=12.0):
    """Smallest gap from sample points to the scene's triangles, less the sampling error so it never reads high.
    Returns (gap or None when nothing is within cap, index of the closest point)."""
    if hasattr(scene, 'nearest'):
        best, at = scene.nearest(pts, cap)
    else:
        best, at = cap, None
        for i, p in enumerate(pts):
            if scene.dist_fast(p, cap) - scene.e_cover >= best:
                continue
            g = scene.dist_exact(p, cap)
            if g < best:
                best, at = g, i
    if at is None:
        return None, None
    return max(0.0, best - err), at


def ext_chamber(pipe_id, pipe_wall, can_id, can_wall, length, l_in, l_out, stub, n_baffles=0, hole=0.0, t_baffle=0.0):
    """An inline expansion chamber with extended inlet and outlet tubes (Munjal's double-tuned chamber when l_in and
    l_out are half and a quarter of the inside length). z runs along the pipe from the can's near outside face
    (z = 0). The shell is a tube of can_id inside with end plates can_wall thick; the inlet tube (pipe_id inside,
    pipe_wall) comes in from z = -stub through the near plate and ends l_in past it; the outlet tube starts l_out
    before the far plate's inside face and runs stub past the far outside face. Returns closed half-sections (r, z) for
    three revolves (shell, inlet tube, outlet tube), the inside length and the gas volume. cm throughout. Raises
    ValueError when the sizes do not make a chamber."""
    vals = (pipe_id, pipe_wall, can_id, can_wall, length, l_in, l_out, stub)
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vals):
        raise ValueError('Fill in the pipe, the chamber and its walls on the Mufflers tab first.')
    if pipe_id <= 0 or pipe_wall <= 0 or can_id <= 0 or can_wall <= 0 or length <= 0 or stub < 0:
        raise ValueError('The pipe, the chamber and their walls need sizes above zero.')
    r_pi, r_po, Rc = pipe_id / 2.0, pipe_id / 2.0 + pipe_wall, can_id / 2.0
    if r_po >= Rc - 0.3:
        raise ValueError('The pipe is about as wide as the chamber. Use a wider chamber.')
    if l_in < 0 or l_out < 0 or l_in + l_out >= length:
        raise ValueError('The extended tubes meet inside the chamber: together they must be shorter than it.')
    z_in, z_far = can_wall, can_wall + length            # inside faces of the end plates
    z1 = z_far + can_wall                                 # far outside face
    Rco = Rc + can_wall
    shell = [(r_po, 0.0), (Rco, 0.0), (Rco, z1), (r_po, z1), (r_po, z_far), (Rc, z_far), (Rc, z_in), (r_po, z_in)]
    inlet = [(r_pi, -stub), (r_po, -stub), (r_po, z_in + l_in), (r_pi, z_in + l_in)]
    outlet = [(r_pi, z_far - l_out), (r_po, z_far - l_out), (r_po, z1 + stub), (r_pi, z1 + stub)]
    gas = math.pi * Rc ** 2 * length - math.pi * r_po ** 2 * (l_in + l_out)
    # baffles: n washers of the chamber's bore with a centred hole, spaced evenly through the open part between the tube
    # mouths (none where the tubes would pass through them)
    baffles = []
    if n_baffles and n_baffles > 0:
        if not (hole > 0 and hole < can_id - 0.2 and t_baffle > 0):
            raise ValueError('A baffle needs a hole smaller than the chamber and a thickness.')
        open0, open1 = z_in + l_in, z_far - l_out
        span = open1 - open0
        if span < (n_baffles + 1) * (t_baffle + 1.0):
            raise ValueError('There is no room for %d baffles between the tube mouths.' % n_baffles)
        for i in range(int(n_baffles)):
            zc = open0 + span * (i + 1) / (n_baffles + 1)
            baffles.append([(hole / 2.0, zc - t_baffle / 2.0), (Rc + 0.05, zc - t_baffle / 2.0), (Rc + 0.05, zc + t_baffle / 2.0), (hole / 2.0, zc + t_baffle / 2.0)])
    return {'shell': shell, 'inlet': inlet, 'outlet': outlet, 'baffles': baffles, 'L_in': length, 'z1': z1, 'R_out': Rco, 'gas': gas,
            'outside_len': z1, 'overall': z1 + 2 * stub}
