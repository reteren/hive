#!/usr/bin/env bash
# Dispatch the d42 performance audit (d42_tasks.md a-f) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: performance wave d42 (audit)" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=([a]=term_4a802c08-abf4-428d-b46b-03446451c25b [b]=term_504f4f19-a954-44b0-ba82-04d4a0a0d556 [c]=term_d36543e3-6d6b-46bf-b5f0-9a80c4140f13 [d]=term_eec6a757-938c-42f3-8efd-fb3c4c51c9ce [e]=term_80e54a70-e5b6-4065-8bfc-3463c65b127d [f]=term_5e36e757-0f52-4733-a95d-1b6c68129831)
declare -A title=([a]="Audit: node rendering" [b]="Audit: links and zones" [c]="Audit: interaction hot paths" [d]="Audit: drawing on large areas" [e]="Audit: persistence and watchers" [f]="Audit: heavy content per node")
for k in a b c d e f; do
  spec="Read C:\hive\docs\handoff\d42common.md, then section '$k' of C:\hive\docs\handoff\d42_tasks.md, and do exactly that read-only audit. Write C:\hive\docs\handoff\d42_audit_$k.md. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  ok=$(orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['ok'],d.get('error'))")
  echo "$k $id $ok"
done
