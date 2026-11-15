"""Treadstone (TRE) intercoolers: a sanity check of the maker's claims (2026-11-14).

The figures are Treadstone's as its authorised retailers list them (the maker's own site refuses automated
reading; nothing here is read from it). The table and the per-field sources are in
docs/BOOST_AUDIT_2026-11-12.md ("Addendum (2026-11-14): Treadstone intercoolers"). This script recomputes the
checks given there, from the core sizes and the claims only:

  * CFM per hp claimed (Corky Bell's 1.5 cfm per hp, the page's conversion; Garrett: Wa = HP x A/F x BSFC / 60);
  * the charge face (the cross-section the charge enters) and the mass flux through it at the claimed CFM, read as
    standard air (1.1839 kg/m3, 101.325 kPa, 25 C: the page's reading of Bell's CFM, since neither maker says);
  * Bell's flow-area rule (6 in2 per 100 hp at 45 % open: 13.33 in2 of face per 100 hp) for the claimed hp;
  * Bell Intercoolers' own catalogue rates every listed air-cooled core at 1 psi for 13.39 CFM per in2 of charge face
    over a 24 in charge length (computed below from the seven catalogue rows in the page). Scaled to a Treadstone core
    at its claimed CFM: dp = 1 psi x (flux ratio)^n x (length / 24 in), n = 2 (fixed loss coefficient) and n = 1.8
    (a Reynolds-number dependence); a different fin can differ, so this is a family check, not a prediction;
  * hp per litre of core against Garrett's rated cores of similar volume (within 20 %), and hp per in2 of face.

Run: python3 tools/validation/boost/treadstone.py
"""

IN2 = 0.00064516
CFM = 0.028316846592 / 60.0          # m3/s per cfm
RHO = 101325 / (287.05 * 298.15)     # the page's BELL_RHO

# model: (length across, height, thickness) in, flow ('h': charge along the length; 'v': along the height),
# hp claim, CFM claim (None: not stated)
TRE = {
    'TR6':      ((22, 6, 3.5), 'h', 400, 600),
    'TR62':     ((22, 6, 3.5), 'h', 450, None),
    'TR8':      ((22, 7.8, 3.5), 'h', 500, 750),
    'TR8C':     ((22, 7.8, 3.5), 'h', 500, 750),
    'TR8L':     ((24, 7.8, 3.5), 'h', 500, 750),
    'TR82':     ((22, 7.8, 3.5), 'h', 500, 750),
    'TR10':     ((24, 10.5, 3.5), 'h', 666, 1000),
    'TR10C':    ((22, 10.5, 3.5), 'h', 700, 1050),
    'TR1035':   ((22, 10.5, 3.5), 'h', 666, 1000),
    'TR1045':   ((22, 10.5, 4.5), 'h', 860, 1300),
    'TR11':     ((21.5, 11, 3), 'h', 560, 860),
    'TR1235':   ((22, 12.5, 3.5), 'h', 760, 1142),
    'TR1235R':  ((22, 12.5, 3.5), 'h', 928, 2010),     # 928 (Turbozentrum .de) or 1340 (.co.uk, MSC): the lower here
    'TR1245':   ((22, 12.5, 4.5), 'h', 1000, 1469),
    'TR1245R':  ((22, 12.5, 4.5), 'h', 1340, 2010),
    'TR1245-28': ((28, 12.5, 4.5), 'h', 1200, 1800),
    'TRV25':    ((25, 6, 3.5), 'v', 1000, 1492),
    'TRV259':   ((25, 9, 3.5), 'v', 1300, 1950),
    'TRV185':   ((470 / 25.4, 152 / 25.4, 89 / 25.4), 'v', 720, None),
}

