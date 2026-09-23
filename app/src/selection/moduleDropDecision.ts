import type { NoteKind } from "../model/note";

export interface ModuleDropDecision {
  /** Whether the caller should offer this single module to the drop hook. */
  tryInsert: boolean;
  /** Whether to commit the ordinary Move history command. */
  commitMove: boolean;
  /** Module previews are always removed when the gesture ends. */
  clearPreview: true;
}

/** Resolve the move/drop path without coupling gesture math to board mutations. */
export function resolveModuleDropDecision(
  movedTypes: readonly NoteKind[],
  cancelled: boolean,
  insertionSucceeded = false,
): ModuleDropDecision {
  const tryInsert = !cancelled && movedTypes.length === 1 && isStandaloneModule(movedTypes[0]);
  return {
    tryInsert,
    commitMove: !cancelled && (!tryInsert || !insertionSucceeded),
    clearPreview: true,
  };
}

function isStandaloneModule(type: NoteKind | undefined): boolean {
  return type === "importance" || type === "purpose";
}
