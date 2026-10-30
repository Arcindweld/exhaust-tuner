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
