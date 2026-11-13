"""The add-in's turbo manifold route (cadtools act_route, mode 'turbomani') against the small stand-in for Fusion's API of
test_chargeroute_fusion_fake.py (mesh bodies for the scan, sketch lines for the markers, the selection). It runs the glue:
the page's payload (web/tests/fixtures/turbomani_payload.json, written by web/tests/turbomani_ui.js with ET_WRITE_FIXTURES=1:
the K24 case's runner, bend radius, equal length, merge and collector, gate window), the markers read in selection order
with the turbine flange marker last, the clear error for too few markers, the runners routed by the real header router
into a collector on the flange marker's axis, every runner and the collector handed to the build (recorded here, not run:
_build_route and _merge_collector are the functions every header auto-route uses; tests/fusion_live_turbomani.py runs them
in Fusion), and the wastegate named as not routed.

The scene is test_header.py's (cm): a head face and a frame rail, four ports 10 cm apart pointing +x, the merge at
(35, 19, -45) going -z. The page's K24 lengths are for the owner's engine, not this box, so the test keeps the payload's
keys and its merge, collector and gate, and sets the tube, radius and target to test_header's (1.625 in, 1.5 D, 76.2 cm);
time_s 1e9 (no wall-clock limit, deterministic)."""
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import test_chargeroute_fusion_fake as F   # noqa: E402  (stubs adsk, imports cadtools, records _build_route)
import test_router as T                    # noqa: E402

CT = F.CT
MERGES = []
CT._merge_collector = lambda comp, col, ends, od, wall, name, notes, lead_end=None: (MERGES.append((name, col, ends, od, wall)) or {'param': True, 'name': name})
ok, fails = F.ok, F.fails


def main():
    CT._app = types.SimpleNamespace(activeProduct=None)
    fx = os.path.join(HERE, '..', '..', 'web', 'tests', 'fixtures', 'turbomani_payload.json')
    page = json.load(open(fx))
    need = ['mode', 'ports', 'od_mm', 'wall_mm', 'clr_mm', 'target_mm', 'gap_mm', 'merge_len_mm', 'collector_len_mm', 'collector_out_mm', 'gate', 'scrolls', 'max_bend_deg']
    ok(page.get('mode') == 'turbomani' and all(k in page for k in need), 'the page’s payload carries what act_route reads: ' + ', '.join(k for k in need if k not in page))
    ok(abs(page['od_mm'] - 47.625) < 1e-9 and abs(page['clr_mm'] - 47.625) < 1e-9 and abs(page['target_mm'] - 193.86835) < 1e-4, 'the K24 case: 1.875 in tube, the tightest stocked 1 7/8 in radius, 193.87 mm runners')
    head = F.Mesh('Head scan', *T.box_mesh((-6, -10, -15), (0, 50, 15), 12))
    rail = F.Mesh('Frame rail', *T.box_mesh((15, -20, -30), (22, 60, -24), 12))
    F.select([head, rail])
    r = F.call('setKeepouts', {})
    ok(r.get('ok'), 'setKeepouts: ' + r.get('msg', ''))
    ports = [F.Line((0.0, 4.0 + 10.0 * i, 0.0), (2.0, 4.0 + 10.0 * i, 0.0)) for i in range(4)]
    back = (page['merge_len_mm'] + page['collector_len_mm']) / 10.0
    flange = F.Line((35.0, 19.0, -45.0 - back), (35.0, 19.0, -47.0 - back))
    data = dict(page, od_mm=41.28, wall_mm=1.651, clr_mm=1.5 * 41.28, target_mm=762.0, gap_mm=12.7, time_s=1e9)
    F.select(ports[:2] + [flange])
    r = F.call('route', data)
    ok(not r.get('ok') and 'select the 4 port markers' in (r.get('msg') or '') and '3 are selected' in (r.get('msg') or ''), 'two ports and a flange for a four-port manifold: ' + (r.get('msg') or '')[:160])
    del F.BUILT[:]
    del MERGES[:]
    F.select(ports + [flange])
    r = F.call('route', data)
    print(r.get('msg'))
    runners = [it for it in (r.get('items') or []) if str(it.get('name', '')).startswith('Runner')]
    ok(r.get('ok') and len(runners) == 4 and all(it.get('ok') for it in runners), 'four runners routed: ' + str([(it.get('name'), it.get('ok')) for it in runners]))
    ok(all(abs((it.get('length') or 0) - 76.2) <= 0.05 for it in runners), 'each at the target length: ' + str([round(it.get('length') or 0, 3) for it in runners]))
    ok(len(F.BUILT) == 4 and [b[2] for b in F.BUILT] == ['Runner 1', 'Runner 2', 'Runner 3', 'Runner 4'] and abs(F.BUILT[0][3] - 4.128) < 1e-9 and abs(F.BUILT[0][4] - 0.1651) < 1e-9,
       'the build gets four runners, the tube OD and wall in cm')
    ok(len(MERGES) == 1 and MERGES[0][0] == 'Merge collector' and abs(MERGES[0][3] - 4.128) < 1e-9,
       'one merge collector handed to the build (its body %.2f cm: the 20 deg merge plus the collector, to the flange)' % back)
    ok('Wastegate: not routed' in (r.get('msg') or '') and '45 deg' in (r.get('msg') or ''), 'the wastegate is named as not routed, with its window')
    print('FAILS:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
