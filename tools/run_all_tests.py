#!/usr/bin/env python3
"""Runs the whole test suite from a checkout, on Linux (or macOS), and writes a results table.

    python3 tools/run_all_tests.py [options]

What it runs (--list shows the plan with each command). Tests are found by globbing, so a new test file is run
without editing this script:
  build    the Rust programs the tests need, when cargo is here: exhaust-tuner-host (rust/), the router core
           (rust/et_core) and the wave model as WebAssembly (rust/et_wave, when the wasm32 target is installed)
  rust     cargo test --release for rust/'s workspace and every other crate under rust/ (et_core, et_wave, ...); the
           wave model built from this checkout's source against the page's JavaScript (wave_wasm_built)
  web      every page test web/tests/*.js (Playwright + Chromium), from web/; the ones that read the page path from
           their command line (process.argv[2] in their source: b4_ui, b5_ui, print_ui, ...) get index.html
  fusion   every fusion-addin/tests/test_*.py, from fusion-addin/tests; test_native with the built core
           (EXHAUST_TUNER_NATIVE_DIR, and --require once it is built), test_router once more on the core
  parity   the files matching OTHER below (cfd/*_vs_py.{py,js}, cfd/test_*, cfd/tests/test_*, openwam/test_*.js,
           sound/test_*.py, layouts/*/test_*.py, ...; one that runs exhaust-tuner-host gets its path), and the
           checks in CHECKS (cfd/gen_rust_templates.py --check, tools/sync_wam_export.py)

Options:
  -j N                  run N tests at a time (default 1)
  --quick               the short forms: QUICK=1 for wave_wasm, --quick for test_native
  --timeout S           per-test time limit in seconds (default 900); a test past it is killed and fails
  --suite a,b           only these suites (build, rust, web, fusion, parity)
  --only REGEX          only the tests whose name matches
  --shard I/N           the I-th of N parts (1-based), balanced on tools/test_timings.json
  --no-build            do not run cargo build (use what is built already)
  --out DIR             where the results go (default test-results/): results.txt, results.json, logs/<name>.log
  --expected-skips F    default tests/expected_skips.txt
  --flaky F             default tests/flaky.txt
  --no-skip-allowed a,b these tests must not skip at all, whatever the expected-skips file says
  --list                print the plan and stop
  --write-timings       write this run's seconds into tools/test_timings.json (for --shard)
  --merge DIR...        no tests: one table (results.txt/.json/.md in --out) from several runs' results (CI shards)

Results: PASS; FAIL (non-zero exit, a FAIL line, or for page tests one of the markers web/tests/run_all_tests.sh
always used: PAGEERROR, "Error:", " BAD ", "overflow <n>", "panel looks empty"; or past the time limit); SKIP (the test
printed "TEST SKIPPED: <why>" -- web/tests/skip.js skip() -- or a legacy line "skipped", or the runner did not start
it because a tool is missing); PASS+SKIP (it passed, but printed "SKIP: <why>" -- skipPart() -- for a part that did
not run, or cargo reported ignored tests or a "...; skipped" line). Every skip, whole or partial, must be listed in the
expected-skips file (lines "name kind condition reason": kind skip or part, condition one of CONDITIONS, true here)
or the run fails (UNEXPECTED SKIP); an entry whose skip did not happen is reported, not failed.
A test in the flaky file ("name reason") that fails is run once more; one that then passes is FLAKY (counted as a
pass, reported).
Exit code: 0 when nothing failed and every skip was expected, 1 otherwise, 2 on a usage error."""
import argparse
import concurrent.futures as cf
import glob
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SUITES = ('build', 'rust', 'web', 'fusion', 'parity')
# files in web/tests that are not tests
NOT_TESTS = {
    'skip.js': 'the shared skip helper the tests require',
    'capture_wave_jobs.js': 'writes fixtures/wave_jobs.json for wave_wasm.js (a generator, run by hand)',
}
WEB_BAD = re.compile(r'^FAIL|FAILS|FAILED|PAGEERROR|Error:| BAD |overflow [0-9]|panel looks empty', re.M)
ANY_BAD = re.compile(r'^FAIL\b', re.M)
WHOLE_SKIP = re.compile(r'^TEST SKIPPED: (.*)$', re.M)
LEGACY_SKIP = re.compile(r'^\s*(?:\S+: )?skipped\s*$', re.M)
PART_SKIP = re.compile(r'^\s*SKIP: (.*)$', re.M)
CARGO_SKIP = re.compile(r'^(.*\S); skipped\s*$', re.M)
CARGO_IGNORED = re.compile(r'test result: \w+\. \d+ passed; \d+ failed; (\d+) ignored')
CONDITIONS = ('always', 'no-cargo', 'no-wasm32', 'no-host', 'no-et-core', 'no-openwam', 'no-openfoam', 'no-numpy',
              'no-playwright', 'python<3.12')
