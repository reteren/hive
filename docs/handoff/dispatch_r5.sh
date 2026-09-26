#!/usr/bin/env bash
# Dispatch R5 (r5_*.md) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: R5 nodes that show and calculate" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_a4d30399-7a7a-4ea0-a3c2-c54afbde17a4 [b]=term_873c41a0-d4b9-4242-bb6b-b521890eaac6 [c]=term_02422b69-2b32-4302-9d58-18779eb3a5a1 [d]=term_1e6b2196-079a-45cd-bea6-0ab48ee42c07 [e]=term_e8b3acaa-88f5-456c-8f91-3bf0c553cb4b [f]=term_5806cbf9-b4f0-45f5-a49a-89bb15754dcb)
declare -A title=([a]="Goal node" [b]="Scope, Progress, Statistics" [c]="Calculator core" [d]="Calculator bank and linked rows" [e]="Calculator persistence and mirroring" [f]="Tierlist")
for k in a b c d e f; do
  spec="Read C:\hive\docs\handoff\r5_$k.md (and r5common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
