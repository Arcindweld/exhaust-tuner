"""Exhaust Tuner: Fusion add-in.

Adds two commands to Solid > Create:

  Exhaust Tuner Panel  opens the full calculator (the same page as the web app) docked
                       beside the model. From the panel you can measure selected paths,
                       edges and tube bodies, check equal length and clearance to keep-out
                       bodies, get a bend schedule, and build runners along a routed path.
  Exhaust Tuner        a native dialog with four modes, described below.

The dialog has four modes:

  1. 4-stroke header + megaphone
  2. 2-stroke expansion chamber
  3. Header layout: direct 4-1 / 8-1, Tri-Y (4-2-1), 180 degree grouping,
     stepped primaries, primary size from the engine, runner lengths
  4. Crossover: H-pipe, X-pipe, Z-pipe (packaging geometry) and Y-pipe

Modes 1 to 3 revolve the pipe as hollow bodies around the X axis. Mode 4 draws the
pipe centerlines as a sketch for you to sweep. The dialog values and key results are
stored as Fusion user parameters (ex4_*, ex2_*, exh_*, exc_*). The next time you open
the dialog it starts from whatever those parameters hold. The geometry is built from
the computed numbers, so changing a parameter does not rebuild old bodies.

The math mirrors the web calculator. Lengths are millimetres, angles degrees.
"""
import math
import traceback

import adsk.core
import adsk.fusion

try:                      # Fusion normally loads the add-in as a package
    from . import cadtools
except ImportError:       # otherwise import it from this folder
    import os
    import sys
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import cadtools

CMD_ID = 'exhaustTunerCmd'
CMD_NAME = 'Exhaust Tuner'
CMD_TIP = 'Header, megaphone, expansion chamber, header layout and crossover calculator'
PANEL_ID = 'SolidCreatePanel'

MODE_FOUR = '4-stroke header + megaphone'
MODE_TWO = '2-stroke expansion chamber'
MODE_HEAD = 'Header layout (stepped, Tri-Y, 180 deg, 8-1)'
MODE_CROSS = 'Crossover (H, X, Z, Y pipe)'
MODES = [MODE_FOUR, MODE_TWO, MODE_HEAD, MODE_CROSS]

_app = None
_ui = None
_handlers = []

IN = 25.4
CYCLE = 720.0


# --------------------------------------------------------------------------
# Math (millimetres, degrees, Celsius). Mirrors the web calculator.
# --------------------------------------------------------------------------

def speed_of_sound(temp_c):
    return 20.05 * math.sqrt(temp_c + 273.15)


def cone_len(d1, d2, included_deg):
    return abs(d2 - d1) / 2.0 / math.tan(math.radians(included_deg / 2.0))


def calc_four(p):
    """p keys: n, rpm, evo, egt, dp, cr, cs, place ('collector'|'tail'), tail, ang, er, port."""
    if p['rpm'] <= 0 or p['dp'] <= 0 or p['cr'] <= 0 or p['cs'] < 0:
        raise ValueError('RPM, primary diameter and collector ratio must be positive.')
    if p['er'] < 1 or not (0 < p['ang'] < 60):
        raise ValueError('Megaphone area ratio must be at least 1 and the angle between 0 and 60 degrees.')
    if p['place'] == 'tail' and p['tail'] < 0:
        raise ValueError('Collector to tailpipe end must not be negative.')

    ed = 180.0 + p['evo']
    lp = (850.0 * ed / p['rpm'] - 3.0) * IN
    port = p.get('port', 0.0)
    port = port if port > 0 else 0.0
    if lp <= 0:
        raise ValueError('That tuning RPM is too high for the formula: the primary length drops to zero.')
    if port >= lp:
        raise ValueError('The port length is longer than the whole tuned primary. Lower it or tune for a lower RPM.')
    dc = p['dp'] * math.sqrt(p['n'] * p['cr'])
    lmerge = cone_len(p['dp'], dc, 15.0)
    lstr = p['cs'] * dc
    dex = dc * math.sqrt(p['er'])
    lm = cone_len(dc, dex, p['ang'])
    tail = p['tail'] if p['place'] == 'tail' else 0.0

    segs = [
        ('Primary', lp - port, p['dp'], p['dp']),
        ('Collector merge', lmerge, p['dp'], dc),
        ('Collector straight', lstr, dc, dc),
    ]
    if tail > 0:
        segs.append(('Tailpipe', tail, dc, dc))
    segs.append(('Megaphone', lm, dc, dex))

    c = speed_of_sound(p['egt'])
    return {
        'segs': segs,
        'lp': lp, 'port': port, 'tube': lp - port,
        'dc': dc, 'lmerge': lmerge, 'lstr': lstr, 'dex': dex, 'lm': lm,
        'm_start': lp + lmerge + lstr + tail,
        'round_trip_ms': 2.0 * lp / 1000.0 / c * 1000.0,
        'total': sum(s[1] for s in segs) + port,
    }


def calc_two(p):
    """p keys: rpm, ed, egt, dh, br, da, bl, ba, sr, rp (percent)."""
    if min(p['rpm'], p['ed'], p['dh'], p['bl'] + 1) <= 0:
        raise ValueError('RPM, port duration and header diameter must be positive.')
    if p['br'] <= 1 or p['sr'] <= 0 or p['sr'] >= p['br']:
        raise ValueError('Belly ratio must be above 1 and the stinger ratio below the belly ratio.')
    if not (0 < p['da'] < 60) or not (0 < p['ba'] < 120) or not (0 <= p['rp'] <= 100):
        raise ValueError('Check the cone angles and the reflection point (0 to 100 percent).')

    c = speed_of_sound(p['egt'])
    tuned = p['ed'] * c / (12.0 * p['rpm']) * 1000.0
    db = p['dh'] * p['br']
    ds = p['dh'] * p['sr']
    ld = cone_len(p['dh'], db, p['da'])
    lbel = p['bl'] * db
    lb = cone_len(db, ds, p['ba'])
    lst = 12.0 * ds
    rp = p['rp'] / 100.0
    header = tuned - (ld + lbel + rp * lb)
    if header <= 0:
        raise ValueError('The cones and belly already use more than the tuned length, so the header '
                         'would be zero or negative. Widen the cone angles, lower the belly ratio, '
                         'or tune for a lower RPM.')
    segs = [
        ('Header', header, p['dh'], p['dh']),
        ('Diffuser', ld, p['dh'], db),
        ('Belly', lbel, db, db),
        ('Baffle cone', lb, db, ds),
        ('Stinger', lst, ds, ds),
    ]
    return {
        'segs': segs, 'tuned': tuned, 'header': header, 'ld': ld, 'lbel': lbel, 'lb': lb,
        'lst': lst, 'db': db, 'ds': ds, 'total': sum(s[1] for s in segs), 'c': c,
    }


