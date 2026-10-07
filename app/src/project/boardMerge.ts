/**
 * Three-way merge of board documents (the parsed board index) when the project changed on disk
 * while it was open — typically a Git pull of someone else's work.
 *
 * base   — the board as this window last loaded or saved it;
 * mine   — the board in this window now (may hold unsaved edits);
 * theirs — the board now on disk.
 *
 * Objects are matched by id: whatever only one side changed wins; an object both sides changed
 * keeps this window's version (it is saved over the disk copy next). Objects added on either side
 * are kept; an object deleted on one side and untouched on the other is deleted.
 */

type Json = unknown;
type JsonObject = Record<string, Json>;

const ID_COLLECTIONS = ["notes", "links", "zones", "trash", "archive"] as const;
const KEYED_BY_CONTENT = ["taskLog"] as const;

export interface BoardMergeResult {
  document: JsonObject;
  /** Ids (or keys) both sides changed differently; this window's version was kept. */
  conflicts: string[];
}

export function mergeBoardDocuments(base: JsonObject, mine: JsonObject, theirs: JsonObject): BoardMergeResult {
  const conflicts: string[] = [];
  const document: JsonObject = {};
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])];
  for (const key of keys) {
    if ((ID_COLLECTIONS as readonly string[]).includes(key)) {
      document[key] = mergeList(asArray(base[key]), asArray(mine[key]), asArray(theirs[key]), idOf, key, conflicts);
    } else if ((KEYED_BY_CONTENT as readonly string[]).includes(key)) {
      document[key] = mergeList(asArray(base[key]), asArray(mine[key]), asArray(theirs[key]), contentKey, key, conflicts);
    } else if (key === "calculators") {
      document[key] = mergeMap(asObject(base[key]), asObject(mine[key]), asObject(theirs[key]), key, conflicts);
    } else if (key === "beaconMarks") {
      document[key] = mergeSet(asStrings(base[key]), asStrings(mine[key]), asStrings(theirs[key]));
    } else if (key === "projectCounters") {
      // Per-person stopwatch: never taken from someone else.
      document[key] = mine[key] ?? theirs[key];
    } else {
      document[key] = pick(base[key], mine[key], theirs[key], key, conflicts);
    }
  }
  return { document, conflicts };
}

function mergeList(
  base: Json[],
  mine: Json[],
  theirs: Json[],
  keyOf: (item: Json) => string | null,
  label: string,
  conflicts: string[],
): Json[] {
  const byKey = (items: Json[]) => {
    const map = new Map<string, Json>();
    for (const item of items) {
      const key = keyOf(item);
      if (key !== null && !map.has(key)) map.set(key, item);
    }
    return map;
  };
  const b = byKey(base);
  const m = byKey(mine);
  const t = byKey(theirs);
  // Their order first (it is what is on disk), then objects only this window has, in its order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const items of [theirs, mine]) {
    for (const item of items) {
      const key = keyOf(item);
      if (key !== null && !seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
  }
  const result: Json[] = [];
  for (const key of order) {
    const chosen = pickItem(b.get(key), m.get(key), t.get(key), `${label} ${key}`, conflicts);
    if (chosen !== undefined) result.push(chosen);
  }
  return result;
}

function pickItem(base: Json | undefined, mine: Json | undefined, theirs: Json | undefined, label: string, conflicts: string[]): Json | undefined {
  if (same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  // Both changed. A delete against an edit keeps the edit; two edits keep this window's.
  if (mine === undefined) return theirs;
  if (theirs === undefined) return mine;
  conflicts.push(label);
  return mine;
}

function pick(base: Json, mine: Json, theirs: Json, label: string, conflicts: string[]): Json {
  if (same(mine, theirs) || same(theirs, base)) return mine;
  if (same(mine, base)) return theirs;
  conflicts.push(label);
  return mine;
}

function mergeMap(base: JsonObject, mine: JsonObject, theirs: JsonObject, label: string, conflicts: string[]): JsonObject {
  const result: JsonObject = {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])) {
    const chosen = pickItem(base[key], mine[key], theirs[key], `${label} ${key}`, conflicts);
    if (chosen !== undefined) result[key] = chosen;
  }
  return result;
}

function mergeSet(base: string[], mine: string[], theirs: string[]): string[] {
  const inBase = new Set(base);
  const inMine = new Set(mine);
  const inTheirs = new Set(theirs);
  const result: string[] = [];
  for (const value of [...theirs, ...mine]) {
    if (result.includes(value)) continue;
    const removed = inBase.has(value) && (!inMine.has(value) || !inTheirs.has(value));
    if (!removed) result.push(value);
  }
  return result;
}

function idOf(item: Json): string | null {
  return isObject(item) && typeof item.id === "string" ? item.id : null;
}

function contentKey(item: Json): string | null {
  return item === undefined ? null : stableStringify(item);
}

function same(left: Json, right: Json): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return stableStringify(left) === stableStringify(right);
}

/** JSON with sorted keys, so field order never makes two equal objects differ. */
export function stableStringify(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: Json): Json[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: Json): JsonObject {
  return isObject(value) ? value : {};
}

function asStrings(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
