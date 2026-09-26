import { execute } from "../history/history.svelte";
import { board, updateNote } from "../model/board.svelte";
import { calculatorKey, type CalculatorData } from "../model/nodeData";
import { calculators, deleteCalculatorData, setCalculatorData } from "../calculator/calculators.svelte";
import { calculatorRenameTarget } from "./naming";

export type CalculatorRenameResult =
  | { ok: true; name: string; changed: boolean }
  | { ok: false; message: string };

/** Rename a calculator and move or copy its shared history in the same Undo step. */
export function renameCalculatorNode(noteId: string, proposed: string): CalculatorRenameResult {
  const note = board.notes[noteId];
  if (!note || note.type !== "calculator") return { ok: false, message: "Calculator no longer exists." };

  const target = calculatorRenameTarget(proposed, noteId, Object.values(board.notes));
  if (!target.ok) return target;
  const nextName = target.name;
  const previousName = note.name;
  if (nextName === previousName) return { ok: true, name: nextName, changed: false };

  const sourceKey = calculatorKey(previousName);
  const targetKey = calculatorKey(nextName);
  const beforeSource = ownData(sourceKey);
  const beforeTarget = sourceKey === targetKey ? beforeSource : ownData(targetKey);
  const otherSourceMirrors = sourceKey !== targetKey && Object.values(board.notes).some((other) =>
    other.id !== noteId && other.type === "calculator" && calculatorKey(other.name) === sourceKey,
  );

  if (sourceKey !== targetKey && hasData(beforeSource) && hasData(beforeTarget)) {
    return {
      ok: false,
      message: `A calculator named ${nextName} already has its own history; rename cancelled.`,
    };
  }

  const afterSource = otherSourceMirrors ? cloneData(beforeSource) : undefined;
  const afterTarget = sourceKey === targetKey
    ? beforeTarget
    : hasData(beforeSource)
      ? cloneData(beforeSource)
      : cloneData(beforeTarget ?? beforeSource);

  execute({
    label: "Rename",
    target: nextName,
    do: () => {
      updateNote(noteId, { name: nextName });
      if (sourceKey !== targetKey) {
        writeData(sourceKey, afterSource);
        writeData(targetKey, afterTarget);
      }
    },
    undo: () => {
      updateNote(noteId, { name: previousName });
      if (sourceKey !== targetKey) {
        writeData(sourceKey, beforeSource);
        writeData(targetKey, beforeTarget);
      }
    },
  });
  return { ok: true, name: nextName, changed: true };
}

function ownData(key: string): CalculatorData | undefined {
  if (!Object.prototype.hasOwnProperty.call(calculators.byKey, key)) return undefined;
  return cloneData(calculators.byKey[key]);
}

function writeData(key: string, data: CalculatorData | undefined): void {
  const copied = cloneData(data);
  if (copied) setCalculatorData(key, copied);
  else deleteCalculatorData(key);
}

function hasData(data: CalculatorData | undefined): boolean {
  return Boolean(data && (data.entries.length > 0 || data.bank !== null || data.rows.length > 0));
}

function cloneData(data: CalculatorData | undefined): CalculatorData | undefined {
  if (!data) return undefined;
  return {
    entries: data.entries.map((entry) => ({ ...entry })),
    bank: data.bank ? { ...data.bank } : null,
    rows: data.rows.map((row) => ({ ...row })),
  };
}
