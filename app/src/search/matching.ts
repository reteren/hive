import type { NoteKind } from "../model/note";
import { inlineImageTextForFit } from "../editor/markdownSyntax";

export interface SearchNote {
  id: string;
  name: string;
  text: string;
  createdAt?: number;
  type?: NoteKind;
  task?: boolean;
}

export type SearchResultKind = "name" | "kind" | "text";

export interface SearchResult {
  noteId: string;
  noteName: string;
  kind: SearchResultKind;
  snippet: string;
  matchStart: number;
  matchEnd: number;
  objectKind?: NoteKind;
  isTask?: boolean;
  kindMatchLabel?: string;
}

const SNIPPET_CONTENT_LENGTH = 96;

/** Find case- and diacritic-insensitive matches in note names and Markdown text. */
export function searchNotes(
  query: string,
  notes: readonly SearchNote[],
  boardOrder: readonly string[] = notes.map((note) => note.id),
): SearchResult[] {
  return new SearchIndex(notes, boardOrder).search(query);
}

interface FoldedText {
  text: string;
  starts: number[];
  ends: number[];
}

interface IndexedNote {
  note: SearchNote;
  name: FoldedText;
  searchableText: string;
  text: FoldedText;
  grams: Set<string>;
  fallbackPosition: number;
}

/** Incremental normalized full-text index; only changed note content is folded and reindexed. */
export class SearchIndex {
  private entries = new Map<string, IndexedNote>();
  private postings = new Map<string, Set<string>>();
  private positionById = new Map<string, number>();
  private nextFallbackPosition = 0;

  constructor(notes: readonly SearchNote[] = [], boardOrder: readonly string[] = []) {
    this.replace(notes, boardOrder.length > 0 ? boardOrder : notes.map((note) => note.id));
  }

  replace(notes: readonly SearchNote[], boardOrder: readonly string[] = notes.map((note) => note.id)): void {
    this.entries.clear();
    this.postings.clear();
    this.nextFallbackPosition = 0;
    for (const note of notes) this.upsert(note);
    this.setOrder(boardOrder);
  }

  upsert(note: SearchNote): boolean {
    const previous = this.entries.get(note.id);
    if (previous && sameSearchFields(previous.note, note)) {
      previous.note = note;
      return false;
    }
    if (previous) this.removePostings(note.id, previous.grams);
    const searchableText = inlineImageTextForFit(note.text);
    const name = foldWithOffsets(note.name);
    const text = foldWithOffsets(searchableText);
    const grams = new Set([
      ...gramsOf(name.text),
      ...gramsOf(text.text),
      ...kindSearchText(note).flatMap((term) => [...gramsOf(term)]),
    ]);
    const indexed: IndexedNote = {
      note,
      name,
      searchableText,
      text,
      grams,
      fallbackPosition: previous?.fallbackPosition ?? this.nextFallbackPosition++,
    };
    this.entries.set(note.id, indexed);
    for (const gram of grams) {
      let ids = this.postings.get(gram);
      if (!ids) this.postings.set(gram, ids = new Set());
      ids.add(note.id);
    }
    return true;
  }

  remove(id: string): boolean {
    const previous = this.entries.get(id);
    if (!previous) return false;
    this.removePostings(id, previous.grams);
    this.entries.delete(id);
    this.positionById.delete(id);
    return true;
  }

  setOrder(order: readonly string[]): void {
    this.positionById = new Map(order.map((id, index) => [id, index]));
  }

