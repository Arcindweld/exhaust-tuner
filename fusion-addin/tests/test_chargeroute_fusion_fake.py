"""The add-in's charge-pipe actions (cadtools: setHotKeepouts, chargeRoute, chargeRouteBuild) run against a small
stand-in for Fusion's API: mesh bodies for the scan and a hot body, sketch lines for the markers, the selection.
It runs the glue: reading the markers in leg order and pointing them, the clear errors when one is missing, the scan
split into ordinary and hot keep-outs, the recommendation through the real router, and the build of the routes
chosen. The build's Fusion half (_build_route: sketch, pipe feature) is recorded here, not run; it is the same function
every auto-route uses, and tests/fusion_live_chargeroute.py runs it inside Fusion.

ET_WRITE_FIXTURES=1 python3 test_chargeroute_fusion_fake.py   also writes web/tests/fixtures/chargeroute_reply.json
(the requests and answers) for web/tests/chargeroute_ui.js."""
import json
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

adsk = types.ModuleType('adsk')
core = types.ModuleType('adsk.core')
fusion = types.ModuleType('adsk.fusion')
adsk.core, adsk.fusion = core, fusion
for n in ('HTMLEventHandler', 'CommandCreatedEventHandler', 'CommandEventHandler', 'ApplicationEventHandler'):
    setattr(core, n, object)
sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})


class P3(object):
    def __init__(self, x, y, z):
        self.x, self.y, self.z = float(x), float(y), float(z)


class Mesh(object):
    objectType = 'adsk::fusion::MeshBody'

    def __init__(self, name, coords, idx):
        self.name, self.isValid, self.assemblyContext = name, True, None
        self.displayMesh = types.SimpleNamespace(nodeCoordinatesAsDouble=coords, nodeIndices=idx)
        xs, ys, zs = coords[0::3], coords[1::3], coords[2::3]
        self.boundingBox = types.SimpleNamespace(minPoint=P3(min(xs), min(ys), min(zs)), maxPoint=P3(max(xs), max(ys), max(zs)))
        self.entityToken = 'mesh-' + name


class Line(object):
    objectType = 'adsk::fusion::SketchLine'

    def __init__(self, a, b):
        self.startSketchPoint = types.SimpleNamespace(worldGeometry=P3(*a))
        self.endSketchPoint = types.SimpleNamespace(worldGeometry=P3(*b))
        self.parentSketch = types.SimpleNamespace(name='Markers')


class Sel(object):
    def __init__(self, ents):
        self.ents = ents

    @property
    def count(self):
        return len(self.ents)

    def item(self, i):
        return types.SimpleNamespace(entity=self.ents[i])


import cadtools as CT          # noqa: E402
import router as RT            # noqa: E402
from test_chargeroute import box, brute_gap, centreline   # noqa: E402

BUILT = []
CT._build_route = lambda comp, res, name, od, wall, pbase: (BUILT.append((comp, res, name, od, wall, pbase)) or {'param': True, 'path': 'sketch'})
CT._new_component = lambda name: types.SimpleNamespace(name=name)
fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def select(ents):
    CT._ui = types.SimpleNamespace(activeSelections=Sel(ents), palettes=types.SimpleNamespace(itemById=lambda i: None))


def call(action, data):
    return CT.dispatch(action, json.dumps(data))


