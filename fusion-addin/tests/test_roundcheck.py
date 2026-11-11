"""roundcheck.py, the roundness check run on every STL the add-in writes (and from the command line), on meshes made
analytically here:
  - a straight 100 mm tube on a tilted, offset axis (the axis found from the mesh), a 4 in to 3 in cone taper, a
    quintic (S-shaped) taper and a tube with two bends (sliced square to its centreline), all meshed finely: round,
  - the same cone with three 0.2 mm lobes, and meshed with 24 facets: both caught, with the deviation and chord error
    they really have, and the summary says what to do,
  - the facet arithmetic (n >= pi / acos(1 - s / r)), the Fusion settings it gives, what the 'high' preset gives,
  - binary and ASCII STL read the same, the axis given or found the same, a skip range, an open mesh not passed,
  - the command line: exit codes and both units in the words.
   python3 tests/test_roundcheck.py"""
import math
import os
import struct
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import roundcheck as RC   # noqa: E402

FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


add = lambda a, b: tuple(x + y for x, y in zip(a, b))
sub = lambda a, b: tuple(x - y for x, y in zip(a, b))
mul = lambda a, s: tuple(x * s for x in a)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))
cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
unit = lambda a: mul(a, 1.0 / math.sqrt(dot(a, a)))


# ------------------------------------------------------------------------------------------------ test meshes

def tube_mesh(frames, r_out, r_in, n_th):
    """A closed tube: frames [(s, p, t, u)] along the middle (u square to t), r_out(s, th) and r_in(s, th) its two
    radii; n_th points round each ring; the two ends closed by flat rings. Returns (vertices, triangles)."""
    V, T = [], []
    rings_o, rings_i = [], []
    for s, p, t, u in frames:
        w = cross(t, u)
        for rings, rf in ((rings_o, r_out), (rings_i, r_in)):
            row = []
            for j in range(n_th):
                th = 2 * math.pi * j / n_th
                r = rf(s, th)
                row.append(len(V))
                V.append(add(p, add(mul(u, r * math.cos(th)), mul(w, r * math.sin(th)))))
            rings.append(row)
    for rings in (rings_o, rings_i):
        for a, b in zip(rings[:-1], rings[1:]):
            for j in range(n_th):
                k = (j + 1) % n_th
                T += [(a[j], a[k], b[k]), (a[j], b[k], b[j])]
    for e in (0, -1):
        o, i = rings_o[e], rings_i[e]
        for j in range(n_th):
            k = (j + 1) % n_th
            T += [(o[j], o[k], i[k]), (o[j], i[k], i[j])]
    return V, T


def straight_frames(p0, d, L, n_rings=2):
    d = unit(d)
    u = unit(cross(d, (0.0, 0.0, 1.0)) if abs(d[2]) < 0.9 else cross(d, (1.0, 0.0, 0.0)))
    return [(L * i / (n_rings - 1), add(p0, mul(d, L * i / (n_rings - 1))), d, u) for i in range(n_rings)]


def path_frames(segs, dphi_deg=1.5, ds_line=None):
    """Frames along lines and planar arcs: ('line', L) and ('arc', R, deg, side) where side is +1 / -1 (which way it
    turns in the start plane); starts at the origin heading +x, u = +z the bend-plane normal (bends turn about u)."""
    p, t, u = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)
    s = 0.0
    out = [(s, p, t, u)]
    cl = [p]
    for sg in segs:
        if sg[0] == 'line':
            L = sg[1]
            n = 1 if ds_line is None else max(1, int(L / ds_line))
            for i in range(1, n + 1):
                q = add(p, mul(t, L * i / n))
                out.append((s + L * i / n, q, t, u))
                cl.append(q)
            p, s = add(p, mul(t, L)), s + L
        else:
            R, deg, side = sg[1], sg[2], sg[3]
            n_ = mul(cross(u, t), side)               # toward the bend centre
            c = add(p, mul(n_, R))
            m = max(2, int(math.ceil(deg / dphi_deg)))
            p0, t0 = p, t
            for i in range(1, m + 1):
                ph = math.radians(deg) * i / m
                q = add(c, add(mul(n_, -R * math.cos(ph)), mul(t0, R * math.sin(ph))))
                tq = unit(add(mul(n_, math.sin(ph)), mul(t0, math.cos(ph))))
                out.append((s + R * math.radians(deg) * i / m, q, tq, u))
            # the centreline polyline the check gets: finer than the mesh's rings and not on them
            k = 4 * m
            for i in range(1, k + 1):
                ph = math.radians(deg) * i / k
                cl.append(add(c, add(mul(n_, -R * math.cos(ph)), mul(t0, R * math.sin(ph)))))
            p, t, s = out[-1][1], out[-1][2], out[-1][0]
    return out, cl