  search(query: string): SearchResult[] {
  const foldedQuery = foldText(query.trim());
  if (!foldedQuery) return [];
  const candidateIds = this.candidatesFor(foldedQuery);
  const matches: Array<{
    result: SearchResult;
    createdAt: number | undefined;
    position: number;
  }> = [];

  for (const id of candidateIds) {
    const indexed = this.entries.get(id);
    if (!indexed) continue;
    const note = indexed.note;
    const nameMatch = findMatchRangeInFold(indexed.name, foldedQuery);
    const resultInfo = { objectKind: note.type, isTask: Boolean(note.task) };
    if (nameMatch) {
      matches.push({
        result: {
          noteId: note.id,
          noteName: note.name,
          kind: "name",
          snippet: note.name,
          matchStart: nameMatch.start,
          matchEnd: nameMatch.end,
          ...resultInfo,
        },
        createdAt: validCreationTime(note.createdAt),
        position: this.positionById.get(note.id) ?? indexed.fallbackPosition ?? Number.MAX_SAFE_INTEGER,
      });
    }

    const kindMatch = findObjectKindMatch(note, foldedQuery);
    if (kindMatch) {
      matches.push({
        result: {
          noteId: note.id,
          noteName: note.name,
          kind: "kind",
          snippet: kindMatch.term,
          matchStart: kindMatch.start,
          matchEnd: kindMatch.end,
          kindMatchLabel: kindMatch.label,
          ...resultInfo,
        },
        createdAt: validCreationTime(note.createdAt),
        position: this.positionById.get(note.id) ?? indexed.fallbackPosition ?? Number.MAX_SAFE_INTEGER,
      });
    }

    const textMatch = findMatchRangeInFold(indexed.text, foldedQuery);
    if (textMatch) {
      const snippet = extractSnippet(indexed.searchableText, textMatch.start, textMatch.end);
      matches.push({
        result: {
          noteId: note.id,
          noteName: note.name,
          kind: "text",
          ...resultInfo,
          ...snippet,
        },
        createdAt: validCreationTime(note.createdAt),
        position: this.positionById.get(note.id) ?? indexed.fallbackPosition ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  matches.sort((left, right) => {
    const kindDifference = resultPriority(left.result.kind) - resultPriority(right.result.kind);
    if (kindDifference !== 0) return kindDifference;
    if (left.createdAt !== undefined && right.createdAt !== undefined) {
      const timeDifference = left.createdAt - right.createdAt;
      if (timeDifference !== 0) return timeDifference;
    } else if (left.createdAt !== right.createdAt) {
      return left.createdAt === undefined ? 1 : -1;
    }

    const positionDifference = left.position - right.position;
    if (positionDifference !== 0) return positionDifference;
    if (left.result.noteId === right.result.noteId && left.result.kind !== right.result.kind) {
      return resultPriority(left.result.kind) - resultPriority(right.result.kind);
    }
    return 0;
  });

  return matches.map(({ result }) => result);
  }

  matchingNameIds(query: string): string[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [...this.entries.keys()];
    return this.candidatesFor(foldText(normalized)).filter((id) =>
      this.entries.get(id)?.note.name.toLocaleLowerCase().includes(normalized));
  }

  private candidatesFor(query: string): string[] {
    const grams = [...gramsOfWidth(query, Math.min(3, query.length))];
    if (grams.length === 0) return [];
    const lists = grams.map((gram) => this.postings.get(gram));
    if (lists.some((ids) => !ids)) return [];
    const ordered = lists as Set<string>[];
    ordered.sort((left, right) => left.size - right.size);
    const [smallest, ...rest] = ordered;
    return [...smallest].filter((id) => rest.every((ids) => ids.has(id)));
  }

  private removePostings(id: string, grams: Set<string>): void {
    for (const gram of grams) {
      const ids = this.postings.get(gram);
      ids?.delete(id);
      if (ids?.size === 0) this.postings.delete(gram);
    }
  }
}

function gramsOf(value: string): Set<string> {
  const grams = new Set<string>();
  for (let width = 1; width <= Math.min(3, value.length); width += 1) {
    for (let index = 0; index <= value.length - width; index += 1) grams.add(value.slice(index, index + width));
  }
  return grams;
}

function gramsOfWidth(value: string, width: number): Set<string> {
  const grams = new Set<string>();
  if (width <= 0 || width > value.length) return grams;
  for (let index = 0; index <= value.length - width; index += 1) grams.add(value.slice(index, index + width));
  return grams;
}

function sameSearchFields(left: SearchNote, right: SearchNote): boolean {
  return left.name === right.name && left.text === right.text && left.createdAt === right.createdAt &&
    left.type === right.type && Boolean(left.task) === Boolean(right.task);
}

function kindSearchText(note: SearchNote): string[] {
  const terms = note.type ? (OBJECT_KIND_TERMS[note.type] ?? []).map((entry) => entry.term) : [];
  if (note.task) terms.push("task");
  return terms.map(foldText);
}

const OBJECT_KIND_TERMS: Partial<Record<NoteKind, Array<{ term: string; label: string }>>> = {
  note: [{ term: "note", label: "Note" }],
  pro: [{ term: "pro", label: "Plus" }, { term: "plus", label: "Plus" }],
  con: [{ term: "con", label: "Minus" }, { term: "minus", label: "Minus" }],
  importance: [{ term: "importance", label: "Importance" }],
  purpose: [{ term: "purpose", label: "Purpose" }],
  mood: [{ term: "mood", label: "Mood" }],
  beacon: [{ term: "beacon", label: "Beacon" }],
};

function findObjectKindMatch(
  note: SearchNote,
  foldedQuery: string,
): { term: string; label: string; start: number; end: number } | null {
  const terms = note.type ? [...(OBJECT_KIND_TERMS[note.type] ?? [])] : [];
  if (note.task) terms.push({ term: "task", label: "Task" });
  for (const candidate of terms) {
    const range = findMatchRange(candidate.term, foldedQuery);
    if (range) return { ...range, ...candidate };
  }
  return null;
}

function resultPriority(kind: SearchResultKind): number {
  return kind === "name" ? 0 : kind === "kind" ? 1 : 2;
}

/** Create a short, highlightable snippet without cutting a surrogate pair. */
export function extractSnippet(
  text: string,
  matchStart: number,
  matchEnd: number,
  maxLength = SNIPPET_CONTENT_LENGTH,
): Pick<SearchResult, "snippet" | "matchStart" | "matchEnd"> {
  const hitLength = Math.max(0, matchEnd - matchStart);
  const contentLength = Math.max(maxLength, hitLength);
  let start = Math.max(0, matchStart - Math.floor((contentLength - hitLength) / 2));
  let end = Math.min(text.length, start + contentLength);

  if (end < matchEnd) {
    end = matchEnd;
    start = Math.max(0, end - contentLength);
  }
  start = alignStart(text, start);
  end = alignEnd(text, end);

  const leadingEllipsis = start > 0 ? "…" : "";
  const trailingEllipsis = end < text.length ? "…" : "";
  return {
    snippet: `${leadingEllipsis}${text.slice(start, end)}${trailingEllipsis}`,
    matchStart: leadingEllipsis.length + matchStart - start,
    matchEnd: leadingEllipsis.length + matchEnd - start,
  };
}

/** Move through the result list with wraparound; an empty list stays at index zero. */
export function cycleSearchIndex(index: number, delta: number, resultCount: number): number {
  if (resultCount <= 0) return 0;
  return ((index + delta) % resultCount + resultCount) % resultCount;
}

/** Keep the active result when possible, or select its successor if it was removed. */
export function reconcileSearchIndex(
  previousResults: readonly SearchResult[],
  previousIndex: number,
  nextResults: readonly SearchResult[],
): number {
  if (nextResults.length === 0) return 0;

  const current = previousResults[previousIndex];
  if (current) {
    const preservedIndex = nextResults.findIndex((result) => sameResult(current, result));
    if (preservedIndex !== -1) return preservedIndex;
  }

  return Math.min(Math.max(previousIndex, 0), nextResults.length - 1);
}

export function splitSearchMatch(result: SearchResult): { before: string; match: string; after: string } {
  return {
    before: result.snippet.slice(0, result.matchStart),
    match: result.snippet.slice(result.matchStart, result.matchEnd),
    after: result.snippet.slice(result.matchEnd),
  };
}

function findMatchRange(source: string, foldedQuery: string): { start: number; end: number } | null {
  const folded = foldWithOffsets(source);
  return findMatchRangeInFold(folded, foldedQuery);
}

function findMatchRangeInFold(folded: FoldedText, foldedQuery: string): { start: number; end: number } | null {
  const index = folded.text.indexOf(foldedQuery);
  if (index === -1) return null;

  const lastIndex = index + foldedQuery.length - 1;
  const start = folded.starts[index];
  const end = folded.ends[lastIndex];
  return start === undefined || end === undefined ? null : { start, end };
}

function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function foldWithOffsets(value: string): { text: string; starts: number[]; ends: number[] } {
  let offset = 0;
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];

  for (const character of value) {
    const start = offset;
    offset += character.length;
    const folded = foldText(character);
    text += folded;
    for (let index = 0; index < folded.length; index += 1) {
      starts.push(start);
      ends.push(offset);
    }
  }

  return { text, starts, ends };
}

function validCreationTime(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function alignStart(text: string, index: number): number {
  const current = text.charCodeAt(index);
  return current >= 0xdc00 && current <= 0xdfff ? index + 1 : index;
}

function alignEnd(text: string, index: number): number {
  const previous = text.charCodeAt(index - 1);
  const current = text.charCodeAt(index);
  const endsAfterHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  const startsWithLowSurrogate = current >= 0xdc00 && current <= 0xdfff;
  return endsAfterHighSurrogate && startsWithLowSurrogate ? index + 1 : index;
}

function sameResult(left: SearchResult, right: SearchResult): boolean {
  return left.noteId === right.noteId && left.kind === right.kind;
}
