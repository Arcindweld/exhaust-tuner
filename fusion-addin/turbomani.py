"""Turbo manifold mode for the scan router (2026-11-13): configuration and thin glue around router.route_header.

The page's Turbo manifold section (Intake tab) sends the runner tube (OD, wall), the bend radius it was laid out with (a
stocked mandrel bend or a B16.9 weld elbow's centre-line radius), the equal length it worked out, the collector (the 20 deg
merge cone's length plus the collector length, and the collector's outside diameter), the clearance to the scan (the
Fabrication tab's auto-route clearance since the boost audit's part 3, 2026-11-13: it was the charge pipes' 2 in hot
clearance, which a runner cannot keep from the head it starts at), the
scrolls (which port markers feed which turbine-flange marker: one group for an undivided manifold, two for a divided one)
and the wastegate's take-off window. This module turns that into route_header calls, one per scroll, sharing one TubeSet so
the runners of the two scrolls keep clear of each other (the way the 180-degree template shares it), each into a collector
marker placed on the turbine flange marker's axis, the merge and collector lengths back from the flange.

What the existing router does and does not do here (it is not changed):
 - it routes each runner from its port marker to a slot on the collector's ring at the merge plane, to the target length,
   with the bend radius given, the clearance to the scan and between tubes;
 - its collector body tapers from the ring's envelope to the outlet diameter over the whole length given, where the page
   models a 20 deg cone then a straight collector: the length and the end diameter agree, the shape between does not;
 - weld elbows: max_bend_deg 90 keeps every bend within one elbow, but the router does not snap bends to whole elbows;
 - the wastegate branch is NOT routed: the router has no branch off a collector. The window the page gives (the centre
   from lo to hi from the turbine flange, the bore, 45 deg) is reported for the owner to place it. Routing it would need a
   router change: a start on the collector body's surface at a given axial position, leaving at 45 deg to the axis (a new
   kind of start, like route_with_parts' attachments but on a cone), then a short route to a wastegate marker.
"""
try:
    from . import router as RT
except ImportError:          # loaded as a top-level module (the add-in's folder is on sys.path), or by the tests
    import router as RT


def merge_marker(p, d, back_cm):
    """the collector marker for route_header: on the turbine flange marker's axis, back_cm before the flange, same direction"""
    u = RT.vunit(tuple(float(v) for v in d))
    return (RT.vsub(tuple(float(v) for v in p), RT.vmul(u, float(back_cm))), u)


def groups(data, nports):
    """the port markers (in selection order, 0-based) of each scroll; one group of all of them when none are given"""
    g = data.get('scrolls') or [list(range(nports))]
    g = [[int(i) for i in s] for s in g]
    flat = [i for s in g for i in s]
    if sorted(flat) != list(range(nports)):
        raise ValueError('Turbo manifold: the page lists %d ports in its scrolls (%s), but %d port markers are selected. '
                         'Select the port markers in cylinder order, then the turbine flange marker%s last.' % (
                             len(flat), ' / '.join('+'.join(str(i + 1) for i in s) for s in g), nports, 's' if len(g) > 1 else ''))
    return g


def check_markers(data, nmarkers):
    n_fl = len(data.get('scrolls') or [0])
    n_port = int(data.get('ports') or 0)
    if n_port and nmarkers != n_port + n_fl:
        raise ValueError('Turbo manifold: select the %d port markers in cylinder order, then %s at the turbine inlet flange '
                         '(drawn from the centre into the turbine) last: %d markers in all, %d are selected.' % (
                             n_port, 'one marker for each of the %d scrolls' % n_fl if n_fl > 1 else 'one marker', n_port + n_fl, nmarkers))
    if nmarkers < n_fl + 2:
        raise ValueError('Turbo manifold: select a marker at each exhaust port (in cylinder order), then %s at the turbine '
                         'inlet flange, drawn from the centre into the turbine.' % ('one marker for each scroll' if n_fl > 1 else 'one marker'))
    return n_fl


