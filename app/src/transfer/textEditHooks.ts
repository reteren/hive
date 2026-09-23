/** A dependent text change that must travel with one editor history command. */
export interface TextEditEffect {
  /** Stable identity within this editor edit, usually the source/target id pair. */
  key: string;
  before: string;
  after: string;
  apply(text: string): void;
}

export interface TextEditParticipant {
  id: string;
  capture(noteId: string, before: string, after: string): TextEditEffect[];
}

const participants = new Map<string, TextEditParticipant>();

/** Register a feature that adds dependent changes to text editor Undo/Redo. */
export function registerTextEditParticipant(participant: TextEditParticipant): () => void {
  participants.set(participant.id, participant);
  return () => {
    if (participants.get(participant.id) === participant) participants.delete(participant.id);
  };
}

/** Capture dependent changes before updating the source note. */
export function captureTextEditEffects(noteId: string, before: string, after: string): TextEditEffect[] {
  return [...participants.values()].flatMap((participant) => participant.capture(noteId, before, after));
}

export function applyTextEditEffects(effects: readonly TextEditEffect[], direction: "undo" | "redo"): void {
  const ordered = direction === "undo" ? [...effects].reverse() : effects;
  for (const effect of ordered) effect.apply(direction === "undo" ? effect.before : effect.after);
}

/** Merge side effects only when both typing fragments touched the same values in sequence. */
export function mergeTextEditEffects(
  previous: readonly TextEditEffect[],
  next: readonly TextEditEffect[],
): TextEditEffect[] | null {
  if (previous.length !== next.length) return null;

  const nextByKey = new Map(next.map((effect) => [effect.key, effect]));
  const merged: TextEditEffect[] = [];
  for (const prior of previous) {
    const later = nextByKey.get(prior.key);
    if (!later || prior.after !== later.before) return null;
    merged.push({ ...prior, after: later.after });
  }
  return merged;
}
