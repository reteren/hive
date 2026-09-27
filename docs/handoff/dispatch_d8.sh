#!/usr/bin/env bash
# Dispatch debug 8 (d8_*.md) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: debug 8 after 1.2.3" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_57f5092c-e20e-4735-bb4f-7a3a826d872c [b]=term_deb84ed8-1b55-44e7-9913-39c3314bace5 [c]=term_af75a516-3777-474e-9331-2cbb85e9ae18 [d]=term_91dc126d-ccb3-4e25-8afe-6fa876635aa6 [e]=term_7db8a8e0-e351-4329-bb17-a80346e91c1e [f]=term_487f578c-93d4-4815-af47-e4789be7efd9)
declare -A title=([a]="Inbox, placement, smooth lines" [b]="List dragging and icons" [c]="Statistics with List" [d]="Source redesign and opening" [e]="Size rules, Map, Dictionary" [f]="Mark as module")
for k in a b c d e f; do
  spec="Read C:\hive\docs\handoff\d8_$k.md (and d8common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
