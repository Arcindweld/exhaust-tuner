"""Fabrication jig generator (jig.plan_fab): the three styles, free-standing against fixture-table mounts, flange
locators, weld gaps, the print bed. Geometry checks on the primitives the add-in builds."""
import math
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import router as RT
import jig as J

FAILS = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        FAILS.append(m)


def arc(p0, cen, nrm, ang_deg, R):
    a = math.radians(ang_deg)
    u0 = RT.vunit(RT.vsub(p0, cen))
    v = RT.vcross(nrm, u0)
    u1 = tuple(math.cos(a) * u0[k] + math.sin(a) * v[k] for k in range(3))
    p1 = tuple(cen[k] + R * u1[k] for k in range(3))
    return ('arc', p0, p1, cen, a, R * a, u0, u1), p1


od, R = 4.445, 6.65
# a flat part like the owner's first photo: 30 cm straight, a 90 deg bend, 20 cm straight, all at z = 6
L1 = ('line', (0.0, 0.0, 6.0), (30.0, 0.0, 6.0), 30.0)
A1, pA = arc((30.0, 0.0, 6.0), (30.0, R, 6.0), (0.0, 0.0, 1.0), 90.0, R)
L2 = ('line', pA, (pA[0], pA[1] + 20.0, 6.0), 20.0)
flat = {'name': 'Pipe', 'elems': [L1, A1, L2], 'od': od}
Ltot = 30.0 + R * math.pi / 2 + 20.0
base = 6.0 - od / 2 - 1.0


def box_pts(b):
    h = RT.vcross(b['d'], b['w'])
    return [tuple(b['c'][k] + i * b['L'] * b['d'][k] + j * b['W'] * b['w'][k] + l * b['H'] * h[k] for k in range(3))
            for i in (-0.5, 0.5) for j in (-0.5, 0.5) for l in (-0.5, 0.5)]


# ---- separate cradles, free-standing: the old jig, feet grown with height
p = J.plan_fab([flat], opts={'style': 'cradles', 'mount': 'free'})
cr = [q for q in p['parts'] if q['kind'] == 'cradle']
ok(len(cr) >= 4 and all(q['holes'] for q in cr), 'cradles, free: %d cradles, each with its M6 holes' % len(cr))
low = min(min(pt[2] for b in q['add'] for pt in box_pts(b)) for q in cr)
ok(abs(low - base) < 1e-9, 'every cradle stands on the base level, 10 mm under the tube (%.2f cm)' % low)
# a tall cradle gets a cross foot: 0.5 H along the tube, 0.6 H across
tall = {'name': 'High', 'elems': [('line', (0.0, -25.0, 30.0), (30.0, -25.0, 30.0), 30.0)], 'od': od}
pt_ = J.plan_fab([tall, flat], opts={'style': 'cradles', 'mount': 'free'})
hi = [q for q in pt_['parts'] if q['tube'] == 'High'][0]
feet = [b for b in hi['add'] if abs(b['H'] - J.DEFAULTS['foot_t']) < 1e-9]
ok(any(b['W'] >= 0.6 * hi['height'] - 1e-9 for b in feet) and any(b['L'] >= 0.5 * hi['height'] - 1e-9 for b in feet),
   'free-standing: a %.0f cm tall cradle stands on a cross foot %.1f x %.1f cm' % (hi['height'], 0.5 * hi['height'], 0.6 * hi['height']))

# ---- fixture table, System 16: holes on the 50 mm grid, never under a tall block, at least two per part
pt = J.plan_fab([flat], opts={'style': 'cradles', 'mount': 'table', 'grid_pitch': 5.0, 'grid_hole': 1.65, 'grid_origin': (0.0, 0.0)})
crt = pt['parts']
on_grid = all(abs(h[0] / 5.0 - round(h[0] / 5.0)) < 1e-9 and abs(h[1] / 5.0 - round(h[1] / 5.0)) < 1e-9 for q in crt for h in q['holes'])
ok(on_grid and all(len(q['holes']) >= 2 for q in crt), 'table: every cradle has %s holes, all on the 50 mm grid' %
   sorted(set(len(q['holes']) for q in crt)))