def stl_binary(V, T):
    b = [b'roundcheck test'.ljust(80, b' '), struct.pack('<I', len(T))]
    for a, c, d in T:
        n = cross(sub(V[c], V[a]), sub(V[d], V[a]))
        ln = math.sqrt(dot(n, n)) or 1.0
        b.append(struct.pack('<12fH', n[0] / ln, n[1] / ln, n[2] / ln, *V[a], *V[c], *V[d], 0))
    return b''.join(b)


def stl_ascii(V, T):
    out = ['solid test']
    for a, c, d in T:
        out += ['facet normal 0 0 0', ' outer loop'] + [' vertex %.6f %.6f %.6f' % V[q] for q in (a, c, d)] + [' endloop', 'endfacet']
    return ('\n'.join(out + ['endsolid test']) + '\n').encode()


GOOD = RC.facets_for(50.8, 0.008)       # finer than the export target, for the meshes that must pass

# ------------------------------------------------------------------------------------------------ the arithmetic
n100 = RC.facets_for(50.0, 0.01)
ok(n100 == 158 and RC.sagitta(50.0, n100) <= 0.01 < RC.sagitta(50.0, n100 - 1),
   'a 100 mm circle needs %d facets for 0.01 mm chord error (%.4f mm at %d, %.4f mm at %d)' % (
       n100, RC.sagitta(50.0, n100), n100, RC.sagitta(50.0, n100 - 1), n100 - 1))
ms = RC.mesh_settings(50.0)
ok(abs(ms['surface_tolerance_cm'] - 0.001) < 1e-12 and abs(ms['max_normal_deviation_rad'] - 2 * math.pi / 158) < 1e-12,
   'Fusion settings for it: surfaceTolerance %.4f cm, maxNormalDeviation %.5f rad (%.2f deg)' % (
       ms['surface_tolerance_cm'], ms['max_normal_deviation_rad'], math.degrees(ms['max_normal_deviation_rad'])))
pn, ptol = RC.preset_facets(50.0, math.sqrt(100 ** 2 + 100 ** 2 + 300 ** 2))
ok(pn == 79 and abs(ptol - 0.0405) < 0.0005,
   'the "high" preset on a 300 mm long 100 mm tube: tolerance %.4f mm, %d facets round it (what was exported before)' % (ptol, pn))
pn2, ptol2 = RC.preset_facets(47.5, 500.0)
ok(55 <= pn2 <= 65, 'and on a part with a 500 mm box: %d facets round a 95 mm circle (the ~60 the owner saw)' % pn2)
ok(RC.mm_in(0.05) == '0.050 mm (0.0020 in)' and RC.mm_in(101.6) == '101.6 mm (4.00 in)', 'lengths read in mm and inches: %s, %s' % (RC.mm_in(0.05), RC.mm_in(101.6)))

