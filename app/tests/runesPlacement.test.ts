import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Svelte runes only compile in .svelte and .svelte.ts files; a rune in a plain .ts module throws
 * `rune_outside_svelte` at runtime and leaves the app blank, while svelte-check and unit tests pass.
 */
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".svelte.ts") && !path.endsWith(".d.ts") ? [path] : [];
  });
}

describe("rune placement", () => {
  it("uses $state/$derived/$effect only in .svelte.ts modules", () => {
    const offenders = tsFiles(join(__dirname, "..", "src")).filter((file) =>
      /\$(state|derived|effect)\s*[(<.]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