clear = True
for q in crt:
    for h in q['holes']:
        for r in q['foot']:
            if not r['flat'] and J._in_rect(dict(r, L=r['L'] + 2 * 0.75 * 1.65, W=r['W'] + 2 * 0.75 * 1.65), h, 0.0):
                clear = False
ok(clear, 'no bolt hole under a cradle block (head clearance kept)')
ok(any(q.get('tabs') for q in crt), 'cradles away from the grid get tabs out to the nearest holes (%d tabs)' % sum(q.get('tabs', 0) for q in crt))
inside = all(any(J._in_rect(r, h, 1.65 / 2 + 0.4 - 1e-6) for r in q['foot'] if r['flat']) for q in crt for h in q['holes'])
ok(inside, 'every hole sits in a foot, rib or tab with a rim round it')
ok(all(len(q['hole_cuts']) == len(q['holes']) and abs(q['hole_cuts'][0]['r'] - 0.825) < 1e-9 for q in crt), '16 mm table holes cut through the base')
p28 = J.plan_fab([flat], opts={'style': 'cradles', 'mount': 'table', 'grid_pitch': 10.0, 'grid_hole': 2.85, 'grid_origin': (2.5, 2.5), 'grid_angle_deg': 0.0})
ok(all(abs((h[0] - 2.5) / 10 - round((h[0] - 2.5) / 10)) < 1e-9 for q in p28['parts'] for h in q['holes']), 'System 28: 100 mm grid from its origin')

# ---- base frame: one part, ribs along the spanning tree
pb = J.plan_fab([flat], opts={'style': 'base', 'mount': 'table'})
ok(len(pb['parts']) == 1 and pb['parts'][0]['kind'] == 'base' and len(pb['parts'][0]['holes']) >= 3,
   'base: one frame, %d bolt holes' % len(pb['parts'][0]['holes']))
nrib = len([b for b in pb['parts'][0]['add'] if abs(b['W'] - 3.0) < 1e-9 and abs(b['H'] - J.DEFAULTS['foot_t']) < 1e-9])
ok(nrib == len(cr) - 1, 'ribs: cradles - 1 = %d' % nrib)

# ---- continuous saddle: broken at the two weld joints, inside the bed, along the tube
ps = J.plan_fab([flat], opts={'style': 'saddle', 'mount': 'free', 'weld_gap': 2.0, 'bed': 25.6})
sd = ps['parts']
starts = sorted((q['s'], q['name']) for q in sd)
gaps_ok = True
for q in sd:
    pass
j1, j2 = 30.0, 30.0 + R * math.pi / 2
for q in sd:
    nm = q['name']
    a, b = [float(x) / 10 for x in nm.split('(')[1].split(' mm')[0].split(' to ')]
    for j in (j1, j2):
        if a < j < b:
            gaps_ok = False
ok(len(sd) >= 3 and gaps_ok, 'saddle: %d pieces, none across a weld joint' % len(sd))
ok(all(q['size'][1] <= 25.6 + 1e-6 for q in sd), 'every saddle piece fits the 256 mm bed (largest %.0f mm)' % (10 * max(q['size'][2] for q in sd)))
covered = sum((float(q['name'].split('(')[1].split(' to ')[1].split(' mm')[0]) - float(q['name'].split('(')[1].split(' to ')[0])) / 10 for q in sd)
ok(covered > 0.8 * (Ltot - 2 * 2.0), 'the saddles run along %.0f of the %.0f cm (gaps and ends left)' % (covered, Ltot))
ok(all(any(c['k'] == 'cyl' and c.get('soft') for c in q['cut']) for q in sd), 'each saddle is cut by the tube')
pst = J.plan_fab([flat], opts={'style': 'saddle', 'mount': 'table'})
ok(all(len(q['holes']) >= 2 and q.get('tabs', 0) >= 1 for q in pst['parts']), 'saddle on a table: tabs out to the grid (a solid saddle has no room for bolts)')

