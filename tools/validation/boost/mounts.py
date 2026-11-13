#!/usr/bin/env python3
"""Independent checks of the Mounts designer (web/index.html mtShares, mtSecStress, mtWeldGroup, mtBoltCap,
mtIsolators, mtStayChecks, mtFlat), written from the sources, not from the page (audit 3, docs/BOOST_AUDIT_2026-11-12.md,
Part 2, findings M1-M9).

  python3 tools/validation/boost/mounts.py        prints every case; web/tests/boostaudit2_ui.js pins the page to these

Sources:
  load sharing   a rigid body on n equal isotropic springs: the 6 x 6 stiffness K = k sum [[I, -[p]x], [[p]x, -[p]x^2]]
                 solved for (u, theta) at an arbitrary origin (no centroid, no pseudo-inverse: the formulation the page's
                 F/n + (J+ M) x s should reduce to); and a statically determinate hand case: three mounts in a horizontal
                 plane under a vertical load (three unknowns, three equations: sum F, sum M about x and z).
  transmissibility  base excitation, viscous damping: T = sqrt(1 + (2 z r)^2) / sqrt((1 - r^2)^2 + (2 z r)^2)
                 (University of Iowa 58:153 lecture 9; any vibration text).
  beam root      sigma = N/A + M_a c_b / I_a + M_b c_a / I_b at the corner, tau = 1.5 V / A (rectangle) + T t / (b t^3 / 3)
                 (thin rectangle), von Mises sqrt(sigma^2 + 3 tau^2) (Shigley ch. 3 and 5 as quoted in open notes).
  columns        Euler P = pi^2 E I / L^2 (pinned), Johnson's parabola sigma = Sy - (Sy / 2 pi)^2 (L/k)^2 / E below
                 (L/k)_cr = sqrt(2 pi^2 E / Sy) (Wikipedia "Johnson's parabolic formula", raw text read 2026-11-12;
                 MechaniCalc "Column Buckling": the transition where the Euler stress is Sy / 2).
  bolts          ISO 898-1: As = pi/4 ((d2 + d3)/2)^2, d2 = d - 0.649519 P, d3 = d - 1.226869 P; shear 0.6 x tensile on
                 the minor area (Portland Bolt); Fastenal 8.8 proof 580 / tensile 800 MPa.
  welds          a fillet weld as a line (Blodgett): force per length f = N/L + M c / I_w with I_w = sum of the line's
                 second moment; stress on the throat 0.707 x leg; AWS D1.1 allowable 0.30 FEXX.
  bend allowance BA = (pi/2)(R + K t) for 90 deg; flat = outside lengths less the setback (R + t) at the bend.
"""
import math
import numpy as np

G = 9.80665


def skew(p):
    x, y, z = p
    return np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]], float)


def shares_springs(P, F, com=(0, 0, 0)):
    """Mount forces on a rigid body held by equal isotropic springs (k = 1), load F at com. Least squares when the
    mounts are on one line (the turn about it has no stiffness)."""
    P = [np.array(p, float) for p in P]
    K = np.zeros((6, 6))
    for p in P:
        S = skew(p)
        K[:3, :3] += np.eye(3); K[:3, 3:] += -S; K[3:, :3] += S; K[3:, 3:] += -S @ S
    F = np.array(F, float)
    M = np.cross(np.array(com, float), F)
    q, *_ = np.linalg.lstsq(K, np.concatenate([F, M]), rcond=1e-12)
    u, th = q[:3], q[3:]
    return [u + np.cross(th, p) for p in P]


def three_mount_vertical(P, W, com):
    """Statically determinate: three mounts at (x, 0, z), vertical load W (downward) at com = (xc, yc, zc).
    Unknown upward reactions R1..R3: sum R = W, sum R x = W xc, sum R z = W zc."""
    A = np.array([[1, 1, 1], [P[0][0], P[1][0], P[2][0]], [P[0][2], P[1][2], P[2][2]]], float)
    return np.linalg.solve(A, np.array([W, W * com[0], W * com[2]], float))


def transmiss(r, z):
    return math.sqrt(1 + (2 * z * r) ** 2) / math.sqrt((1 - r * r) ** 2 + (2 * z * r) ** 2)


