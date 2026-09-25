#!/usr/bin/env bash
# Wake the coordinator when a worker message arrives OR a watched task leaves "dispatched".
# Heartbeat-only batches are acknowledged silently.
# Usage: watch.sh task_id...
tasks="$*"
while true; do
  out=$(orca orchestration check --wait --types worker_done,escalation,question,status --timeout-ms 120000 --json 2>/dev/null | grep -v _keepalive)
  if echo "$out" | grep -q '"count": [1-9]'; then
    verdict=$(echo "$out" | python -c "
import json,sys
d=json.load(sys.stdin)['result']
types={m['type'] for m in d['messages']}
print('HB '+d['deliveryId'] if types<= {'heartbeat'} else 'MSG')" 2>/dev/null)
    case "$verdict" in
      HB*) orca orchestration check --ack "${verdict#HB }" --json >/dev/null 2>&1; continue ;;
      *) echo "$out"; exit 0 ;;
    esac
  fi
  st=$(orca orchestration task-list --brief --json | python -c "
import json,sys
want=set('$tasks'.split())
for t in json.load(sys.stdin)['result']['tasks']:
  if t['id'] in want and t['status']!='dispatched': print(t['id'],t['status'])")
  if [ -n "$st" ]; then echo "TASK STATUS CHANGE:"; echo "$st"; exit 0; fi
done
