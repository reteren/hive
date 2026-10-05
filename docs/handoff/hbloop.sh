#!/usr/bin/env bash
# Auto-acknowledge heartbeat-only deliveries so they don't pile up while workers run.
while true; do
  id=$(orca orchestration check --wait --types heartbeat --timeout-ms 600000 --json 2>/dev/null | python -c "import json,sys
try: print(json.load(sys.stdin)['result'].get('deliveryId') or '')
except Exception: print('')")
  [ -n "$id" ] && orca orchestration check --ack "$id" --json >/dev/null 2>&1
done
