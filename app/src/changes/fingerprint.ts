/**
 * Fields that change without anyone editing the node, or only say where it sits: moving a node,
 * a time node's scheduler checkpoints or a running stopwatch must not mark the node "changed".
 */
const IGNORED_KEYS = new Set([
  "file",
  "x",
  "y",
  "zoneId",
  "smoothLineAnchors",
  "gifStopped",
  "pdfZoom",
  "embedSections",
  "runtime",
  "elapsedMs",
  "startedAt",
  "running",
  "lastCheckedAt",
  "lastFiredKey",
  "countedMs",
  "intervalStartedAt",
  "nodeCreatedAppMs",
  "nodeCreatedActiveMs",
]);

/** A node as saved (its board index entry) plus its Markdown text. */
export type NodeRecord = { id: string; text?: string } & Record<string, unknown>;

/** Short stable hash of everything a person would call the node's content (text, name, size, data). */
export function nodeFingerprint(record: NodeRecord): string {
  return fnv1a(stable(record));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => !IGNORED_KEYS.has(key) && record[key] !== undefined && record[key] !== null)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  // Sizes go through float math on every save; round so 25 and 25.000000000000004 agree.
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "null";
  return JSON.stringify(value) ?? "null";
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
