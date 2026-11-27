/**
 * Short ids for MCP agents: a UUID costs 36 characters in every reply, and an agent only needs enough
 * of it to tell objects apart. Replies carry the shortest prefix (at least 8 characters) that is unique
 * among the project's objects; params accept that prefix, any longer one, or the full id.
 */
import { McpError } from "./registry";

export const SHORT_ID_LENGTH = 8;
/** Shorter input prefixes are left alone, so they can never select an object by accident. */
export const MIN_PREFIX_LENGTH = 6;
/** Param keys whose string values (or string arrays) name objects. `data` holds kind fields, never ids. */
const ID_KEYS = new Set(["id", "ids", "nodeId", "zoneId", "linkedTo", "node", "from", "to"]);

export interface IdIndex {
  has(id: string): boolean;
  /** The reply form of `id`; ids the index does not know come back unchanged. */
  short(id: string): string;
  /** A full id for an exact id or a unique prefix; other values come back unchanged. */
  resolve(value: string): string;
}

interface Entry {
  id: string;
  key: string;
}

export function createIdIndex(ids: Iterable<string>): IdIndex {
  const sorted: Entry[] = [...new Set(ids)]
    .map((id) => ({ id, key: id.toLowerCase() }))
    .sort((first, second) => (first.key < second.key ? -1 : first.key > second.key ? 1 : 0));
  const known = new Set(sorted.map((entry) => entry.id));
  const shortById = new Map<string, string>();
  sorted.forEach((entry, index) => {
    const shared = Math.max(
      index > 0 ? commonPrefixLength(entry.key, sorted[index - 1]!.key) : 0,
      index + 1 < sorted.length ? commonPrefixLength(entry.key, sorted[index + 1]!.key) : 0,
    );
    shortById.set(entry.id, entry.id.slice(0, Math.max(SHORT_ID_LENGTH, shared + 1)));
  });

  return {
    has: (id) => known.has(id),
    short: (id) => shortById.get(id) ?? id,
    resolve(value) {
      if (known.has(value) || value.length < MIN_PREFIX_LENGTH) return value;
      const prefix = value.toLowerCase();
      const matches: string[] = [];
      for (let index = lowerBound(sorted, prefix); index < sorted.length && sorted[index]!.key.startsWith(prefix); index += 1) {
        matches.push(sorted[index]!.id);
      }
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) {
        throw new McpError(
          "invalid_params",
          `Id '${value}' is ambiguous: matches ${matches.slice(0, 5).join(", ")}; use more characters.`,
          { id: value, matches },
        );
      }
      return value;
    },
  };
}

/** A copy of `value` where every string that is exactly a known id is replaced by its short form. */
export function shortenIds<T>(value: T, index: IdIndex): T {
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return index.short(item);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    }
    return item;
  };
  return walk(value) as T;
}

/** A copy of `params` with short ids under id keys replaced by full ids (never refs of this call). */
export function expandParamIds(params: Record<string, unknown>, index: IdIndex): Record<string, unknown> {
  const refs = new Set<string>();
  collectRefs(params, refs);
  const resolve = (value: string): string => (refs.has(value) ? value : index.resolve(value));
  const walk = (item: unknown, key: string | undefined): unknown => {
    if (key === "data") return item;
    if (key !== undefined && ID_KEYS.has(key)) {
      if (typeof item === "string") return resolve(item);
      if (Array.isArray(item)) return item.map((element) => (typeof element === "string" ? resolve(element) : walk(element, undefined)));
    }
    if (Array.isArray(item)) return item.map((element) => walk(element, undefined));
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, walk(child, childKey)]));
    }
    return item;
  };
  return walk(params, undefined) as Record<string, unknown>;
}

function collectRefs(item: unknown, refs: Set<string>): void {
  if (Array.isArray(item)) {
    for (const element of item) collectRefs(element, refs);
  } else if (item && typeof item === "object") {
    for (const [key, child] of Object.entries(item)) {
      if (key === "ref" && typeof child === "string") refs.add(child);
      else if (key !== "data") collectRefs(child, refs);
    }
  }
}

function commonPrefixLength(first: string, second: string): number {
  const limit = Math.min(first.length, second.length);
  let length = 0;
  while (length < limit && first[length] === second[length]) length += 1;
  return length;
}

function lowerBound(sorted: readonly Entry[], key: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]!.key < key) low = middle + 1;
    else high = middle;
  }
  return low;
}
