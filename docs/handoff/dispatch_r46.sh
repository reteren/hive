#!/usr/bin/env bash
# Dispatch R4.6-R4.8 (r46_*.md) to four of the user's Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: R4.6-R4.8 complex zone shapes" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_d501f962-da12-434b-8291-966a3664669c [b]=term_52c83ce1-8727-48aa-a813-22cd7979ef27 [c]=term_d88f2e67-7e36-407d-a89f-1fdb02979999 [d]=term_36ee5725-c2d3-45ae-846e-7104b7b19772)
declare -A title=([a]="Zone shape engine" [b]="Contour editing logic" [c]="Shape-edit mode UI and cut-out" [d]="Complex zones rendering and behaviour")
for k in a b c d; do
  spec="Read C:\hive\docs\handoff\r46_$k.md (and r46common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
