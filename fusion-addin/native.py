"""The Rust core (rust/et_core in the repository) for router.py: the scene's distance queries, the tube set's
distances, the clearance fields, and route()'s lattice search, fit and clearance check, which are where the
router spends its time.

It loads et_core.dll (Windows), libet_core.dylib (macOS) or libet_core.so (Linux) from this folder with ctypes,
so it does not depend on Fusion's Python version. When there is no library, it does not load, its interface
version is not this file's, or EXHAUST_TUNER_PURE_PYTHON is set, AVAILABLE is False (WHY says why) and the
router runs its own Python, which gives the same answers, only slower (the same routes too, unless the slower run is
stopped by a route's time limit first).

It loads a copy (native/et_core-<first 12 hex of its SHA-1>.dll beside it), not the file itself: Windows keeps a
loaded DLL locked until Fusion quits, and Python never unloads one, so an update could not replace et_core.dll
while Fusion was open. Older copies are removed when they are no longer in use.

Every call is checked: one the Rust core could not do raises CoreError with its reason, and router.py then does
that work in Python instead.
"""
import ctypes
import os
import sys
import time
from array import array

ABI = 2
HERE = os.path.dirname(os.path.abspath(__file__))
NONE = -(2 ** 63)                     # "no owner to skip" (i64::MIN on the Rust side)

_D = ctypes.c_double
_PD = ctypes.POINTER(ctypes.c_double)
_PQ = ctypes.POINTER(ctypes.c_int64)
_VP = ctypes.c_void_p
_SZ = ctypes.c_size_t
_I = ctypes.c_int
_Q = ctypes.c_int64


class CoreError(RuntimeError):
    """The Rust core could not do a call (bad input, or a fault it caught); the message says why."""


def _names():
    if os.name == 'nt':
        return ['et_core.dll']
    if sys.platform == 'darwin':
        return ['libet_core.dylib']
    return ['libet_core.so']


def _sig(lib):
    for name, res, args in (
            ('et_abi_version', ctypes.c_uint32, []),
            ('et_scene_new', _VP, [_D, _D, ctypes.c_uint64]),
            ('et_scene_free', None, [_VP]),
            ('et_scene_add_mesh', _I, [_VP, _PD, _SZ, _PQ, _SZ, _D]),
            ('et_scene_build', _I, [_VP, _PD, _PD, _D]),
            ('et_scene_stats', _I, [_VP, _PD]),
            ('et_scene_any_within', _I, [_VP, _PD, _D, _PD, _SZ]),
            ('et_scene_dist_fast', _D, [_VP, _PD, _D, _PD, _SZ]),
            ('et_scene_dist_exact', _D, [_VP, _PD, _D, _PD, _SZ]),
            ('et_scene_dist_fast_many', _I, [_VP, _PD, _SZ, _D, _PD, _SZ, _PD]),
            ('et_scene_points_near', _SZ, [_VP, _PD, _D, _PD, _SZ]),
            ('et_scene_points', _SZ, [_VP, _PD, _SZ]),
            ('et_tubes_new', _VP, [_D]),
            ('et_tubes_free', None, [_VP]),
            ('et_tubes_add_polyline', _I, [_VP, _PD, _SZ, _D, _Q]),
            ('et_tubes_dist', _D, [_VP, _PD, _D, _Q, _Q]),
            ('et_field_new_scene', _VP, [_VP, _D, _D, _PD, _SZ]),
            ('et_field_new_tubes', _VP, [_VP, _D, _D, _Q, _Q]),
            ('et_field_free', None, [_VP]),
            ('et_field_eval', _I, [_VP, _PD, _SZ, _PD]),
            ('et_last_error', _SZ, [ctypes.c_char_p, _SZ]),
            ('et_failed', _I, []),
            ('et_route_new', _VP, [_VP, _VP, _Q, _Q, _VP, _VP, _VP, _VP, _PD, _SZ, _PD]),
            ('et_route_free', None, [_VP]),
            ('et_route_search', _Q, [_VP, _D, _Q, _D, _PQ]),
            ('et_route_path', _SZ, [_VP, _PD, _SZ]),
            ('et_route_lm', _I, [_VP, _PD, _SZ, _D, _D, _PD, _PD, _SZ, _D, _SZ, _Q, _D, _D, _PD]),
            ('et_route_residual', _Q, [_VP, _PD, _SZ, _D, _D, _PD, _PD, _SZ, _D, _SZ, _PD, _SZ]),
            ('et_route_certify', _I, [_VP, _PD, _SZ, _PD]),
            ('et_route_free_at', _I, [_VP, _PD, _D]),
            ('et_route_los', _I, [_VP, _PD, _PD, _D]),
            ('et_cyl_cost', _D, [_PD, _SZ, _PD, _PD, _D, _D]),
            ('et_scene_min_dist', _D, [_VP, _PD, _SZ, _D, _PD, _SZ, _I]),
            ('et_scene_nearest', _I, [_VP, _PD, _SZ, _D, _PD, _SZ, _PD])):
        f = getattr(lib, name)
        f.restype = res
        f.argtypes = args


