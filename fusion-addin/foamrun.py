"""OpenFOAM runs from the Fusion panel, on the Exhaust Tuner program's own OpenFOAM: the add-in bundles no solver and no
case runner of its own. The program's headless host (exhaust-tuner-host.exe, installed beside ExhaustTuner.exe) runs a
case exactly as the program's own "Run in OpenFOAM on this PC" does (rust/et_host/src/openfoam.rs: the 3-D case
generated from design.json by intake_cfd.py's generator in Rust, blockMesh, surfaceFeatureExtract + snappyHexMesh
for 3-D, checkMesh, topoSet, the solver with the convergence watchdog, the report -> results.json; no bash, no Python).
The host reads one JSON request per line on stdin ({id, action, data}) and writes progress events and the reply one per
line on stdout ({..., id}); {"action": "cancel"} stops a run (the host stops the OpenFOAM program it is running).

hostrun.py registers run_openfoam as the panel's 'runOpenFOAM' (hostCall/hostEvent/hostDone/hostChunk, background
threads), so the page's own CFD run button and the Fusion "Test this intake (CFD)" button both come through here.

Finding the program, as hostrun.find_openwam finds its OpenWAM: EXHAUST_TUNER_HOST_EXE, the path saved in settings.json
('program_host'), else exhaust-tuner-host.exe in "Exhaust Tuner" under Program Files or %LOCALAPPDATA%\\Programs (the
installer's per-user default). Its OpenFOAM: engines\\openfoam\\OpenFOAM-v2412 beside it (EXHAUST_TUNER_OPENFOAM
overrides, as it does for the host itself), with the programs the host needs (openfoam.rs PROGRAMS) and etc\\.

Results are cached by the design (the page sends the design dictionary as 'cache'): a second run of the same tube at
the same airflow, mesh and program build comes back at once from Documents\\Exhaust Tuner\\cfd-cache."""
import hashlib
import json
import os
import re
import subprocess
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, 'settings.json')
HOST_NAME = 'exhaust-tuner-host.exe' if os.name == 'nt' else 'exhaust-tuner-host'
PROGRAMS = ('blockMesh', 'snappyHexMesh', 'surfaceFeatureExtract', 'checkMesh', 'topoSet', 'foamDictionary', 'simpleFoam', 'rhoSimpleFoam')
NOT_INSTALLED = ('The Exhaust Tuner program is not installed on this PC, and the CFD test runs on the OpenFOAM it carries: '
                 'install the program (it puts this add-in in Fusion too), then click the button again.')
STOP_WAIT = 20.0            # s the host gets to stop OpenFOAM and answer after a Stop, before it is killed
CACHE_VERSION = 1