KINDS = ('skip', 'part')     # the whole test, or a part of it (a "SKIP: " line, an ignored cargo test)
HOST = os.path.join(ROOT, 'rust', 'target', 'release', 'exhaust-tuner-host')
CORE_DIR = os.path.join(ROOT, 'rust', 'et_core', 'target', 'release')
WASM = os.path.join(ROOT, 'rust', 'et_wave', 'target', 'wasm32-unknown-unknown', 'release', 'et_wave.wasm')
WAM_DEFAULT = os.path.join(ROOT, 'ext', 'OpenWAM', 'build', 'bin', 'release', 'OpenWAM')


def sh_ok(cmd, cwd=ROOT):
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=120).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def probe():
    """What is here: the tools the tests use, found the way the tests find them."""
    t = {'node': shutil.which('node'), 'python': sys.executable, 'python_version': platform.python_version(),
         'cargo': shutil.which('cargo')}
    t['playwright'] = bool(t['node']) and sh_ok([t['node'], '-e', "require.resolve('playwright')"], os.path.join(ROOT, 'web'))
    t['numpy'] = sh_ok([sys.executable, '-c', 'import numpy'])
    t['wasm32'] = False
    if t['cargo'] and shutil.which('rustup'):
        r = subprocess.run(['rustup', 'target', 'list', '--installed'], capture_output=True, text=True)
        t['wasm32'] = 'wasm32-unknown-unknown' in r.stdout
    wam = os.environ.get('EXHAUST_TUNER_OPENWAM') or (WAM_DEFAULT if os.path.isfile(WAM_DEFAULT) else '')
    t['openwam'] = wam if wam and os.path.isfile(wam) else ''
    t['openfoam'] = os.environ.get('EXHAUST_TUNER_OPENFOAM', '')
    return t


def conditions(tools):
    """The expected-skips conditions that hold here (after the builds)."""
    c = {'always'}
    if not tools['cargo']:
        c.add('no-cargo')
    if not tools['wasm32']:
        c.add('no-wasm32')
    if not os.path.isfile(HOST):
        c.add('no-host')
    if not core_built():
        c.add('no-et-core')
    if not tools['openwam']:
        c.add('no-openwam')
    if not tools['openfoam']:
        c.add('no-openfoam')
    if not tools['numpy']:
        c.add('no-numpy')
    if not tools['playwright']:
        c.add('no-playwright')
    if sys.version_info < (3, 12):
        c.add('python<3.12')
    return c


def read_list(path, what):
    """name -> [(kind, condition, reason)] from an expected-skips file, or name -> reason from the flaky file."""
    out = {}
    if not os.path.isfile(path):
        return out
    for n, line in enumerate(open(path, encoding='utf-8'), 1):
        line = line.split('#', 1)[0].strip() if line.lstrip().startswith('#') else line.strip()
        if not line:
            continue
        parts = line.split(None, 3 if what == 'skips' else 1)
        if what == 'skips':
            if len(parts) < 4 or parts[1] not in KINDS or parts[2] not in CONDITIONS:
                sys.exit('%s:%d: want "name kind condition reason", kind one of %s, condition one of %s'
                         % (path, n, ', '.join(KINDS), ', '.join(CONDITIONS)))
            out.setdefault(parts[0], []).append((parts[1], parts[2], parts[3]))
        else:
            if len(parts) < 2:
                sys.exit('%s:%d: want "name reason" (a flaky test needs its reason written down)' % (path, n))
            out[parts[0]] = parts[1]
    return out


class T:
    """One entry of the plan."""
    def __init__(self, name, suite, cmd, cwd, env=None, needs=(), runner_skip=None, note='', require_if=None, unset=()):
        self.name, self.suite, self.cmd, self.cwd, self.env = name, suite, cmd, cwd, env or {}
        self.unset = tuple(unset)          # variables taken out of its environment
        self.must_run_some = False         # cargo test with a name filter: fail when the filter matched nothing
        self.require_if = require_if       # 'core': add --require when the core is built by the time it runs
        self.needs = set(needs)            # builds it needs: host, core, wasm
        self.runner_skip = runner_skip     # (condition, reason) when a tool it cannot start without is missing
        self.note = note


