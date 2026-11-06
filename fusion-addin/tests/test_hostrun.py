"""hostrun.py, the panel's OpenWAM runs inside Fusion, with a stand-in solver (a shell script that writes what OpenWAM
writes): the case written with CRLF inputs, every .wam model run in its own folder, finished only with OpenWAM's
marker, the INS.DAT cut to its last four cycles, progress events, the result fetched in pieces, and a stop.
   python3 tests/test_hostrun.py"""
import json
import os
import stat
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import hostrun as HR   # noqa: E402

FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


tmp = tempfile.mkdtemp()
os.environ['HOME'] = tmp            # runs_root() under this
os.makedirs(os.path.join(tmp, 'Documents'))
# INS with six cycles of 0..700 deg
ins = 'Angle(deg)\tP\n' + ''.join('%d\t%d\n' % (a, c) for c in range(6) for a in range(0, 720, 20))
exe = os.path.join(tmp, 'OpenWAM.exe')
with open(exe, 'w') as f:
    f.write('#!/bin/sh\nn=$(basename "$1" .wam)\necho "model $n"\n'
            'if [ "$n" = bad ]; then echo nan; exit 0; fi\n'
            'if [ "$n" = slow ]; then exec sleep 30; fi\n'
            'echo avg > ${n}AVG.DAT\ncat > ${n}INS.DAT <<EOF\n' + ins + 'EOF\n'
            'echo "SIMULATION FINISHED CORRECTLY"\n')
os.chmod(exe, os.stat(exe).st_mode | stat.S_IEXEC)
HR.find_openwam = lambda: exe

t = HR.ins_tail(ins, 4)
ok(t.startswith('Angle(deg)') and t.count('\n') == 1 + 4 * 36, 'ins_tail keeps the header and the last four of six cycles')
ok(HR.ins_tail('x\ty\n1\t2\n', 4) == 'x\ty\n1\t2\n', 'ins_tail leaves a file without an Angle column alone')

events, done = [], {}
lock = threading.Lock()


def post(kind, payload):
    with lock:
        if kind == 'hostDone':
            done[payload['id']] = payload
        else:
            events.append(payload)


HR._post = post
files = [{'name': 'a.wam', 'text': 'line1\nline2\n'}, {'name': 'bad.wam', 'text': 'x\n'}, {'name': 'run_all.bat', 'text': 'echo\n'},
         {'name': 'README.txt', 'text': 'r\n'}]
r = HR.host_call({'id': 1, 'action': 'runOpenWAM', 'data': {'name': 'test case', 'files': files}})
ok(r.get('ok') and r.get('started') == '1', 'the call starts the run and returns at once')
for _ in range(200):
    if '1' in done:
        break
    time.sleep(0.05)
d = done.get('1') or {}
ok(d.get('ok') and d.get('size', 0) > 0, 'hostDone arrives with the result size (%s)' % d.get('size'))
text, i = '', 0
while True:
    c = HR.host_chunk({'id': 1, 'i': i})
    if not c.get('ok'):
        break
    text += c['text']
    i += 1
    if c['last']:
        break
res = json.loads(text) if text else {}
ms = {m['name']: m for m in res.get('models', [])}
ok(set(ms) == {'a', 'bad'}, 'both models ran (%s)' % ', '.join(ms))
ok(ms.get('a', {}).get('finished') and ms['a'].get('avg') == 'avg\n', 'a finished, its AVG.DAT read')
ok(ms.get('a', {}).get('ins', '').count('\n') == 1 + 4 * 36, 'its INS.DAT cut to the last four cycles')
ok(ms.get('bad', {}).get('finished') is False and ms['bad'].get('avg') is None and 'nan' in ms['bad'].get('logTail', ''), 'bad did not finish; its log tail says why')
with open(os.path.join(res['folder'], 'a.wam'), 'rb') as f:
    ok(f.read() == b'line1\r\nline2\r\n', 'the .wam input is written with CRLF')
ok(os.path.isfile(os.path.join(res['folder'], 'a', 'a.log')), 'each model runs in its own folder with its log')
ok(any(e['ev'].get('event') == 'done' and e['ev'].get('count') == 2 and e['ev'].get('of') == 2 for e in events), 'progress events: 2 of 2 done')
ok(not HR.host_chunk({'id': 1, 'i': 0}).get('ok'), 'the result is dropped once fetched')

# a stop kills the solver
done.clear()
HR.host_call({'id': 2, 'action': 'runOpenWAM', 'data': {'name': 's', 'files': [{'name': 'slow.wam', 'text': 'x\n'}]}})
time.sleep(0.5)
t0 = time.time()
HR.host_cancel()
for _ in range(200):
    if '2' in done:
        break
    time.sleep(0.05)
ok(done.get('2', {}).get('ok') is False and 'Stopped' in done.get('2', {}).get('msg', '') and time.time() - t0 < 5, 'Stop ends a running model within seconds')

r = HR.host_call({'id': 3, 'action': 'runEngineSim', 'data': {}})
ok(r.get('ok') is False and 'program' in r.get('msg', ''), 'an action the panel cannot run says so')
info = HR.host_info()
ok(info['engines']['openwam'] and info['openwam'] == exe and info['where'] == 'fusion', 'hostInfo reports OpenWAM')

print('test_hostrun: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
