/**
 * What one Git version changed in a node, said in words: sentences for the node itself ("Moved
 * card “X” from S to A", "Completed the task") and a word-level diff of its text — not Git's patch.
 */

export interface NodeVersionData {
  beforeNode: string | null;
  afterNode: string | null;
  beforeText: string | null;
  afterText: string | null;
  beforeLegacy: boolean;
}

export interface NameLookup {
  noteName: (id: string) => string | undefined;
  zoneName: (id: string) => string | undefined;
}

export type TextPiece = { kind: "same" | "add" | "remove"; text: string };

export interface VersionChanges {
  lines: string[];
  /** Text diff with long unchanged stretches shortened; null when the text did not change. */
  text: TextPiece[] | null;
}

type Json = Record<string, unknown>;

/** Saved fields that are bookkeeping, not something a person changed. */
const IGNORED = new Set([
  "_order", "id", "file", "createdAt", "smoothLineAnchors", "baseWidth", "baseHeight",
  "baseStatisticsExtensionWidth", "statisticsExtensionWidth", "widthLocked", "gifStopped", "pdfZoom", "embedSections",
]);

const FIELD_LABELS: Record<string, string> = {
  customMarks: "marks",
  customMarkFrame: "mark frame",
  listStats: "list statistics",
  smoothLines: "smooth lines",
  inboxGroup: "inbox group",
  randomPick: "random pick",
  source: "source",
  message: "message settings",
  recordings: "recordings",
  scope: "scope",
  frameHidden: "frame",
};

export function describeVersion(version: NodeVersionData, names: NameLookup): VersionChanges {
  const before = parse(version.beforeNode);
  const after = parse(version.afterNode);
  const lines: string[] = [];
  if (!before && after) lines.push(version.beforeLegacy ? "Project moved to the Git-friendly format" : "Created the node");
  else if (before && !after) lines.push("Deleted the node");
  else if (before && after) lines.push(...describeNode(before, after, names));

  const beforeText = normalizeText(version.beforeText);
  const afterText = normalizeText(version.afterText);
  let text: TextPiece[] | null = null;
  if (beforeText !== afterText) {
    if (beforeText.replace(/\s+/g, " ").trim() === afterText.replace(/\s+/g, " ").trim()) {
      lines.push("Only spacing or line breaks changed in the text");
    } else {
      text = compactPieces(diffText(beforeText, afterText));
    }
  } else if (version.beforeText !== version.afterText && version.beforeText !== null && version.afterText !== null) {
    lines.push("Only line endings changed in the text");
  }
  if (lines.length === 0 && !text) lines.push("No visible changes (internal data only)");
  return { lines, text };
}

