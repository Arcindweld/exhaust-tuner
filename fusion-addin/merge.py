"""A merge collector (or a Tri-Y's Y merge) as one welded part, planned in plain Python so it can be tested outside
Fusion. Lengths in cm, like the router.

What gets built, in the collector's own axial coordinate x (0 at the plane where the tubes end, the router's slot
plane, increasing the way the gas flows):

  sleeve   x = -s .. t      inside diameter = the bundle's envelope (the circle round the touching tubes), so the
                           primaries slip in; the crescent gaps between the tubes and the sleeve are outside the gas path
  plate    x = 0 .. t       the merge plate inside the sleeve: one bore-sized hole per tube, on the tube's own centre,
                           so each tube butts onto it and its bore carries straight through. Holes are the tube's
                           inside diameter, which keeps a full wall of metal between neighbours and to the rim (outside
                           diameter holes would only touch at a point, which can be neither cut nor welded)
  cone     x = t .. L       from the sleeve's diameter down to the outlet (d_out is the outlet's outside diameter, as
                           the router gives it), wall measured square to the axis
  spike    x = t .. t + Ls  a solid cone on the axis, standing on the plate's middle where no hole is: it fills the
                           dead centre between the tubes. Its length is chosen so the open area keeps falling (or
                           stays level) from the plate to the outlet: a spike that ends too abruptly gives back area
                           faster than the cone takes it away, a short diffuser just where the pulses meet.

The open area along the merge is A(x) = pi (R(x)^2 - r_s(x)^2), R the cone's inside radius and r_s the spike's. With
R falling linearly (slope R') and r_s from r_b to 0 over Ls, dA/dx <= 0 everywhere needs R |R'| >= r_s r_b / Ls, worst
at the plate: Ls >= r_b^2 / (R0 |R'|)."""
import math


def _v(a, b, s=1.0):
    return tuple(a[k] + s * b[k] for k in range(3))


def _dot(a, b):
    return sum(a[k] * b[k] for k in range(3))