def main():
    CT._app = types.SimpleNamespace(activeProduct=None)
    # the scan: a wall with one window (as tests/test_chargeroute.py 2.), and a box under the compressor outlet that
    # stands for the turbine housing, marked hot
    walls = [box((28, -25, -20), (32, 25, 9)), box((28, -25, 21), (32, 25, 40)), box((28, -25, 9), (32, -6, 21)),
             box((28, 6, 9), (32, 25, 21))]
    coords, idx = [], []
    for c, i in walls:
        base = len(coords) // 3
        coords += c
        idx += [base + k for k in i]
    scan = Mesh('Engine bay scan', coords, idx)
    turbine = Mesh('Turbine box', *box((0, -10, -20), (20, 10, -9)))
    select([scan, turbine])
    r = call('setKeepouts', {})
    ok(r.get('ok') and '2 keep-out bodies' in r['msg'], 'setKeepouts: ' + r.get('msg', ''))
    select([turbine])
    r = call('setHotKeepouts', {})
    ok(r.get('ok') and r['hot'] == ['Turbine box'], 'setHotKeepouts: ' + r.get('msg', ''))
    flow_hot = {'m_kg_s': 0.25, 'T_C': 120.0, 'p_Pa': 202650.0, 'rho_amb': 1.184}
    flow_cold = {'m_kg_s': 0.25, 'T_C': 45.0, 'p_Pa': 195755.0, 'rho_amb': 1.184}
    stock = [{'clr_mm': 50.8, 'angles': [45, 90, 180]}, {'clr_mm': 76.2, 'angles': [45, 90]}, {'clr_mm': 101.6, 'angles': [90]}]
    data = {'legs': [{'kind': 'hot', 'name': 'Compressor outlet to intercooler inlet', 'id_mm': 50.8, 'wall_mm': 1.651, 'gap_mm': 12.7,
                      'stock': stock, 'flow': flow_hot},
                     {'kind': 'cold', 'name': 'Intercooler outlet to throttle body', 'id_mm': 50.8, 'wall_mm': 1.651, 'gap_mm': 12.7,
                      'stock': stock, 'flow': flow_cold}],
            'hot_gap_mm': 50.8, 'coupler_mm': 76.2, 'joints': 'weld', 'min_straight_mm': 25.4, 'gap_tt_mm': 3.175,
            'time_s': 20, 'max_radii': 2}
    m1 = Line((0, 0, 0), (2, 0, 0))                # compressor outlet, pointing the way the air goes
    m2 = Line((60, 0, 0), (62, 0, 0))              # intercooler inlet
    m3 = Line((60, 40, 0), (58, 40, 0))            # intercooler outlet (beside the wall, clear of it)
    m4 = Line((5, 40, 10), (3, 40, 10))            # throttle body
    # a missing marker: which one, and the order
    select([m1, m2, m3])
    r = call('chargeRoute', data)
    ok(not r['ok'] and 'Missing: the end marker of Intercooler outlet to throttle body' in r['msg'] and '3 markers are selected; 4 are needed' in r['msg'],
       'three markers for two legs: ' + r['msg'])
    select([m1])
    r = call('chargeRoute', dict(data, legs=data['legs'][:1]))
    ok(not r['ok'] and 'Missing: the end marker of Compressor outlet to intercooler inlet' in r['msg'], 'one marker for one leg: ' + r['msg'][:120])
    select([m1, m1])
    r = call('chargeRoute', dict(data, legs=data['legs'][:1]))
    ok(not r['ok'] and 'at the same place' in r['msg'], 'the same marker twice: ' + r['msg'][:120])
    r = call('chargeRoute', dict(data, legs=[]))
    ok(not r['ok'] and 'Tick at least one leg' in r['msg'], 'no legs ticked: ' + r['msg'])
    r = call('chargeRoute', dict(data, legs=[dict(data['legs'][0], id_mm=0)]))
    ok(not r['ok'] and 'inside diameter' in r['msg'], 'no tube size: ' + r['msg'])
    # the recommendation
    select([m1, m2, m3, m4])
    rec = call('chargeRoute', data)
    ok(rec.get('ok') and rec.get('route_ok') and rec.get('hot'), 'chargeRoute: ' + rec.get('msg', '')[:300])
    plan = rec.get('plan') or {'legs': []}
    ok(len(plan['legs']) == 2 and all(L['ok'] for L in plan['legs']), 'both legs fit')
    ok('_elems' not in json.dumps(rec), 'the answer is plain JSON without the build elements')
    L0 = plan['legs'][0]
    cs = [c for c in L0['candidates'] if c['ok']]
    ok(len(cs) >= 2 and [c['rank'] for c in cs] == list(range(1, len(cs) + 1)) and all(cs[i]['dp_Pa'] <= cs[i + 1]['dp_Pa'] for i in range(len(cs) - 1)),
       'leg 1: %d routes, ranked by loss: %s Pa' % (len(cs), [round(c['dp_Pa']) for c in cs]))
    ok(all(c['hot_gap_mm'] is not None and c['hot_gap_mm'] >= 50.8 - 0.6 for c in cs), 'leg 1 keeps the hot clearance from the turbine box: %s mm' % (
        [round(c['hot_gap_mm'], 1) for c in cs]))
    # independent: the routes built from the add-in's own elements clear both bodies
    priv = CT._LAST_CHARGE['plan']['legs']
    for i, L in enumerate(priv):
        best = L['candidates'][L['best']]
        pts = centreline(best['_elems'], 0.1)
        g_scan, _ = brute_gap(pts, walls)
        g_hot, _ = brute_gap(pts, [box((0, -10, -20), (20, 10, -9))])
        R = (50.8 + 2 * 1.651) / 20.0
        ok(g_scan - R >= 1.27 - 0.011 and g_hot - R >= 5.08 - 0.011, '%s: %.2f mm from the scan, %.2f mm from the hot box (independent)' % (
            L['name'], (g_scan - R) * 10, (g_hot - R) * 10))
    a = RT.path_points(priv[0]['candidates'][priv[0]['best']]['_elems'], 0.2)
    b = RT.path_points(priv[1]['candidates'][priv[1]['best']]['_elems'], 0.2)
    dmin = min(math.sqrt(sum((p[k] - q[k]) ** 2 for k in range(3))) for p in a for q in b) - 2 * 2.7051
    ok(dmin >= 0.3175 - 0.02, 'the two legs keep %.1f mm apart (3.2 mm asked)' % (dmin * 10))
    # build: the second-ranked route of leg 1, the best of leg 2
    pick = [cs[1]['id'], plan['legs'][1]['candidates'][0]['id']]
    del BUILT[:]
    bres = call('chargeRouteBuild', {'choice': pick, 'title': 'Charge pipes'})
    ok(bres.get('ok') and len(BUILT) == 2, 'chargeRouteBuild builds two pipes: ' + bres.get('msg', '')[:200])
    if len(BUILT) == 2:
        want = next(c for c in priv[0]['candidates'] if c['id'] == pick[0])
        ok(BUILT[0][1]['elems'] is want['_elems'] and BUILT[0][2] == 'Compressor outlet to intercooler inlet' and abs(BUILT[0][3] - 5.4102) < 1e-9
           and abs(BUILT[0][4] - 0.1651) < 1e-9 and BUILT[0][0].name == 'Charge pipes', 'leg 1 built on the route chosen (the second), its OD and wall, in one component')
        ok(BUILT[1][2] == 'Intercooler outlet to throttle body', 'leg 2 built')
        it = bres['items'][0]
        ok(abs(it['length'] - want['length_mm'] / 10) < 1e-9 and it['charge']['label'] == want['label'] and it['lra'][0]['L'] > 0,
           'the build answers with each pipe\'s length, bend schedule and route')
    r = call('chargeRouteBuild', {'choice': [999, None]})
    ok(not r['ok'] and 'not in the last recommendation' in r['msg'], 'an unknown route: ' + r['msg'])
    r = call('setHotKeepouts', {'clear': True})
    ok(r['ok'] and not CT._hot_tokens, 'hot marks cleared')
    if os.environ.get('ET_WRITE_FIXTURES'):
        fx = os.path.join(HERE, '..', '..', 'web', 'tests', 'fixtures', 'chargeroute_reply.json')
        with open(fx, 'w') as fh:
            json.dump({'request': data, 'reply': rec, 'build_choice': pick, 'build': bres}, fh, indent=1)
        print('wrote', fx)
    print('FAILS:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
