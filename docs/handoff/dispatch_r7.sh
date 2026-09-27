#!/usr/bin/env bash
# Dispatch R7 (r7_*.md) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: R7 quick input and organisational nodes" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_487f578c-93d4-4815-af47-e4789be7efd9 [b]=term_57f5092c-e20e-4735-bb4f-7a3a826d872c [c]=term_deb84ed8-1b55-44e7-9913-39c3314bace5 [d]=term_91dc126d-ccb3-4e25-8afe-6fa876635aa6 [e]=term_af75a516-3777-474e-9331-2cbb85e9ae18 [f]=term_7db8a8e0-e351-4329-bb17-a80346e91c1e)
declare -A title=([a]="Tray, global shortcut, quick window" [b]="Inbox node and twins" [c]="List and Random Choice" [d]="Source node" [e]="Spellcheck and shared dictionary" [f]="Map overlay and node")
for k in a b c d e f; do
  spec="Read C:\hive\docs\handoff\r7_$k.md (and r7common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
