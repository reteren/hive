export interface NamedItem {
  id: string;
  name: string;
}

/** Name lookup postings updated only when a note's name or membership changes. */
export class NameIndex<T extends NamedItem> {
  private items = new Map<string, { item: T; name: string; grams: Set<string> }>();
  private postings = new Map<string, Set<string>>();

  constructor(items: readonly T[] = []) {
    this.replace(items);
  }

  replace(items: readonly T[]): boolean {
    this.items.clear();
    this.postings.clear();
    for (const item of items) this.upsert(item);
    return true;
  }

  upsert(item: T): boolean {
    const name = item.name.toLocaleLowerCase();
    const previous = this.items.get(item.id);
    if (previous?.name === name) {
      previous.item = item;
      return false;
    }
    if (previous) this.removePostings(item.id, previous.grams);
    const grams = gramsOf(name);
    this.items.set(item.id, { item, name, grams });
    for (const gram of grams) {
      let ids = this.postings.get(gram);
      if (!ids) this.postings.set(gram, ids = new Set());
      ids.add(item.id);
    }
    return true;
  }

  remove(id: string): boolean {
    const previous = this.items.get(id);
    if (!previous) return false;
    this.removePostings(id, previous.grams);
    this.items.delete(id);
    return true;
  }

  matchingIds(query: string): string[] {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [...this.items.keys()];
    const grams = [...gramsOfWidth(normalized, Math.min(3, normalized.length))];
    const lists = grams.map((gram) => this.postings.get(gram));
    if (lists.some((ids) => !ids)) return [];
    const ordered = lists as Set<string>[];
    ordered.sort((left, right) => left.size - right.size);
    const [smallest, ...rest] = ordered;
    return [...smallest].filter((id) => {
      const entry = this.items.get(id);
      return entry !== undefined && rest.every((ids) => ids.has(id)) && entry.name.includes(normalized);
    });
  }

  get(id: string): T | undefined {
    return this.items.get(id)?.item;
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