function describeNode(before: Json, after: Json, names: NameLookup): string[] {
  const lines: string[] = [];
  const handled = new Set<string>();
  const take = (...keys: string[]) => keys.forEach((key) => handled.add(key));

  if (before.type !== after.type) {
    lines.push(`Turned from ${String(before.type)} into ${String(after.type)}`);
  }
  take("type");
  if (before.name !== after.name) lines.push(`Renamed “${String(before.name)}” → “${String(after.name)}”`);
  take("name");

  const dx = num(after.x) - num(before.x);
  const dy = num(after.y) - num(before.y);
  if (Math.abs(dx) + Math.abs(dy) > 0.5) lines.push("Moved on the board");
  take("x", "y");

  if (!same(before.width, after.width) || !same(before.height, after.height)) {
    lines.push(`Resized ${size(before)} → ${size(after)}`);
  }
  take("width", "height");

  if (!same(before.scale ?? 1, after.scale ?? 1)) {
    lines.push(`Scale ${Math.round(num(before.scale ?? 1) * 100)}% → ${Math.round(num(after.scale ?? 1) * 100)}%`);
  }
  take("scale");

  if (!same(before.zoneId ?? null, after.zoneId ?? null)) {
    const zone = typeof after.zoneId === "string" ? names.zoneName(after.zoneId) : undefined;
    lines.push(after.zoneId ? `Moved into zone${zone ? ` “${zone}”` : ""}` : "Taken out of its zone");
  }
  take("zoneId");

  lines.push(...describeTask(asRecord(before.task), asRecord(after.task)));
  take("task", "taskMemory");

  if (!same(before.importance ?? null, after.importance ?? null)) {
    lines.push(`Importance: ${String(before.importance ?? "none")} → ${String(after.importance ?? "none")}`);
  }
  take("importance");
  for (const key of ["purposes", "moods"] as const) {
    if (!same(before[key] ?? [], after[key] ?? [])) {
      lines.push(`${key === "purposes" ? "Purposes" : "Moods"}: ${listOf(before[key])} → ${listOf(after[key])}`);
    }
    take(key);
  }

  if (!same(before.color ?? null, after.color ?? null)) lines.push(after.color ? "Changed the colour" : "Removed the colour");
  if (!same(before.accentColor ?? null, after.accentColor ?? null)) lines.push("Changed the accent colour");
  if (!same(before.glow ?? null, after.glow ?? null)) lines.push(!before.glow ? "Added a glow" : !after.glow ? "Removed the glow" : "Changed the glow");
  if (Boolean(before.headerHidden) !== Boolean(after.headerHidden)) lines.push(after.headerHidden ? "Hid the header" : "Showed the header");
  take("color", "accentColor", "glow", "headerHidden");

  lines.push(...describeTiers(arrayOf(before.tiers), arrayOf(after.tiers), names));
  lines.push(...describeList(arrayOf(before.listItems), arrayOf(after.listItems), names));
  take("tiers", "listItems");

  const beforeImage = asRecord(before.image);
  const afterImage = asRecord(after.image);
  if (beforeImage?.file !== afterImage?.file) lines.push(afterImage ? "Replaced the picture" : "Removed the picture");
  if (!same(before.opacity ?? 1, after.opacity ?? 1)) lines.push(`Opacity ${Math.round(num(before.opacity ?? 1) * 100)}% → ${Math.round(num(after.opacity ?? 1) * 100)}%`);
  if (Boolean(before.flipX) !== Boolean(after.flipX) || Boolean(before.flipY) !== Boolean(after.flipY)) lines.push("Flipped the picture");
  if (asRecord(before.media)?.file !== asRecord(after.media)?.file) lines.push(after.media ? "Replaced the file" : "Removed the file");
  take("image", "opacity", "flipX", "flipY", "media");

  if (!same(before.youtube ?? null, after.youtube ?? null)) {
    const a = asRecord(before.youtube);
    const b = asRecord(after.youtube);
    lines.push(a?.videoId !== b?.videoId ? "Changed the video" : "Changed the video start or loop");
  }
  take("youtube");

  const beforeTime = asRecord(before.time);
  const afterTime = asRecord(after.time);
  if (beforeTime || afterTime) {
    if (Boolean(beforeTime?.enabled) !== Boolean(afterTime?.enabled)) lines.push(afterTime?.enabled ? "Turned the timer on" : "Turned the timer off");
    if (!same(beforeTime?.schedule ?? null, afterTime?.schedule ?? null)) lines.push("Changed the schedule");
    if (!same(asRecord(beforeTime?.stopwatch)?.mode ?? null, asRecord(afterTime?.stopwatch)?.mode ?? null)) lines.push("Changed the stopwatch mode");
  }
  take("time");

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (handled.has(key) || IGNORED.has(key)) continue;
    if (!same(before[key] ?? null, after[key] ?? null)) lines.push(`Changed the ${FIELD_LABELS[key] ?? humanize(key)}`);
  }
  return lines;
}

function describeTask(before: Json | null, after: Json | null): string[] {
  if (!before && after) return [after.done ? "Made it a task and completed it" : "Made it a task"];
  if (before && !after) return ["No longer a task"];
  if (before && after && Boolean(before.done) !== Boolean(after.done)) return [after.done ? "Completed the task" : "Reopened the task"];
  return [];
}