# the tests outside web/tests and fusion-addin/tests, found by these patterns (a new file that matches is run without
# editing this list); (pattern, folder to run it from: 'root' for the checkout, 'dir' for the file's own folder)
OTHER = (('cfd/*_vs_py.py', 'root'), ('cfd/*_vs_py.js', 'root'), ('cfd/test_*.py', 'root'), ('cfd/test_*.js', 'root'),
         ('cfd/tests/test_*.py', 'root'), ('cfd/tests/test_*.js', 'root'), ('openwam/test_*.js', 'dir'),
         ('sound/test_*.py', 'dir'), ('layouts/*/test_*.py', 'dir'), ('layouts/*/fake/test_*.py', 'dir'),
         ('tools/test_*.py', 'root'))
# files the patterns find that are not run, each with the reason (shown by --list and in every results table, so an
# exclusion is never silent); remove the line once the reason is gone
EXCLUDED = {
    'layouts_test_bundle_mode': 'stale: its Fusion stub (layouts/ls3-180/fake/adsk) has no TemporaryBRepManager, which '
                                'cadtools._merge_body has used since the merge collectors became one welded body; it '
                                'fails with AttributeError before checking anything. Extend the stub, then remove this line',
}
# and these, which are checks with their own command line
CHECKS = (('gen_rust_templates_check', ['cfd/gen_rust_templates.py', '--check']),
          ('sync_wam_export', ['tools/sync_wam_export.py']))


def other_name(rel):
    """cfd/gen_rs_vs_py.py -> gen_rs_vs_py; sound/test_sweep.py -> sound_test_sweep (test_* names are not unique)."""
    stem = os.path.splitext(os.path.basename(rel))[0]
    return rel.split('/')[0] + '_' + stem if stem.startswith('test_') else stem


def crates():
    """(name, manifest) for rust/Cargo.toml's workspace and every crate under rust/ that is not one of its members."""
    out, members = [], set()
    top = os.path.join(ROOT, 'rust', 'Cargo.toml')
    if os.path.isfile(top):
        out.append(('rust', 'rust/Cargo.toml'))
        m = re.search(r'^members\s*=\s*\[([^\]]*)\]', open(top, encoding='utf-8').read(), re.M)
        members = set(re.findall(r'"([^"]+)"', m.group(1))) if m else set()
    for man in sorted(glob.glob(os.path.join(ROOT, 'rust', '*', 'Cargo.toml'))):
        d = os.path.basename(os.path.dirname(man))
        if d not in members:
            out.append((d, os.path.relpath(man, ROOT)))
    return out