# ----- primary diameter from the engine -----

STD_OD_IN = [1.5, 1.625, 1.75, 1.875, 2.0, 2.125, 2.25, 2.375, 2.5]


def calc_primary_size(p):
    """p keys: cc, cyl, rpm (peak torque), wall (mm). Area = RPM / 88200 x CID per cylinder."""
    if p['cc'] <= 0 or p['cyl'] < 1 or p['rpm'] <= 0 or p['wall'] < 0:
        raise ValueError('Fill in displacement, cylinders, peak torque RPM and tube wall to size the primaries.')
    cid_per = p['cc'] / 16.387064 / p['cyl']
    area_in2 = p['rpm'] / 88200.0 * cid_per
    id_in = math.sqrt(area_in2 * 1.273)
    idm = id_in * IN
    od = idm + 2 * p['wall']
    od_in = od / IN
    lo = None
    hi = None
    for s in STD_OD_IN:
        if s <= od_in + 1e-9:
            lo = s
    for s in STD_OD_IN:
        if s >= od_in - 1e-9:
            hi = s
            break

    def std(s):
        return None if s is None else {'od': s * IN, 'id': s * IN - 2 * p['wall']}

    return {'area_in2': area_in2, 'id_in': id_in, 'id': idm, 'od': od, 'lo': std(lo), 'hi': std(hi)}


# ----- header layouts: firing pulses, Tri-Y, stepped primaries -----

ENGINES = {
    'i4': {'name': 'Inline-4  1-3-4-2', 'order': [1, 3, 4, 2], 'banks': [[1, 2, 3, 4]]},
    'i6': {'name': 'Inline-6  1-5-3-6-2-4', 'order': [1, 5, 3, 6, 2, 4], 'banks': [[1, 2, 3, 4, 5, 6]]},
    'sbc': {'name': 'Chevy small-block V8  1-8-4-3-6-5-7-2', 'order': [1, 8, 4, 3, 6, 5, 7, 2],
            'banks': [[1, 3, 5, 7], [2, 4, 6, 8]]},
    'sbf': {'name': 'Ford small-block V8  1-5-4-2-6-3-7-8', 'order': [1, 5, 4, 2, 6, 3, 7, 8],
            'banks': [[1, 2, 3, 4], [5, 6, 7, 8]]},
    'ls': {'name': 'GM LS V8  1-8-7-2-6-5-4-3', 'order': [1, 8, 7, 2, 6, 5, 4, 3],
           'banks': [[1, 3, 5, 7], [2, 4, 6, 8]]},
}
STEP_FR = {'step2': [0.5, 0.5], 'step3': [0.5, 0.25, 0.25]}


def parse_list(s):
    out, cur = [], ''
    for ch in str(s) + ' ':
        if ch.isdigit():
            cur += ch
        elif cur:
            out.append(int(cur))
            cur = ''
    return out


def analyze_group(order, cyls):
    step = CYCLE / len(order)
    pulses = sorted(({'cyl': c, 'ang': order.index(c) * step} for c in cyls), key=lambda q: q['ang'])
    n = len(pulses)
    gaps = [CYCLE if n == 1 else (pulses[(i + 1) % n]['ang'] - q['ang'] + CYCLE) % CYCLE
            for i, q in enumerate(pulses)]
    mn, mx = min(gaps), max(gaps)
    return {'cyls': [q['cyl'] for q in pulses], 'pulses': pulses, 'gaps': gaps,
            'min': mn, 'max': mx, 'even': (mx - mn) < 1e-6}


def best_pairing(pulses):
    options = [[(0, 1), (2, 3)], [(0, 2), (1, 3)], [(0, 3), (1, 2)]]
    best = None
    for m in options:
        pairs = []
        for a, b in m:
            d = abs(pulses[a]['ang'] - pulses[b]['ang'])
            pairs.append({'a': pulses[a]['cyl'], 'b': pulses[b]['cyl'],
                          'gaps': [d, CYCLE - d], 'min': min(d, CYCLE - d)})
        score = min(x['min'] for x in pairs)
        if best is None or score > best['score'] + 1e-9:
            best = {'pairs': pairs, 'score': score}
    return best


