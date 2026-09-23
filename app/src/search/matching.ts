export interface SearchNote {
  id: string;
  name: string;
  text: string;
  createdAt?: number;
}

export type SearchResultKind = "name" | "text";

export interface SearchResult {
  noteId: string;
  noteName: string;
  kind: SearchResultKind;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

const SNIPPET_CONTENT_LENGTH = 96;

/** Find case- and diacritic-insensitive matches in note names and Markdown text. */
export function searchNotes(
  query: string,
  notes: readonly SearchNote[],
  boardOrder: readonly string[] = notes.map((note) => note.id),
): SearchResult[] {
  const foldedQuery = foldText(query.trim());
  if (!foldedQuery) return [];

  const positionById = new Map(boardOrder.map((id, index) => [id, index]));
  const fallbackPosition = new Map(notes.map((note, index) => [note.id, index]));
  const matches: Array<{
    result: SearchResult;
    createdAt: number | undefined;
    position: number;
  }> = [];

  for (const note of notes) {
    const nameMatch = findMatchRange(note.name, foldedQuery);
    if (nameMatch) {
      matches.push({
        result: {
          noteId: note.id,
          noteName: note.name,
          kind: "name",
          snippet: note.name,
          matchStart: nameMatch.start,
          matchEnd: nameMatch.end,
        },
        createdAt: validCreationTime(note.createdAt),
        position: positionById.get(note.id) ?? fallbackPosition.get(note.id) ?? Number.MAX_SAFE_INTEGER,
      });
    }

    const textMatch = findMatchRange(note.text, foldedQuery);
    if (textMatch) {
      const snippet = extractSnippet(note.text, textMatch.start, textMatch.end);
      matches.push({
        result: {
          noteId: note.id,
          noteName: note.name,
          kind: "text",
          ...snippet,
        },
        createdAt: validCreationTime(note.createdAt),
        position: positionById.get(note.id) ?? fallbackPosition.get(note.id) ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  matches.sort((left, right) => {
    if (left.createdAt !== undefined && right.createdAt !== undefined) {
      const timeDifference = left.createdAt - right.createdAt;
      if (timeDifference !== 0) return timeDifference;
    } else if (left.createdAt !== right.createdAt) {
      return left.createdAt === undefined ? 1 : -1;
    }

    const positionDifference = left.position - right.position;
    if (positionDifference !== 0) return positionDifference;
    if (left.result.noteId === right.result.noteId && left.result.kind !== right.result.kind) {
      return left.result.kind === "name" ? -1 : 1;
    }
    return 0;
  });

  return matches.map(({ result }) => result);
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