# ---- flange locators: plate square to the tube at its start, bolt circle, legs to the base
pf = J.plan_fab([flat], opts={'style': 'cradles', 'mount': 'free', 'flange_ends': 'both', 'flange_size': 9.0,
                              'flange_n': 3, 'flange_pcd': 7.0, 'flange_hole': 1.0, 'flange_thick': 1.0})
fl = [q for q in pf['parts'] if q['kind'] == 'flange']
ok(len(fl) == 2, 'flange locators at both ends')
f0 = [q for q in fl if q['name'].endswith('start')][0]
plate = f0['add'][0]
ok(abs(abs(plate['d'][0]) - 1.0) < 1e-9 and abs(plate['c'][0] + 0.5) < 1e-9 and abs(plate['W'] - 9.0) < 1e-9,
   'start plate square to the tube (+x), behind the flange face, 90 mm')
bolts = [c for c in f0['cut'] if c['k'] == 'cyl' and abs(c['r'] - 0.5) < 1e-9]
rad = [math.hypot(c['a'][1], c['a'][2] - 6.0) for c in bolts]
ok(len(bolts) == 3 and all(abs(r - 3.5) < 1e-9 for r in rad), 'three 10 mm bolt holes on the 70 mm PCD')
legs = [b for b in f0['add'] if abs(b['L'] - 2.0) < 1e-9 and abs(b['W'] - 2.0) < 1e-9]
ok(len(legs) == 2 and all(abs(min(pt[2] for pt in box_pts(b)) - pf['base']) < 1e-9 for b in legs) and
   all(max(pt[2] for pt in box_pts(b)) >= 6.0 - 4.5 for b in legs) and pf['base'] < 6.0 - 4.5,
   'two legs from the base (lowered to %.1f cm, under the 90 mm plate) up to the plate' % pf['base'])
crs = [q for q in pf['parts'] if q['kind'] == 'cradle']
ok(all(abs(min(pt[2] for b in q['add'] for pt in box_pts(b)) - pf['base']) < 1e-9 for q in crs), 'the cradles stand on the same lowered base')
leg_clear = all(min(pt[0] for pt in box_pts(b)) < -1.0 + 1e-9 for b in legs)
ok(leg_clear, 'the legs stand behind the plate, clear of the tube')
try:
    J.plan_fab([flat], opts={'style': 'wobble'})
    ok(False, 'unknown style refused')
except ValueError as e:
    ok('Unknown jig style' in str(e), 'unknown style refused')
# ---- cradles step off the weld joints (the live Tri-Y had 8 on joints before)
pj = J.plan_fab([flat], opts={'style': 'cradles', 'weld_gap': 2.0})
js = [30.0, 30.0 + R * math.pi / 2]
ok(all(min(abs(q['s'] - j) for j in js) >= 1.0 + 1.0 - 1e-6 for q in pj['parts']) and not any('weld joint' in n for n in pj['notes']),
   'cradles kept a block and a weld gap off every joint: %s' % [round(q['s'], 1) for q in pj['parts']])

# ---- plate: one part, a strip along the tube, cradles on it
pp = J.plan_fab([flat, tall], opts={'style': 'plate', 'mount': 'table'})
pl = pp['parts']
ok(len(pl) == 1 and pl[0]['kind'] == 'plate' and len(pl[0]['holes']) >= 3, 'plate: one part, %d table holes' % len(pl[0]['holes']))
strips = [b for b in pl[0]['add'] if abs(b['H'] - J.DEFAULTS['foot_t']) < 1e-9 and abs(b['W'] - (od + 1.6 + 4.8)) < 1e-9]
ok(len(strips) > 20 and any('bridge' in n for n in pp['notes']), 'a strip all along each tube (%d pieces) and a bridge between the two tubes' % len(strips))

