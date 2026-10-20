import { t } from "../i18n/i18n.svelte";

export interface SearchableCommand {
  id: string;
  label: string;
}

/** Rank a query against one command label or id; null means no fuzzy match. */
export function fuzzyMatchScore(query: string, candidate: string): number | null {
  const normalizedQuery = normalizeSearchText(query).replace(/\s+/g, "");
  if (!normalizedQuery) return 0;

  const normalizedCandidate = normalizeSearchText(candidate);
  const compactCandidate = normalizedCandidate.replace(/\s+/g, "");
  if (compactCandidate === normalizedQuery) return 1_000;
  if (compactCandidate.startsWith(normalizedQuery)) return 900 - (compactCandidate.length - normalizedQuery.length);

  const substringPosition = normalizedCandidate.indexOf(normalizeSearchText(query));
  if (substringPosition !== -1) return 800 - substringPosition * 2;

  let cursor = 0;
  let first = -1;
  let last = -1;
  let gaps = 0;
  let wordStarts = 0;

  for (const character of normalizedQuery) {
    const position = normalizedCandidate.indexOf(character, cursor);
    if (position === -1) return null;
    if (first === -1) first = position;
    else gaps += position - cursor;
    if (position === 0 || normalizedCandidate[position - 1] === " ") wordStarts += 1;
    last = position;
    cursor = position + 1;
  }

  const span = last - first + 1;
  return 500 - first * 3 - gaps * 8 - (span - normalizedQuery.length) * 2 + wordStarts * 6;
}

/** Search command labels and stable ids, preferring close label matches. */
export function searchCommands<T extends SearchableCommand>(commands: readonly T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return [...commands].sort((left, right) => t(left.label).localeCompare(t(right.label)));

  return commands
    .map((command, index) => {
      // The shown (translated) label and the English one both match, so English muscle memory keeps working.
      const shown = t(command.label);
      const labelScore = Math.max(fuzzyMatchScore(trimmed, shown) ?? Number.NEGATIVE_INFINITY, shown === command.label ? Number.NEGATIVE_INFINITY : (fuzzyMatchScore(trimmed, command.label) ?? Number.NEGATIVE_INFINITY) - 6);
      const idScore = fuzzyMatchScore(trimmed, command.id);
      const score = Math.max(labelScore, (idScore ?? Number.NEGATIVE_INFINITY) - 18);
      return { command, index, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command }) => command);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}