def spec_for(rspec, data):
    """the route_header spec: the router's own spec from the page's tube, plus the collector and the elbow limit"""
    s = dict(rspec)
    merge = float(data.get('merge_len_mm') or 0.0) / 10.0
    col = float(data.get('collector_len_mm') or 0.0) / 10.0
    s['collector_len'] = merge + col
    if data.get('collector_out_mm'):
        s['collector_out_d'] = float(data['collector_out_mm']) / 10.0
    if data.get('elbows'):
        s['max_bend_deg'] = 90.0
        s['min_straight'] = 0.0
    return s


def route(scene, ports, flanges, data, rspec, log=None):
    """ports: [(point, direction out of the port)] in cylinder order; flanges: [(point, direction into the turbine)], one per
    scroll. Returns {'jobs': [{'ports', 'res', 'spec', 'name'}], 'ok', 'msg', 'notes', 'lengths', 'spread'}."""
    G = groups(data, len(ports))
    if len(flanges) != len(G):
        raise ValueError('Turbo manifold: %d scroll%s, %d turbine flange marker%s selected.' % (
            len(G), '' if len(G) == 1 else 's', len(flanges), '' if len(flanges) == 1 else 's'))
    tubes = RT.TubeSet()
    jobs = []
    for k, g in enumerate(G):
        sp = spec_for(rspec, data)
        sp['tubes'] = tubes
        sp['owner_base'] = 100 * k
        col = merge_marker(flanges[k][0], flanges[k][1], sp['collector_len'])
        res = RT.route_header(scene, [ports[i] for i in g], col, sp, log=log)
        jobs.append({'ports': g, 'res': res, 'spec': sp, 'collector_marker': col,
                     'name': 'Merge collector' + (' (scroll %d: %s)' % (k + 1, '+'.join(str(i + 1) for i in g)) if len(G) > 1 else '')})
    lens = [r['length'] for j in jobs for r in j['res']['primaries'] if r and r.get('length')]
    tgt = rspec.get('target')
    notes = []
    gate = data.get('gate') or {}
    if gate.get('bore_mm'):
        notes.append('Wastegate: not routed (the router has no branch off a collector). Put a %.1f mm (%.3f in) branch at 45 deg '
                     'on the collector, its centre %.0f to %.0f mm (%.2f to %.2f in) from the turbine flange, as the page placed it.' % (
                         gate['bore_mm'], gate['bore_mm'] / 25.4, gate.get('lo_mm', 0), gate.get('hi_mm', 0),
                         gate.get('lo_mm', 0) / 25.4, gate.get('hi_mm', 0) / 25.4))
    notes.append('The collector here tapers from the runners\' ring to the outlet bore over its whole length; the page works out its loss '
                 'for a 20 deg merge cone then a straight collector of the same total length and end bore.')
    if len(G) > 1:
        notes.append('Divided: each scroll\'s runners go to their own flange marker; the two collectors are routed apart and '
                     'meet only at the flange.')
    spread = (max(lens) - min(lens)) if len(lens) > 1 else 0.0
    miss = max(abs(L - tgt) for L in lens) if (lens and tgt) else None
    ok = all(j['res']['ok'] for j in jobs)
    msg = 'Built %d runner%s into %d collector%s' % (len(lens), '' if len(lens) == 1 else 's', len(G), '' if len(G) == 1 else 's')
    if lens:
        msg += '; lengths within %.2f mm of each other' % (10 * spread)
        if miss is not None:
            msg += ', at most %.2f mm from the page\'s %.1f mm' % (10 * miss, 10 * tgt)
    msg += '.' if ok else '. Some runners need attention (see below).'
    return {'jobs': jobs, 'ok': ok, 'msg': msg, 'notes': notes, 'lengths': lens, 'spread': spread, 'miss': miss}
