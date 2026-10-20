/**
 * Pure translation helpers. A catalog maps the English source text to its translation, so the
 * English string in the code is the key and also the fallback when a translation is missing.
 */

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type CatalogEntry = string | Partial<Record<PluralCategory, string>>;
export type Catalog = Readonly<Record<string, CatalogEntry>>;
export type TranslationParams = Readonly<Record<string, string | number | null | undefined>>;

export function translateWith(locale: string, catalog: Catalog, source: string, params?: TranslationParams): string {
  const entry = catalog[source];
  const count = typeof params?.count === "number" ? params.count : 0;
  const text = entry === undefined ? source : typeof entry === "string" ? entry : pickPlural(locale, entry, count, source);
  return params ? interpolate(text, params) : text;
}

/**
 * Plural text. The English plural form is the catalog key; a translation may give one form per
 * plural category of its language (`{ one, few, many, other }`).
 */
export function translatePluralWith(
  locale: string,
  catalog: Catalog,
  count: number,
  one: string,
  other: string,
  params?: TranslationParams,
): string {
  // A caller may pass a formatted `count` ("1,494") for display; the plural form uses the number.
  const values = { count, ...params };
  const entry = catalog[other];
  if (entry === undefined) return interpolate(englishPlural(count) === "one" ? one : other, values);
  if (typeof entry === "string") return interpolate(entry, values);
  return interpolate(pickPlural(locale, entry, count, other), values);
}

function englishPlural(count: number): PluralCategory {
  return new Intl.PluralRules("en").select(count) as PluralCategory;
}

function pickPlural(locale: string, entry: Partial<Record<PluralCategory, string>>, count: number, source: string): string {
  const category = new Intl.PluralRules(locale).select(count) as PluralCategory;
  return entry[category] ?? entry.other ?? Object.values(entry)[0] ?? source;
}

function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{(\w+)\}/gu, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? placeholder : String(value);
  });
}