def _perp(u):
    """Two unit vectors square to u and to each other (any pair: the cut files only need the holes' layout)."""
    a = (1.0, 0.0, 0.0) if abs(u[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = _unit(tuple(a[k] - u[k] * _dot(a, u) for k in range(3)))
    e2 = (u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0])
    return e1, e2


def _unit(a):
    n = math.sqrt(_dot(a, a))
    return tuple(c / n for c in a)


SPIKE_ROLL_CM = 3.81     # 1.5 in: a spike this wide or wider is rolled from sheet, a smaller one turned from bar
SLEEVE_FIT_CM = 0.04     # the sleeve's bore over the bundle's outer circle: 0.4 mm on the diameter, a slip fit
SLEEVE_CM = 1.905        # 3/4 in of slip into the sleeve
PLATE_STOCK_CM = (0.3175, 0.47625, 0.635)    # 1/8, 3/16 and 1/4 in sheet: the merge plate is cut from one of these


def plan(start, axis, slots, od, wall, d_in, d_out, length, sleeve=None, plate_t=None, spike=None, lead_end=None):
    """start: the slot plane's centre; axis: the way the gas flows; slots: each tube's end centre on that plane (the
    router's collector_slots); od, wall: the tubes'; d_in: the bundle envelope (router collector_body's d_in); d_out:
    the outlet's outside diameter; length: start to outlet. sleeve, plate_t: cm, or None for the defaults; spike:
    True / False / None (None: when the centre gap is worth filling). lead_end: the tubes' last straight, which the
    sleeve may not run past."""
    u = _unit(axis)
    n = len(slots)
    notes = []
    s = SLEEVE_CM if sleeve is None else float(sleeve)
    if lead_end:
        s = min(s, 0.9 * float(lead_end))
    # the plate carries little load (the tubes and the sleeve do); it only has to take a fillet weld to the tube
    # wall without burning through, so the thinnest stock at least half again the tube wall
    t = float(plate_t) if plate_t is not None else next((v for v in PLATE_STOCK_CM if v >= 1.5 * wall), PLATE_STOCK_CM[-1])
    idr = od / 2.0 - wall
    Ri0 = d_in / 2.0 + SLEEVE_FIT_CM / 2.0      # the primaries slip into the sleeve with this clearance
    Ro0 = Ri0 + wall
    Ro1 = d_out / 2.0
    Ri1 = Ro1 - wall
    if n < 2:
        t = 0.0                      # one tube: a plain reducer, nothing to merge
    if length <= t + 0.2:
        raise ValueError('The collector is %.1f mm long: it needs more than its %.1f mm merge plate.' % (10 * length, 10 * t))
    if Ri1 <= 0:
        raise ValueError('The collector outlet (%.1f mm) is thinner than two walls.' % (10 * d_out))
    if Ri1 > Ri0:
        notes.append('The outlet is wider than the bundle: the collector flares out instead of tapering in.')
    Lc = length - t
    slope = (Ri1 - Ri0) / Lc                      # R'
    # the cone's included angle: Burns Stainless recommend 15 deg for most collectors, about 7 to 17 or 18 deg the best
    # range, and 25 deg only where a turbo's packaging forces it (Vince in Shorts, Collectors part one)
    incl = 2.0 * math.degrees(math.atan(abs(slope)))
    if Ri1 < Ri0 and not (7.0 <= incl <= 18.0):
        notes.append('the cone tapers at %.1f deg included; Burns Stainless recommend 15 deg, about 7 to 18 deg the '
                     'best range (%s)' % (incl, 'longer collector or a smaller step' if incl > 18 else 'a shorter collector costs little'))
    rad = []
    for sl in slots:
        d = tuple(sl[k] - start[k] for k in range(3))
        if abs(_dot(d, u)) > 0.05:
            raise ValueError('A tube ends %.1f mm off the collector\'s inlet plane.' % (10 * abs(_dot(d, u))))
        rad.append(math.sqrt(max(0.0, _dot(d, d) - _dot(d, u) ** 2)))
    rpack = sum(rad) / len(rad) if n >= 2 else 0.0
    if n >= 2 and (max(rad) - min(rad) > 0.05 or rpack + od / 2.0 > Ri0 + 0.05):
        raise ValueError('The tubes do not end on one ring inside the collector inlet.')
    # the plate's metal: between neighbouring holes (measured from the holes themselves, so uneven spacing shows), and
    # from each hole to the rim
    gaps = [math.sqrt(sum((slots[i][k] - slots[j][k]) ** 2 for k in range(3))) for i in range(n) for j in range(i + 1, n)] if n >= 2 else []
    if n >= 2 and min(gaps) < od - 0.05:
        raise ValueError('Two tubes overlap at the collector inlet (%.1f mm apart for %.1f mm tubes).' % (10 * min(gaps), 10 * od))
    lig_nb = (min(gaps) - 2.0 * idr) if n >= 2 else None
    lig_rim = (Ri0 - rpack - idr) if n >= 2 else None
    plate = None
    if n >= 2:
        plate = {'center': start, 'normal': u, 't': t, 'r': Ri0,
                 'holes': [(sl, idr) for sl in slots], 'lig_between': lig_nb, 'lig_rim': lig_rim}
    # the centre: the biggest circle on the axis that clears every hole by half a wall
    r_void = rpack - idr if n >= 2 else 0.0
    r_b = r_void - 0.5 * wall
    want = (r_b >= 0.15 * od) if spike is None else bool(spike)
    sp = None
    if want and r_b > 0.05 and n >= 3:
        need = r_b * r_b / (Ri0 * abs(slope)) if slope < 0 else float('inf')
        Ls = max(1.15 * need, 3.0 * r_b) if need != float('inf') else 3.0 * r_b
        cap = 0.9 * Lc
        if Ls > cap:
            if 1.15 * need > cap:
                notes.append('The merge spike would need %.1f mm to keep the open area from growing behind it; the cone '
                             'leaves room for %.1f mm.' % (10 * 1.15 * need, 10 * cap))
            else:
                notes.append('The merge spike is cut to %.1f mm, the room the cone leaves, from the %.1f mm a slender spike '
                             '(three base radii) would have; the open area still does not grow.' % (10 * cap, 10 * Ls))
            Ls = cap
        base = _v(start, u, t)
        sp = {'base': base, 'tip': _v(base, u, Ls), 'r': r_b, 'len': Ls, 'hollow': False}
        # a spike 1.5 in across or more is rolled from the cone's sheet (a hollow cone closed by the plate); a smaller
        # one is turned from round bar, solid
        if 2.0 * r_b >= SPIKE_ROLL_CM:
            al = math.atan(r_b / Ls)
            ri, Li = r_b - wall / math.cos(al), Ls - wall / math.sin(al)
            if ri > 0.05 and Li > 0.05:
                sp.update(hollow=True, r_in=ri, len_in=Li)
    elif want and n >= 3:
        notes.append('The gap in the middle of the tubes is too small for a spike.')
    # open area along the merge
    A_bores = n * math.pi * idr * idr
    xs, As = [], []
    for i in range(41):
        x = Lc * i / 40.0
        R = Ri0 + slope * x
        rs = 0.0
        if sp and x < sp['len']:
            rs = sp['r'] * (1.0 - x / sp['len'])
        xs.append(t + x)
        As.append(math.pi * (R * R - rs * rs))
    grow = max([As[i + 1] / As[i] for i in range(len(As) - 1)] + [1.0])
    worst = max(As[i + 1] - As[i] for i in range(len(As) - 1))
    # the metal, as one body: sleeve, cone shell, the plate inside the sleeve less its holes, the spike past the plate
    fr = lambda R, r, h: math.pi * h / 3.0 * (R * R + R * r + r * r)
    vol = (math.pi * (Ro0 ** 2 - Ri0 ** 2) * (s + t) + fr(Ro0, Ro1, Lc) - fr(Ri0, Ri1, Lc) +
           (t * math.pi * (Ri0 ** 2 - n * idr ** 2) if plate else 0.0) +
           (math.pi / 3.0 * (sp['len'] * sp['r'] ** 2 - (sp['len_in'] * sp['r_in'] ** 2 if sp['hollow'] else 0.0)) if sp else 0.0))
    return {'volume_cm3': vol, 'taper_deg': incl, 'n': n, 'start': start, 'axis': u, 'end': _v(start, u, length), 'length': length,
            'sleeve': s, 'plate_t': t, 'Ri0': Ri0, 'Ro0': Ro0, 'Ri1': Ri1, 'Ro1': Ro1, 'wall': wall,
            # (x, r) outline of the shell's half section, closed, for a revolve about the axis
            'section': [(-s, Ri0), (-s, Ro0), (t, Ro0), (length, Ro1), (length, Ri1), (t, Ri0)],
            'plate': plate, 'spike': sp, 'x': xs, 'area': As, 'area_bores': A_bores,
            'area_merge': As[0], 'area_out': As[-1], 'area_growth': max(0.0, worst), 'growth_ratio': grow,
            'notes': notes}


def at(p, x, r=0.0, e=None):
    """The point x along the axis and r out along e (a unit vector square to the axis)."""
    q = _v(p['start'], p['axis'], x)
    return _v(q, e, r) if e else q


def summary(p, name, inch=2.54):
    """One line for the add-in's answer, inches then mm."""
    f = lambda cm: '%.3f in (%.1f mm)' % (cm / inch, 10 * cm)
    bits = ['%s: %d into 1' % (name, p['n'])]
    if p['plate']:
        bits.append('a %s merge plate with %d bore-size holes (%s between holes, %s to the rim)' % (
            f(p['plate_t']), p['n'], f(p['plate']['lig_between']), f(p['plate']['lig_rim'])))
    bits.append('a %s slip sleeve' % f(p['sleeve']))
    if p['spike']:
        bits.append('a %s spike, %s at its base, %s' % (f(p['spike']['len']), f(2 * p['spike']['r']),
                    'rolled from the cone\'s sheet' if p['spike']['hollow'] else 'turned from round bar'))
    bits.append('the cone %.1f deg included' % p['taper_deg'])
    bits.append('open area %.2f times the bores at the plate, %.2f at the outlet' % (
        p['area_merge'] / p['area_bores'], p['area_out'] / p['area_bores']))
    bits.append('about %.2f lb (%.0f g) in 304' % (p['volume_cm3'] * 8.0 / 453.6, p['volume_cm3'] * 8.0))
    return '; '.join(bits) + '.'


# --------------------------------------------------------------------------
# Cut files (DXF R12, millimetres, everything on the CUT layer, as the page's hanger files): the plate on its own
# (it is thicker stock), and the cone and the sleeve as flat patterns from the tube's own wall gauge.
# --------------------------------------------------------------------------

PLATE_FIT_CM = 0.0075     # the plate's radius under the sleeve's bore: 0.15 mm on the diameter, a slip fit


def _dxf(ents):
    # R12 (AC1009); $INSUNITS is a later variable that R12-only readers skip, so the file name and the page say mm too
    out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '0', 'ENDSEC',
           '0', 'SECTION', '2', 'ENTITIES']
    f = lambda v: '%.4f' % (0.0 if abs(v) < 1e-9 else v)
    for e in ents:
        if e[0] == 'L':
            out += ['0', 'LINE', '8', 'CUT', '10', f(e[1][0]), '20', f(e[1][1]), '30', '0', '11', f(e[2][0]), '21', f(e[2][1]), '31', '0']
        elif e[0] == 'C':
            out += ['0', 'CIRCLE', '8', 'CUT', '10', f(e[1][0]), '20', f(e[1][1]), '30', '0', '40', f(e[2])]
        else:                 # ('A', centre, r, start deg, end deg), counter-clockwise
            out += ['0', 'ARC', '8', 'CUT', '10', f(e[1][0]), '20', f(e[1][1]), '30', '0', '40', f(e[2]),
                    '50', f(e[3] % 360.0), '51', f(e[4] % 360.0)]
    out += ['0', 'ENDSEC', '0', 'EOF']
    return '\r\n'.join(out) + '\r\n'


