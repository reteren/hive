import { describe, expect, it } from "vitest";
import { LOCALES } from "../src/i18n/locales";

type Catalog = Record<string, string | Record<string, string>>;
const catalogs = import.meta.glob<Catalog>("../src/i18n/catalogs/*.json", { eager: true, import: "default" });
const files = Object.keys(catalogs).map((path) => path.split("/").pop() ?? path);
const holders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("interface language catalogs", () => {
  it("exist only for supported languages", () => {
    const tags = LOCALES.map((locale) => locale.tag);
    for (const file of files) expect(tags).toContain(file.replace(/\.json$/, ""));
    expect(files.length).toBe(tags.length - 1);
  });

  for (const file of files) {
    it(`${file} keeps every placeholder of its English text`, () => {
      const catalog = catalogs[`../src/i18n/catalogs/${file}`];
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