def _private_copy(p):
    """The library at p as a copy named by its content (see above); p itself when the copy cannot be made."""
    try:
        import hashlib
        with open(p, 'rb') as f:
            data = f.read()
        base, ext = os.path.splitext(os.path.basename(p))
        d = os.path.join(os.path.dirname(p), 'native')
        name = '%s-%s%s' % (base, hashlib.sha1(data).hexdigest()[:12], ext)
        q = os.path.join(d, name)
        if not os.path.isfile(q):
            if not os.path.isdir(d):
                try:
                    os.makedirs(d)
                except OSError:          # another Fusion made it at the same moment
                    if not os.path.isdir(d):
                        raise
            tmp = '%s.%d.part' % (q, os.getpid())
            with open(tmp, 'wb') as f:
                f.write(data)
            for attempt in range(5):
                try:
                    os.replace(tmp, q)
                    break
                except OSError:
                    if os.path.isfile(q):    # another Fusion made it first and has it open: use theirs
                        break
                    if attempt == 4:
                        raise
                    time.sleep(0.1 * (attempt + 1))  # a virus scanner can hold a new file for a moment
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
        for old in os.listdir(d):        # earlier versions' copies, unless a running Fusion still has one
            if old != name and old.startswith(base + '-'):
                try:
                    os.remove(os.path.join(d, old))
                except OSError:
                    pass
        return q
    except (OSError, IOError):
        return p


def _load():
    if os.environ.get('EXHAUST_TUNER_PURE_PYTHON'):
        return None, 'turned off by EXHAUST_TUNER_PURE_PYTHON'
    dirs = [HERE]
    if os.environ.get('EXHAUST_TUNER_NATIVE_DIR'):
        dirs.insert(0, os.environ['EXHAUST_TUNER_NATIVE_DIR'])
    why = 'no %s next to the add-in' % ' or '.join(_names())
    for d in dirs:
        for n in _names():
            p = os.path.join(d, n)
            if not os.path.isfile(p):
                continue
            q = _private_copy(p)
            try:
                lib = ctypes.CDLL(q)
                _sig(lib)
                v = lib.et_abi_version()
            except (OSError, AttributeError) as ex:
                why = '%s did not load: %s' % (n, ex)
                continue
            if v != ABI:
                why = '%s is interface %d, this add-in needs %d' % (n, v, ABI)
                continue
            return lib, 'loaded %s' % q
    return None, why


lib, WHY = _load()
AVAILABLE = lib is not None


def _dbuf(seq):
    """A double buffer ctypes can pass without copying (array('d') is kept alive by the caller)."""
    a = seq if isinstance(seq, array) and seq.typecode == 'd' else array('d', seq)
    return a, (ctypes.c_double * len(a)).from_buffer(a) if len(a) else None


def _pack_planes(planes):
    if not planes:
        return None, 0
    flat = []
    for o, n, eps in planes:
        flat.extend((float(o[0]), float(o[1]), float(o[2]), float(n[0]), float(n[1]), float(n[2]), float(eps)))
    return (ctypes.c_double * len(flat))(*flat), len(planes)


class _Planes(object):
    """Packed planes, cached per plane list (the router passes the same few lists over and over)."""

    def __init__(self):
        self.c = {}

    def get(self, planes):
        if not planes:
            return None, 0
        k = id(planes)
        hit = self.c.get(k)
        if hit is not None and hit[0] is planes:
            return hit[1], hit[2]
        packed, n = _pack_planes(planes)
        if len(self.c) > 64:
            self.c.clear()
        self.c[k] = (planes, packed, n)          # holds the list, so its id is not reused while cached
        return packed, n


