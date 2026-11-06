"""Stands in for Fusion between the page and hostrun.py in web/tests/fusionhost_ui.js: one JSON request a line on
stdin ({seq, action, data}) gets {seq, reply} on stdout; the run's messages come out as {kind, payload} lines."""
import json
import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import hostrun as HR   # noqa: E402

out = threading.Lock()


def send(obj):
    with out:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


HR._post = lambda kind, payload: send({'kind': kind, 'payload': json.dumps(payload)})
ACT = {'hostInfo': HR.host_info, 'hostCall': HR.host_call, 'hostChunk': HR.host_chunk, 'hostCancel': HR.host_cancel}
for line in sys.stdin:
    try:
        q = json.loads(line)
    except ValueError:
        continue
    fn = ACT.get(q.get('action'))
    send({'seq': q.get('seq'), 'reply': fn(q.get('data') or {}) if fn else {'ok': False, 'msg': 'unknown'}})