def plan(tools, quick):
    py, node = sys.executable, tools['node'] or 'node'
    rel = lambda *p: os.path.join(ROOT, *p)
    out = []
    nocargo = ('no-cargo', 'cargo is not installed') if not tools['cargo'] else None
    nopw = None if tools['playwright'] else ('no-playwright', 'Playwright is not installed for node (npm i playwright; npx playwright install chromium)')
    nonp = None if tools['numpy'] else ('no-numpy', 'numpy is not installed for ' + py)
    q = {'QUICK': '1'} if quick else {}
    # builds
    out.append(T('build_host', 'build', ['cargo', 'build', '--release', '--manifest-path', 'rust/Cargo.toml', '--bin',
                 'exhaust-tuner-host'], ROOT, runner_skip=nocargo))
    out.append(T('build_et_core', 'build', ['cargo', 'build', '--release', '--manifest-path', 'rust/et_core/Cargo.toml'],
                 ROOT, runner_skip=nocargo))
    nowasm = nocargo or (None if tools['wasm32'] else ('no-wasm32', 'the wasm32-unknown-unknown target is not installed (rustup target add wasm32-unknown-unknown)'))
    out.append(T('build_wave_wasm', 'build', ['cargo', 'build', '--release', '--target', 'wasm32-unknown-unknown',
                 '--manifest-path', 'rust/et_wave/Cargo.toml'], ROOT, runner_skip=nowasm))
    # rust: cargo test for every crate, then the wave model built from this checkout against the page's JavaScript
    # rust/'s tests use shell-script stand-ins for the solvers, and EXHAUST_TUNER_OPENWAM / _OPENFOAM would replace
    # those (rust/et_host/src/paths.rs reads them first: the router cancel tests then fail), so they run without them;
    # the tests named *real_solver* run once more with the real OpenWAM
    solvers = ('EXHAUST_TUNER_OPENWAM', 'EXHAUST_TUNER_OPENFOAM')
    for crate, man in crates():
        out.append(T('cargo_test_' + crate, 'rust', ['cargo', 'test', '--release', '--manifest-path', man, '--', '--show-output']
                     + (['--skip', 'real_solver'] if crate == 'rust' else []), ROOT, runner_skip=nocargo, unset=solvers))
        if crate == 'rust':
            out.append(T('cargo_test_rust_real_openwam', 'rust', ['cargo', 'test', '--release', '--manifest-path', man, 'real_solver',
                         '--', '--show-output'], ROOT, unset=solvers[1:],
                         runner_skip=nocargo or (None if tools['openwam'] else ('no-openwam', 'no OpenWAM build (EXHAUST_TUNER_OPENWAM)')),
                         note='the tests named real_solver, with EXHAUST_TUNER_OPENWAM'))
            out[-1].must_run_some = True
    out.append(T('wave_wasm_built', 'rust', [node, 'wave_wasm.js'], rel('web', 'tests'), dict(q, WAVE_WASM=WASM), needs={'wasm'}, runner_skip=nowasm,
                 note='the wave model built from rust/et_wave against the page\'s JavaScript'))
    # web: every web/tests/*.js; the arguments a test takes are read from its source
    for f in sorted(os.listdir(rel('web', 'tests'))):
        if not f.endswith('.js') or f in NOT_TESTS:
            continue
        src = open(rel('web', 'tests', f), encoding='utf-8').read()
        args = ['index.html'] if 'process.argv[2]' in src else []     # the page path (b4_ui, b5_ui, print_ui, ...)
        env = dict(q) if 'process.env.QUICK' in src else {}
        needs = {'host'} if 'exhaust-tuner-host' in src else set()
        out.append(T(f[:-3], 'web', [node, 'tests/' + f] + args, rel('web'), env, needs,
                     runner_skip=nopw if "require('playwright')" in src else None,
                     note=' '.join(args) and 'argument: ' + ' '.join(args)))
    # fusion: every fusion-addin/tests/test_*.py; test_native compares the Rust core with the Python, so it gets the
    # built core (and --require once it is built, so a core that does not load fails); the router once more on the core
    core_env = {'EXHAUST_TUNER_NATIVE_DIR': CORE_DIR}
    for f in sorted(os.listdir(rel('fusion-addin', 'tests'))):
        if f.startswith('test_') and f.endswith('.py'):
            nat = f == 'test_native.py'
            args = ['--quick'] if quick and nat else []
            out.append(T(f[:-3], 'fusion', [py, f] + args, rel('fusion-addin', 'tests'), core_env if nat else {},
                         needs={'core'} if nat else (), require_if='core' if nat else None, note=' '.join(args)))
    if os.path.isfile(rel('fusion-addin', 'tests', 'test_router.py')):
        out.append(T('test_router_native', 'fusion', [py, 'test_router.py'], rel('fusion-addin', 'tests'), core_env,
                     needs={'core'}, note='the router\'s tests on the Rust core'))
    # parity and the other checks: found by pattern; one that runs the host program gets its path
    for pat, where in OTHER:
        for f in sorted(glob.glob(rel(*pat.split('/')))):
            r = os.path.relpath(f, ROOT).replace(os.sep, '/')
            src = open(f, encoding='utf-8', errors='replace').read()
            js = f.endswith('.js')
            cwd = ROOT if where == 'root' else os.path.dirname(f)
            cmd = [node if js else py, r if where == 'root' else os.path.basename(f)]
            needs = set()
            if 'exhaust-tuner-host' in src:
                cmd.append(HOST)
                needs.add('host')
            rs = None
            if js and "require('playwright')" in src:
                rs = nopw
            if not js and re.search(r'^\s*import numpy', src, re.M):
                rs = nonp
            out.append(T(other_name(r), 'parity', cmd, cwd, needs=needs, runner_skip=rs))
    for name, args in CHECKS:
        if os.path.isfile(rel(*args[0].split('/'))):
            out.append(T(name, 'parity', [py] + args, ROOT))
    out = [t for t in out if t.name not in EXCLUDED]
    names = [t.name for t in out]
    dup = {n for n in names if names.count(n) > 1}
    if dup:
        sys.exit('two tests with one name: ' + ', '.join(sorted(dup)))
    return out


