class _Any(object):
    def __getattr__(self, k):
        if k.startswith('__'): raise AttributeError(k)
        return _Any()
    def __call__(self, *a, **k): return _Any()
import sys, types
core = types.ModuleType('adsk.core'); fusion = types.ModuleType('adsk.fusion')
for m in (core, fusion):
    m.__getattr__ = lambda k: (_ for _ in ()).throw(AttributeError(k)) if k.startswith('__') else type(k, (object,), {})
sys.modules['adsk.core'] = core; sys.modules['adsk.fusion'] = fusion
