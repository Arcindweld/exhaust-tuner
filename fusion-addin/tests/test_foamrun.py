"""foamrun.py, the Fusion panel's OpenFOAM runs on the Exhaust Tuner program's own OpenFOAM, with a stand-in for the
program's host (a script that speaks its line protocol: {id, action, data} in, {event, ..., id} and {ok, result |
error, id} out, "cancel" stops): found where the installer puts it, refused in one sentence when it is not there or its
OpenFOAM is missing, the request and the progress events, the cell count from checkMesh's log, the result through
hostrun's hostCall / hostDone / hostChunk, Stop (the cancel line, then a kill for a host that ignores it), a host that
dies or reports an error, and the cache (the same design comes back at once without starting the host).
   python3 tests/test_foamrun.py"""
import json
import os
import stat
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


tmp = tempfile.mkdtemp()
os.environ['HOME'] = tmp                 # Documents/Exhaust Tuner/{runs,cfd-cache} under this
os.makedirs(os.path.join(tmp, 'Documents'))
for k in ('EXHAUST_TUNER_HOST_EXE', 'EXHAUST_TUNER_OPENFOAM', 'ProgramFiles', 'ProgramW6432'):
    os.environ.pop(k, None)
os.environ['LOCALAPPDATA'] = os.path.join(tmp, 'AppData', 'Local')
import foamrun as FR      # noqa: E402
import hostrun as HR      # noqa: E402
FR.SETTINGS = HR.SETTINGS = os.path.join(tmp, 'settings.json')

# ---------------------------------------------------------------- 1. finding the program
ok(FR.find_host() is None and FR.status() == (None, FR.NOT_INSTALLED), 'no program: one sentence: ' + FR.NOT_INSTALLED)
info = HR.host_info()
ok(info['engines']['openfoam'] is False and info['openfoamWhy'] == FR.NOT_INSTALLED, 'hostInfo says OpenFOAM is not on hand, and why')
app = os.path.join(tmp, 'AppData', 'Local', 'Programs', 'Exhaust Tuner')     # the installer's per-user folder
os.makedirs(app)
host = os.path.join(app, FR.HOST_NAME)
log = os.path.join(tmp, 'host_log.txt')
STUB = r'''#!%s
# a stand-in for exhaust-tuner-host: one JSON request per line on stdin, events and the reply per line on stdout
import json, os, sys, threading, time
LOG = %r
out_lock = threading.Lock()
cancel = threading.Event()
def say(o):
    with out_lock:
        sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
def note(t):
    with open(LOG, "a") as f: f.write(t + "\n")
def run(msg):
    d = msg["data"]; rid = msg["id"]; name = d["name"]
    note("run " + name + " files=" + ",".join(f["name"] for f in d["files"]))
    if name == "die":
        os._exit(3)
    if name == "fail":
        say({"ok": False, "error": "OpenFOAM is not installed where the program expects it: C:/x", "id": rid}); return
    run_dir = os.path.join(os.path.dirname(LOG), "runs", name)
    case = os.path.join(run_dir, "case"); os.makedirs(case, exist_ok=True)
    with open(os.path.join(case, "log.checkMesh"), "w") as f:
        f.write("Mesh stats\n    points:           61234\n    cells:            48211\n    faces:            150000\n")
    say({"event": "folder", "folder": run_dir, "id": rid})
    for st in ("generate", "blockMesh", "snappyHexMesh", "checkMesh", "topoSet"):
        say({"event": "step", "step": st, "id": rid}); say({"event": "stepDone", "step": st, "exitCode": 0, "seconds": 0.1, "id": rid})
    say({"event": "step", "step": "simpleFoam", "id": rid})
    it = 0
    while True:
        it += 100
        say({"event": "progress", "step": "simpleFoam", "iteration": it, "of": 6000, "seconds": it / 100, "id": rid})
        if name not in ("slow", "stubborn") and it >= 300:
            break
        if cancel.is_set() and name == "slow":
            note("cancelled"); say({"ok": False, "error": "Stopped.", "id": rid}); return
        time.sleep(0.05)
    say({"event": "step", "step": "report", "id": rid})
    res = {"ok": True, "folder": run_dir, "case": case, "solver": "simpleFoam", "iterations": 300, "endTime": 6000,
           "results": {"planes": {"tract_end": {"dp_total_Pa": 1050.0, "K_total_loss": 0.83, "mdot_kg_s": 0.369}}},
           "steps": [{"step": "simpleFoam", "exitCode": 0, "seconds": 3.0, "stoppedBy": "convergence"}]}
    say({"ok": True, "result": res, "id": rid})
ts = []
for line in sys.stdin:
    if not line.strip():
        continue
    m = json.loads(line)
    if m.get("action") == "cancel":
        note("cancel line"); cancel.set(); continue
    if m.get("action") == "hostInfo":
        say({"ok": True, "result": {"app": "Exhaust Tuner", "engines": {"openfoam": True}}, "id": m["id"]}); continue
    t = threading.Thread(target=run, args=(m,)); t.start(); ts.append(t)
note("stdin closed")
for t in ts:
    t.join()
''' % (sys.executable, log)
with open(host, 'w') as f:
    f.write(STUB)
os.chmod(host, os.stat(host).st_mode | stat.S_IEXEC)
ok(FR.find_host() == host, 'the program found where the per-user installer puts it (%LOCALAPPDATA%\\Programs\\Exhaust Tuner)')
h, why = FR.status()
ok(h is None and 'its OpenFOAM is not there' in why and 'blockMesh' in why, 'the program without its OpenFOAM: ' + why)
fd = FR.foam_dir(host)
os.makedirs(os.path.join(fd, 'bin'))
os.makedirs(os.path.join(fd, 'etc'))
for prog in FR.PROGRAMS:
    open(os.path.join(fd, 'bin', prog + ('.exe' if os.name == 'nt' else '')), 'w').close()
