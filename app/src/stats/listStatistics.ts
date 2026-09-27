import { ME_OBJECT_ID } from "../model/link";
import type { Link } from "../model/link";
import type { ListItem } from "../model/nodeData";
import type { Note } from "../model/note";

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\u2010-\u2015-][\p{L}\p{N}\p{M}]+)*/gu;
const MAX_ROW_CACHE_ENTRIES = 800;

interface TextCounts {
  words: number;
  characters: number;
}

export type ListRowStatistics =
  | { kind: "text"; words: number; characters: number; text: string }
  | { kind: "note"; name: string; words: number; characters: number; lines: number }
  | { kind: "beacon"; name: string; connections: number }
  | { kind: "empty" };

interface CachedStatistics {
  signature: string;
  value: ListRowStatistics;
}

const rowCache = new Map<string, CachedStatistics>();

/** Calculate one List row's statistics, reusing the result until its displayed source changes. */
export function statisticsForListRow(
  listId: string,
  item: ListItem,
  notes: Readonly<Record<string, Note | undefined>>,
  links: Readonly<Record<string, Link | undefined>>,
): ListRowStatistics {
  const targetId = item.targetId;
  if (targetId === null) {
    const signature = JSON.stringify(["text", item.label]);
    return memoized(`${listId}:${item.id}`, signature, () => ({
      kind: "text",
      text: item.label,
      ...countText(item.label),
    }));
  }

  const target = notes[targetId];
  if (targetId === ME_OBJECT_ID) {
    const signature = JSON.stringify(["beacon", "ME", countConnections(targetId, links)]);
    return memoized(`${listId}:${item.id}`, signature, () => ({
      kind: "beacon",
      name: "ME",
      connections: countConnections(targetId, links),
    }));
  }
  if (!target) return memoized(`${listId}:${item.id}`, "empty", () => ({ kind: "empty" }));

  if (target.type === "beacon") {
    const connections = countConnections(target.id, links);
    const signature = JSON.stringify(["beacon", target.name, connections]);
    return memoized(`${listId}:${item.id}`, signature, () => ({
      kind: "beacon",
      name: target.name,
      connections,
    }));
  }

  if (isTextNote(target)) {
    const text = target.text ?? "";
    const signature = JSON.stringify(["note", target.name, text]);
    return memoized(`${listId}:${item.id}`, signature, () => ({
      kind: "note",
      name: target.name,
      ...countText(text),
      lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
    }));
  }

  return memoized(`${listId}:${item.id}`, `other:${target.type}`, () => ({ kind: "empty" }));
}

/** Format one row with its target label for the linked Statistics view. */
export function formatLinkedListRow(statistics: ListRowStatistics): string {
  switch (statistics.kind) {
    case "note":
      return `${statistics.name} · words - ${statistics.words} · characters - ${statistics.characters} · lines - ${statistics.lines}`;
    case "beacon":
      return `${statistics.name} · connections - ${statistics.connections}`;
    case "text":
      return `${statistics.text} · words - ${statistics.words} · characters - ${statistics.characters}`;
    case "empty":
      return "—";
  }
}

/** Format the List extension without repeating the note or row text as a label. */
export function formatListRowExtension(statistics: ListRowStatistics): string {
  switch (statistics.kind) {
    case "note":
      return `words - ${statistics.words} · characters - ${statistics.characters} · lines - ${statistics.lines}`;
    case "beacon":
      return `connections - ${statistics.connections}`;
    case "text":
      return `words - ${statistics.words} · characters - ${statistics.characters}`;
    case "empty":
      return "—";
  }
}

function countText(text: string): TextCounts {
  return { words: [...text.matchAll(WORD)].length, characters: [...text].length };
}

function countConnections(beaconId: string, links: Readonly<Record<string, Link | undefined>>): number {
  let count = 0;
  for (const link of Object.values(links)) {
    if (link && (link.from === beaconId || link.to === beaconId)) count += 1;
  }
  return count;
}

function isTextNote(note: Note): boolean {
  return note.type === "note" || note.type === "pro" || note.type === "con";
}

function memoized(key: string, signature: string, calculate: () => ListRowStatistics): ListRowStatistics {
  const cached = rowCache.get(key);
  if (cached?.signature === signature) return cached.value;

  const value = calculate();
  rowCache.delete(key);
  rowCache.set(key, { signature, value });
  if (rowCache.size > MAX_ROW_CACHE_ENTRIES) {
    const oldest = rowCache.keys().next().value as string | undefined;
    if (oldest !== undefined) rowCache.delete(oldest);
  }
  return value;
}