# Garrett air-to-air rows of IC_LIB: (hot-flow length, height no flow, width cold flow) in, supported hp
GARRETT = [((10.2, 8.1, 4.7), 300), ((18.0, 6.4, 3.0), 310), ((10.0, 12.3, 4.5), 375), ((18.0, 8.0, 3.0), 410),
           ((18.0, 8.0, 3.5), 425), ((13.5, 8.6, 5.5), 450), ((24.0, 6.4, 3.0), 475), ((24.0, 6.4, 3.5), 500),
           ((18.0, 10.5, 3.0), 510), ((14.0, 12.1, 3.5), 550), ((20.1, 11.2, 3.0), 600), ((24.0, 8.0, 3.5), 600),
           ((21.0, 5.4, 5.3), 600), ((13.0, 10.2, 4.0), 600), ((27.5, 6.2, 3.5), 660), ((8.0, 24.0, 3.5), 750),
           ((9.0, 22.1, 4.0), 750), ((18.0, 12.1, 3.0), 750), ((18.0, 11.2, 4.5), 750), ((21.0, 9.4, 5.3), 750),
           ((18.0, 12.1, 4.5), 785), ((24.0, 10.5, 3.5), 800), ((26.3, 7.8, 4.3), 800), ((24.0, 12.1, 3.0), 900),
           ((24.0, 12.1, 3.5), 925), ((24.0, 12.1, 4.5), 950), ((26.8, 10.4, 4.0), 950), ((23.7, 12.0, 3.8), 1000),
           ((12.0, 22.4, 4.5), 1100), ((27.8, 12.7, 5.1), 1260), ((14.0, 22.1, 4.5), 1275)]

# Bell Intercoolers rows of IC_LIB: A (thickness), B (height), C (charge length) in, CFM at 1 psi
BELL = [(3.5, 9.7, 24, 455), (3.5, 13, 24, 609), (3.5, 14.3, 24, 670), (3.5, 16.9, 24, 792), (3, 22.7, 24, 912),
        (3.5, 24, 24, 1125), (3.5, 28, 24, 1312)]


def face_len(dims, flow):
    L, H, T = dims
    return (H * T, L) if flow == 'h' else (L * T, H)


def main():
    bflux = [cfm / (a * b) for a, b, c, cfm in BELL]
    bf = sum(bflux) / len(bflux)
    print('Bell catalogue: CFM per in2 of charge face at 1 psi over 24 in: %s (mean %.3f)'
          % (', '.join('%.3f' % x for x in bflux), bf))
    print()
    print('%-10s %7s %7s %6s %8s %9s %9s %8s %8s %8s %7s  %s' % (
        'model', 'face', 'len', 'cfm/hp', 'kg/s', 'G kg/sm2', 'Bell face', 'face/B', 'dp n=2', 'dp n=1.8', 'hp/L', 'Garrett hp/L, similar volume'))
    for k, (dims, flow, hp, cfm) in TRE.items():
        A, Lf = face_len(dims, flow)
        vol = dims[0] * dims[1] * dims[2] * 0.016387064
        need = hp * 6 / 100 / 0.45
        hpl = hp / vol
        near = [g for g in GARRETT if abs(g[0][0] * g[0][1] * g[0][2] * 0.016387064 / vol - 1) <= 0.20]
        gr = sorted(h / (d[0] * d[1] * d[2] * 0.016387064) for d, h in near)
        gtxt = ('%.1f to %.1f (%d cores)' % (gr[0], gr[-1], len(gr))) if gr else 'none within 20 %'
        if cfm:
            m = cfm * CFM * RHO
            G = m / (A * IN2)
            r = (cfm / A) / bf
            dp2, dp18 = r ** 2 * Lf / 24, r ** 1.8 * Lf / 24
            print('%-10s %7.2f %7.2f %6.3f %8.4f %9.1f %9.2f %8.3f %8.2f %8.2f %7.1f  %s' % (
                k, A, Lf, cfm / hp, m, G, need, A / need, dp2, dp18, hpl, gtxt))
        else:
            print('%-10s %7.2f %7.2f %6s %8s %9s %9.2f %8.3f %8s %8s %7.1f  %s' % (
                k, A, Lf, '-', '-', '-', need, A / need, '-', '-', hpl, gtxt))
    print()
    gh = [h / (d[1] * d[2]) for d, h in GARRETT]
    print('Garrett hp per in2 of charge face (height x width): %.1f to %.1f' % (min(gh), max(gh)))
    for k, (dims, flow, hp, cfm) in TRE.items():
        A, _ = face_len(dims, flow)
        print('  %-10s %.1f hp per in2' % (k, hp / A))


if __name__ == '__main__':
    main()