class Scene(object):
    def __init__(self, cell, sample_len, max_points):
        self.h = lib.et_scene_new(float(cell), float(sample_len), int(max_points))
        if not self.h:
            raise CoreError('the Rust core could not make a scene')
        self._p = (ctypes.c_double * 3)()
        self._planes = _Planes()

    def __del__(self):
        h, self.h = getattr(self, 'h', None), None
        if h and lib is not None:
            lib.et_scene_free(h)

    def add_mesh(self, coords, indices, tol=0.0):
        a, pa = _dbuf(coords)
        b = array('q', indices)
        pb = (ctypes.c_int64 * len(b)).from_buffer(b) if len(b) else None
        if lib.et_scene_add_mesh(self.h, pa, len(a), pb, len(b), float(tol)) != 1:
            raise CoreError(last_error())

    def build(self, lo, hi, pad):
        L = (ctypes.c_double * 3)(*lo)
        H = (ctypes.c_double * 3)(*hi)
        if lib.et_scene_build(self.h, L, H, float(pad)) != 1:
            raise CoreError(last_error())
        st = (ctypes.c_double * 13)()
        if lib.et_scene_stats(self.h, st) != 1:
            raise CoreError(last_error())
        return {'ntri': int(st[0]), 'npoints': int(st[1]), 'e_cover': st[2], 'vox': st[3], 'tol': st[4],
                'build_time': st[5], 'lo': (st[6], st[7], st[8]), 'hi': (st[9], st[10], st[11]), 'ccell': st[12]}

    def any_within(self, p, r, planes=None):
        q = self._p
        q[0], q[1], q[2] = p[0], p[1], p[2]
        pl, n = self._planes.get(planes)
        v = lib.et_scene_any_within(self.h, q, r, pl, n)
        if v < 0:
            raise CoreError(last_error())
        return v != 0

    def dist_fast(self, p, cap, planes=None):
        q = self._p
        q[0], q[1], q[2] = p[0], p[1], p[2]
        pl, n = self._planes.get(planes)
        return _num(lib.et_scene_dist_fast(self.h, q, cap, pl, n))

    def dist_exact(self, p, cap, planes=None):
        q = self._p
        q[0], q[1], q[2] = p[0], p[1], p[2]
        pl, n = self._planes.get(planes)
        return _num(lib.et_scene_dist_exact(self.h, q, cap, pl, n))

    def _points(self, fn, *args):
        n = fn(self.h, *(args + (None, 0)))
        if not n:
            if lib.et_failed():
                raise CoreError(last_error())
            return []
        out = (ctypes.c_double * (3 * n))()
        if fn(self.h, *(args + (out, n))) != n:
            raise CoreError(last_error() if lib.et_failed() else 'the scan\'s points changed between two calls')
        return [(out[3 * i], out[3 * i + 1], out[3 * i + 2]) for i in range(n)]

    def points_near(self, c, rad):
        return self._points(lib.et_scene_points_near, (ctypes.c_double * 3)(*c), float(rad))

    def min_dist(self, pts, cap, planes=None, exact=False):
        flat, n = _flat3(pts)
        pl, npl = self._planes.get(planes)
        return _num(lib.et_scene_min_dist(self.h, flat, n, float(cap), pl, npl, 1 if exact else 0))

    def nearest(self, pts, cap, planes=None):
        flat, n = _flat3(pts)
        pl, npl = self._planes.get(planes)
        o = (ctypes.c_double * 2)()
        if lib.et_scene_nearest(self.h, flat, n, float(cap), pl, npl, o) != 1:
            raise CoreError(last_error())
        return o[0], (int(o[1]) if o[1] >= 0 else None)

    def all_points(self):
        return self._points(lib.et_scene_points)