# ------------------------------------------------------------------------------------------------ straight tube, axis found
ax = unit((0.3, -0.4, 0.866))
o0 = (12.0, -30.0, 45.0)
V, T = tube_mesh(straight_frames(o0, ax, 300.0), lambda s, th: 50.0, lambda s, th: 47.0, GOOD)
t0 = time.time()
r = RC.check((V, T))
dt = time.time() - t0
a_err = math.degrees(math.acos(min(1.0, abs(dot(r['axis']['direction'], ax)))))
off = sub(r['axis']['point'], o0)
off_perp = math.sqrt(max(0.0, dot(off, off) - dot(off, ax) ** 2))
ok(r['verdict'] == 'round' and r['judged'] == 25, 'straight 100 mm tube on a tilted axis: %s, %d sections (%.1f s)' % (r['verdict'], r['judged'], dt))
ok(a_err < 1e-3 and off_perp < 1e-3, 'its axis found from the mesh: %.2e deg off, %.2e mm off the true line' % (a_err, off_perp))
roles = [lp['role'] for lp in r['stations'][3]['loops']]
o_lp, b_lp = r['stations'][3]['loops']
ok(roles == ['outer', 'bore'] and abs(o_lp['d_mm'] - 100) < 0.02 and abs(b_lp['d_mm'] - 94) < 0.02,
   'outer and bore separately: %.3f and %.3f mm across' % (o_lp['d_mm'], b_lp['d_mm']))
ok(o_lp['facets'] == GOOD and abs(o_lp['sag_mm'] - RC.sagitta(50, GOOD)) < 1e-4 and r['worst_dev_mm'] <= RC.sagitta(50, GOOD) + 1e-4,
   '%d facets counted round it (%d made), chord error %.5f mm (%.5f by the formula), worst deviation %.5f mm' % (
       o_lp['facets'], GOOD, o_lp['sag_mm'], RC.sagitta(50, GOOD), r['worst_dev_mm']))
rg = RC.check((V, T), axis=ax)
ok(rg['verdict'] == 'round' and abs(rg['worst_dev_mm'] - r['worst_dev_mm']) < 1e-4, 'the axis direction given instead: the same answer')

# ------------------------------------------------------------------------------------------------ cone taper, lobed, coarse
L_c, R0, R1, W = 120.0, 50.8, 38.1, 3.0
rc_ = lambda s: R0 + (R1 - R0) * s / L_c
cone = tube_mesh(straight_frames((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), L_c), lambda s, th: rc_(s), lambda s, th: rc_(s) - W, GOOD)
r = RC.check(cone)
ok(r['verdict'] == 'round' and r['worst_dev_mm'] < 0.01 and r['worst_sag_mm'] < 0.01,
   '4 in to 3 in cone taper (%d facets): round, worst deviation %.4f mm, chord error %.4f mm' % (GOOD, r['worst_dev_mm'], r['worst_sag_mm']))
ok(abs(r['stations'][0]['loops'][0]['d_mm'] - 2 * rc_(r['stations'][0]['s_mm'])) < 0.02, 'its first section %.3f mm across where the cone is %.3f' % (
    r['stations'][0]['loops'][0]['d_mm'], 2 * rc_(r['stations'][0]['s_mm'])))

LOBE = 0.2
lob = tube_mesh(straight_frames((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), L_c, 25), lambda s, th: rc_(s) + LOBE * math.cos(3 * th),
                lambda s, th: rc_(s) - W + LOBE * math.cos(3 * th), GOOD)
r = RC.check(lob)
devs = [lp['dev_max_mm'] for s in r['stations'] for lp in s['loops']]
ok(r['verdict'] == 'not round' and r['failing'] == 25 and all(abs(d - LOBE) < 0.02 for d in devs),
   'the cone with three 0.2 mm lobes: %s, %d of 25 sections fail, deviation %.3f to %.3f mm, out-of-round %.3f mm' % (
       r['verdict'], r['failing'], min(devs), max(devs), r['worst_oor_mm']))
ok(r['worst_sag_mm'] < RC.SAG_TOL_MM and 'revolve its profile' in r['summary'] and 'Do not print' in r['summary'],
   'its facets are fine (chord %.4f mm), so the summary blames the shape: "%s"' % (r['worst_sag_mm'], r['summary'][-140:]))