def plate_flat(p):
    """The merge plate in mm, in its own plane (x along the frame's first square-to-axis direction): the outline
    and the holes, centred on the rim's centre. None for one tube."""
    pl = p['plate']
    if not pl:
        return None
    e1, e2 = _perp(p['axis'])
    ents = [('C', (0.0, 0.0), 10.0 * (pl['r'] - PLATE_FIT_CM))]
    for c, r in pl['holes']:
        d = tuple(c[k] - pl['center'][k] for k in range(3))
        ents.append(('C', (10.0 * _dot(d, e1), 10.0 * _dot(d, e2)), 10.0 * r))
    return ents


def cone_flat(p):
    """The cone's flat pattern in mm at the middle of its wall (where a rolled sheet neither stretches nor shrinks),
    a butt seam: an annular sector, or a rectangle when the collector does not taper. Returns (entities, info)."""
    w = p['wall']
    ra, rb = p['Ri0'] + 0.5 * w, p['Ri1'] + 0.5 * w
    h = p['length'] - p['plate_t']
    if abs(ra - rb) < 1e-4:
        c = 2.0 * math.pi * ra * 10.0
        H = 10.0 * h
        return ([('L', (0, 0), (c, 0)), ('L', (c, 0), (c, H)), ('L', (c, H), (0, H)), ('L', (0, H), (0, 0))],
                {'kind': 'band', 'w_mm': c, 'h_mm': H})
    s = math.sqrt(h * h + (ra - rb) ** 2)
    big, small = max(ra, rb), min(ra, rb)
    Rb = s * big / (big - small)
    Rs = Rb - s
    th = 2.0 * math.pi * big / Rb
    a0, a1 = 90.0 - math.degrees(th) / 2.0, 90.0 + math.degrees(th) / 2.0
    pt = lambda R, a: (10.0 * R * math.cos(math.radians(a)), 10.0 * R * math.sin(math.radians(a)))
    ents = [('A', (0.0, 0.0), 10.0 * Rb, a0, a1), ('L', pt(Rs, a0), pt(Rb, a0)), ('L', pt(Rs, a1), pt(Rb, a1))]
    if Rs > 1e-6:
        ents.append(('A', (0.0, 0.0), 10.0 * Rs, a0, a1))
    return ents, {'kind': 'sector', 'R_mm': 10.0 * Rb, 'r_mm': 10.0 * Rs, 'angle_deg': math.degrees(th), 'slant_mm': 10.0 * s}