def shard(tests, i, n):
    """Longest first onto the least loaded of n parts, on the recorded seconds (30 s for a test not recorded)."""
    try:
        tim = json.load(open(os.path.join(ROOT, 'tools', 'test_timings.json')))['seconds']
    except (OSError, ValueError, KeyError):
        tim = {}
    load, part = [0.0] * n, {}
    for t in sorted(tests, key=lambda t: (-tim.get(t.name, 30.0), t.name)):
        k = min(range(n), key=lambda j: (load[j], j))
        load[k] += tim.get(t.name, 30.0)
        part[t.name] = k
    return [t for t in tests if part[t.name] == i - 1], load[i - 1]


def show(t):
    """The command as a person would type it: paths in the checkout relative to the test's folder, node/python bare."""
    c = [os.path.basename(t.cmd[0]) if os.path.isabs(t.cmd[0]) and not t.cmd[0].startswith(ROOT) else t.cmd[0]] + t.cmd[1:]
    return ' '.join(os.path.relpath(x, t.cwd) if os.path.isabs(x) and x.startswith(ROOT) else x for x in c)


def core_built():
    return any(os.path.isfile(os.path.join(CORE_DIR, n)) for n in ('libet_core.so', 'libet_core.dylib', 'et_core.dll'))


def run_one(t, timeout, logdir, env0):
    env = dict(env0)
    for k in t.unset:
        env.pop(k, None)
    env.update(t.env)
    cmd = t.cmd + (['--require'] if t.require_if == 'core' and core_built() else [])
    t0 = time.time()
    try:
        p = subprocess.Popen(cmd, cwd=t.cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        return {'rc': None, 'out': 'could not start: %s' % e, 'seconds': 0.0, 'timed_out': False}
    try:
        out, _ = p.communicate(timeout=timeout)
        timed = False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)       # the test and everything it started (browsers, solvers)
        except OSError:
            pass
        out, _ = p.communicate()
        timed = True
    out = out.decode('utf-8', 'replace')
    secs = time.time() - t0
    with open(os.path.join(logdir, t.name + '.log'), 'a', encoding='utf-8') as fh:
        fh.write('$ (cd %s && %s%s)\n' % (os.path.relpath(t.cwd, ROOT), ' '.join('%s=%s' % kv for kv in sorted(t.env.items())) + (' ' if t.env else ''),
                                         ' '.join([show(t)] + cmd[len(t.cmd):])))
        fh.write(out)
        fh.write('\n[exit %s after %.1f s%s]\n' % (p.returncode, secs, ', timed out' if timed else ''))
    return {'rc': p.returncode, 'out': out, 'seconds': secs, 'timed_out': timed}


def judge(t, r):
    """status, reason, partial skips from one run's output."""
    out, parts = r['out'], []
    bad = (WEB_BAD if t.suite == 'web' else ANY_BAD).findall(out)
    lines = [l for l in out.splitlines() if (WEB_BAD if t.suite == 'web' else ANY_BAD).search(l)]
    if r['timed_out']:
        return 'FAIL', 'timed out', []
    if r['rc'] != 0 or bad:
        why = ('exit %s' % r['rc']) if r['rc'] != 0 else ''
        if lines:
            why += ('; ' if why else '') + lines[0].strip()[:160]
        return 'FAIL', why, []
    if t.must_run_some and not re.search(r'test result: ok\. [1-9]', out):
        return 'FAIL', 'its name filter matched no test (renamed?)', []
    m = WHOLE_SKIP.search(out)
    if m:
        return 'SKIP', m.group(1).strip(), []
    if LEGACY_SKIP.search(out):
        prev = [l for l in out.splitlines() if l.strip()]
        i = next(k for k, l in enumerate(prev) if LEGACY_SKIP.match(l))
        return 'SKIP', (prev[i - 1].strip() if i else 'no reason given') + ' (legacy "skipped" line)', []
    parts = [x.strip() for x in PART_SKIP.findall(out)]
    if t.suite in ('rust', 'build'):
        parts += [x.strip() for x in CARGO_SKIP.findall(out)]
        ign = sum(int(x) for x in CARGO_IGNORED.findall(out))
        if ign:
            parts.append('%d test(s) marked #[ignore]' % ign)
    return ('PASS+SKIP' if parts else 'PASS'), '', parts


def summarize(rows, unexpected, stale, seconds):
    count = lambda s: sum(r['status'] == s for r in rows)
    summary = {'tests': len(rows), 'pass': count('PASS') + count('PASS+SKIP'), 'flaky': count('FLAKY'), 'fail': count('FAIL'),
               'skip': count('SKIP'), 'partial_skips': sum(len(r['partial_skips']) for r in rows),
               'unexpected_skips': unexpected, 'expected_skip_not_seen': stale, 'excluded': EXCLUDED, 'seconds': seconds}
    summary['result'] = 'ok' if summary['fail'] == 0 and not unexpected else 'FAILED'
    return summary


