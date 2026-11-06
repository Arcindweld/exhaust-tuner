"""The page's solver runs inside Fusion: the Exhaust Tuner panel calls OpenWAM on this PC through the add-in, the same
way the Windows program does (rust/et_host/src/openwam.rs), so a case never has to be saved, run by hand and loaded
back. The page sends hostCall {id, action, data}; the run goes on in background threads; progress and the result come
back to the panel as 'hostEvent' / 'hostDone' messages (sent from Fusion's main thread through a custom event), and
the result text is fetched in pieces with hostChunk (an INS.DAT can be a few MB).

OpenWAM: engines/openwam/OpenWAM.exe in the add-in folder, else the Exhaust Tuner program's copy, else one found on
the Desktop or in Downloads, else the path the user picked (settings.json beside this file)."""
import glob
import json
import os
import subprocess
import threading
import time

FINISHED_MARKER = 'SIMULATION FINISHED CORRECTLY'
INS_KEEP_CYCLES = 4
CHUNK = 400000
HERE = os.path.dirname(os.path.abspath(__file__))
SETTINGS = os.path.join(HERE, 'settings.json')

_jobs = {}          # id -> {'cancel': Event, 'procs': [Popen], 'result': str or None}
_lock = threading.Lock()
_post = None        # post(kind, payload_dict): hands a message to the main thread (set by start())


def _settings():
    try:
        with open(SETTINGS, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def _save_settings(s):
    try:
        with open(SETTINGS, 'w', encoding='utf-8') as f:
            json.dump(s, f, indent=1)
    except Exception:
        pass


def find_openwam():
    """The OpenWAM executable to run, or None."""
    cands = [os.environ.get('EXHAUST_TUNER_OPENWAM') or '', os.path.join(HERE, 'engines', 'openwam', 'OpenWAM.exe')]
    s = _settings().get('openwam')
    if s:
        cands.append(s)
    for base in (os.environ.get('ProgramFiles'), os.environ.get('ProgramW6432'),
                 os.path.join(os.environ.get('LOCALAPPDATA') or '', 'Programs')):
        if base:
            cands.append(os.path.join(base, 'Exhaust Tuner', 'engines', 'openwam', 'OpenWAM.exe'))
    home = os.path.expanduser('~')
    for d in ('Desktop', 'Downloads', 'Documents'):
        for pat in ('OpenWAM*.exe', '*/OpenWAM*.exe', '*/*/OpenWAM*.exe', '*/*/*/OpenWAM*.exe'):
            cands.extend(sorted(glob.glob(os.path.join(home, d, pat))))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def runs_root():
    base = os.path.join(os.path.expanduser('~'), 'Documents', 'Exhaust Tuner', 'runs')
    os.makedirs(base, exist_ok=True)
    return base


def ins_tail(text, keep=INS_KEEP_CYCLES):
    """The header and the last `keep` cycles of an INS.DAT (a cycle starts where Angle(deg) drops by more than 180),
    as openwam.rs ins_tail: the page reads only the last two complete cycles."""
    lines = text.splitlines(True)
    if not lines:
        return text
    head = lines[0].rstrip('\r\n').split('\t')
    col = next((i for i, h in enumerate(head) if h.strip() == 'Angle(deg)'), None)
    if col is None:
        return text
    starts, prev = [], None
    for i, l in enumerate(lines[1:], 1):
        parts = l.split('\t')
        try:
            a = float(parts[col])
        except (IndexError, ValueError):
            continue
        if prev is not None and a < prev - 180.0:
            starts.append(i)
        prev = a
    if keep <= 0 or len(starts) < keep:
        return text
    return lines[0] + ''.join(lines[starts[-keep]:])


def _safe(p):
    return ''.join(ch for ch in p if ch not in '<>:"|?*').strip() or '_'


def write_case(folder, files):
    """The page's files under folder (sub-paths kept); OpenWAM inputs, .bat and .txt with CRLF, as act_save_files."""
    names = []
    for f in files:
        if not (isinstance(f, dict) and f.get('name') and isinstance(f.get('text'), str)):
            continue
        parts = [_safe(q) for q in str(f['name']).replace('\\', '/').split('/') if q and q not in ('.', '..')]
        if not parts:
            continue
        path = os.path.join(folder, *parts)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        nl = '\r\n' if parts[-1].lower().endswith(('.bat', '.txt', '.wam')) else '\n'
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(f['text'].replace('\r\n', '\n').replace('\n', nl))
        names.append('/'.join(parts))
    return names


def _run_one(exe, case_dir, name, job, emit):
    d = os.path.join(case_dir, name)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(case_dir, name + '.wam'), 'rb') as a, open(os.path.join(d, name + '.wam'), 'wb') as b:
        b.write(a.read())
    t0 = time.time()
    flags = 0x08000000 if os.name == 'nt' else 0      # CREATE_NO_WINDOW
    p = subprocess.Popen([exe, name + '.wam'], cwd=d, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, creationflags=flags)
    with _lock:
        job['procs'].append(p)
    log, last = [], 0.0
    for raw in iter(p.stdout.readline, b''):
        s = raw.decode('utf-8', 'replace').rstrip('\r\n')
        log.append(s)
        if s.strip() and time.time() - last >= 2.0:
            last = time.time()
            emit({'event': 'output', 'model': name, 'line': s.strip()[:300]})
        if job['cancel'].is_set():
            break
    if job['cancel'].is_set():
        try:
            p.kill()
        except Exception:
            pass
    code = p.wait()
    text = '\r\n'.join(log) + '\r\n'
    with open(os.path.join(d, name + '.log'), 'w', encoding='utf-8', newline='') as f:
        f.write(text)

    def read(suffix):
        try:
            with open(os.path.join(d, name + suffix), 'r', encoding='utf-8', errors='replace') as f:
                return f.read()
        except Exception:
            return None
    ins = read('INS.DAT')
    tail = [l for l in log if l.strip()][-8:]
    return {'name': name, 'finished': FINISHED_MARKER in text, 'exitCode': code, 'seconds': round(time.time() - t0, 1),
            'folder': d, 'avg': read('AVG.DAT'), 'ins': ins_tail(ins) if ins is not None else None, 'logTail': '\n'.join(tail)}


