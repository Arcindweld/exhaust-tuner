import os
"""End-to-end check of cadtools._route_bundle180 with Fusion stubbed out: markers in a rotated, Y-up frame."""
import sys, math, time, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..')); sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'fusion-addin'))
import adsk  # stub
import cadtools as CT, router as RT, templates as T, design as D
IN = 2.54
# the bay in the template frame
D.FLOOR_Y = 10.75; D.GROUND_Z = -14.0
sc = RT.Scene(cell=1.0, sample_len=0.4)
for n, k, p in D.solids():
    co, ix = D.mesh_of(k, p); sc.add_mesh(co, ix, 0.0, n)
sc.build((-50*IN, -20*IN, -24*IN), (14*IN, 20*IN, 18*IN), 2.0)
# Fusion frame: Y up, bay X rotated 37 deg about Y, translated
a = math.radians(37.0); O = (100.0, 50.0, -30.0)
EX = (math.cos(a), 0.0, -math.sin(a)); EZ = (0.0, 1.0, 0.0); EY = CT._cross(EZ, EX)
def to_fusion(p): return tuple(O[k] + EX[k]*p[0] + EY[k]*p[1] + EZ[k]*p[2] for k in range(3))
def to_bay(q): d = CT._sub(q, O); return (CT._dot(d, EX), CT._dot(d, EY), CT._dot(d, EZ))
class BayScene(object):
    built = True
    def dist_exact(self, p, cap, planes=None): return sc.dist_exact(to_bay(p), cap)
CT._up_vector = lambda: EZ
CT._status = lambda s: None
CT._new_component = lambda title: 'comp'
CT._build_route = lambda comp, r, nm, od, wall, pb: {'param': True, 'n': len(r['elems'])}
CT._revolve_cone = lambda *a: None
# the collectors: merge.plan runs as in Fusion (plate holes, cone, spike, notes); only the solid is not built. The stub
# has no sketches or TemporaryBRepManager, so _merge_param is replaced as _build_route is (2026-11-12)
CT._merge_param = lambda comp, p, name: None
CT._cm = lambda data, key, default=None: (float(data[key]) / 10.0 if data.get(key) else default)
ports = {}
for i in range(4):
    ports[1+2*i] = D.port(i, +1); ports[2+2*i] = D.port(i, -1)
CX, CY, CZ = -21.0, 7.7, -6.6
mk = []
for c in range(1, 9):
    p, d = ports[c]
    mk.append({'p': to_fusion(p), 'd': CT._neg(tuple(EX[k]*d[0]+EY[k]*d[1]+EZ[k]*d[2] for k in range(3))), 'signed': False})  # deliberately flipped
mk.append({'p': to_fusion((CX*IN, -CY*IN, CZ*IN)), 'd': EX, 'signed': False})   # B first, wrong sign
mk.append({'p': to_fusion((CX*IN, CY*IN, CZ*IN)), 'd': CT._neg(EX), 'signed': False})
sp = {'od': 1.875*IN, 'wall': 0.065*IN, 'clr': 2.82*IN, 'gap': 1.27, 'target': None}
notes = []
t0 = time.time()
comp, built, items, msg = CT._route_bundle180({'collector_len_mm': 147, 'collector_out_mm': 76.2}, sp, mk, BayScene(), lambda s: None, notes, 'LS3 180')
print('%.0f s' % (time.time()-t0)); print(msg)
for n in notes: print(' note:', n)
for it in items: print(' ', it['name'], 'len %.1f in' % (it['length']/IN), 'ok', it['ok'], 'gap', it.get('min_gap') and round(it['min_gap']/IN, 2), '|', it['note'][:70])
# The template must reproduce the reviewed hand layout (../ls3_180.json, written by ../layout.py and reported to the
# customer): each primary's length, bend count and closest approach to the bay. Five tubes come under the 0.5 in scan
# rule there (0.34-0.44 in, called out in the report as tubes to wrap or shield), so the add-in marks those not ok;
# that is expected, and what is checked is that the figures match the layout, not that every tube is ok.
import json, re
REP = json.load(open(os.path.join(HERE, '..', 'ls3_180.json')))['report']
fails = []
for it in items:
    m = re.match(r'Primary (\d+) ', it['name'])
    if not m:
        continue
    rp = REP[m.group(1)]
    nb = len([x for x in it['lra'] if (x.get('A') or 0) > 1]) if it['lra'] and isinstance(it['lra'][0], dict) else len(it['lra'])
    gap = (it.get('min_gap') or 0) / IN
    print('P%s length %.2f in (layout %.1f), bends %d (layout %d), scan gap %.2f in (layout %.2f)' % (
        m.group(1), it['length'] / IN, rp['length'], nb, len(rp['bends']), gap, rp['scene_gap_in']))
    if abs(it['length'] / IN - rp['length']) > 0.15: fails.append('P%s length' % m.group(1))
    if nb != len(rp['bends']): fails.append('P%s bends' % m.group(1))
    if abs(gap - rp['scene_gap_in']) > 0.02: fails.append('P%s scan gap' % m.group(1))
    if (it['ok'] is True) != (rp['scene_gap_in'] >= 0.5 - 0.005): fails.append('P%s ok flag' % m.group(1))
# both collectors planned as welded merges (merge.plan: a plate with one hole per tube), not the plain-cone fallback
cols = [b for b in built if isinstance(b, dict) and 'merge' in b]
print('collectors planned:', [(b['name'], len((b['merge'].get('plate') or {}).get('holes') or [])) for b in cols])
if len(cols) != 2 or any(len((b['merge'].get('plate') or {}).get('holes') or []) != 4 for b in cols): fails.append('collector merge plans')
print('FAILS', fails)
sys.exit(1 if fails else 0)