def note_of(r):
    note = r['reason']
    if r['partial_skips']:
        note = (note + '; ' if note else '') + 'skipped part: ' + ' | '.join(r['partial_skips'])
    if r.get('unexpected_skip'):
        note = 'UNEXPECTED SKIP: ' + note
    elif r.get('expected_skip') and (r['status'] == 'SKIP' or r['partial_skips']):
        note += '  [expected: %s]' % r['expected_skip']
    return note


def render(rows, summary, skips_file):
    """The results table as text and as Markdown (for a CI job summary)."""
    width = max([len(r['name']) for r in rows] + [4])
    lines = ['%-*s  %-7s %-10s %8s  %s' % (width, 'test', 'suite', 'result', 'seconds', 'note'),
             '-' * (width + 2) + ' ' + '-' * 7 + ' ' + '-' * 10 + ' ' + '-' * 8 + '  ' + '-' * 40]
    md = ['| test | suite | result | seconds | note |', '|---|---|---|---:|---|']
    for r in rows:
        st = r['status'] + ('!' if r.get('unexpected_skip') else '')
        note = note_of(r)
        lines.append('%-*s  %-7s %-10s %8.1f  %s' % (width, r['name'], r['suite'], st, r['seconds'], note))
        md.append('| %s | %s | %s | %.1f | %s |' % (r['name'], r['suite'], ('**%s**' % st) if st not in ('PASS', 'PASS+SKIP') else st,
                                                    r['seconds'], note.replace('|', '/')))
    tail = ['%d tests: %d passed, %d flaky (passed on retry), %d failed, %d skipped, %d partial skips; %d unexpected skips; %.0f s'
            % (summary['tests'], summary['pass'], summary['flaky'], summary['fail'], summary['skip'], summary['partial_skips'],
               len(summary['unexpected_skips']), summary['seconds'])]
    if summary['unexpected_skips']:
        tail.append('unexpected skips (not in %s for this machine, or named in --no-skip-allowed): %s'
                    % (skips_file, ', '.join(summary['unexpected_skips'])))
    for n, why in sorted(summary.get('excluded', {}).items()):
        tail.append('not run (tools/run_all_tests.py EXCLUDED): %s: %s' % (n, why))
    if summary['expected_skip_not_seen']:
        tail.append('expected to skip here but ran: %s (the expected-skips entry may be out of date)'
                    % ', '.join(summary['expected_skip_not_seen']))
    tail.append('result: ' + summary['result'])
    text = '\n'.join(lines + [''] + tail) + '\n'
    md = '\n'.join(['### Test results: %s' % summary['result'], ''] + ['- ' + t for t in tail[:-1]] + [''] + md) + '\n'
    return text, md


