#!/usr/bin/env bash
# Dispatch the 1.1.7 debug wave (d17_*.md) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: debug after 1.1.7" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_096d5a6e-9f3c-4f5c-b9e8-b9efcb2dbe9e [b]=term_4093c6b6-cd37-48eb-ac01-fc1926bef578 [c]=term_befffa94-52cf-4a68-84c3-c4f814d3b945 [d]=term_fd35ec66-6fa9-449b-833f-19fc9356ffa4 [e]=term_3e02aae5-0f31-4870-a6fe-0191eae568b9 [f]=term_faa73e2b-5903-44e9-ae97-b34087161004)
declare -A title=([a]="Kill focus-ring bug class" [b]="Performance pass" [c]="Goal into goal, row height" [d]="Menus open at constant size" [e]="Tierlist redesign and dragging" [f]="Fix calculator node")
for k in a b c d e f; do
  spec="Read C:\hive\docs\handoff\d17_$k.md (and d17common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