def calc_layout(p):
    """p keys: order, banks, mode (bank|alt|all), merge (direct|triy), prof (const|step2|step3),
    rpm, evo, dp, cr, cs, first, yr, inc, cone, port."""
    order = list(p['order'])
    n = len(order)
    if n < 2 or sorted(order) != list(range(1, n + 1)):
        raise ValueError('The firing order must list every cylinder once, numbered 1 to N, '
                         'for example 1-8-4-3-6-5-7-2.')
    if p['rpm'] <= 0 or p['dp'] <= 0 or p['cr'] <= 0 or p['cs'] < 0:
        raise ValueError('Fill in RPM, valve opening, primary diameter and collector ratio with positive numbers.')
    if p['mode'] == 'all':
        groups = [order[:]]
    elif p['mode'] == 'alt':
        if n % 2:
            raise ValueError('Alternating firing-order groups need an even number of cylinders.')
        groups = [order[0::2], order[1::2]]
    else:
        groups = [list(b) for b in p['banks'] if len(b)]
        flat = [c for g in groups for c in g]
        if len(flat) != n or len(set(flat)) != n or any(c not in order for c in flat):
            raise ValueError('The bank lists must cover every cylinder exactly once.')
    ed = 180.0 + p['evo']
    total = (850.0 * ed / p['rpm'] - 3.0) * IN
    if total <= 0:
        raise ValueError('That tuning RPM is too high for the formula: the primary length drops to zero.')
    an = [analyze_group(order, g) for g in groups]
    ng = max(len(a['cyls']) for a in an)
    segs = []
    steps = []
    pairs = None
    d_end = p['dp']
    dsec = None
    if p['merge'] == 'triy':
        if ng != 4 or any(len(a['cyls']) != 4 for a in an):
            raise ValueError('Tri-Y (4-2-1) needs four cylinders on every collector. On a V8 use per-bank or '
                             '180 degree groups. On an inline-4 use all into one.')
        if p['first'] <= 0 or p['yr'] <= 0:
            raise ValueError('Fill in the first section length and the secondary area ratio.')
        if p['first'] >= total:
            raise ValueError('The first section is as long as the whole tuned length. Shorten it to leave '
                             'room for the secondary pipes.')
        dsec = p['dp'] * math.sqrt(2 * p['yr'])
        yc = cone_len(p['dp'], dsec, 15.0)
        sec = total - p['first']
        if sec <= yc:
            raise ValueError('The secondary section is shorter than the Y merge cone. Shorten the first '
                             'section or lower the secondary ratio.')
        dc = dsec * math.sqrt(2 * p['cr'])
        cmerge = cone_len(dsec, dc, 15.0)
        cstraight = p['cs'] * dc
        segs += [('First section', p['first'], p['dp'], p['dp']), ('Y merge', yc, p['dp'], dsec),
                 ('Secondary', sec - yc, dsec, dsec), ('Collector merge', cmerge, dsec, dc),
                 ('Collector straight', cstraight, dc, dc)]
        d_end = dsec
        pairs = [best_pairing(a['pulses']) for a in an]
    else:
        if p['prof'] == 'const':
            segs.append(('Primary', total, p['dp'], p['dp']))
        else:
            fr = STEP_FR[p['prof']]
            if p['inc'] <= 0 or p['cone'] < 0 or p['cone'] >= 180:
                raise ValueError('Step size must be positive and the transition cone angle 0 (a sharp step) up to 179 degrees.')
            sharp = p['cone'] == 0
            x = 0.0
            for i, f in enumerate(fr):
                ln = f * total
                d = p['dp'] + i * p['inc']
                if i == 0:
                    segs.append(('Primary 1', ln, d, d))
                else:
                    if sharp:
                        segs.append(('Primary %d' % (i + 1), ln, d, d))
                    else:
                        c = cone_len(d - p['inc'], d, p['cone'])
                        if ln <= c:
                            raise ValueError('A step section is shorter than its transition cone. Use a smaller step, '
                                             'a wider cone angle or a longer primary.')
                        segs.append(('Step %d cone' % i, c, d - p['inc'], d))
                        segs.append(('Primary %d' % (i + 1), ln - c, d, d))
                    steps.append({'n': i, 'x': x, 'd': d, 'rpm': 850.0 * ed / (x / IN + 3.0)})
                x += ln
            d_end = p['dp'] + (len(fr) - 1) * p['inc']
        dc = d_end * math.sqrt(ng * p['cr'])
        cmerge = cone_len(d_end, dc, 15.0)
        cstraight = p['cs'] * dc
        segs.append(('Collector merge', cmerge, d_end, dc))
        segs.append(('Collector straight', cstraight, dc, dc))
    port = p.get('port', 0.0)
    port = port if port > 0 else 0.0
    if port >= segs[0][1]:
        raise ValueError('The port length is longer than the first primary section. Lower it or '
                         'lengthen the primary.')
    segs[0] = (segs[0][0], segs[0][1] - port, segs[0][2], segs[0][3])
    w = p.get('wall', 0.0)
    w = w if w > 0 else 0.0
    od_end = d_end + 2 * w
    return {
        'ed': ed, 'total': total, 'port': port, 'tube': total - port,
        'rule_dc': None if (p['merge'] == 'triy' or ng != 4) else [1.75 * od_end, 2.0 * od_end],
        'rule_len': 0.5 * total, 'od_end': od_end, 'dc_od': dc + 2 * w,
        'segs': segs, 'groups': an, 'n_coll': len(an), 'ng': ng, 'd_end': d_end, 'dc': dc, 'dsec': dsec,
        'cmerge': cmerge, 'cstraight': cstraight, 'steps': steps, 'pairs': pairs,
        'triy': p['merge'] == 'triy', 'min_gap': min(a['min'] for a in an),
        'all_even': all(a['even'] for a in an),
        'sum_len': sum(s[1] for s in segs), 'half': total / 2.0,
    }


# ----- crossovers: H, X, Z and Y pipes -----

XWIN = (8 * IN, 18 * IN)


def calc_cross(p):
    """p keys: type (h|x|z|y), d, s, pos, ratio, ang, mrg, sout, jang, yratio, yang."""
    d, s = p['d'], p['s']
    if d <= 0 or s <= 0 or p['pos'] < 0:
        raise ValueError('Fill in pipe diameter, pipe spacing and crossover position with positive numbers.')
    if s <= d:
        raise ValueError('Pipe spacing is measured centre to centre, so it must be larger than the pipe diameter.')
    stub = max(1.5 * d, 100.0)
    place = {'pos': p['pos'], 'min': XWIN[0], 'max': XWIN[1], 'ok': XWIN[0] <= p['pos'] <= XWIN[1]}

    def mir(a):
        return [(x, -y) for x, y in a]

    t = p['type']
    if t == 'h':
        if p['ratio'] <= 0 or p['ratio'] > 1.5:
            raise ValueError('Crossover ratio must be above 0 and no more than 1.5 times the main pipe.')
        dc = d * p['ratio']
        lm = 2 * stub + dc
        return {'type': 'h', 'place': place, 'stub': stub, 'dc': dc, 'tube': s - d,
                'area_ratio': p['ratio'] ** 2,
                'strokes': [{'pts': [(0, s / 2), (lm, s / 2)], 'd': d},
                            {'pts': [(0, -s / 2), (lm, -s / 2)], 'd': d},
                            {'pts': [(lm / 2, s / 2), (lm / 2, -s / 2)], 'd': dc}]}
    if t == 'x':
        if not (0 < p['ang'] < 80) or p['mrg'] < 0:
            raise ValueError('Crossing angle must be between 0 and 80 degrees and merge length cannot be negative.')
        lc = (s / 2) / math.tan(math.radians(p['ang']))
        lm = p['mrg'] * d
        ln = 2 * lc + lm
        dm = d * math.sqrt(2)
        a = [(0, s / 2), (stub, s / 2), (stub + lc, 0), (stub + lc + lm, 0),
             (stub + ln, -s / 2), (2 * stub + ln, -s / 2)]
        return {'type': 'x', 'place': place, 'stub': stub, 'lc': lc, 'lm': lm, 'len': ln, 'dm': dm,
                'strokes': [{'pts': a, 'd': d}, {'pts': mir(a), 'd': d},
                            {'pts': [(stub + lc, 0), (stub + lc + lm, 0)], 'd': dm}]}
    if t == 'z':
        if p['sout'] <= 0 or not (0 < p['jang'] < 85):
            raise ValueError('Outlet spacing must be positive and the jog angle between 0 and 85 degrees.')
        lat = (s + p['sout']) / 2
        lj = lat / math.tan(math.radians(p['jang']))
        cx = lj * s / (s + p['sout'])
        a = [(0, s / 2), (stub, s / 2), (stub + lj, -p['sout'] / 2), (2 * stub + lj, -p['sout'] / 2)]
        return {'type': 'z', 'place': place, 'stub': stub, 'lat': lat, 'lj': lj, 'cx': cx,
                'strokes': [{'pts': a, 'd': d}, {'pts': mir(a), 'd': d}]}
    if p['yratio'] <= 0 or not (0 < p['yang'] < 80):
        raise ValueError('Outlet area ratio must be positive and the merge angle between 0 and 80 degrees.')
    lc = (s / 2) / math.tan(math.radians(p['yang']))
    dy = d * math.sqrt(2 * p['yratio'])
    a = [(0, s / 2), (stub, s / 2), (stub + lc, 0)]
    return {'type': 'y', 'place': None, 'stub': stub, 'lc': lc, 'dy': dy,
            'strokes': [{'pts': a, 'd': d}, {'pts': mir(a), 'd': d},
                        {'pts': [(stub + lc, 0), (2 * stub + lc, 0)], 'd': dy}]}


