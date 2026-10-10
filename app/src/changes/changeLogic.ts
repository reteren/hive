import { nodeFingerprint, type NodeRecord } from "./fingerprint";

export type ChangeKind = "new" | "changed";

/** Node id → fingerprint of the node as this person last saw it. */
export type SeenMap = Record<string, string>;

export const SEEN_STATE_VERSION = 1;

/**
 * Marks for a project that was just opened. Without a saved state (first open on this computer)
 * nothing is marked: the current board becomes the starting point.
 */
export function marksOnOpen(notes: readonly NodeRecord[], seen: SeenMap | null): { seen: SeenMap; marks: Record<string, ChangeKind> } {
  if (!seen) return { seen: fingerprints(notes), marks: {} };
  const marks: Record<string, ChangeKind> = {};
  for (const note of notes) {
    const before = seen[note.id];
    if (before === undefined) marks[note.id] = "new";
    else if (before !== nodeFingerprint(note)) marks[note.id] = "changed";
  }
  return { seen: { ...seen }, marks };
}

/**
 * After this window saved: its own edits count as seen. Nodes still carrying a mark keep their old
 * fingerprint until the person looks at them; deleted nodes are forgotten.
 */
export function seenAfterOwnSave(notes: readonly NodeRecord[], seen: SeenMap, marks: Readonly<Record<string, ChangeKind>>): SeenMap {
  const next: SeenMap = {};
  for (const note of notes) {
    if (marks[note.id]) {
      if (seen[note.id] !== undefined) next[note.id] = seen[note.id];
    } else {
      next[note.id] = nodeFingerprint(note);
    }
  }
  return next;
}

/** Mark for a node that just changed from outside: "new" while this person has never seen it. */
export function externalMark(id: string, seen: SeenMap, current: ChangeKind | undefined): ChangeKind {
  if (current === "new" || seen[id] === undefined) return "new";
  return "changed";
}

export function parseSeenState(serialized: string | null): SeenMap | null {
  if (serialized == null) return null;
  try {
    const parsed = JSON.parse(serialized) as { version?: unknown; seen?: unknown };
    if (parsed.version !== SEEN_STATE_VERSION || !parsed.seen || typeof parsed.seen !== "object" || Array.isArray(parsed.seen)) return null;
    const seen: SeenMap = {};
    for (const [id, value] of Object.entries(parsed.seen as Record<string, unknown>)) {
      if (typeof value === "string") seen[id] = value;
    }
    return seen;
  } catch {
    return null;
  }
}

export function serializeSeenState(seen: SeenMap): string {
  return JSON.stringify({ version: SEEN_STATE_VERSION, seen });
}

function fingerprints(notes: readonly NodeRecord[]): SeenMap {
  return Object.fromEntries(notes.map((note) => [note.id, nodeFingerprint(note)]));
}