def _settings():
    try:
        with open(SETTINGS, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def find_host():
    """The program's exhaust-tuner-host executable, or None."""
    cands = [os.environ.get('EXHAUST_TUNER_HOST_EXE') or '', _settings().get('program_host') or '']
    for base in (os.environ.get('ProgramFiles'), os.environ.get('ProgramW6432'),
                 os.path.join(os.environ.get('LOCALAPPDATA') or '', 'Programs')):
        if base:
            cands.append(os.path.join(base, 'Exhaust Tuner', HOST_NAME))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def foam_dir(host):
    return os.environ.get('EXHAUST_TUNER_OPENFOAM') or os.path.join(os.path.dirname(host), 'engines', 'openfoam', 'OpenFOAM-v2412')


def foam_missing(host):
    """What of the program's OpenFOAM is not there ([] when it is all there), as openfoam.rs foam_available checks."""
    d = foam_dir(host)
    ext = '.exe' if os.name == 'nt' else ''
    miss = [p for p in PROGRAMS if not os.path.isfile(os.path.join(d, 'bin', p + ext))]
    if not os.path.isdir(os.path.join(d, 'etc')):
        miss.append('etc')
    return miss


def status():
    """(host or None, a plain sentence when the CFD cannot run here, else '')."""
    host = find_host()
    if not host:
        return None, NOT_INSTALLED
    miss = foam_missing(host)
    if miss:
        return None, ('The Exhaust Tuner program is installed (%s) but its OpenFOAM is not there (%s missing from %s): '
                      'reinstall the program from its latest installer.' % (os.path.dirname(host), ', '.join(miss[:3]), foam_dir(host)))
    return host, ''


def cache_root():
    d = os.path.join(os.path.expanduser('~'), 'Documents', 'Exhaust Tuner', 'cfd-cache')
    os.makedirs(d, exist_ok=True)
    return d


def cache_key(design_text, host):
    """sha256 of the design (as the page sent it) and the program build that runs it (path, size, date)."""
    try:
        st = os.stat(host)
        ident = '%s|%d|%d' % (os.path.normcase(host), st.st_size, int(st.st_mtime))
    except Exception:
        ident = str(host)
    h = hashlib.sha256()
    h.update(('v%d|' % CACHE_VERSION).encode())
    h.update(ident.encode('utf-8'))
    h.update(b'|')
    h.update(design_text.encode('utf-8'))
    return h.hexdigest()


def _cache_get(key):
    try:
        with open(os.path.join(cache_root(), key + '.json'), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _cache_put(key, res):
    try:
        p = os.path.join(cache_root(), key + '.json')
        with open(p + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(res, f)
        os.replace(p + '.tmp', p)
    except Exception:
        pass


def mesh_cells(case_dir):
    """The cell count checkMesh printed (log.checkMesh), or None."""
    try:
        with open(os.path.join(case_dir, 'log.checkMesh'), 'r', encoding='utf-8', errors='replace') as f:
            m = re.search(r'^\s*cells:\s+(\d+)', f.read(), re.M)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def ask_host(host, action='hostInfo', data=None, timeout=30.0):
    """One quick request to the program's host (hostInfo: its version and which engines it finds): the reply's result,
    or raises RuntimeError. The live test uses it to show the host starts from inside Fusion and finds its OpenFOAM."""
    flags = 0x08000000 if os.name == 'nt' else 0
    p = subprocess.Popen([host], cwd=os.path.dirname(host), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, creationflags=flags)
    try:
        out, _ = p.communicate((json.dumps({'id': 'ask', 'action': action, 'data': data or {}}) + '\n').encode('utf-8'), timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_tree(p)
        raise RuntimeError('The Exhaust Tuner program did not answer %s within %.0f s.' % (action, timeout))
    for line in out.decode('utf-8', 'replace').splitlines():
        try:
            m = json.loads(line)
        except ValueError:
            continue
        if isinstance(m, dict) and m.get('id') == 'ask' and 'ok' in m:
            if not m.get('ok'):
                raise RuntimeError(str(m.get('error')))
            return m.get('result')
    raise RuntimeError('The Exhaust Tuner program gave no answer to %s (exit code %s).' % (action, p.returncode))


def _kill_tree(p):
    """The host and anything it started (on Windows, killing a process leaves its children running)."""
    try:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=0x08000000)
        else:
            p.kill()
    except Exception:
        try:
            p.kill()
        except Exception:
            pass


def run_openfoam(data, job, emit, host=None):
    """hostrun RUNNERS['runOpenFOAM']: data {name, files: [{name, text, exec}], cache: the design text (optional)}.
    Emits the host's progress events ({event: folder | step | progress | stepDone, ...}); returns the host's result
    (openfoam.rs run()) with cells (from checkMesh), seconds_total and cached added."""
    if host is None:
        host, why = status()
        if not host:
            raise RuntimeError(why)
    files = data.get('files') or []
    if not files:
        raise RuntimeError('No case files.')
    key = None
    if isinstance(data.get('cache'), str) and data['cache']:
        key = cache_key(data['cache'], host)
        hit = _cache_get(key)
        if hit is not None and hit.get('ok'):
            hit['cached'] = True
            emit({'event': 'cached'})
            return hit
    t0 = time.time()
    flags = 0x08000000 if os.name == 'nt' else 0      # CREATE_NO_WINDOW
    p = subprocess.Popen([host], cwd=os.path.dirname(host), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, creationflags=flags)
    req = {'id': 'run', 'action': 'runOpenFOAM', 'data': {'name': str(data.get('name') or 'fusion_intake'), 'files': files}}
    lock = threading.Lock()
    state = {'closed': False, 'stopped': False}

    def send(obj, close=False):
        with lock:
            if state['closed']:
                return
            try:
                p.stdin.write((json.dumps(obj) + '\n').encode('utf-8'))
                p.stdin.flush()
                if close:
                    p.stdin.close()
                    state['closed'] = True
            except Exception:
                state['closed'] = True

    send(req)

    def watch():
        while p.poll() is None:
            if job['cancel'].wait(0.25):
                state['stopped'] = True
                send({'id': 'stop', 'action': 'cancel'})
                t = time.time()
                while p.poll() is None and time.time() - t < STOP_WAIT:
                    time.sleep(0.1)
                if p.poll() is None:
                    _kill_tree(p)
                return
    threading.Thread(target=watch, daemon=True).start()
    reply, tail = None, []
    for raw in iter(p.stdout.readline, b''):
        s = raw.decode('utf-8', 'replace').strip()
        if not s:
            continue
        try:
            m = json.loads(s)
        except ValueError:
            tail.append(s[:300])
            del tail[:-6]
            continue
        if not isinstance(m, dict) or m.get('id') != 'run':
            continue
        if 'event' in m:
            ev = dict(m)
            ev.pop('id', None)
            emit(ev)
        elif 'ok' in m:
            reply = m
            with lock:          # the reply is in: closing stdin lets the host's request loop end and the host exit
                if not state['closed']:
                    try:
                        p.stdin.close()
                    except Exception:
                        pass
                    state['closed'] = True
    try:
        p.wait(timeout=15)
    except Exception:
        _kill_tree(p)
    if state['stopped'] or job['cancel'].is_set():
        raise RuntimeError('Stopped.')
    if reply is None:
        raise RuntimeError('The Exhaust Tuner program stopped without an answer (exit code %s)%s.' % (
            p.returncode, (': ' + ' / '.join(tail)) if tail else ''))
    if not reply.get('ok'):
        raise RuntimeError(str(reply.get('error') or 'The run failed inside the Exhaust Tuner program.'))
    res = reply.get('result') or {}
    res['seconds_total'] = round(time.time() - t0, 1)
    res['cells'] = mesh_cells(res.get('case') or '')
    res['program'] = host
    res['cached'] = False
    if key and res.get('ok') and res.get('results'):
        _cache_put(key, res)
    return res
