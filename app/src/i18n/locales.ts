/** Interface languages, the same set MarkNote ships. Names are shown in their own language. */
export type Locale = "en" | "ru" | "de" | "es" | "pt" | "it" | "fr" | "zh" | "ja" | "ar";

export const LOCALES: readonly { tag: Locale; name: string }[] = [
  { tag: "en", name: "English" },
  { tag: "ru", name: "Русский" },
  { tag: "de", name: "Deutsch" },
  { tag: "es", name: "Español" },
  { tag: "pt", name: "Português" },
  { tag: "it", name: "Italiano" },
  { tag: "fr", name: "Français" },
  { tag: "zh", name: "中文" },
  { tag: "ja", name: "日本語" },
  { tag: "ar", name: "العربية" },
];

export const DEFAULT_LOCALE: Locale = "en";

export function normalizeLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  if (typeof value !== "string") return fallback;
  const language = value.trim().toLowerCase().split(/[-_]/u)[0];
  return LOCALES.some((locale) => locale.tag === language) ? language as Locale : fallback;
}