def spike_flat(p):
    """The spike rolled from the same sheet as the cone: a full cone's sector in mm (closed by the seam's two
    lines from the apex). None without a spike."""
    sp = p['spike']
    if not sp:
        return None, None
    al = math.atan(sp['r'] / sp['len'])
    r = sp['r'] - 0.5 * p['wall'] / math.cos(al)       # at the middle of its wall, as the cone
    sl = r / math.sin(al)
    th = 2.0 * math.pi * r / sl
    a0, a1 = 90.0 - math.degrees(th) / 2.0, 90.0 + math.degrees(th) / 2.0
    pt = lambda a: (10.0 * sl * math.cos(math.radians(a)), 10.0 * sl * math.sin(math.radians(a)))
    return ([('A', (0.0, 0.0), 10.0 * sl, a0, a1), ('L', (0.0, 0.0), pt(a0)), ('L', (0.0, 0.0), pt(a1))],
            {'R_mm': 10.0 * sl, 'angle_deg': math.degrees(th)})


def sleeve_flat(p):
    """The slip sleeve as a rectangle in mm: round the middle of its wall by its length (sleeve plus plate)."""
    c = 2.0 * math.pi * (p['Ri0'] + 0.5 * p['wall']) * 10.0
    H = 10.0 * (p['sleeve'] + p['plate_t'])
    return [('L', (0, 0), (c, 0)), ('L', (c, 0), (c, H)), ('L', (c, H), (0, H)), ('L', (0, H), (0, 0))], {'w_mm': c, 'h_mm': H}