# --------------------------------------------------------------------------
# Dialog field tables: (id, label, kind, default, (min, max, step))
# kind: len = mm, deg = degrees, num = plain number, int = integer
# --------------------------------------------------------------------------

FOUR_FIELDS = [
    ('f_n', 'Primaries per collector', 'int', 4, (2, 6, 1)),
    ('f_rpm', 'Tuning RPM', 'num', 6500, (500, 20000, 100)),
    ('f_evo', 'Exhaust valve opens (deg BBDC)', 'num', 60, (0, 120, 1)),
    ('f_egt', 'Exhaust gas temp (deg C)', 'num', 704.444, (100, 1000, 10)),
    ('f_disp', 'Engine displacement (cc)', 'num', 5735.5, (50, 20000, 100)),
    ('f_cyl', 'Engine cylinders', 'int', 8, (1, 16, 1)),
    ('f_trq', 'Peak torque RPM', 'num', 5000, (500, 20000, 100)),
    ('f_port', 'Exhaust port length, valve to flange', 'len', 0, None),
    ('f_dp', 'Primary inside diameter', 'len', 44.45, None),
    ('f_cr', 'Collector area / all primaries', 'num', 0.8, (0.3, 2.0, 0.05)),
    ('f_cs', 'Collector straight length (x ID)', 'num', 1.5, (0, 6, 0.25)),
    ('f_ang', 'Megaphone included angle', 'deg', 8, None),
    ('f_er', 'Megaphone exit area / inlet area', 'num', 2.0, (1.0, 6.0, 0.1)),
]
TWO_FIELDS = [
    ('t_rpm', 'Peak power RPM', 'num', 8000, (500, 20000, 100)),
    ('t_ed', 'Exhaust port duration (deg)', 'num', 190, (100, 260, 1)),
    ('t_egt', 'Effective gas temp in the pipe (deg C)', 'num', 396.111, (100, 1000, 5)),
    ('t_dh', 'Header inside diameter', 'len', 41.275, None),
    ('t_br', 'Belly / header diameter', 'num', 2.6, (1.2, 5.0, 0.1)),
    ('t_da', 'Diffuser included angle', 'deg', 8, None),
    ('t_bl', 'Belly straight length (x belly ID)', 'num', 0.5, (0, 3, 0.1)),
    ('t_ba', 'Baffle included angle', 'deg', 20, None),
    ('t_sr', 'Stinger / header diameter', 'num', 0.61, (0.3, 1.0, 0.01)),
    ('t_rp', 'Reflection point along baffle (%)', 'num', 50, (0, 100, 5)),
]
HEAD_FIELDS = [
    ('h_rpm', 'Tuning RPM', 'num', 6500, (500, 20000, 100)),
    ('h_evo', 'Exhaust valve opens (deg BBDC)', 'num', 60, (0, 120, 1)),
    ('h_disp', 'Engine displacement (cc)', 'num', 5735.5, (50, 20000, 100)),
    ('h_trq', 'Peak torque RPM', 'num', 5000, (500, 20000, 100)),
    ('h_port', 'Exhaust port length, valve to flange', 'len', 0, None),
    ('h_dp', 'Primary inside diameter', 'len', 44.45, None),
    ('h_cr', 'Collector area / its primaries', 'num', 0.8, (0.3, 2.0, 0.05)),
    ('h_cs', 'Collector straight length (x ID)', 'num', 1.5, (0, 6, 0.25)),
    ('h_first', 'Tri-Y first section, valve to Y', 'len', 368.3, None),
    ('h_yr', 'Tri-Y secondary area / two primaries', 'num', 0.8, (0.3, 2.0, 0.05)),
    ('h_inc', 'Step size', 'len', 3.175, None),
    ('h_cone', 'Step transition cone (0 = sharp step)', 'deg', 0, None),
]
CROSS_FIELDS = [
    ('c_d', 'Main pipe inside diameter', 'len', 63.5, None),
    ('c_s', 'Pipe spacing, centre to centre', 'len', 152.4, None),
    ('c_pos', 'Collector ends to crossover', 'len', 330.2, None),
    ('c_ratio', 'H-pipe diameter / main pipe', 'num', 0.8, (0.2, 1.5, 0.05)),
    ('c_ang', 'X-pipe crossing angle of each pipe', 'deg', 20, None),
    ('c_mrg', 'X-pipe merged length (x ID)', 'num', 1.0, (0, 6, 0.25)),
    ('c_sout', 'Z-pipe outlet spacing, centre to centre', 'len', 101.6, None),
    ('c_jang', 'Z-pipe jog angle', 'deg', 30, None),
    ('c_yr', 'Y-pipe outlet area / both inlets', 'num', 0.8, (0.3, 2.0, 0.05)),
    ('c_yang', 'Y-pipe merge angle of each pipe', 'deg', 15, None),
]
FIELDS_BY_MODE = {MODE_FOUR: FOUR_FIELDS, MODE_TWO: TWO_FIELDS, MODE_HEAD: HEAD_FIELDS, MODE_CROSS: CROSS_FIELDS}

ENG_OPTIONS = [(k, v['name']) for k, v in ENGINES.items()] + [('custom', 'Custom firing order')]
GRP_OPTIONS = [('bank', 'Per bank (V) or one collector (inline)'),
               ('alt', '180 deg: alternate cylinders in firing order'),
               ('all', 'All cylinders into one (8-1, 6-1, 4-1)')]
MERGE_OPTIONS = [('direct', 'Direct to collector (4-1)'), ('triy', 'Tri-Y (4-2-1)')]
PROF_OPTIONS = [('const', 'Constant diameter'), ('step2', 'Stepped, 2 sections'), ('step3', 'Stepped, 3 sections')]
SIZE_OPTIONS = [('mine', 'Use my primary ID'), ('exact', 'Calculate from engine, exact'),
                ('lo', 'Calculate, next tube size down'), ('hi', 'Calculate, next tube size up')]
