#!/usr/bin/env bash
# Dispatch the 1.0.9 debug wave (d10_*.md) to the user's six Codex terminals.
cd /c/hive
run=$(orca orchestration run-create --objective "hive: debug and improvements after 1.0.9" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['run']['id'])")
echo "run $run"
declare -A term=(
  [a]=term_f1b321f9-b7bf-4ac2-ad87-315e7c75e5c6
  [b]=term_82d22dee-7f60-409e-b60e-a563ce2f4354
  [c]=term_14bf8b71-b169-4fdb-b4fc-56f346c392d9
  [d]=term_ef3abc10-a0c7-415d-b691-7cc99077575b
  [e]=term_99e89cba-3ab7-4272-aa9f-7b0f45079928
  [f]=term_796ce503-a2c8-4d2e-bc71-b888bb929873
)
declare -A title=(
  [a]="Selection layer fixes"
  [b]="Grid and snap controls"
  [c]="Beacons menu, focus, search"
  [d]="Mood and Purpose nodes"
  [e]="Undoable selection, placement"
  [f]="Width lock, size limits, zone blob"
)
for k in a b c d e f; do
  spec="Read C:\\hive\\docs\\handoff\\d10_$k.md (and d10common.md) and do exactly that task. Report with worker_done when finished."
  id=$(orca orchestration task-create --run "$run" --task-title "${title[$k]}" --spec "$spec" --json | python -c "import json,sys;print(json.load(sys.stdin)['result']['task']['id'])")
  echo "$k $id ${term[$k]}"
  orca orchestration worker-start --run "$run" --task "$id" --terminal "${term[$k]}" --json >/dev/null && echo "started $k"
done
