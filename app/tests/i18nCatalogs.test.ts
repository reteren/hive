import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../src/i18n/locales";

const dir = join(__dirname, "../src/i18n/catalogs");
const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
const holders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("interface language catalogs", () => {
  it("exist only for supported languages", () => {
    const tags = LOCALES.map((locale) => locale.tag);
    for (const file of files) expect(tags).toContain(file.replace(/\.json$/, ""));
  });

  for (const file of files) {
    it(`${file} keeps every placeholder of its English text`, () => {
      const catalog = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, string | Record<string, string>>;
      const broken: string[] = [];
      for (const [source, entry] of Object.entries(catalog)) {
        const expected = holders(source);
        for (const form of typeof entry === "string" ? [entry] : Object.values(entry)) {
          const got = holders(form);
          // A plural form may spell the number out ("one" in Arabic), dropping only {count}.
          const withoutCount = expected.filter((name) => name !== "count");
          if (got.join() !== expected.join() && !(typeof entry !== "string" && got.join() === withoutCount.join())) broken.push(`${source} → ${form}`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
