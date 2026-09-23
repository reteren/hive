/**
 * Task → Task dependencies (R3.8, decision A05): a task cannot be completed while any task
 * directly linked into it (strong link A → B) is still open. Implemented by the dependencies worker.
 */
export interface CompletionCheck {
  ok: boolean;
  /** Open predecessor note ids that block completion. */
  blockers: string[];
}

export function canCompleteTask(_noteId: string): CompletionCheck {
  return { ok: true, blockers: [] };
}