ok(FR.status() == (host, ''), 'with engines/openfoam/OpenFOAM-v2412 (bin with the 8 programs, etc) beside it, the CFD can run')
ok(HR.host_info()['engines']['openfoam'] is True, 'hostInfo then reports OpenFOAM')


def logged():
    try:
        return open(log).read()
    except Exception:
        return ''


hi = FR.ask_host(host)
ok(hi.get('engines', {}).get('openfoam') is True, 'a hostInfo request to the program\'s host answers (the live test\'s first check)')

# ---------------------------------------------------------------- 2. one run, straight through foamrun
evs = []
job = {'cancel': threading.Event(), 'procs': [], 'result': None}
files = [{'name': 'design.json', 'text': '{"name": "x"}'}, {'name': 'intake_cfd.py', 'text': '#'}]
t0 = time.time()
res = FR.run_openfoam({'name': 'ok', 'files': files, 'cache': '{"design": 1}'}, job, evs.append)
ok(res.get('ok') and res['results']['planes']['tract_end']['dp_total_Pa'] == 1050.0 and res['cached'] is False,
   'the run comes back with the host\'s results (tract end 1050 Pa)')
ok(res.get('cells') == 48211 and res.get('seconds_total', -1) >= 0 and res.get('program') == host, 'cells %s read from log.checkMesh; run time and program added' % res.get('cells'))
steps = [e.get('step') for e in evs if e.get('event') == 'step']
ok(steps == ['generate', 'blockMesh', 'snappyHexMesh', 'checkMesh', 'topoSet', 'simpleFoam', 'report'] and all('id' not in e for e in evs),
   'progress: %s' % ', '.join(steps))
ok(any(e.get('event') == 'progress' and e.get('iteration') == 300 and e.get('of') == 6000 for e in evs), 'iteration events (300 of at most 6000)')
time.sleep(0.3)
ok('run ok files=design.json,intake_cfd.py' in logged() and 'stdin closed' in logged(), 'the host got the case files, and its stdin was closed after the reply so it exits')

# ---------------------------------------------------------------- 3. the cache
n_before = logged().count('run ')
evs2 = []
t1 = time.time()
res2 = FR.run_openfoam({'name': 'ok', 'files': files, 'cache': '{"design": 1}'}, {'cancel': threading.Event(), 'procs': []}, evs2.append)
ok(res2.get('cached') is True and res2['results']['planes']['tract_end']['dp_total_Pa'] == 1050.0 and logged().count('run ') == n_before and time.time() - t1 < 0.5,
   'the same design again: from the cache in %.3f s, the host not started' % (time.time() - t1))
res3 = FR.run_openfoam({'name': 'ok', 'files': files, 'cache': '{"design": 2}'}, {'cancel': threading.Event(), 'procs': []}, lambda e: None)
ok(res3.get('cached') is False and logged().count('run ') == n_before + 1, 'a changed design runs again')
ok(len(os.listdir(FR.cache_root())) == 2, 'two results in Documents/Exhaust Tuner/cfd-cache')

# ---------------------------------------------------------------- 4. errors
for name, want, what in (('fail', 'OpenFOAM is not installed where the program expects it', 'a host error is passed on as said'),
                         ('die', 'stopped without an answer', 'a host that dies says so')):
    try:
        FR.run_openfoam({'name': name, 'files': files}, {'cancel': threading.Event(), 'procs': []}, lambda e: None)
        ok(False, what)
    except RuntimeError as e:
        ok(want in str(e), what + ': ' + str(e))

# ---------------------------------------------------------------- 5. through hostrun: hostCall, hostDone, hostChunk, Stop
done, events = {}, []
lk = threading.Lock()


def post(kind, payload):
    with lk:
        if kind == 'hostDone':
            done[payload['id']] = payload
        else:
            events.append(payload)


HR._post = post
r = HR.host_call({'id': 'a', 'action': 'runOpenFOAM', 'data': {'name': 'ok', 'files': files, 'cache': '{"design": 3}'}})
ok(r.get('started') == 'a', 'hostCall runOpenFOAM starts in the background')
for _ in range(200):
    if 'a' in done:
        break
    time.sleep(0.05)
txt, i = '', 0
while done.get('a', {}).get('ok'):
    c = HR.host_chunk({'id': 'a', 'i': i})
    if not c.get('ok'):
        break
    txt += c['text']
    i += 1
    if c['last']:
        break
rr = json.loads(txt) if txt else {}
ok(rr.get('ok') and rr.get('cells') == 48211 and any(e['ev'].get('event') == 'progress' for e in events if e['id'] == 'a'),
   'hostDone, the result fetched with hostChunk, progress as hostEvent')
FR.STOP_WAIT = 2.0
for name, what in (('slow', 'Stop: the host gets the cancel line and stops'), ('stubborn', 'Stop on a host that ignores it: killed after the wait')):
    done.clear()
    HR.host_call({'id': name, 'action': 'runOpenFOAM', 'data': {'name': name, 'files': files}})
    time.sleep(0.6)
    t2 = time.time()
    HR.host_cancel()
    for _ in range(200):
        if name in done:
            break
        time.sleep(0.05)
    d = done.get(name, {})
    ok(d.get('ok') is False and d.get('msg') == 'Stopped.' and 'cancel line' in logged() and time.time() - t2 < 6,
       '%s (%.1f s)' % (what, time.time() - t2))
ok('cancelled' in logged(), 'the stand-in saw the cancel and stopped its solver')
HR.host_cancel()

print('test_foamrun: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