class Tubes(object):
    def __init__(self, cell):
        self.h = lib.et_tubes_new(float(cell))
        if not self.h:
            raise CoreError('the Rust core could not make a tube set')
        self._p = (ctypes.c_double * 3)()

    def __del__(self):
        h, self.h = getattr(self, 'h', None), None
        if h and lib is not None:
            lib.et_tubes_free(h)

    def add_polyline(self, pts, radius, owner_id):
        flat = array('d')
        for q in pts:
            flat.extend((q[0], q[1], q[2]))
        _a, pa = _dbuf(flat)
        if lib.et_tubes_add_polyline(self.h, pa, len(pts), float(radius), int(owner_id)) != 1:
            raise CoreError(last_error())

    def dist(self, p, cap, skip_a=NONE, skip_b=NONE):
        q = self._p
        q[0], q[1], q[2] = p[0], p[1], p[2]
        return _num(lib.et_tubes_dist(self.h, q, cap, skip_a, skip_b))


class Field(object):
    """A clearance field built in Rust: call it on one point, or many() on a list of points."""

    def __init__(self, handle, keep):
        if not handle:
            raise CoreError(last_error())
        self.h = handle
        self.keep = keep                      # the scene or tube set it reads, kept alive with it
        self._p = (ctypes.c_double * 3)()
        self._o = (ctypes.c_double * 1)()

    @staticmethod
    def over_scene(scene, g, cap, planes=None):
        pl, n = _pack_planes(planes)
        return Field(lib.et_field_new_scene(scene.h, float(g), float(cap), pl, n), scene)

    @staticmethod
    def over_tubes(tubes, g, cap, skip_a=NONE, skip_b=NONE):
        return Field(lib.et_field_new_tubes(tubes.h, float(g), float(cap), int(skip_a), int(skip_b)), tubes)

    def __del__(self):
        h, self.h = getattr(self, 'h', None), None
        if h and lib is not None:
            lib.et_field_free(h)

    def __call__(self, p):
        q = self._p
        q[0], q[1], q[2] = p[0], p[1], p[2]
        if lib.et_field_eval(self.h, q, 1, self._o) != 1:
            raise CoreError(last_error())
        return self._o[0]

    def many(self, pts):
        n = len(pts)
        if not n:
            return []
        flat = (ctypes.c_double * (3 * n))()
        for i, q in enumerate(pts):
            flat[3 * i], flat[3 * i + 1], flat[3 * i + 2] = q[0], q[1], q[2]
        out = (ctypes.c_double * n)()
        if lib.et_field_eval(self.h, flat, n, out) != 1:
            raise CoreError(last_error())
        return list(out)


def last_error():
    n = lib.et_last_error(None, 0)
    buf = ctypes.create_string_buffer(n + 1)
    lib.et_last_error(buf, n)
    return buf.value.decode('utf-8', 'replace') or 'the Rust core gave no reason'


def _num(v):
    """A number the Rust core returned, or CoreError when the NaN it returned means the call failed."""
    if v != v and lib.et_failed():
        raise CoreError(last_error())
    return v


def _nan(v):
    """None (and Python's other false numbers) as NaN: "not given" on the Rust side."""
    return float(v) if v else float('nan')


def _flat3(pts):
    n = len(pts) if pts else 0
    if not n:
        return None, 0
    flat = (ctypes.c_double * (3 * n))()
    for i, q in enumerate(pts):
        flat[3 * i], flat[3 * i + 1], flat[3 * i + 2] = q[0], q[1], q[2]
    return flat, n