def _bbox(ents):
    xs, ys = [], []
    for e in ents:
        if e[0] == 'L':
            xs += [e[1][0], e[2][0]]
            ys += [e[1][1], e[2][1]]
        elif e[0] == 'C':
            xs += [e[1][0] - e[2], e[1][0] + e[2]]
            ys += [e[1][1] - e[2], e[1][1] + e[2]]
        else:
            c, r, a0, a1 = e[1], e[2], e[3], e[4]
            angs = [a0, a1] + [k * 90.0 for k in range(-4, 9) if a0 <= k * 90.0 <= a1]
            xs += [c[0] + r * math.cos(math.radians(a)) for a in angs]
            ys += [c[1] + r * math.sin(math.radians(a)) for a in angs]
    return min(xs), min(ys), max(xs), max(ys)


def _shift(ents, dx, dy):
    out = []
    for e in ents:
        if e[0] == 'L':
            out.append(('L', (e[1][0] + dx, e[1][1] + dy), (e[2][0] + dx, e[2][1] + dy)))
        elif e[0] == 'C':
            out.append(('C', (e[1][0] + dx, e[1][1] + dy), e[2]))
        else:
            out.append(('A', (e[1][0] + dx, e[1][1] + dy), e[2], e[3], e[4]))
    return out


def _row(groups, gap=15.0):
    """Parts side by side along x, 15 mm apart, each with its lower left corner on y = 0."""
    out, x = [], 0.0
    for ents in groups:
        x0, y0, x1, _y1 = _bbox(ents)
        out += _shift(ents, x - x0, -y0)
        x += x1 - x0 + gap
    return out


def cut_files(p, name):
    """[{name, text, what}] for the page to save: the plate (its own stock) and the cone and sleeve (the tube gauge)."""
    tag = name.lower().replace(' ', '_')
    w_in = p['wall'] / 2.54
    out = []
    pf = plate_flat(p)
    if pf:
        out.append({'name': '%s_plate_%.3fin_mm.dxf' % (tag, p['plate_t'] / 2.54), 'text': _dxf(_row([pf])),
                    'what': '%s: the merge plate, %.3f in (%.2f mm) sheet' % (name, p['plate_t'] / 2.54, 10 * p['plate_t'])})
    cf, ci = cone_flat(p)
    sf, si = sleeve_flat(p)
    kf, ki = spike_flat(p) if (p['spike'] and p['spike']['hollow']) else (None, None)
    out.append({'name': '%s_cone_and_sleeve_%.3fin_mm.dxf' % (tag, w_in), 'text': _dxf(_row([cf, sf] + ([kf] if kf else []))),
                'what': '%s: the cone, the sleeve%s as flat patterns, %.3f in (%.2f mm) sheet, rolled with a butt seam' % (
                    name, ' and the spike' if kf else '', w_in, 10 * p['wall']),
                'cone': ci, 'sleeve': si, 'spike': ki})
    return out