function describeTiers(before: Json[], after: Json[], names: NameLookup): string[] {
  if (same(before, after)) return [];
  const lines: string[] = [];
  const rowName = (row: Json | undefined) => `“${String(row?.name || "untitled row")}”`;
  const beforeRows = new Map(before.map((row) => [String(row.id), row]));
  const afterRows = new Map(after.map((row) => [String(row.id), row]));
  for (const [id, row] of afterRows) {
    const old = beforeRows.get(id);
    if (!old) lines.push(`Added row ${rowName(row)}`);
    else if (old.name !== row.name) lines.push(`Renamed row ${rowName(old)} → ${rowName(row)}`);
  }
  for (const [id, row] of beforeRows) if (!afterRows.has(id)) lines.push(`Removed row ${rowName(row)}`);

  const where = (rows: Json[]) => {
    const map = new Map<string, { row: Json; index: number; card: Json }>();
    for (const row of rows) arrayOf(row.cards).forEach((card, index) => map.set(String(card.id), { row, index, card }));
    return map;
  };
  const was = where(before);
  const now = where(after);
  const reordered = new Set<string>();
  for (const [id, { row, card }] of now) {
    const old = was.get(id);
    if (!old) lines.push(`Added ${cardLabel(card, names)} to ${rowName(row)}`);
    else if (old.row.id !== row.id) lines.push(`Moved ${cardLabel(card, names)} from ${rowName(old.row)} to ${rowName(row)}`);
  }
  for (const [id, { row, card }] of was) if (!now.has(id)) lines.push(`Removed ${cardLabel(card, names)} from ${rowName(row)}`);
  for (const row of after) {
    const old = beforeRows.get(String(row.id));
    if (!old) continue;
    const stayed = (cards: Json[]) => cards.map((card) => String(card.id)).filter((id) => was.get(id)?.row.id === row.id && now.get(id)?.row.id === row.id);
    if (!same(stayed(arrayOf(old.cards)), stayed(arrayOf(row.cards)))) reordered.add(rowName(row));
  }
  for (const row of reordered) lines.push(`Reordered cards in ${row}`);
  if (lines.length === 0) lines.push("Changed the tierlist");
  return lines;
}

function cardLabel(card: Json, names: NameLookup): string {
  if (card.kind === "text") return `“${shorten(String(card.text ?? ""), 40)}”`;
  if (card.kind === "note") return `“${shorten(names.noteName(String(card.noteId)) ?? "a node", 40)}”`;
  const image = asRecord(card.image);
  return image?.name ? `picture “${shorten(String(image.name), 40)}”` : "a picture";
}

function describeList(before: Json[], after: Json[], names: NameLookup): string[] {
  if (same(before, after)) return [];
  const label = (item: Json) => `“${shorten(String(item.label || (item.targetId ? names.noteName(String(item.targetId)) : "") || "item"), 40)}”`;
  const beforeIds = new Set(before.map((item) => String(item.id)));
  const afterIds = new Set(after.map((item) => String(item.id)));
  const lines: string[] = [];
  for (const item of after) if (!beforeIds.has(String(item.id))) lines.push(`Added ${label(item)} to the list`);
  for (const item of before) if (!afterIds.has(String(item.id))) lines.push(`Removed ${label(item)} from the list`);
  const kept = (items: Json[]) => items.map((item) => String(item.id)).filter((id) => beforeIds.has(id) && afterIds.has(id));
  if (!same(kept(before), kept(after))) lines.push("Reordered the list");
  const beforeById = new Map(before.map((item) => [String(item.id), item]));
  for (const item of after) {
    const old = beforeById.get(String(item.id));
    if (old && old.label !== item.label && old.label && item.label) lines.push(`Renamed list item ${label(old)} → ${label(item)}`);
  }
  if (lines.length === 0) lines.push("Changed the list");
  return lines;
}