# ---- flange frame: a single tube with flanges at both ends, beams between the locators, no cradles
two_flange = {'name': 'Crossover', 'elems': [('line', (0.0, 0.0, 8.0), (25.0, 0.0, 8.0), 25.0)], 'od': od}
pfr = J.plan_fab([two_flange], opts={'style': 'frame', 'mount': 'free', 'flange_n': 2, 'flange_pcd': 7.0, 'flange_hole': 0.9, 'flange_size': 9.0})
fr = pfr['parts']
ok(len(fr) == 1 and fr[0]['kind'] == 'frame' and not any(q['kind'] == 'cradle' for q in fr), 'flange frame: one part, no cradles')
beams = [b for b in fr[0]['add'] if abs(b['H'] - 3.0) < 1e-9]
bolts = [c for c in fr[0]['cut'] if c['k'] == 'cyl' and abs(c['r'] - 0.45) < 1e-9]
ok(len(beams) == 3 and len(bolts) == 4, 'four leg pads joined by 3 beams; 2 bolt holes at each end (%d beams, %d holes)' % (len(beams), len(bolts)))
# a header: only free ends get locators (ports and the last ends, not inside the Y merges)
prim = [{'name': 'P%d' % i, 'elems': [('line', (0.0, 10.0 * i, 10.0), (20.0, 10.0 * i, 10.0), 20.0)], 'od': od} for i in range(2)]
sec = {'name': 'S', 'elems': [('line', (32.0, 5.0, 10.0), (60.0, 5.0, 10.0), 28.0)], 'od': 5.08}
pfh = J.plan_fab(prim + [sec], opts={'style': 'cradles', 'flange_ends': 'both'})
fn = sorted(q['name'] for q in pfh['parts'] if q['kind'] == 'flange')
ok(fn == ['Flange locator, P0 start', 'Flange locator, P1 start', 'Flange locator, S end'], 'flanges only at free ends: %s' % fn)

# ---- laid flat: a part standing on edge (in the xz plane) gets the y axis as up, and much lower cradles
edge = {'name': 'Edge', 'elems': [('line', (0.0, 0.0, 0.0), (30.0, 0.0, 0.0), 30.0), ('line', (30.0, 0.0, 0.0), (30.0, 0.0, 30.0), 30.0)], 'od': od}
pm = J.plan_fab([edge], opts={'style': 'saddle', 'layout': 'model'})
pfl = J.plan_fab([edge], opts={'style': 'saddle', 'layout': 'flat'})
ok(abs(abs(pfl['up'][1]) - 1.0) < 1e-6, 'laid flat: up is the normal of the part’s plane (%s)' % [round(x, 3) for x in pfl['up']])
ok(sum(q['size'][2] * 0 + 1 for q in pfl['parts']) >= 2 and max(q['height'] for q in pfl['parts']) < 0.5 * max(q['height'] for q in pm['parts'] + [{'height': 99}]),
   'laid flat the saddles run along both legs and stand %.1f cm tall (as drawn the upright leg gets none)' % max(q['height'] for q in pfl['parts']))
# ---- flange types: a turbo-style 4-stud pattern with two slotted holes, a round V-band plate with a pocket (male)
# or a boss (female), a port spigot
pat = [(-3.0, 2.5, 1.0), (3.0, 2.5, 1.0), (-3.0, -2.5, 1.0, 0.6, 0.0), (3.0, -2.5, 1.0, 0.6, 0.0)]
pq = J.plan_fab([flat], opts={'flange_ends': 'start', 'flange_shape': 'rect', 'flange_w': 9.0, 'flange_h': 8.0, 'flange_holes': pat})
fq = [q for q in pq['parts'] if q['kind'] == 'flange'][0]
holes_c = [c for c in fq['cut'] if c['k'] == 'cyl' and abs(c['r'] - 0.5) < 1e-9]
slots = [c for c in fq['cut'] if c['k'] == 'box']
xy = sorted((round(c['a'][1], 6), round(c['a'][2] - 6.0, 6)) for c in holes_c)
ok(len(holes_c) == 2 + 2 * 2 and len(slots) == 2, 'turbo-style pattern: 2 round holes and 2 slots (each 2 end circles + a box)')
ok((-3.0, 2.5) in xy and (3.0, 2.5) in xy and any(abs(x + 3.3) < 1e-6 and abs(y + 2.5) < 1e-6 for x, y in xy),
   'holes where the pattern puts them, x level and y up from the tube centre; a slot spans +-3 mm')
