import { getUserWords, importUserDictionary, removeUserWord } from "./engine";
import { clearSpellcheckCache, refreshAllSpellcheckEditors } from "./spellcheck";

export const userDictionary = $state({
  words: [] as string[],
  loading: false,
  error: "",
});

export async function refreshUserDictionary(): Promise<void> {
  userDictionary.loading = true;
  userDictionary.error = "";
  try {
    userDictionary.words = await getUserWords();
  } catch (error) {
    userDictionary.error = error instanceof Error ? error.message : "Could not load the dictionary.";
  } finally {
    userDictionary.loading = false;
  }
}

export async function mergeUserDictionary(contents: string): Promise<void> {
  await importUserDictionary(contents);
  await refreshUserDictionary();
  clearSpellcheckCache();
  refreshAllSpellcheckEditors();
}

export async function deleteUserWord(word: string): Promise<void> {
  await removeUserWord(word);
  await refreshUserDictionary();
  clearSpellcheckCache();
  refreshAllSpellcheckEditors();
}