def rect_root(b, t, N, Mb_strong, Mb_weak, T, V):
    """Strap b (wide) x t at its root: Mb_weak bends through the thickness, Mb_strong across the width."""
    A = b * t; Iw = b * t ** 3 / 12; Is = t * b ** 3 / 12
    sig = abs(N) / A + abs(Mb_weak) * (t / 2) / Iw + abs(Mb_strong) * (b / 2) / Is
    tau = 1.5 * abs(V) / A + abs(T) * t / (b * t ** 3 / 3)
    return sig, tau, math.sqrt(sig * sig + 3 * tau * tau)


def column(D, w, L, E, Sy):
    di = D - 2 * w
    A = math.pi * (D * D - di * di) / 4
    I = math.pi * (D ** 4 - di ** 4) / 64
    k = math.sqrt(I / A); s = L / k; scr = math.sqrt(2 * math.pi ** 2 * E / Sy)
    euler = math.pi ** 2 * E * I / L ** 2
    johnson = A * (Sy - (Sy / (2 * math.pi)) ** 2 * s * s / E)
    return dict(A=A, I=I, k=k, slender=s, scr=scr, euler=euler, johnson=johnson, yieldN=Sy * A,
                cap=euler if s >= scr else johnson)


def bolt(d, P, As, proof, uts):
    d3 = d - 1.226869 * P; d2 = d - 0.649519 * P
    As_iso = math.pi / 4 * ((d2 + d3) / 2) ** 2
    return dict(As_iso=As_iso, T=proof * As, V=0.6 * uts * math.pi * d3 * d3 / 4, d3=d3)


def weld_strap_two_faces(b, t, N, M_weak, M_strong, T, V):
    """Fillet welds along both long faces of a b x t strap (lines of length b at +-t/2). Line properties:
    L = 2b; I about the width axis (bending through the thickness) = 2 b (t/2)^2; I about the thickness axis =
    2 b^3 / 12; polar = sum. Worst end of a line: (b/2, t/2)."""
    L = 2 * b; Iw = 2 * b * (t / 2) ** 2; Is = 2 * b ** 3 / 12; J = Iw + Is
    fn = abs(N) / L + abs(M_weak) * (t / 2) / Iw + abs(M_strong) * (b / 2) / Is
    fs = abs(V) / L + abs(T) * math.hypot(b / 2, t / 2) / J
    return math.hypot(fn, fs)


