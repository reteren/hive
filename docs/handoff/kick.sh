#!/usr/bin/env bash
# Submit a dispatched prompt that got pasted into a worker's input but not sent.
# Usage: kick.sh <terminal-handle>...
for h in "$@"; do
  sleep 6
  tail=$(orca terminal read --terminal "$h" --json | python -c "import json,sys;print(str(json.load(sys.stdin)['result']['terminal'])[-300:])")
  if echo "$tail" | grep -q "Pasted Content"; then
    orca terminal send --terminal "$h" --text "" --enter --json >/dev/null && echo "kicked $h"
  else
    echo "ok $h"
  fi
done
