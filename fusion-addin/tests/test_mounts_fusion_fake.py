"""The add-in's mount actions (cadtools: mountPlace, mountPick, mountBuild) against a small stand-in for Fusion's API:
a scan (a mesh floor), a part body (a box), sketch points on the part and clicks on the scan, the selection, and a hot
keep-out. It runs the glue: the stand-in's box, the pairs read in order with the scan's normal at each click, the
page's frame (Z up: page Y is the model's Z, page Z its -Y), the reach and offset, the build placing each bracket with
mounts.check against the real router Scene (ordinary and hot keep-outs) and the straight-line tool access. The plates'
Fusion half (_hang_plate: sketch, extrude) is recorded here, not run; it is the same function the hanger build uses,
and tests/fusion_live_mounts.py runs it inside Fusion.

ET_WRITE_FIXTURES=1 python3 test_mounts_fusion_fake.py   also writes web/tests/fixtures/mounts_reply.json (the
answers to mountPick and mountBuild) for web/tests/mounts_ui.js."""
import json
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


core.Point3D = types.SimpleNamespace(create=lambda x, y, z: P3(x, y, z))
core.Vector3D = types.SimpleNamespace(create=lambda x, y, z: P3(x, y, z))
MADE = []
core.OrientedBoundingBox3D = types.SimpleNamespace(create=lambda c, ld, wd, L, W, H: {'c': (c.x, c.y, c.z), 'ld': (ld.x, ld.y, ld.z), 'wd': (wd.x, wd.y, wd.z), 'L': L, 'W': W, 'H': H})
TBM = types.SimpleNamespace(createBox=lambda obb: ('box', obb), createCylinderOrCone=lambda a, r1, b, r2: ('cyl', (a.x, a.y, a.z), r1, (b.x, b.y, b.z), r2),
                            booleanOperation=lambda a, b, how: True)
fusion.TemporaryBRepManager = types.SimpleNamespace(get=lambda: TBM)
fusion.BooleanTypes = types.SimpleNamespace(DifferenceBooleanType=2)


class Mesh(object):
    objectType = 'adsk::fusion::MeshBody'

    def __init__(self, name, coords, idx):
        self.name, self.isValid, self.assemblyContext = name, True, None
        self.displayMesh = types.SimpleNamespace(nodeCoordinatesAsDouble=coords, nodeIndices=idx)
        xs, ys, zs = coords[0::3], coords[1::3], coords[2::3]
        self.boundingBox = types.SimpleNamespace(minPoint=P3(min(xs), min(ys), min(zs)), maxPoint=P3(max(xs), max(ys), max(zs)))
        self.entityToken = 'mesh-' + name


class Body(object):
    objectType = 'adsk::fusion::BRepBody'

    def __init__(self, name, lo, hi):
        self.name, self.isValid, self.assemblyContext, self.entityToken = name, True, None, 'body-' + name
        self.boundingBox = types.SimpleNamespace(minPoint=P3(*lo), maxPoint=P3(*hi))


class SPoint(object):
    objectType = 'adsk::fusion::SketchPoint'

    def __init__(self, p):
        self.worldGeometry = P3(*p)


class Sel(object):
    def __init__(self, items):
        self.items = items

    @property
    def count(self):
        return len(self.items)

    def item(self, i):
        e, p = self.items[i]
        return types.SimpleNamespace(entity=e, point=None if p is None else P3(*p))


import cadtools as CT          # noqa: E402
from test_chargeroute import box   # noqa: E402

PLATES = []
CT._hang_plate = lambda comp, pl: (PLATES.append(pl) or types.SimpleNamespace(name=pl['name']))
CT._new_component = lambda name: types.SimpleNamespace(name=name, sketches=types.SimpleNamespace(count=0), constructionPlanes=types.SimpleNamespace(count=0))
CT._add_bodies = lambda comp, named: (MADE.extend(named) or [types.SimpleNamespace(name=n) for _b, n in named])
fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def select(items):
    CT._ui = types.SimpleNamespace(activeSelections=Sel(items), palettes=types.SimpleNamespace(itemById=lambda i: None))