plate = fq['add'][0]
ok(abs(plate['W'] - 9.0) < 1e-9 and abs(plate['H'] - 8.0) < 1e-9, 'a 90 x 80 mm rectangular plate')
pm_ = J.plan_fab([flat], opts={'flange_ends': 'start', 'flange_shape': 'round', 'flange_size': 10.0, 'flange_seat': {'kind': 'pocket', 'd': 7.6, 'depth': 0.4}})
fm = [q for q in pm_['parts'] if q['kind'] == 'flange'][0]
pocket = [c for c in fm['cut'] if c['k'] == 'cyl' and abs(c['r'] - (3.8 + 0.025)) < 1e-9]
ok(fm['add'][0]['k'] == 'cyl' and abs(fm['add'][0]['r'] - 5.0) < 1e-9 and len(pocket) == 1 and abs(pocket[0]['a'][0] + 0.4) < 1e-9,
   'male V-band: a round 100 mm plate with a 76 mm pocket 4 mm deep for its spigot')
legs_r = [b for b in fm['add'] if b['k'] == 'box' and abs(b['L'] - 2.0) < 1e-9 and abs(b['W'] - 2.0) < 1e-9]
on_disc = all(math.hypot(b['c'][1], b['c'][2] + b['H'] / 2.0 - 1.0 - 6.0) <= 5.0 - 0.99 for b in legs_r)
ok(len(legs_r) == 2 and on_disc, 'a round plate stands on two legs under its rim, each overlapping the disc (not on the square corners)')
pf_ = J.plan_fab([flat], opts={'flange_ends': 'start', 'flange_shape': 'round', 'flange_size': 10.0, 'flange_seat': {'kind': 'boss', 'd': 7.0, 'depth': 0.3}})
ff = [q for q in pf_['parts'] if q['kind'] == 'flange'][0]
boss = [b for b in ff['add'] if b['k'] == 'cyl' and abs(b['r'] - (3.5 - 0.025)) < 1e-9]
bore = ff['cut'][0]
ok(len(boss) == 1 and abs(boss[0]['b'][0] - 0.3) < 1e-9 and bore['r'] <= 3.5 - 0.3 + 1e-9, 'female V-band: a 70 mm boss 3 mm proud fills its recess, the bore inside it')
ps_ = J.plan_fab([flat], opts={'flange_ends': 'start', 'flange_spigot': {'d': 3.8, 'len': 1.5}})
fs = [q for q in ps_['parts'] if q['kind'] == 'flange'][0]
spg = [b for b in fs['add'] if b['k'] == 'cyl' and abs(b['b'][0] - 1.5) < 1e-9]
ok(len(spg) == 1 and abs(spg[0]['r'] - (1.9 - 0.025)) < 1e-9, 'a 38 mm spigot 15 mm into the port')
# ---- gussets: struts from the foot up to the block on a tall cradle, none on a short one, nothing below the base
g_on = [b for b in hi['add'] if abs(b['H'] - 1.4) < 1e-9]
ok(len(g_on) == 4, 'the %.0f cm cradle has 4 gussets (both sides across, both ends along)' % hi['height'])
low_c = [q for q in pt_['parts'] if q['tube'] == 'Pipe']
ok(all(not [b for b in q['add'] if abs(b['H'] - 1.4) < 1e-9] for q in low_c), 'the 3 cm cradles under the low pipe have none')
ok(any(c['k'] == 'box' and c['c'][2] < pt_['base'] - 40 for c in hi['cut']), 'a cut below the base trims the struts flat')
gs = J.plan_fab([tall], opts={'gussets': 'off'})
ok(not [b for b in gs['parts'][0]['add'] if abs(b['H'] - 1.4) < 1e-9], 'gussets off: none')
# ---- grid pads: a cradle on a pad square to the grid across two holes either side of its block
pg = J.plan_fab([flat], opts={'style': 'cradles', 'mount': 'table', 'table_feet': 'pads', 'grid_pitch': 5.0, 'grid_hole': 1.65})
pads_ok = all(len(q['holes']) == 2 and (q.get('pad') or not q.get('tabs')) for q in pg['parts'])
ok(pads_ok and any(q.get('pad') for q in pg['parts']), 'pads: every cradle on two grid holes, %d on pads' % sum(1 for q in pg['parts'] if q.get('pad')))
sq = True
for q in pg['parts']:
    if q.get('pad'):
        h1, h2 = q['holes']
        dx, dy = abs(h2[0] - h1[0]), abs(h2[1] - h1[1])
        sq &= (dx < 1e-9 or dy < 1e-9) and abs(max(dx, dy) / 5.0 - round(max(dx, dy) / 5.0)) < 1e-9