def main():
    print('M1 load sharing')
    # asymmetric three-mount case: mounts in the horizontal plane y = 0 (mm, from the part's centre), load at the centre
    P3 = [(-200.0, 0, -100.0), (300.0, 0, -100.0), (-100.0, 0, 250.0)]
    W = 10 * G
    c = np.mean(np.array(P3), axis=0)
    R = three_mount_vertical(P3, W, (0, 0, 0))
    S = shares_springs(P3, (0, -W, 0))
    print('  hand (statics) R =', ['%.6f' % x for x in R], 'N; springs:', ['%.6f' % (-s[1]) for s in S])
    # the same mounts, 25 g sideways plus gravity with the centre of mass 80 mm above the mount plane: indeterminate,
    # the equal-spring answer (both formulations), and equilibrium
    com = (0, 80.0, 0)
    Fs = (25 * W, -W, 0)
    S2 = shares_springs([np.array(p) - 0 for p in P3], Fs, com)
    tot = sum(S2); mom = sum(np.cross(np.array(p), s) for p, s in zip(P3, S2))
    print('  25 g side, com 80 mm up: forces', [tuple(round(v, 6) for v in s) for s in S2])
    print('  sum F', tot.round(9), 'sum M', mom.round(6), 'load M', np.cross(np.array(com), np.array(Fs)).round(6))
    # four mounts, asymmetric, the page's convention (com at the part's centre = origin)
    P4 = [(-330.0, -152.4, 0), (330.0, -152.4, 0), (-250.0, 152.4, 0), (330.0, 152.4, 30.0)]
    S4 = shares_springs(P4, (0, -26 * 7 * G, 25 * 7 * G))
    print('  four asymmetric, 26 g down + 25 g fwd on 7 kg:', [tuple(round(v, 6) for v in s) for s in S4])

    print('M2 isolation')
    for (f, fn, z) in ((28.3333333, 11.567, 0.07), (28.3333333, 21.966, 0.07), (40.0, 12.0, 0.07)):
        r = f / fn
        print('  f %.4f fn %.4f r %.5f T undamped %.6f damped %.6f' % (f, fn, r, 1 / abs(1 - r * r), transmiss(r, z)))
    m, n, Tt, f = 7.0, 4, 0.2, 4 * 850 / 120
    fnmax = f / math.sqrt(1 + 1 / Tt); kmax = m * (2 * math.pi * fnmax) ** 2 / n / 1000
    print('  target 20%%: fn max %.6f Hz (undamped inversion), k max %.6f N/mm; damped T at fn max %.6f' % (fnmax, kmax, transmiss(f / fnmax, 0.07)))
    from scipy.optimize import brentq
    rT = brentq(lambda r: transmiss(r, 0.07) - Tt, math.sqrt(2) + 1e-9, 50.0)
    for mm in (7.0, 40.0):
        k = mm * (2 * math.pi * f / rT) ** 2 / n / 1000
        print('  damped inversion (brentq): r %.6f fn max %.6f Hz, %g kg: k max %.6f N/mm, sag %.6f mm' % (rT, f / rT, mm, k, mm * G / (n * k)))

    print('M3 strap root (case A forward, 3/16 in x 54 mm, M = 63.5 x 429.041)')
    Ff = 25 * 7 * G / 4; Fd = 7 * G / 4
    sig, tau, vm = rect_root(54, 4.7498, Fd, 0, 63.5 * Ff, 0, Ff)
    print('  sigma %.4f tau %.4f vm %.4f SF %.4f' % (sig, tau, vm, 248 / vm))
    # second set: side 25 g on the same mount with a 20 mm offset along the width: torsion about the upright
    Fs1 = 25 * 7 * G / 4
    sig, tau, vm = rect_root(54, 4.7498, Fd, 63.5 * Fs1, 0, 20 * Fs1, Fs1)
    print('  side 25 g, offset 20 mm along the width: sigma %.4f tau %.4f vm %.4f' % (sig, tau, vm))

    print('M4 stay column')
    for (D, w, L, E, Sy) in ((19.05, 1.651, 300.0, 205000.0, 248.0), (19.05, 1.651, 1000.0, 205000.0, 248.0), (25.4, 1.651, 400.0, 68300.0, 103.0)):
        cc = column(D, w, L, E, Sy)
        print('  D %.2f w %.3f L %.0f: A %.4f I %.3f L/k %.4f (cr %.4f) Euler %.2f Johnson %.2f yield %.2f -> %.2f N'
              % (D, w, L, cc['A'], cc['I'], cc['slender'], cc['scr'], cc['euler'], cc['johnson'], cc['yieldN'], cc['cap']))

    print('M5 bolts')
    b8 = bolt(8, 1.25, 36.6, 580, 800)
    print('  M8 8.8: As(ISO) %.4f mm2 (Fastenal 36.6), T %.2f N, V %.2f N, d3 %.5f' % (b8['As_iso'], b8['T'], b8['V'], b8['d3']))
    u38 = bolt(9.525, 25.4 / 16, 0.0775 * 645.16, 85 * 6.894757, 120 * 6.894757)
    print('  3/8-16 Grade 5: As(ISO form) %.4f mm2 (Fastenal 0.0775 in2 = %.4f), T %.2f N, V %.2f N' % (u38['As_iso'], 0.0775 * 645.16, u38['T'], u38['V']))

    print('M6 weld, strap both faces, case A forward')
    fr = weld_strap_two_faces(54, 4.7498, Fd, 63.5 * Ff, 0, 0, Ff)
    print('  f %.4f N/mm; E70 cap per mm at 4.7498 leg: %.4f N/mm' % (fr, 0.30 * 70 * 6.894757 * 0.707 * 4.7498))

    print('M7 bend allowance and flat lengths: t 4.7498, R = t, K 0.42, foot Lf, reach h')
    t = 4.7498; R = t; K = 0.42; BA = math.pi / 2 * (R + K * t)
    print('  BA %.5f mm' % BA)

    print('M8 net section at a hole (Kt not applied: static, ductile)')
    b, t, d = 54.0, 4.7498, 27.0
    print('  net width %.3f, area %.4f, I %.4f' % (b - d, (b - d) * t, (b - d) * t ** 3 / 12))


if __name__ == '__main__':
    main()