def call(action, data):
    return CT.dispatch(action, json.dumps(data))


def main():
    CT._app = types.SimpleNamespace(activeProduct=None)
    floor = Mesh('Engine bay scan', *box((-40, -40, -2), (40, 40, 0)))
    turbo = Mesh('Turbo box', *box((34.0, -8.0, 3.0), (36.0, -2.0, 8.0)))
    # the stand-in: 600 x 100 x 300 mm (page across, fore-aft, up), Z up
    r = (select([(SPoint((0, 0, 25)), None)]), call('mountPlace', {'shape': 'box', 'L_mm': 600, 'H_mm': 300, 'W_mm': 100, 'name': 'Core stand-in'}))[1]
    obb = MADE[-1][0][1] if MADE else {}
    # length along page X = model x, width along page Z = model -y, height 300 mm: L 60, W 10, H 30 cm
    ok(r.get('ok') and obb.get('c') == (0, 0, 25) and obb.get('ld') == (1, 0, 0) and obb.get('wd') == (0, -1, 0) and (obb['L'], obb['W'], obb['H']) == (60, 10, 30),
       'mountPlace: a 600 x 300 x 100 mm box centred on the point, length across, width fore-aft: ' + r.get('msg', ''))
    part = Body('Core stand-in', (-30, -5, 10), (30, 5, 40))
    select([(floor, None), (turbo, None)])
    call('setKeepouts', {})
    select([(turbo, None)])
    call('setHotKeepouts', {})
    # two mounts on the core's front face (model y = -5 is page forward... page Z = -y, so y -5 is page +50 mm), 2 cm
    # up from its bottom; clicks on the floor 12 cm below each
    pairs = [(part, None), (SPoint((-28, -5, 12)), None), (floor, (-28, -5, 0)), (SPoint((28, -5, 12)), None), (floor, (28, -5, 0))]
    select(pairs)
    pk = call('mountPick', {})
    m = pk.get('mounts') or []
    # from the part's centre (0, 0, 25): mount 1 at x -28, y -5, z 12 -> page across -280 mm, up -130 mm, fore-aft
    # +50 mm; reach 12 cm = 120 mm straight down to the floor (n = +z), no offset; part 600 x 300 x 100 mm
    ok(pk.get('ok') and len(m) == 2 and m[0]['p_mm'] == [-280.0, -130.0, 50.0] and m[0]['h_mm'] == 120.0 and m[0]['s_mm'] == 0.0 and m[0]['dir'] == 'dn'
       and m[0]['n'] == [0.0, 1.0, 0.0] and pk['part'] == {'L_mm': 600.0, 'H_mm': 300.0, 'W_mm': 100.0},
       'mountPick: mount 1 at (-280, -130, 50) mm from the centre, reach 120 mm down, page normal (0, 1, 0): ' + pk.get('msg', ''))
    select([(part, None), (SPoint((-28, 0, 10)), None)])
    bad = call('mountPick', {})
    ok(not bad.get('ok') and 'in pairs' in bad.get('msg', ''), 'mountPick with one point after the part: ' + bad.get('msg', ''))
    select([(part, None), (SPoint((-28, 0, 10)), None), (SPoint((-28, 0, 0)), None), (SPoint((28, 0, 10)), None), (floor, (28, 0, 0))])
    bad2 = call('mountPick', {})
    ok(not bad2.get('ok') and 'face or on the scan' in bad2.get('msg', ''), 'a chassis pick with no direction is refused: ' + bad2.get('msg', ''))
    select(pairs)
    call('mountPick', {})
    # the page's brackets: 1/8 in strap, 54 mm wide, M8 (9 mm holes), foot bolts 13.7 mm out, foot 27.2 mm; page u =
    # across (1, 0, 0) -> model x, so f = n x u = z x x = +y; the part's centre is on +f of P, so the plate goes on
    # its -f side (y -5.3175 to -5), outside the part, and the foot runs away from the part (-f)
    br = {'type': 'strap', 't': 3.175, 'b': 54.0, 'hole': 9.0, 'bolt': 8.0, 'R': 3.175, 'K': 0.42, 'h': 120.0, 's': 0.0, 'u': [1, 0, 0],
          'foot': {'nb': 2, 'sb': 27.0, 'hole': 9.0, 'bolt': 8.0, 'a': 13.7, 'L': 27.2}, 'light': [], 'hf': 0, 'hg': 0}
    data = {'brackets': [dict(br, name='Mount 1'), dict(br, name='Mount 2')], 'gap_mm': 12.7, 'hot_gap_mm': 50.8, 'socket_r_mm': 12.7, 'tool_mm': 150}
    del PLATES[:]
    b = call('mountBuild', data)
    reps = b.get('brackets') or []
    ok(b.get('ok') and len(PLATES) == 4 and sorted(p['name'] for p in PLATES) == ['Mount 1 foot', 'Mount 1 upright', 'Mount 2 foot', 'Mount 2 upright'],
       'mountBuild: an upright and a foot for each bracket (' + ', '.join(p['name'] for p in PLATES) + ')')
    # mount 1: nothing near; mount 2: the hot box starts at x = 34, the upright's edge at 28 + 2.7 = 30.7 cm: 3.3 cm
    # off, inside the 5.08 cm hot clearance (the scan's sampled points are 0.3 cm apart, so 33.0 to 34.5 mm)
    ok(len(reps) == 2 and reps[0]['clear'] and reps[0]['hot_gap_mm'] > 50.8 and reps[0]['foot_side'] == -1 and reps[0]['plate_side'] == -1 and all(a['clear'] for a in reps[0]['access']),
       'mount 1: clear (hot box %.1f mm off), the foot away from the part, every bolt has a straight line out' % reps[0]['hot_gap_mm'])
    ok(len(reps) == 2 and (not reps[1]['clear']) and 33.0 <= reps[1]['hot_gap_mm'] <= 34.5, 'mount 2: %.1f mm from the hot box against 50.8 mm: flagged' % (reps[1]['hot_gap_mm'] if len(reps) > 1 else -1))
    ok(not b.get('all_ok') and 'Mount 2' in b.get('msg', ''), 'the message names the bracket to change: ' + b.get('msg', ''))
    # the foot runs away from the part's footprint: the part is at z >= 10, the foot on the floor; both sides clear,
    # the reach is the page's
    bad3 = call('mountBuild', dict(data, brackets=[dict(br, name='Mount 1', h=110.0), dict(br, name='Mount 2')]))
    ok(not bad3.get('ok') and 'Read the mounts again' in bad3.get('msg', ''), 'a page reach that disagrees with the picks is refused: ' + bad3.get('msg', ''))
    # a stay on mount 1: a tube from the floor to the part, cut 120 - 2 x 38.1 = 43.8 mm
    del MADE[:]
    st = call('mountBuild', dict(data, brackets=[dict(br, name='Mount 1', type='stay', stay={'od': 19.05, 'wall': 1.651, 're': 38.1}), dict(br, name='Mount 2')]))
    ok(st.get('ok') and any(n == 'Mount 1 stay tube' for _b, n in MADE) and abs(st['brackets'][0]['stay']['cut_mm'] - 43.8) < 1e-9, 'a stay: one tube, cut 43.8 mm')
    if os.environ.get('ET_WRITE_FIXTURES'):
        out = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'web', 'tests', 'fixtures', 'mounts_reply.json')
        json.dump({'pick': pk, 'build': b}, open(out, 'w'), indent=1)
        print('wrote', out)
    print('FAILS:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
