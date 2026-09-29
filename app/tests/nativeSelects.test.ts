import { describe, expect, it } from "vitest";

const svelteSources = import.meta.glob<string>("/src/**/*.svelte", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("native select usage", () => {
  it("does not use native select elements in Svelte components", () => {
    const offenders = Object.entries(svelteSources)
      .filter(([, source]) => source.includes("<select"))
      .map(([path]) => path)
      .sort();

    expect(offenders).toEqual([]);
  });
});
