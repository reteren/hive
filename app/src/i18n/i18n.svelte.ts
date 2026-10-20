import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./locales";
import { translatePluralWith, translateWith, type Catalog, type TranslationParams } from "./translate";

export type { Locale } from "./locales";
export type { TranslationParams } from "./translate";

const STORAGE_KEY = "hive.language.v1";
const catalogs = import.meta.glob<{ default: Catalog }>("./catalogs/*.json");

class I18nState {
  locale = $state<Locale>(DEFAULT_LOCALE);
  catalog = $state.raw<Catalog>({});
}

/** Reading it in a template or `$derived` makes that place follow a language switch. */
export const i18n = new I18nState();

/** Translate an English source text into the interface language. Missing entries stay English. */
export function t(source: string, params?: TranslationParams): string {
  return translateWith(i18n.locale, i18n.catalog, source, params);
}

/** Plural text: `tp(n, "{count} entry", "{count} entries")`. `{count}` is filled in. */
export function tp(count: number, one: string, other: string, params?: TranslationParams): string {
  return translatePluralWith(i18n.locale, i18n.catalog, count, one, other, params);
}

/** Locale for dates: English keeps hive's day-month-year order, other languages use their own. */
export function dateLocale(): string {
  return i18n.locale === "en" ? "en-GB" : i18n.locale;
}

/** Marks a constant as translatable without translating it yet; the place that shows it calls t(). */
export function msg(source: string): string {
  return source;
}

let request = 0;

/** Load the language's catalog, then switch every window that shares this storage. */
export async function setLanguage(value: unknown): Promise<Locale> {
  const locale = normalizeLocale(value);
  const current = ++request;
  let catalog: Catalog = {};
  if (locale !== "en") {
    const load = catalogs[`./catalogs/${locale}.json`];
    try {
      if (load) catalog = (await load()).default;
    } catch (error) {
      console.error(`Could not load the ${locale} interface language.`, error);
    }
  }
  if (current !== request) return i18n.locale;
  i18n.catalog = catalog;
  i18n.locale = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The view settings stay authoritative when browser storage is unavailable.
  }
  return locale;
}

/** The language cached by the last run, applied before the first mount so nothing flashes English. */
export function bootLanguage(): Promise<Locale> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  if (typeof window !== "undefined") {
    // Quick input and the reminder window follow a switch made in the main window.
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue && event.newValue !== i18n.locale) void setLanguage(event.newValue);
    });
  }
  return setLanguage(saved ?? DEFAULT_LOCALE);
}