XTYPE_OPTIONS = [('h', 'H-pipe'), ('x', 'X-pipe'), ('z', 'Z-pipe (compact offset crossover)'), ('y', 'Y-pipe (2 into 1)')]
PLACE_OPTIONS = [('collector', 'Right behind the collector'), ('tail', 'At the open tailpipe end')]

PREFIX = {'f_': 'ex4_', 't_': 'ex2_', 'h_': 'exh_', 'c_': 'exc_'}


def param_name(field_id):
    return PREFIX[field_id[:2]] + field_id[2:]


# --------------------------------------------------------------------------
# User parameters
# --------------------------------------------------------------------------

def _design():
    return adsk.fusion.Design.cast(_app.activeProduct)


def read_saved(design, field):
    """Return the saved user-parameter value in dialog units, or the default."""
    fid, _label, kind, default, _rng = field
    try:
        p = design.userParameters.itemByName(param_name(fid)) if design else None
        if not p:
            return default
        v = p.value
        if kind == 'len':
            return v * 10.0
        if kind == 'deg':
            return math.degrees(v)
        return v
    except Exception:
        return default


def write_param(design, name, value, kind, comment=''):
    if kind == 'len':
        expr, unit = '%.4f mm' % value, 'mm'
    elif kind == 'deg':
        expr, unit = '%.4f deg' % value, 'deg'
    else:
        expr, unit = '%.6g' % value, ''
    existing = design.userParameters.itemByName(name)
    if existing:
        existing.expression = expr
    else:
        design.userParameters.add(name, adsk.core.ValueInput.createByString(expr), unit, comment)


def store_parameters(design, fields, values, results, wall):
    for fid, label, kind, _d, _r in fields:
        write_param(design, param_name(fid), values[fid], kind, label)
    write_param(design, 'ex_wall', wall, 'len', 'Exhaust Tuner wall thickness')
    for name, mm in results:
        write_param(design, name, mm, 'len', 'Exhaust Tuner result (not live)')


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def _wall_polygon(segs, x0, wall):
    """Closed outline of the pipe wall for consecutive segments, in cm. Y is radius."""
    outer, inner = [], []
    x = x0
    for i, (_n, ln, d0, d1) in enumerate(segs):
        if i == 0 or abs(d0 - segs[i - 1][3]) > 1e-9:   # start, or a sharp step in diameter
            outer.append((x, d0 / 2.0 + wall))
            inner.append((x, d0 / 2.0))
        x += ln
        outer.append((x, d1 / 2.0 + wall))
        inner.append((x, d1 / 2.0))
    pts = outer + list(reversed(inner))
    return [(px / 10.0, py / 10.0) for px, py in pts]   # mm -> cm


