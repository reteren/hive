import { loadSpellcheckLanguages, type SpellLanguage } from "./engine";
import { refreshAllSpellcheckEditors } from "./spellcheck";

const STORAGE_KEY = "hive.spellcheck.settings.v1";
const DEFAULT_LANGUAGES = ["en", "ru"];

export const spellSettings = $state({
  enabled: true,
  inlineSuggestions: false,
  languages: [...DEFAULT_LANGUAGES],
  availableLanguages: [
    { tag: "en", name: "English" },
    { tag: "ru", name: "Русский" },
  ] as SpellLanguage[],
});

let initialized = false;

export async function initializeSpellSettings(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const value = JSON.parse(saved) as { enabled?: unknown; inlineSuggestions?: unknown; languages?: unknown };
      if (typeof value.enabled === "boolean") spellSettings.enabled = value.enabled;
      if (typeof value.inlineSuggestions === "boolean") spellSettings.inlineSuggestions = value.inlineSuggestions;
      if (Array.isArray(value.languages)) {
        spellSettings.languages = value.languages.filter((tag): tag is string => typeof tag === "string");
      }
    }
  } catch {
    // Keep defaults if browser storage is unavailable or malformed.
  }

  const found = await loadSpellcheckLanguages();
  if (found.length > 0) {
    spellSettings.availableLanguages = found;
    const valid = new Set(found.map((language) => language.tag));
    const selected = spellSettings.languages.filter((tag) => valid.has(tag));
    spellSettings.languages = selected.length > 0 ? selected : found.map((language) => language.tag);
  }
  persist();
  refreshAllSpellcheckEditors();
}

export function setSpellcheckEnabled(enabled: boolean): void {
  spellSettings.enabled = enabled;
  persist();
  refreshAllSpellcheckEditors();
}

export function setInlineSpellSuggestions(enabled: boolean): void {
  spellSettings.inlineSuggestions = enabled;
  persist();
  refreshAllSpellcheckEditors();
}

export function setSpellcheckLanguage(tag: string, selected: boolean): void {
  const next = new Set(spellSettings.languages);
  if (selected) next.add(tag);
  else next.delete(tag);
  spellSettings.languages = [...next].filter((item) => spellSettings.availableLanguages.some((language) => language.tag === item));
  persist();
  refreshAllSpellcheckEditors();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      enabled: spellSettings.enabled,
      inlineSuggestions: spellSettings.inlineSuggestions,
      languages: spellSettings.languages,
    }));
  } catch {
    // Settings still apply for this session if storage is unavailable.
  }
}
