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
# geometry sanity: tube 1 must start at marker 1 and end at collector A's slot, in Fusion coordinates
e1 = [it for it in items if it['name'].startswith('Primary 1 ')][0]
print('lra bends', len([x for x in e1['lra'] if x.get('angle', 0) > 1]) if isinstance(e1['lra'][0], dict) else len(e1['lra']))
