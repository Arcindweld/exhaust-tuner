#!/usr/bin/env python3
"""Re-read the curve nodes of Conflux Technology's brochures (audit 3, findings C1 and O3 in
docs/BOOST_AUDIT_2026-11-12.md Part 2). The brochures are the maker's copyrighted PDFs supplied by the owner and are NOT
in the repository: pass their paths.

    python3 -I tools/validation/boost/conflux_curves.py oil.pdf [barrel.pdf]

Method (written for this audit, not the earlier extraction): each chart's axes are fitted to its own gridlines
(pdfplumber lines: horizontal and vertical rules inside the chart box) paired with the tick labels' values, least
squares; the data curve is the stroked path wider than 1 pt inside the chart; its nodes are the path's move-to point and
each cubic segment's end point (the control points are the plotting program's smoothing). Prints each node in data units.
"""
import sys
import numpy as np
import pdfplumber


def axis_fit(lines, labels, horizontal):
    """lines: positions of the gridlines; labels: (position, value) of the tick labels. Pair each label with the
    nearest gridline (or keep the label position for the zero, which has the axis line) and fit value = a pos + b."""
    pos, val = [], []
    for p, v in labels:          # only labels with their own gridline (a label's centre sits about 0.8 pt off its line)
        near = min(lines, key=lambda q: abs(q - p)) if lines else None
        if near is not None and abs(near - p) < 3:
            pos.append(near); val.append(v)
    assert len(pos) >= 3, 'too few gridlines matched'
    a, b = np.polyfit(pos, val, 1)
    return lambda q: a * q + b


def charts(pg, ymin=500, ymax=720):
    words = [w for w in pg.extract_words() if w['text'].replace('.', '').isdigit() and ymin < w['top'] < ymax]
    cx = lambda w: (w['x0'] + w['x1']) / 2
    cy = lambda w: (w['top'] + w['bottom']) / 2
    tops = [round(w['top']) for w in words]
    xlab_top = max(t for t in set(tops) if tops.count(t) >= 6)     # the row of x tick labels (both charts)
    xl = [w for w in words if abs(w['top'] - xlab_top) < 2]
    mid = (min(cx(w) for w in xl) + max(cx(w) for w in xl)) / 2
    L = [l for l in pg.lines if ymin < l['top'] < ymax]
    hl = [l for l in L if abs(l['top'] - l['bottom']) < 0.01 and l['x1'] - l['x0'] > 100]
    vl = [l for l in L if abs(l['x0'] - l['x1']) < 0.01 and l['bottom'] - l['top'] > 50]
    out = []
    for side in (0, 1):
        sel = (lambda x: x < mid) if side == 0 else (lambda x: x >= mid)
        xs = [(cx(w), float(w['text'])) for w in xl if sel(cx(w))]
        x_lo = min(p for p, _ in xs) - 15
        ys = [(cy(w), float(w['text'])) for w in words if abs(w['top'] - xlab_top) >= 2 and sel(cx(w)) and cx(w) < x_lo + 15]
        fx = axis_fit(sorted(l['x0'] for l in vl if sel(l['x0'])), xs, False)
        fy = axis_fit(sorted(l['top'] for l in hl if sel((l['x0'] + l['x1']) / 2)), ys, True)
        out.append((sel, fx, fy))
    return out


def nodes(pdf, page):
    pg = pdf.pages[page]
    C = charts(pg)
    res = []
    for c in pg.curves:
        xs = [p[0] for p in c['pts']]
        if not (c.get('linewidth', 0) > 1 and min(p[1] for p in c['pts']) > 500 and max(xs) - min(xs) > 30):
            continue
        pts = [c['path'][0][1]] + [t[-1] for t in c['path'][1:]]
        for side, (sel, fx, fy) in enumerate(C):
            if sel(np.mean(xs)):
                res.append((side, [(float(fx(x)), float(fy(y))) for x, y in pts]))
    return res


def main():
    oil = sys.argv[1]
    with pdfplumber.open(oil) as pdf:
        for page, pn in ((3, '100220'), (4, '100219'), (5, '100218')):
            for side, pts in nodes(pdf, page):
                print('oil %s %s: %s' % (pn, 'drop kPa' if side == 0 else 'heat kW', ', '.join('(%.3f L/min, %.3f)' % p for p in pts)))
    if len(sys.argv) > 2:
        with pdfplumber.open(sys.argv[2]) as pdf:
            for i, pg in enumerate(pdf.pages):
                for side, pts in (nodes(pdf, i) if len(pg.curves) else []):
                    print('barrel page %d chart %d: %s' % (i + 1, side, ', '.join('(%.4f, %.3f)' % p for p in pts)))


if __name__ == '__main__':
    main()
