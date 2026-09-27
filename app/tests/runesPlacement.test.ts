import { describe, expect, it } from "vitest";

/**
 * Svelte runes only compile in .svelte and .svelte.ts files; a rune in a plain .ts module throws
 * `rune_outside_svelte` at runtime and leaves the app blank, while svelte-check and unit tests pass.
 */
const sources = import.meta.glob<string>("/src/**/*.ts", { query: "?raw", import: "default", eager: true });

describe("rune placement", () => {
  it("uses $state/$derived/$effect only in .svelte.ts modules", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith(".svelte.ts") && !path.endsWith(".d.ts"))
      .filter(([, text]) => /\$(state|derived|effect)\s*[(<.]/.test(text))
      .map(([path]) => path);
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