def run_openwam(data, job, emit):
    exe = find_openwam()
    if not exe:
        raise RuntimeError('OpenWAM was not found on this PC. Use "Find OpenWAM.exe" in the panel to point to it.')
    files = data.get('files') or []
    name = _safe(str(data.get('name') or 'case'))
    case_dir = os.path.join(runs_root(), '%s_%s' % (name, time.strftime('%Y%m%d-%H%M%S')))
    write_case(case_dir, files)
    models = []
    for f in files:
        n = str(f.get('name') or '').replace('\\', '/')
        if '/' not in n and n.lower().endswith('.wam'):
            stem = _safe(n[:-4])
            if stem not in models:
                models.append(stem)
    if not models:
        raise RuntimeError('The case has no .wam model files.')
    workers = max(1, min(len(models), (os.cpu_count() or 2) // 2))
    out, nxt, done = [None] * len(models), [0], [0]

    def work():
        while not job['cancel'].is_set():
            with _lock:
                i = nxt[0]
                nxt[0] += 1
            if i >= len(models):
                return
            m = models[i]
            emit({'event': 'start', 'model': m, 'of': len(models)})
            try:
                r = _run_one(exe, case_dir, m, job, emit)
            except Exception as e:
                r = {'name': m, 'finished': False, 'exitCode': -1, 'seconds': 0, 'folder': '', 'avg': None, 'ins': None, 'logTail': str(e)}
            out[i] = r
            with _lock:
                done[0] += 1
                k = done[0]
            emit({'event': 'done', 'model': m, 'finished': r['finished'], 'seconds': r['seconds'], 'count': k, 'of': len(models)})
    ts = [threading.Thread(target=work, daemon=True) for _ in range(workers)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    if job['cancel'].is_set():
        raise RuntimeError('Stopped.')
    return {'ok': True, 'folder': case_dir, 'openwam': exe, 'models': [r for r in out if r]}


RUNNERS = {'runOpenWAM': run_openwam}


def host_info(_data=None):
    exe = find_openwam()
    return {'ok': True, 'where': 'fusion', 'engines': {'openwam': bool(exe)}, 'openwam': exe or '', 'runsFolder': runs_root()}


def host_call(data):
    """Start a run in the background; the reply only says it started."""
    jid, action, args = str(data.get('id')), data.get('action'), data.get('data') or {}
    if action == 'hostInfo':
        return host_info()
    if action == 'openFolder':
        return open_folder(args)
    if action == 'openRunsFolder':
        return open_folder({'path': runs_root()})
    fn = RUNNERS.get(action)
    if not fn:
        return {'ok': False, 'msg': 'The Fusion panel cannot do "%s"; the Exhaust Tuner program can.' % action}
    job = {'cancel': threading.Event(), 'procs': [], 'result': None}
    with _lock:
        _jobs[jid] = job

    def emit(ev):
        if _post:
            _post('hostEvent', {'id': jid, 'ev': ev})

    def go():
        try:
            res = json.dumps(fn(args, job, emit))
            ok, msg = True, ''
        except Exception as e:
            res, ok, msg = '', False, str(e)
        job['result'] = res
        if _post:
            _post('hostDone', {'id': jid, 'ok': ok, 'msg': msg, 'size': len(res), 'chunk': CHUNK})
    threading.Thread(target=go, daemon=True).start()
    return {'ok': True, 'started': jid}


def host_chunk(data):
    jid, i = str(data.get('id')), int(data.get('i') or 0)
    job = _jobs.get(jid)
    if not job or job['result'] is None:
        return {'ok': False, 'msg': 'No result for run %s.' % jid}
    part = job['result'][i * CHUNK:(i + 1) * CHUNK]
    last = (i + 1) * CHUNK >= len(job['result'])
    if last:
        with _lock:
            _jobs.pop(jid, None)
    return {'ok': True, 'text': part, 'last': last}


def host_cancel(_data=None):
    with _lock:
        jobs = list(_jobs.values())
    for j in jobs:
        j['cancel'].set()
        for p in j['procs']:
            try:
                p.kill()
            except Exception:
                pass
    return {'ok': True}


def open_folder(data):
    p = str(data.get('path') or '')
    if not os.path.isdir(p):
        return {'ok': False, 'msg': 'No such folder: ' + p}
    try:
        os.startfile(p)       # Windows
    except AttributeError:
        subprocess.Popen(['open' if os.uname().sysname == 'Darwin' else 'xdg-open', p])
    return {'ok': True}


def pick_openwam(ui):
    """Let the user point to OpenWAM.exe; remembered in settings.json."""
    import adsk.core
    dlg = ui.createFileDialog()
    dlg.title = 'Find OpenWAM.exe'
    dlg.filter = 'OpenWAM (OpenWAM*.exe);;Programs (*.exe)'
    if dlg.showOpen() != adsk.core.DialogResults.DialogOK:
        return {'ok': False, 'msg': 'Not changed.'}
    s = _settings()
    s['openwam'] = dlg.filename
    _save_settings(s)
    return host_info()