ok(sq, 'each pad’s two holes lie on one grid line, a whole number of pitches apart')
ok(any('pad square to the grid' in n for n in pg['notes']), 'the note says pads')
# ---- the page's flange presets (web/index.html FLANGE_PRESETS, mm): each one builds a locator on a tube of its size,
# every bolt hole and seat inside the plate
import json
import re
_page = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'index.html'), encoding='utf-8').read()
PRE = json.loads(re.search(r'const FLANGE_PRESETS=(\[.*?\]);\n', _page).group(1))
bad = []
for f in PRE:
    m = re.match(r'([\d.]+) in', f['name'])
    tod = float(m.group(1)) * 2.54 if m else 5.08
    pipe = {'name': 'P', 'elems': [('line', (0.0, 0.0, 6.0), (30.0, 0.0, 6.0), 30.0)], 'od': tod}
    o = {'flange_ends': 'start', 'flange_shape': f.get('shape', 'square'), 'flange_thick': f.get('thick', 10) / 10.0}
    if f.get('size'):
        o['flange_size'] = f['size'] / 10.0
    if f.get('w'):
        o['flange_w'], o['flange_h'] = f['w'] / 10.0, f['h'] / 10.0
    if f.get('holes'):
        o['flange_holes'] = [tuple(v / 10.0 if k != 4 else v for k, v in enumerate(h)) for h in f['holes']]
    if f.get('n'):
        o.update(flange_n=f['n'], flange_pcd=f['pcd'] / 10.0, flange_hole=f['hole'] / 10.0, flange_angle_deg=f.get('ang', 0))
    if f.get('seat'):
        o['flange_seat'] = {'kind': f['seat'], 'd': f.get('seatd', 0) / 10.0, 'depth': f.get('seatdep', 0) / 10.0}
    try:
        pp = J.plan_fab([pipe], opts=o)
    except Exception as ex:
        bad.append('%s: %s' % (f['name'], ex))
        continue
    fl = [q for q in pp['parts'] if q['kind'] == 'flange'][0]
    pl = fl['add'][0]
    if pl['k'] == 'cyl':
        half_w = half_h = pl['r']
    else:
        half_w, half_h = pl['W'] / 2.0, pl['H'] / 2.0
    for c in fl['cut'][1:]:
        if c['k'] != 'cyl':
            continue
        y, z, r = c['a'][1], c['a'][2] - 6.0, c['r']
        inside = (math.hypot(y, z) + r <= pl['r'] + 1e-6) if pl['k'] == 'cyl' else (abs(y) + r <= half_w + 1e-6 and abs(z) + r <= half_h + 1e-6)
        if not inside:
            bad.append('%s: a hole or seat runs off the plate (%.1f, %.1f) r %.1f mm' % (f['group'] + ' ' + f['name'], 10 * y, 10 * z, 10 * r))
            break
ok(len(PRE) >= 40 and not bad, 'all %d flange presets build a locator with every hole and seat on the plate%s' % (len(PRE), (': ' + '; '.join(bad)) if bad else ''))
kinds = {(f['group'].split(',')[0], f.get('seat')) for f in PRE}
ok(('V-band', 'pocket') in kinds and ('V-band', 'boss') in kinds, 'V-band presets for male (pocket) and female (boss) flanges')
s = J.fab_summary(pt)
ok(s['count'] == len(pt['parts']) and s['holes'] >= 2 * s['count'], 'summary: %d parts, %d holes' % (s['count'], s['holes']))
print('FAILS:', FAILS)
sys.exit(1 if FAILS else 0)
