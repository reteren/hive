#!/usr/bin/env bash
# Wake the coordinator when a worker message arrives OR a watched task leaves "dispatched".
# Usage: watch.sh task_id...
tasks="$*"
while true; do
  out=$(orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 120000 --json 2>/dev/null | grep -v _keepalive)
  if echo "$out" | grep -q '"count": [1-9]'; then echo "$out"; exit 0; fi
  st=$(orca orchestration task-list --brief --json | python -c "
import json,sys
want=set('$tasks'.split())
for t in json.load(sys.stdin)['result']['tasks']:
  if t['id'] in want and t['status']!='dispatched': print(t['id'],t['status'])")
  if [ -n "$st" ]; then echo "TASK STATUS CHANGE:"; echo "$st"; exit 0; fi
done