coarse = tube_mesh(straight_frames((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), L_c), lambda s, th: rc_(s), lambda s, th: rc_(s) - W, 24)
r = RC.check(coarse)
st = r['stations'][12]
sag_true = RC.sagitta(st['loops'][0]['r_mm'], 24)
ok(r['verdict'] == 'not round' and r['failing'] == 25 and st['loops'][0]['facets'] == 24 and abs(st['loops'][0]['sag_mm'] - sag_true) < 0.002,
   'the cone with 24 facets: %s, 24 facets counted, chord error %.3f mm (formula %.3f), deviation %.3f mm' % (
       r['verdict'], st['loops'][0]['sag_mm'], sag_true, st['loops'][0]['dev_max_mm']))
ok('too coarse' in r['summary'] and 'in)' in r['summary'] and 'At ' in r['summary'], 'the summary lists failing sections in mm and inches and says to export finer: "%s"' % r['summary'][:230])

# ------------------------------------------------------------------------------------------------ quintic (S) taper
qn = lambda x: 10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5
rq = lambda s: R0 + (R1 - R0) * qn(s / 150.0)
quint = tube_mesh(straight_frames((5.0, 6.0, 7.0), (1.0, 0.0, 0.0), 150.0, 76), lambda s, th: rq(s), lambda s, th: rq(s) - W, GOOD)
r = RC.check(quint)
mid = r['stations'][12]['loops'][0]
ok(r['verdict'] == 'round' and abs(mid['d_mm'] - 2 * rq(mid and r['stations'][12]['s_mm'])) < 0.05,
   'quintic S taper (75 rings): round, worst deviation %.4f mm; mid section %.3f mm across (the profile says %.3f)' % (
       r['worst_dev_mm'], mid['d_mm'], 2 * rq(r['stations'][12]['s_mm'])))

# ------------------------------------------------------------------------------------------------ bends: centreline
segs = [('line', 80.0), ('arc', 120.0, 90.0, 1), ('line', 60.0), ('arc', 100.0, 60.0, -1), ('line', 40.0)]
fr, cl = path_frames(segs)
bent = tube_mesh(fr, lambda s, th: 38.1, lambda s, th: 36.1, GOOD)
t0 = time.time()
r = RC.check(bent, centreline=cl)
dt = time.time() - t0
ok(r['verdict'] == 'round' and r['judged'] == 25 and r['worst_dev_mm'] < 0.01,
   'a 3 in tube with a 90 and a 60 degree bend, sliced square to its centreline: %s, %d sections, worst deviation %.4f mm (%.1f s, %d triangles)' % (
       r['verdict'], r['judged'], r['worst_dev_mm'], dt, r['triangles']))
in_bend = [s for s in r['stations'] if 80 < s['s_mm'] < 80 + 120 * math.pi / 2]
ok(len(in_bend) >= 5 and all(s['status'] == 'round' and len(s['loops']) == 2 for s in in_bend),
   '%d of them in the first bend, each with the outer and the bore' % len(in_bend))
coarse_b = tube_mesh(fr, lambda s, th: 38.1, lambda s, th: 36.1, 24)
r = RC.check(coarse_b, centreline=cl)
ok(r['verdict'] == 'not round' and r['failing'] == 25, 'the bent tube with 24 facets: %s (%d fail)' % (r['verdict'], r['failing']))
r = RC.check(bent)
ok(r['verdict'] != 'round', 'the bent tube without its centreline is not passed as round (%s)' % r['verdict'])

