interface RevisionEntry<T> {
  revision: string;
  value: T;
}

/** Reuse a calculated value until its caller's exact dependency revision changes. */
export class RevisionCache<T> {
  private readonly entries = new Map<string, RevisionEntry<T>>();

  get(key: string, revision: string, calculate: () => T): T {
    const cached = this.entries.get(key);
    if (cached?.revision === revision) return cached.value;
    const value = calculate();
    this.entries.set(key, { revision, value });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
