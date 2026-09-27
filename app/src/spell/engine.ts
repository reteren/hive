import { invoke } from "@tauri-apps/api/core";

export type SpellLanguage = { tag: string; name: string };
export type SpellRange = { from: number; to: number };
export type UserDictionary = Record<string, string[]>;

const suggestionCache = new Map<string, Promise<string[]>>();

export async function loadSpellcheckLanguages(): Promise<SpellLanguage[]> {
  try {
    const languages = await invoke<SpellLanguage[]>("spellcheck_languages");
    return Array.isArray(languages) ? languages.filter((item) => typeof item?.tag === "string" && typeof item?.name === "string") : [];
  } catch {
    return [];
  }
}

export async function checkSpelling(text: string, languages: readonly string[]): Promise<SpellRange[]> {
  if (!text || languages.length === 0) return [];
  try {
    const ranges = await invoke<SpellRange[]>("spellcheck_check", { text, languages: [...languages] });
    return Array.isArray(ranges)
      ? ranges.filter((range) => Number.isInteger(range?.from) && Number.isInteger(range?.to) && range.to > range.from)
      : [];
  } catch {
    return [];
  }
}

export async function suggestSpelling(word: string, languages: readonly string[]): Promise<string[]> {
  if (!word || languages.length === 0) return [];
  const key = JSON.stringify([word, [...languages].sort()]);
  const existing = suggestionCache.get(key);
  if (existing) return existing;
  const request = invoke<string[]>("spellcheck_suggest", { word, languages: [...languages], limit: 5 })
    .then((suggestions) => Array.isArray(suggestions)
      ? suggestions.filter((item): item is string => typeof item === "string").slice(0, 5)
      : [])
    .catch(() => []);
  suggestionCache.set(key, request);
  if (suggestionCache.size > 1024) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  return request;
}

export async function addSpellingWord(word: string, languages: readonly string[]): Promise<void> {
  if (!word || languages.length === 0) return;
  await invoke("spellcheck_add_word", { word, languages: [...languages] });
  clearSpellcheckSuggestionCache();
}

export async function getUserWords(): Promise<string[]> {
  const words = await invoke<string[]>("spellcheck_user_words");
  return Array.isArray(words) ? words.filter((word): word is string => typeof word === "string") : [];
}

export async function getUserDictionary(): Promise<UserDictionary> {
  const dictionary = await invoke<UserDictionary>("spellcheck_export_dictionary");
  return dictionary && typeof dictionary === "object" ? dictionary : {};
}

export async function importUserDictionary(contents: string): Promise<void> {
  await invoke("spellcheck_import_dictionary", { contents });
}

export async function removeUserWord(word: string): Promise<void> {
  await invoke("spellcheck_remove_word", { word });
}

export function clearSpellcheckSuggestionCache(): void {
  suggestionCache.clear();
}