# ------------------------------------------------------------------------------------------------ STL in, skip, open, box
Vc, Tc = cone
with tempfile.TemporaryDirectory() as td:
    fb, fa, fl = os.path.join(td, 'cone_bin.stl'), os.path.join(td, 'cone_ascii.stl'), os.path.join(td, 'lobed.stl')
    open(fb, 'wb').write(stl_binary(Vc, Tc))
    open(fa, 'wb').write(stl_ascii(Vc, Tc))
    open(fl, 'wb').write(stl_binary(*lob))
    rb, ra = RC.check(open(fb, 'rb').read()), RC.check(fa)
    ok(rb['verdict'] == ra['verdict'] == 'round' and abs(rb['worst_dev_mm'] - ra['worst_dev_mm']) < 1e-3 and rb['triangles'] == len(Tc),
       'binary and ASCII STL of the cone read the same: %d triangles, deviation %.4f and %.4f mm' % (rb['triangles'], rb['worst_dev_mm'], ra['worst_dev_mm']))
    hdr = stl_binary(Vc, Tc)
    hdr = b'solid but binary'.ljust(80, b' ') + hdr[80:]
    ok(RC.check(hdr)['verdict'] == 'round', 'a binary STL whose header starts with "solid" is still read as binary')
    cli = os.path.join(os.path.dirname(HERE), 'roundcheck.py')
    p1 = subprocess.run([sys.executable, cli, fb], capture_output=True, text=True)
    p2 = subprocess.run([sys.executable, cli, fl, '--axis', '0,0,1'], capture_output=True, text=True)
    p3 = subprocess.run([sys.executable, cli, os.path.join(td, 'missing.stl')], capture_output=True, text=True)
    p4 = subprocess.run([sys.executable, cli, fb, '--json'], capture_output=True, text=True)
    ok(p1.returncode == 0 and 'ROUND' in p1.stdout and ' in)' in p1.stdout and 'mm' in p1.stdout,
       'command line, the cone: exit 0, "%s"' % p1.stdout.splitlines()[0][:120])
    ok(p2.returncode == 1 and 'NOT ROUND' in p2.stdout, 'command line, the lobed cone with --axis 0,0,1: exit 1')
    ok(p3.returncode == 2, 'command line, no such file: exit 2 (%s)' % p3.stderr.strip()[:80])
    ok(p4.returncode == 0 and '"verdict": "round"' in p4.stdout, 'command line --json: the whole report')

r = RC.check(lob, skip=[(0.0, 200.0)])
ok(r['verdict'] == 'not checked' and all(s['status'] == 'skipped' for s in r['stations']), 'every section skipped: not checked, never passed')
r = RC.check(lob, skip=[(0.0, 59.0)])
ok(sum(s['status'] == 'skipped' for s in r['stations']) == 12 and r['failing'] == 13, 'a skip range (a keep-out such as lettering): 12 skipped, the other 13 still judged')
Vo, To = cone
holed = (Vo, [t for k, t in enumerate(To) if not (k % 2 == 0 and k < 2 * GOOD)])
r = RC.check(holed, axis=(0, 0, 1), point=(0, 0, 0))
ok(r['verdict'] != 'round', 'an open mesh (half the outer triangles gone): %s, not passed' % r['verdict'])
box = tube_mesh(straight_frames((0.0, 0.0, 0.0), (0.0, 0.0, 1.0), 100.0), lambda s, th: 30.0, lambda s, th: 25.0, 4)
r = RC.check(box)
ok(r['verdict'] == 'not round', 'a square tube: %s' % r['verdict'])
r = RC.check(([], []))
ok(r['verdict'] == 'not checked' and not r['ok'], 'an empty mesh: not checked')

# a mesh written face by face (the add-in's CFD export does): the outer cone's two halves meshed apart, the seam's
# points on one half 0.002 mm off the other's, so nothing there welds and the loop is chained across the gap
half = set()
for k, (a, b, c) in enumerate(Tc[:2 * GOOD]):
    if (k // 2) < GOOD // 2:
        half.add(k)
soup = []
for k, (a, b, c) in enumerate(Tc):
    soup += [add(Vc[q], (0.002, 0.0, 0.0)) if k in half else Vc[q] for q in (a, b, c)]
r = RC.check((soup, [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(Tc))]), axis=(0, 0, 1))
ok(r['verdict'] == 'round' and r['judged'] == 25, 'a mesh written face by face, its seams 0.002 mm apart, still chains into closed loops: %s' % r['verdict'])

print('test_roundcheck: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