class Route(object):
    """route()'s search, fit and clearance check for one tube, in Rust. router.py builds it from the tube's
    _Clearance: the Rust scene (or None), the Rust tube set and the two owners to leave out (or None), the four
    clearance fields (f_mid, f_s, f_e, f_tt; None where there is nothing), the numbers in rust/et_core's
    route::NPARAMS order and the start's and end's planes."""

    def __init__(self, scene, tubes, skip_a, skip_b, fields, params, planes):
        self.keep = (scene, tubes, fields)           # held as long as the Rust side borrows them
        fh = [f.h if f is not None else None for f in fields]
        P = (ctypes.c_double * len(params))(*[float(v) for v in params])
        pl, n = _pack_planes(planes)
        if n != 2:
            raise ValueError('a route takes the start\'s plane and the end\'s')
        self.h = lib.et_route_new(scene.h if scene is not None else None, tubes.h if tubes is not None else None,
                                  int(skip_a), int(skip_b), fh[0], fh[1], fh[2], fh[3], P, len(params), pl)
        if not self.h:
            raise CoreError(last_error())

    def __del__(self):
        h, self.h = getattr(self, 'h', None), None
        if h and lib is not None:
            lib.et_route_free(h)

    def search(self, extra, max_expand, seconds):
        """route()'s search(): (path, nodes expanded), the path None when there is no way through."""
        ex = ctypes.c_int64(0)
        n = lib.et_route_search(self.h, float(extra), int(max_expand), float(seconds), ctypes.byref(ex))
        if n < 0:
            raise CoreError(last_error())
        if n == 0:
            return None, ex.value
        out = (ctypes.c_double * (3 * n))()
        if lib.et_route_path(self.h, out, n) != n:
            raise CoreError(last_error() if lib.et_failed() else 'the path changed between two calls')
        return [(out[3 * i], out[3 * i + 1], out[3 * i + 2]) for i in range(n)], ex.value

    def _fit_args(self, target, margin, weights, anchor, D, nsamp):
        W = (ctypes.c_double * 4)(*[float(v) for v in weights])
        A, na = _flat3(anchor)
        return [_nan(target), float(margin), W, A, na, float(D or 0.0), int(nsamp)]

    def lm(self, x, target, margin, weights, anchor, D, nsamp, iters, step_max, seconds):
        """levenberg_marquardt on route()'s residuals: (x, cost)."""
        n = len(x)
        X = (ctypes.c_double * n)(*[float(v) for v in x])
        cost = ctypes.c_double(0.0)
        a = self._fit_args(target, margin, weights, anchor, D, nsamp)
        if lib.et_route_lm(self.h, X, n, *(a + [int(iters), _nan(step_max), float(seconds), ctypes.byref(cost)])) != 1:
            raise CoreError(last_error())
        return list(X), cost.value

    def residual(self, x, target, margin, weights, anchor, D, nsamp):
        """route()'s residuals at x (what _residual_fn's fun(x) gives)."""
        n = len(x)
        X = (ctypes.c_double * n)(*[float(v) for v in x])
        a = self._fit_args(target, margin, weights, anchor, D, nsamp)
        m = lib.et_route_residual(self.h, X, n, *(a + [None, 0]))
        if m < 0:
            raise CoreError(last_error())
        out = (ctypes.c_double * max(m, 1))()
        if lib.et_route_residual(self.h, X, n, *(a + [out, m])) != m:
            raise CoreError(last_error() if lib.et_failed() else 'the residuals changed between two calls')
        return list(out)[:m]

    def certify(self, x):
        """certify() of the centreline from x: the same dict."""
        n = len(x)
        X = (ctypes.c_double * n)(*[float(v) for v in x])
        o = (ctypes.c_double * 11)()
        if lib.et_route_certify(self.h, X, n, o) != 1:
            raise CoreError(last_error())
        return {'slack': o[0], 'gap': o[1], 'tt': o[2], 'at': (o[3], o[4], o[5]) if o[6] else None,
                'tt_at': (o[7], o[8], o[9]) if o[10] else None}

    def free_at(self, p, extra=0.0):
        P = (ctypes.c_double * 3)(*p)
        v = lib.et_route_free_at(self.h, P, float(extra))
        if v < 0:
            raise CoreError(last_error())
        return bool(v)

    def los(self, p, q, extra=0.0):
        P = (ctypes.c_double * 3)(*p)
        Q = (ctypes.c_double * 3)(*q)
        v = lib.et_route_los(self.h, P, Q, float(extra))
        if v < 0:
            raise CoreError(last_error())
        return bool(v)


class Points(object):
    """A fixed list of points on the Rust side, for costs evaluated over and over (templates.fit_main_pipe)."""

    def __init__(self, pts):
        self.n = len(pts)
        self.flat, _n = _flat3(pts)
        self._a = (ctypes.c_double * 3)()
        self._c = (ctypes.c_double * 3)()

    def cyl_cost(self, a, c, R, T):
        """Sum over the points of min(miss^2, T^2), the miss being the distance from the cylinder through c along
        a (a unit vector) with radius R: fit_main_pipe's cost."""
        A, C = self._a, self._c
        A[0], A[1], A[2] = a[0], a[1], a[2]
        C[0], C[1], C[2] = c[0], c[1], c[2]
        return _num(lib.et_cyl_cost(self.flat, self.n, A, C, float(R), float(T)))
