#!/usr/bin/env bash
# Dispatch the 1.1.1 mini-debug (d11_*.md) to three of the user's Codex terminals.
cd /c/hive
run=run_1cde70c13942
declare -A term=([a]=term_d501f962-da12-434b-8291-966a3664669c [b]=term_52c83ce1-8727-48aa-a813-22cd7979ef27 [c]=term_d88f2e67-7e36-407d-a89f-1fdb02979999)
declare -A title=([a]="Predictable placement with gap" [b]="Plus centring, zone min 30" [c]="Line breaks, fit width to text")
for k in a b c; do
  spec="Read C:\hive\docs\handoff\d11_$k.md (and d10common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  echo "$k $id"
  orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json >/dev/null && echo "started $k"
done