def _revolve_group(comp, name, segs, x0, wall):
    pts = _wall_polygon(segs, x0, wall)
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = name
    lines = sk.sketchCurves.sketchLines
    P = adsk.core.Point3D.create
    clean = []
    for q in pts:
        if not clean or abs(q[0] - clean[-1][0]) > 1e-9 or abs(q[1] - clean[-1][1]) > 1e-9:
            clean.append(q)
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-9 and abs(clean[0][1] - clean[-1][1]) < 1e-9:
        clean.pop()
    # chain each line from the previous line's end point so the outline is one closed, connected loop
    first_line = prev = None
    for i, q in enumerate(clean):
        nxt = clean[(i + 1) % len(clean)]
        start = prev.endSketchPoint if prev is not None else P(q[0], q[1], 0)
        end = first_line.startSketchPoint if (i == len(clean) - 1 and first_line is not None) else P(nxt[0], nxt[1], 0)
        ln = lines.addByTwoPoints(start, end)
        if first_line is None:
            first_line = ln
        prev = ln
    xs = [p[0] for p in pts]
    axis = lines.addByTwoPoints(P(min(xs), 0, 0), P(max(xs), 0, 0))
    axis.isConstruction = True

    if sk.profiles.count == 0:
        raise RuntimeError('Sketch "%s" made no closed profile.' % name)
    if sk.profiles.count == 1:
        profile = sk.profiles.item(0)
    else:
        profile = adsk.core.ObjectCollection.create()
        for i in range(sk.profiles.count):
            profile.add(sk.profiles.item(i))
    revs = comp.features.revolveFeatures
    rin = revs.createInput(profile, axis, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    rin.setAngleExtent(False, adsk.core.ValueInput.createByReal(2 * math.pi))
    feat = revs.add(rin)
    try:
        feat.bodies.item(0).name = name
    except Exception:
        pass
    return feat


def build_pipe(design, title, segs, wall, split):
    """Revolve the segments (mm) as hollow bodies in a new component. Returns the component."""
    segs = [s for s in segs if s[1] > 1e-6]
    if not segs:
        raise ValueError('Nothing to build.')
    comp = cadtools.new_component(design, title)
    if split:
        x = 0.0
        for name, ln, d0, d1 in segs:
            _revolve_group(comp, name, [(name, ln, d0, d1)], x, wall)
            x += ln
    else:
        _revolve_group(comp, title + ' body', segs, 0.0, wall)
    return comp


def build_centerlines(design, title, strokes):
    """Draw each stroke as a polyline of sketch lines (mm -> cm) in a new component."""
    comp = cadtools.new_component(design, title)
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = title + ' centerlines'
    lines = sk.sketchCurves.sketchLines
    P = adsk.core.Point3D.create
    for st in strokes:
        pts = st['pts']
        for a, b in zip(pts[:-1], pts[1:]):
            if abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9:
                continue
            lines.addByTwoPoints(P(a[0] / 10.0, a[1] / 10.0, 0), P(b[0] / 10.0, b[1] / 10.0, 0))
    return comp


# --------------------------------------------------------------------------
# Command dialog
# --------------------------------------------------------------------------

def _fmt(mm):
    return '%.2f in (%.1f mm)' % (mm / IN, mm)


def _add_field(inputs, field, value):
    fid, label, kind, _default, rng = field
    if kind == 'len':
        return inputs.addValueInput(fid, label, 'mm', adsk.core.ValueInput.createByReal(value / 10.0))
    if kind == 'deg':
        return inputs.addValueInput(fid, label, 'deg', adsk.core.ValueInput.createByReal(math.radians(value)))
    lo, hi, step = rng
    if kind == 'int':
        return inputs.addIntegerSpinnerCommandInput(fid, label, int(lo), int(hi), int(step), int(round(value)))
    return inputs.addFloatSpinnerCommandInput(fid, label, '', lo, hi, step, value)


def _read_field(inputs, field):
    fid, _label, kind, _d, _r = field
    inp = inputs.itemById(fid)
    if kind == 'len':
        return inp.value * 10.0          # cm -> mm
    if kind == 'deg':
        return math.degrees(inp.value)   # rad -> deg
    return float(inp.value)


def _add_dropdown(inputs, fid, label, options, default_key=None):
    dd = inputs.addDropDownCommandInput(fid, label, adsk.core.DropDownStyles.TextListDropDownStyle)
    for k, name in options:
        dd.listItems.add(name, k == (default_key or options[0][0]))
    return dd


def _key(inputs, fid, options):
    name = inputs.itemById(fid).selectedItem.name
    for k, n in options:
        if n == name:
            return k
    return options[0][0]


def _mode(inputs):
    return inputs.itemById('mode').selectedItem.name


def _show(inputs, fid, on):
    inputs.itemById(fid).isVisible = bool(on)


def _apply_visibility(inputs):
    mode = _mode(inputs)
    four, two, head, cross = (mode == MODE_FOUR, mode == MODE_TWO, mode == MODE_HEAD, mode == MODE_CROSS)
    for fid, *_ in FOUR_FIELDS:
        _show(inputs, fid, four)
    _show(inputs, 'f_size', four)
    _show(inputs, 'f_place', four)
    _show(inputs, 'f_tail', four and _key(inputs, 'f_place', PLACE_OPTIONS) == 'tail')
    for fid, *_ in TWO_FIELDS:
        _show(inputs, fid, two)

    merge = _key(inputs, 'h_merge', MERGE_OPTIONS)
    prof = _key(inputs, 'h_prof', PROF_OPTIONS)
    stepped = head and merge == 'direct' and prof != 'const'
    for fid in ('h_eng', 'h_grp', 'h_merge', 'h_prof', 'h_size'):
        _show(inputs, fid, head)
    custom = head and _key(inputs, 'h_eng', ENG_OPTIONS) == 'custom'
    _show(inputs, 'h_order', custom)
    _show(inputs, 'h_bank', custom)
    for fid, *_ in HEAD_FIELDS:
        on = head
        if fid in ('h_first', 'h_yr'):
            on = head and merge == 'triy'
        elif fid in ('h_inc', 'h_cone'):
            on = stepped
        _show(inputs, fid, on)

    ctype = _key(inputs, 'c_type', XTYPE_OPTIONS)
    _show(inputs, 'c_type', cross)
    only = {'c_pos': 'hxz', 'c_ratio': 'h', 'c_ang': 'x', 'c_mrg': 'x', 'c_sout': 'z', 'c_jang': 'z',
            'c_yr': 'y', 'c_yang': 'y'}
    for fid, *_ in CROSS_FIELDS:
        _show(inputs, fid, cross and (fid not in only or ctype in only[fid]))


def create_dialog(inputs):
    design = _design()
    mode = inputs.addDropDownCommandInput('mode', 'Type', adsk.core.DropDownStyles.TextListDropDownStyle)
    for i, m in enumerate(MODES):
        mode.listItems.add(m, i == 0)

    for f in FOUR_FIELDS:
        if f[0] == 'f_dp':
            _add_dropdown(inputs, 'f_size', 'Primary size', SIZE_OPTIONS)
        _add_field(inputs, f, read_saved(design, f))
    _add_dropdown(inputs, 'f_place', 'Megaphone placement', PLACE_OPTIONS)
    inputs.addValueInput('f_tail', 'Collector to tailpipe end', 'mm', adsk.core.ValueInput.createByReal(100.0))

    for f in TWO_FIELDS:
        _add_field(inputs, f, read_saved(design, f))

    _add_dropdown(inputs, 'h_eng', 'Engine and firing order', ENG_OPTIONS, 'sbc')
    inputs.addStringValueInput('h_order', 'Custom firing order', '1-8-4-3-6-5-7-2')
    inputs.addStringValueInput('h_bank', 'Custom: cylinders on bank A (blank = one bank)', '')
    _add_dropdown(inputs, 'h_grp', 'Which cylinders share a collector', GRP_OPTIONS)
    _add_dropdown(inputs, 'h_merge', 'Merge', MERGE_OPTIONS)
    _add_dropdown(inputs, 'h_prof', 'Primary profile', PROF_OPTIONS)
    for f in HEAD_FIELDS:
        if f[0] == 'h_dp':
            _add_dropdown(inputs, 'h_size', 'Primary size', SIZE_OPTIONS)
        _add_field(inputs, f, read_saved(design, f))

    _add_dropdown(inputs, 'c_type', 'Crossover type', XTYPE_OPTIONS)
    for f in CROSS_FIELDS:
        _add_field(inputs, f, read_saved(design, f))

    wall_saved = 1.651
    try:
        p = design.userParameters.itemByName('ex_wall') if design else None
        if p and p.value > 0:
            wall_saved = p.value * 10.0
    except Exception:
        pass
    inputs.addValueInput('o_wall', 'Wall thickness (also used to size tubes)', 'mm',
                         adsk.core.ValueInput.createByReal(wall_saved / 10.0))
    inputs.addBoolValueInput('o_split', 'One body per section', True, '', False)
    inputs.addBoolValueInput('o_params', 'Save values as user parameters', True, '', True)
    _apply_visibility(inputs)


def _resolve_dp(inputs, size_id, cc, cyl, rpm, wall, dp_mine):
    """Return (primary ID in mm, size result or None)."""
    key = _key(inputs, size_id, SIZE_OPTIONS)
    if key == 'mine':
        return dp_mine, None
    s = calc_primary_size({'cc': cc, 'cyl': cyl, 'rpm': rpm, 'wall': wall})
    lo = s['lo'] or s['hi']
    hi = s['hi'] or s['lo']
    return {'exact': s['id'], 'lo': lo['id'], 'hi': hi['id']}[key], s


def _size_text(s, dp):
    if not s:
        return ''
    out = '\nPrimary size from the engine: %s ID calculated (%.2f sq in). Building with %s ID.' % (
        _fmt(s['id']), s['area_in2'], _fmt(dp))
    if s['lo']:
        out += '\n  Next tube size down: %.3f in OD, %.3f in ID' % (s['lo']['od'] / IN, s['lo']['id'] / IN)
    if s['hi']:
        out += '\n  Next tube size up: %.3f in OD, %.3f in ID' % (s['hi']['od'] / IN, s['hi']['id'] / IN)
    return out + '\n'


def run_command(inputs):
    design = _design()
    if not design:
        _ui.messageBox('Open a Design document first (the active document is not a design).')
        return
    mode = _mode(inputs)
    wall = inputs.itemById('o_wall').value * 10.0
    if wall <= 0:
        raise ValueError('Wall thickness must be positive.')
    split = inputs.itemById('o_split').value
    save = inputs.itemById('o_params').value

    if mode == MODE_FOUR:
        vals = {f[0]: _read_field(inputs, f) for f in FOUR_FIELDS}
        place = _key(inputs, 'f_place', PLACE_OPTIONS)
        dp, size = _resolve_dp(inputs, 'f_size', vals['f_disp'], int(round(vals['f_cyl'])), vals['f_trq'],
                               wall, vals['f_dp'])
        vals['f_dp'] = dp
        p = {'n': int(round(vals['f_n'])), 'rpm': vals['f_rpm'], 'evo': vals['f_evo'], 'egt': vals['f_egt'],
             'dp': dp, 'cr': vals['f_cr'], 'cs': vals['f_cs'], 'place': place,
             'tail': inputs.itemById('f_tail').value * 10.0, 'ang': vals['f_ang'], 'er': vals['f_er'],
             'port': vals['f_port']}
        r = calc_four(p)
        build_pipe(design, 'Header %d-1 + megaphone' % p['n'], r['segs'], wall, split)
        if save:
            store_parameters(design, FOUR_FIELDS, vals, [
                ('ex4_primary_len', r['lp']), ('ex4_primary_tube', r['tube']), ('ex4_collector_id', r['dc']),
                ('ex4_collector_merge_len', r['lmerge']), ('ex4_collector_straight_len', r['lstr']),
                ('ex4_mega_start', r['m_start']), ('ex4_mega_exit_id', r['dex']), ('ex4_mega_len', r['lm'])], wall)
        where = 'at the open tailpipe end' if place == 'tail' else 'right behind the collector'
        msg = ('4-STROKE HEADER AND MEGAPHONE\n%s\n'
               'Tuned length, valve to collector: %s\n%s'
               'Primary ID: %s\nCollector ID: %s\nMerge cone: %s\nCollector straight: %s\n'
               'Megaphone (%s) starts %s from the valve\nMegaphone exit ID: %s\nMegaphone length: %s\n'
               'Pulse round trip: %.2f ms\n\n'
               'The bodies run straight along X from the valve. Bend or sweep them to fit.') % (
            _size_text(size, dp), _fmt(r['lp']),
            ('Port length: %s\nPrimary tube, flange to collector: %s\n' % (_fmt(r['port']), _fmt(r['tube']))
             if r['port'] > 0 else ''),
            _fmt(dp), _fmt(r['dc']), _fmt(r['lmerge']), _fmt(r['lstr']), where, _fmt(r['m_start']),
            _fmt(r['dex']), _fmt(r['lm']), r['round_trip_ms'])

    elif mode == MODE_TWO:
        vals = {f[0]: _read_field(inputs, f) for f in TWO_FIELDS}
        p = {k[2:]: v for k, v in vals.items()}
        r = calc_two(p)
        build_pipe(design, 'Expansion chamber', r['segs'], wall, split)
        if save:
            store_parameters(design, TWO_FIELDS, vals, [
                ('ex2_tuned_len', r['tuned']), ('ex2_header_len', r['header']),
                ('ex2_diffuser_len', r['ld']), ('ex2_belly_id', r['db']),
                ('ex2_belly_len', r['lbel']), ('ex2_baffle_len', r['lb']),
                ('ex2_stinger_id', r['ds']), ('ex2_stinger_len', r['lst'])], wall)
        msg = ('2-STROKE EXPANSION CHAMBER\n\n'
               'Tuned length: %s\nHeader: %s\nDiffuser: %s\nBelly: %s at %s ID\nBaffle cone: %s\n'
               'Stinger: %s at %s ID\nTotal: %s') % (
            _fmt(r['tuned']), _fmt(r['header']), _fmt(r['ld']), _fmt(r['lbel']), _fmt(r['db']),
            _fmt(r['lb']), _fmt(r['lst']), _fmt(r['ds']), _fmt(r['total']))

    elif mode == MODE_HEAD:
        vals = {f[0]: _read_field(inputs, f) for f in HEAD_FIELDS}
        eng = _key(inputs, 'h_eng', ENG_OPTIONS)
        if eng == 'custom':
            order = parse_list(inputs.itemById('h_order').value)
            a = parse_list(inputs.itemById('h_bank').value)
            banks = [a, [c for c in order if c not in a]] if a else [order[:]]
            ename = 'Custom ' + '-'.join(str(c) for c in order)
        else:
            order, banks, ename = ENGINES[eng]['order'], ENGINES[eng]['banks'], ENGINES[eng]['name']
        merge = _key(inputs, 'h_merge', MERGE_OPTIONS)
        prof = 'const' if merge == 'triy' else _key(inputs, 'h_prof', PROF_OPTIONS)
        grp = _key(inputs, 'h_grp', GRP_OPTIONS)
        dp, size = _resolve_dp(inputs, 'h_size', vals['h_disp'], len(order), vals['h_trq'], wall, vals['h_dp'])
        vals['h_dp'] = dp
        p = {'order': order, 'banks': banks, 'mode': grp, 'merge': merge, 'prof': prof,
             'rpm': vals['h_rpm'], 'evo': vals['h_evo'], 'dp': dp, 'cr': vals['h_cr'], 'cs': vals['h_cs'],
             'first': vals['h_first'], 'yr': vals['h_yr'], 'inc': vals['h_inc'], 'cone': vals['h_cone'],
             'port': vals['h_port'], 'wall': wall}
        r = calc_layout(p)
        build_pipe(design, 'Header runner', r['segs'], wall, split)
        if save:
            store_parameters(design, HEAD_FIELDS, vals, [
                ('exh_tuned_len', r['total']), ('exh_runner_tube', r['tube']), ('exh_collector_id', r['dc'])], wall)
        lab = lambda i: chr(65 + i)
        coll = '\n'.join('  %s: cylinders %s, gaps %s deg (%s)' % (
            lab(i), '-'.join(str(q['cyl']) for q in g['pulses']),
            '/'.join(str(int(round(x))) for x in g['gaps']), 'even' if g['even'] else 'uneven')
            for i, g in enumerate(r['groups']))
        secs = '\n'.join('  %s: %s%s' % (n, _fmt(ln), '' if abs(d0 - d1) < 1e-6 else ' (%.1f to %.1f mm ID)' % (d0, d1))
                         for n, ln, d0, d1 in r['segs'])
        steps = ''.join('\n  Step %d starts %s from the valve at %.1f mm ID, timed for about %d RPM' % (
            s['n'], _fmt(s['x']), s['d'], round(s['rpm'])) for s in r['steps'])
        pairs = ''
        if r['pairs']:
            pairs = '\nTri-Y pairs:' + ''.join('\n  %s: %d + %d (gaps %d/%d deg)' % (
                lab(i), x['a'], x['b'], round(x['gaps'][0]), round(x['gaps'][1]))
                for i, q in enumerate(r['pairs']) for x in q['pairs'])
        msg = ('HEADER LAYOUT: %s\n%s\n'
               'Tuned length, valve to collector: %s\n%s'
               'Runner tube, flange to collector: %s (target for every cylinder)\n'
               'Primary ID: %s\nCollector ID: %s, %d collector%s\n\nPulse spacing:\n%s%s\n\nSections along one runner:\n%s%s\n\n'
               'Total, flange to collector exit: %s') % (
            ename, _size_text(size, dp), _fmt(r['total']),
            ('Port length: %s\n' % _fmt(r['port']) if r['port'] > 0 else ''),
            _fmt(r['tube']), _fmt(dp), _fmt(r['dc']), r['n_coll'], '' if r['n_coll'] == 1 else 's',
            coll, pairs, secs, steps, _fmt(r['sum_len']))
        if r['rule_dc']:
            msg += ('\nRule of thumb collector size, 1.75 to 2.00 x primary OD: %s to %s. Yours: %s OD.' %
                    (_fmt(r['rule_dc'][0]), _fmt(r['rule_dc'][1]), _fmt(r['dc_od'])))
        if not r['all_even']:
            msg += '\n\nThe closest pulses on a collector are only %d deg apart. The 180 deg grouping gives even spacing.' % int(round(r['min_gap']))

    else:
        vals = {f[0]: _read_field(inputs, f) for f in CROSS_FIELDS}
        ctype = _key(inputs, 'c_type', XTYPE_OPTIONS)
        p = {'type': ctype, 'd': vals['c_d'], 's': vals['c_s'], 'pos': vals['c_pos'], 'ratio': vals['c_ratio'],
             'ang': vals['c_ang'], 'mrg': vals['c_mrg'], 'sout': vals['c_sout'], 'jang': vals['c_jang'],
             'yratio': vals['c_yr'], 'yang': vals['c_yang']}
        r = calc_cross(p)
        names = dict(XTYPE_OPTIONS)
        build_centerlines(design, 'Crossover ' + names[ctype], r['strokes'])
        results = []
        if ctype == 'h':
            results = [('exc_crossover_id', r['dc']), ('exc_tube_len', r['tube'])]
            body = 'Crossover ID: %s\nTube length between the pipe walls: %s' % (_fmt(r['dc']), _fmt(r['tube']))
        elif ctype == 'x':
            results = [('exc_total_len', r['len']), ('exc_merged_id', r['dm'])]
            body = ('Total length: %s\nConverging run each side: %s\nMerged section: %s at %s equivalent ID' %
                    (_fmt(r['len']), _fmt(r['lc']), _fmt(r['lm']), _fmt(r['dm'])))
        elif ctype == 'z':
            results = [('exc_jog_len', r['lj']), ('exc_sideways', r['lat'])]
            body = ('Jog length: %s\nEach pipe moves sideways: %s\nPipes cross after: %s\n'
                    'Packaging geometry only. No published sizing rule exists for Z-pipes.' %
                    (_fmt(r['lj']), _fmt(r['lat']), _fmt(r['cx'])))
        else:
            results = [('exc_outlet_id', r['dy']), ('exc_converge_len', r['lc'])]
            body = 'Outlet ID: %s\nConverging run each pipe: %s' % (_fmt(r['dy']), _fmt(r['lc']))
        if save:
            store_parameters(design, CROSS_FIELDS, vals, results, wall)
        pl = ''
        if r['place']:
            pl = '\nPosition %s from the collector ends (%s the 8 to 18 in window).' % (
                _fmt(r['place']['pos']), 'inside' if r['place']['ok'] else 'outside')
        msg = ('CROSSOVER: %s\n\n%s%s\n\nThe sketch holds the pipe centerlines. Sweep a circle of the main pipe ID '
               'along them, or use them to place your own tube.') % (names[ctype], body, pl)

    _ui.messageBox(msg, CMD_NAME)


class _InputChanged(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            if args.input.id in ('mode', 'f_place', 'h_eng', 'h_merge', 'h_prof', 'c_type'):
                _apply_visibility(args.inputs)
        except Exception:
            _ui.messageBox('Input change failed:\n%s' % traceback.format_exc())


class _Execute(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            run_command(args.command.commandInputs)
        except ValueError as e:
            _ui.messageBox(str(e), CMD_NAME)
        except Exception:
            _ui.messageBox('Exhaust Tuner failed:\n%s' % traceback.format_exc())


class _Created(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            cmd = args.command
            create_dialog(cmd.commandInputs)
            h1, h2 = _InputChanged(), _Execute()
            cmd.inputChanged.add(h1)
            cmd.execute.add(h2)
            _handlers.extend([h1, h2])
        except Exception:
            _ui.messageBox('Could not open the dialog:\n%s' % traceback.format_exc())


# --------------------------------------------------------------------------
# Add-in entry points
# --------------------------------------------------------------------------

def run(context):
    global _app, _ui
    try:
        _app = adsk.core.Application.get()
        _ui = _app.userInterface
        old = _ui.commandDefinitions.itemById(CMD_ID)
        if old:
            old.deleteMe()
        cmd_def = _ui.commandDefinitions.addButtonDefinition(CMD_ID, CMD_NAME, CMD_TIP, '')
        h = _Created()
        cmd_def.commandCreated.add(h)
        _handlers.append(h)
        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        ctrl = panel.controls.itemById(CMD_ID)
        if not ctrl:
            panel.controls.addCommand(cmd_def)
        cadtools.start(_app, _ui, _handlers, PANEL_ID, build_pipe, build_centerlines)
    except Exception:
        if _ui:
            _ui.messageBox('Exhaust Tuner failed to start:\n%s' % traceback.format_exc())


def stop(context):
    try:
        panel = _ui.allToolbarPanels.itemById(PANEL_ID)
        ctrl = panel.controls.itemById(CMD_ID) if panel else None
        if ctrl:
            ctrl.deleteMe()
        cmd_def = _ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()
        cadtools.stop(_ui, PANEL_ID)
        _handlers.clear()
    except Exception:
        if _ui:
            _ui.messageBox('Exhaust Tuner failed to stop:\n%s' % traceback.format_exc())