/** Word-level diff (whitespace kept as its own tokens); falls back to lines for very large texts. */
export function diffText(before: string, after: string): TextPiece[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  // Keep whole words around the changed middle.
  while (start > 0 && !/\s/.test(before[start - 1]!)) start -= 1;
  while (endBefore < before.length && endAfter < after.length && !/\s/.test(before[endBefore]!)) {
    endBefore += 1;
    endAfter += 1;
  }
  const pieces: TextPiece[] = [];
  if (start > 0) pieces.push({ kind: "same", text: before.slice(0, start) });
  const a = tokens(before.slice(start, endBefore));
  const b = tokens(after.slice(start, endAfter));
  const middle = a.length * b.length <= 4_000_000 ? lcsDiff(a, b) : lcsDiff(lineTokens(a.join("")), lineTokens(b.join("")));
  pieces.push(...middle);
  if (endBefore < before.length) pieces.push({ kind: "same", text: before.slice(endBefore) });
  return merge(pieces);
}

function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function lineTokens(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function lcsDiff(a: string[], b: string[]): TextPiece[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [{ kind: "remove", text: a.join("") }, { kind: "add", text: b.join("") }];
  const table = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * (m + 1) + j] = a[i] === b[j]
        ? table[(i + 1) * (m + 1) + j + 1]! + 1
        : Math.max(table[(i + 1) * (m + 1) + j]!, table[i * (m + 1) + j + 1]!);
    }
  }
  const pieces: TextPiece[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pieces.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * (m + 1) + j]! >= table[i * (m + 1) + j + 1]!) {
      pieces.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      pieces.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) pieces.push({ kind: "remove", text: a[i++]! });
  while (j < m) pieces.push({ kind: "add", text: b[j++]! });
  return pieces;
}

function merge(pieces: TextPiece[]): TextPiece[] {
  const merged: TextPiece[] = [];
  for (const piece of pieces) {
    if (!piece.text) continue;
    const last = merged.at(-1);
    if (last && last.kind === piece.kind) last.text += piece.text;
    else merged.push({ ...piece });
  }
  return merged;
}

const CONTEXT = 70;

/** Shorten long unchanged stretches so the changes stay in view. */
export function compactPieces(pieces: TextPiece[]): TextPiece[] {
  return pieces.map((piece, index) => {
    if (piece.kind !== "same" || piece.text.length <= CONTEXT * 2 + 10) return piece;
    const first = index === 0;
    const last = index === pieces.length - 1;
    if (first) return { kind: "same", text: `…${cutStart(piece.text, CONTEXT)}` };
    if (last) return { kind: "same", text: `${cutEnd(piece.text, CONTEXT)}…` };
    return { kind: "same", text: `${cutEnd(piece.text, CONTEXT)} … ${cutStart(piece.text, CONTEXT)}` };
  });
}

function cutEnd(text: string, length: number): string {
  const slice = text.slice(0, length);
  const space = slice.lastIndexOf(" ");
  return space > length / 2 ? slice.slice(0, space) : slice;
}

function cutStart(text: string, length: number): string {
  const slice = text.slice(-length);
  const space = slice.indexOf(" ");
  return space >= 0 && space < length / 2 ? slice.slice(space + 1) : slice;
}

function normalizeText(text: string | null): string {
  return (text ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
}

function parse(json: string | null): Json | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}

function arrayOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item): item is Json => Boolean(asRecord(item))) : [];
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function size(node: Json): string {
  const round = (value: unknown) => String(Math.round(num(value) * 10) / 10);
  return `${round(node.width)} × ${node.height === null || node.height === undefined ? "auto" : round(node.height)}`;
}

function listOf(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "none";
}

function shorten(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length - 1)}…` : single;
}

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.001;
  return stable(a) === stable(b);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Json;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined && record[key] !== null).sort()
      .map((key) => `${key}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