def merge(dirs, out):
    """One table from several runs' results.json (the CI shards); exit 1 when any of them failed."""
    rows, unexpected, stale, secs, seen = [], [], [], 0.0, set()
    for d in dirs:
        f = os.path.join(d, 'results.json') if os.path.isdir(d) else d
        try:
            j = json.load(open(f, encoding='utf-8'))
        except (OSError, ValueError) as e:
            print('merge: %s: %s' % (f, e))
            rows.append({'name': 'results of ' + os.path.basename(d.rstrip('/')), 'suite': '-', 'status': 'FAIL',
                         'reason': 'no results (%s)' % e, 'partial_skips': [], 'seconds': 0.0})
            continue
        for r in j['tests']:
            if r['name'] in seen and r['suite'] == 'build':
                continue           # each shard builds what it needs: list a build once
            seen.add(r['name'])
            rows.append(r)
        unexpected += j['summary']['unexpected_skips']
        stale += j['summary']['expected_skip_not_seen']
        secs = max(secs, j['summary']['seconds'])
    summary = summarize(rows, unexpected, stale, secs)
    text, md = render(rows, summary, 'tests/expected_skips.txt')
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'results.txt'), 'w', encoding='utf-8').write(text)
    open(os.path.join(out, 'results.md'), 'w', encoding='utf-8').write(md)
    json.dump({'summary': summary, 'merged_from': dirs, 'tests': rows}, open(os.path.join(out, 'results.json'), 'w', encoding='utf-8'), indent=1)
    print(text, end='')
    return 0 if summary['result'] == 'ok' else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-j', type=int, default=1)
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--timeout', type=float, default=900)
    ap.add_argument('--suite', default='')
    ap.add_argument('--only', default='')
    ap.add_argument('--shard', default='')
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--out', default=os.path.join(ROOT, 'test-results'))
    ap.add_argument('--expected-skips', default=os.path.join(ROOT, 'tests', 'expected_skips.txt'))
    ap.add_argument('--flaky', default=os.path.join(ROOT, 'tests', 'flaky.txt'))
    ap.add_argument('--no-skip-allowed', default='')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--write-timings', action='store_true')
    ap.add_argument('--merge', nargs='+', metavar='DIR', help='combine these runs\' results.json into one table in --out')
    a = ap.parse_args()
    if a.merge:
        return merge(a.merge, a.out)
    if a.j < 1:
        ap.error('-j wants 1 or more')
    suites = [s for s in a.suite.split(',') if s] or list(SUITES)
    for s in suites:
        if s not in SUITES:
            ap.error('unknown suite %s (%s)' % (s, ', '.join(SUITES)))
    tools = probe()
    tests = plan(tools, a.quick)
    if a.only:
        rx = re.compile(a.only)
        tests = [t for t in tests if rx.search(t.name)]
    tests = [t for t in tests if t.suite in suites]
    # builds that the selected tests need come along, whatever --suite/--only say; --no-build drops them all
    need = set().union(*[t.needs for t in tests]) if tests else set()
    want_build = {'host': 'build_host', 'core': 'build_et_core', 'wasm': 'build_wave_wasm'}
    allp = {t.name: t for t in plan(tools, a.quick)}
    for k in sorted(need):
        if want_build[k] not in [t.name for t in tests]:
            tests.insert(0, allp[want_build[k]])
    if a.no_build:
        tests = [t for t in tests if t.suite != 'build']
    builds = [t for t in tests if t.suite == 'build']
    rest = [t for t in tests if t.suite != 'build']
    shard_load = None
    if a.shard:
        m = re.match(r'^(\d+)/(\d+)$', a.shard)
        if not m or not 1 <= int(m.group(1)) <= int(m.group(2)):
            ap.error('--shard wants I/N with 1 <= I <= N')
        rest, shard_load = shard(rest, int(m.group(1)), int(m.group(2)))
        need = set().union(*[t.needs for t in rest]) if rest else set()
        builds = [t for t in builds if t.name in {want_build[k] for k in need}]
    skips_exp = read_list(a.expected_skips, 'skips')
    flaky = read_list(a.flaky, 'flaky')
    strict = {n for n in a.no_skip_allowed.split(',') if n}
    known = {t.name for t in plan(tools, a.quick)}
    for n in sorted(set(skips_exp) | set(flaky) | strict):
        if n not in known:
            sys.exit('%s is named in the expected-skips, flaky or --no-skip-allowed list but is not a test here' % n)
    if a.list:
        for t in builds + rest:
            print('%-30s %-7s (cd %s && %s%s)%s' % (t.name, t.suite, os.path.relpath(t.cwd, ROOT) or '.',
                  ''.join('%s=%s ' % kv for kv in sorted(t.env.items())), show(t),
                  ('   [not started: %s]' % t.runner_skip[1]) if t.runner_skip else ''))
        for f, why in sorted(NOT_TESTS.items()):
            print('%-30s %-7s not a test: %s' % (f, 'web', why))
        for n, why in sorted(EXCLUDED.items()):
            print('%-30s %-7s NOT RUN: %s' % (n, '', why))
        if shard_load is not None:
            print('shard %s: %d tests, about %.0f s by tools/test_timings.json' % (a.shard, len(rest), shard_load))
        return 0
    if not tools['node']:
        sys.exit('node is not on PATH')
    os.makedirs(os.path.join(a.out, 'logs'), exist_ok=True)
    for f in os.listdir(os.path.join(a.out, 'logs')):
        os.remove(os.path.join(a.out, 'logs', f))
    env0 = dict(os.environ)
    if tools['openwam']:
        env0['EXHAUST_TUNER_OPENWAM'] = os.path.abspath(tools['openwam'])
    env0.setdefault('PYTHONDONTWRITEBYTECODE', '1')
    print('tools: node %s, python %s, cargo %s, wasm32 %s, playwright %s, numpy %s, OpenWAM %s, OpenFOAM %s' % (
        'yes' if tools['node'] else 'no', tools['python_version'], 'yes' if tools['cargo'] else 'no',
        'yes' if tools['wasm32'] else 'no', 'yes' if tools['playwright'] else 'no', 'yes' if tools['numpy'] else 'no',
        tools['openwam'] or 'no', tools['openfoam'] or 'not set'), flush=True)
    results, lock, t_start = {}, threading.Lock(), time.time()
    width = max([len(t.name) for t in builds + rest] + [4])

    def do(t):
        if t.runner_skip:
            res = {'name': t.name, 'suite': t.suite, 'status': 'SKIP', 'reason': t.runner_skip[1], 'partial_skips': [],
                   'seconds': 0.0, 'attempts': 0, 'runner_skip': t.runner_skip[0]}
        else:
            r = run_one(t, a.timeout, os.path.join(a.out, 'logs'), env0)
            st, why, parts = judge(t, r)
            attempts, first = 1, None
            if st == 'FAIL' and t.name in flaky:
                first = why
                r2 = run_one(t, a.timeout, os.path.join(a.out, 'logs'), env0)
                st, why, parts = judge(t, r2)
                attempts, r['seconds'] = 2, r['seconds'] + r2['seconds']
                if st != 'FAIL':
                    st, why = 'FLAKY', 'failed once (%s), passed on the retry; listed in %s: %s' % (first, os.path.relpath(a.flaky, ROOT), flaky[t.name])
            res = {'name': t.name, 'suite': t.suite, 'status': st, 'reason': why, 'partial_skips': parts,
                   'seconds': round(r['seconds'], 1), 'attempts': attempts, 'exit_code': r['rc'],
                   'log': os.path.relpath(os.path.join(a.out, 'logs', t.name + '.log'), ROOT)}
        res['command'] = ' '.join(t.cmd)
        res['cwd'] = os.path.relpath(t.cwd, ROOT)
        with lock:
            results[t.name] = res
            done = len(results)
            print('[%3d/%d] %-*s %-9s %7.1f s  %s' % (done, len(builds) + len(rest), width, t.name, res['status'], res['seconds'],
                  (res['reason'] or '; '.join(res['partial_skips']))[:110]), flush=True)
        return res

    for t in builds:           # one at a time: cargo locks its build folder anyway
        do(t)
    with cf.ThreadPoolExecutor(max_workers=a.j) as ex:
        list(ex.map(do, rest))
    # the skips against the expected list
    cond = conditions(tools)
    unexpected, stale = [], []
    for r in results.values():
        kind = 'skip' if r['status'] == 'SKIP' else ('part' if r['partial_skips'] else '')
        had = bool(kind)
        exp = [why for k, c, why in skips_exp.get(r['name'], []) if c in cond and k == kind]
        expany = [why for k, c, why in skips_exp.get(r['name'], []) if c in cond]
        r['expected_skip'] = exp[0] if exp else ''
        if had and (not exp or r['name'] in strict):
            r['unexpected_skip'] = True
            unexpected.append(r['name'])
        elif expany and not had and r['status'] in ('PASS', 'FLAKY'):
            stale.append(r['name'])
    order = [t.name for t in builds + rest]
    rows = [results[n] for n in order]
    summary = summarize(rows, unexpected, stale, round(time.time() - t_start, 1))
    text, md = render(rows, summary, os.path.relpath(a.expected_skips, ROOT))
    open(os.path.join(a.out, 'results.txt'), 'w', encoding='utf-8').write(text)
    open(os.path.join(a.out, 'results.md'), 'w', encoding='utf-8').write(md)
    json.dump({'summary': summary, 'tools': tools, 'conditions': sorted(cond),
               'options': {'j': a.j, 'quick': a.quick, 'timeout': a.timeout, 'suites': suites, 'only': a.only, 'shard': a.shard},
               'platform': platform.platform(), 'tests': rows}, open(os.path.join(a.out, 'results.json'), 'w', encoding='utf-8'), indent=1)
    print()
    print(text, end='')
    ok = summary['result'] == 'ok'
    if a.write_timings:
        p = os.path.join(ROOT, 'tools', 'test_timings.json')
        try:
            old = json.load(open(p))['seconds']
        except (OSError, ValueError, KeyError):
            old = {}
        old.update({r['name']: r['seconds'] for r in rows if r['seconds'] > 0})
        json.dump({'note': 'seconds per test from a run of tools/run_all_tests.py --write-timings (for --shard); '
                   'measured on a 2-core machine shared with other work, so on the slow side', 'seconds': dict(sorted(old.items()))},
                  open(p, 'w', encoding='utf-8'), indent=1)
        open(p, 'a').write('\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
