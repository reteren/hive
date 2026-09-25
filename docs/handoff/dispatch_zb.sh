#!/usr/bin/env bash
# Dispatch the zone brush wave (zb_*.md) to four of the user's Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: zone brush redesign" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_a4d30399-7a7a-4ea0-a3c2-c54afbde17a4 [b]=term_873c41a0-d4b9-4242-bb6b-b521890eaac6 [c]=term_02422b69-2b32-4302-9d58-18779eb3a5a1 [d]=term_36ee5725-c2d3-45ae-846e-7104b7b19772)
declare -A title=([a]="Zone brush engine" [b]="Brush input, preview, commit" [c]="Brush panel, remove old editor")
for k in a b c; do
  spec="Read C:\hive\docs\handoff\zb_$k.md (and zbcommon.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
