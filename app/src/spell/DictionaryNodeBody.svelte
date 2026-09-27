<script lang="ts">
  import { onMount } from "svelte";
  import type { Note } from "../model/note";
  import { deleteUserWord, mergeUserDictionary, refreshUserDictionary, userDictionary } from "./dictionary.svelte";
  import { getUserDictionary } from "./engine";

  let { note }: { note: Note } = $props();
  let search = $state("");
  let fileInput: HTMLInputElement;
  let busy = $state(false);
  let message = $state("");

  let visibleWords = $derived(userDictionary.words.filter((word) => word.toLocaleLowerCase().includes(search.toLocaleLowerCase())));

  onMount(() => { void refreshUserDictionary(); });

  async function removeWord(word: string): Promise<void> {
    if (!window.confirm(`Remove “${word}” from the shared user dictionary?`)) return;
    busy = true;
    message = "";
    try { await deleteUserWord(word); }
    catch { message = "Could not remove that word."; }
    finally { busy = false; }
  }

  async function exportDictionary(format: "txt" | "json"): Promise<void> {
    busy = true;
    message = "";
    try {
      const dictionary = await getUserDictionary();
      const contents = format === "json"
        ? JSON.stringify(dictionary, null, 2)
        : [...new Set(Object.values(dictionary).flat())].sort((a, b) => a.localeCompare(b)).join("\n") + "\n";
      const blob = new Blob([contents], { type: format === "json" ? "application/json" : "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hive-user-dictionary.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      message = `Dictionary exported as ${format.toUpperCase()}.`;
    } catch { message = "Could not export the dictionary."; }
    finally { busy = false; }
  }

  function openImport(): void { fileInput?.click(); }

  async function importFile(event: Event): Promise<void> {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    const file = input.files[0];
    busy = true;
    message = "";
    try {
      await mergeUserDictionary(await file.text());
      message = `Merged words from ${file.name}.`;
    } catch { message = "Could not import that dictionary file."; }
    finally { busy = false; input.value = ""; }
  }
</script>

<div class="dictionary-node" data-dictionary-node data-note-id={note.id}>
  <div class="dictionary-toolbar">
    <input bind:value={search} type="search" aria-label="Search dictionary" placeholder="Search words…" />
    <button type="button" onclick={openImport} disabled={busy}>Import…</button>
  </div>
  <input bind:this={fileInput} class="dictionary-file-input" type="file" accept=".txt,.json,text/plain,application/json" onchange={importFile} />
  <div class="dictionary-export">
    <button type="button" onclick={() => void exportDictionary("txt")} disabled={busy}>Export .txt</button>
    <button type="button" onclick={() => void exportDictionary("json")} disabled={busy}>Export .json</button>
    <span>{userDictionary.loading ? "Loading…" : `${userDictionary.words.length} words`}</span>
  </div>
  {#if userDictionary.error || message}<div class="dictionary-status" role="status">{userDictionary.error || message}</div>{/if}
  <ul class="dictionary-words">
    {#each visibleWords as word (word)}
      <li>
        <span>{word}</span>
        <button type="button" aria-label={`Remove ${word}`} title="Remove word" disabled={busy} onclick={() => void removeWord(word)}>×</button>
      </li>
    {:else}
      <li class="dictionary-empty">{search ? "No matching words." : "No words added yet."}</li>
    {/each}
  </ul>
</div>

<style>
  .dictionary-node { display: flex; min-height: 0; height: 100%; flex-direction: column; gap: 5px; color: var(--text); font-size: 10px; user-select: text; }
  .dictionary-toolbar, .dictionary-export { display: flex; align-items: center; gap: 4px; }
  .dictionary-toolbar input { min-width: 0; height: 24px; flex: 1; padding: 3px 5px; border: 1px solid #484848; border-radius: 3px; background: #181818; color: var(--text); font: inherit; }
  .dictionary-file-input { display: none; }
  .dictionary-node button { min-height: 23px; padding: 2px 6px; border: 1px solid #484848; border-radius: 3px; background: #252525; color: var(--text); font: inherit; cursor: pointer; }
  .dictionary-node button:disabled { opacity: .55; cursor: default; }
  .dictionary-export span { margin-left: auto; color: var(--text-dim); white-space: nowrap; }
  .dictionary-status { color: #efaaa5; overflow-wrap: anywhere; }
  .dictionary-words { min-height: 0; flex: 1; margin: 0; padding: 0; overflow: auto; list-style: none; }
  .dictionary-words li { display: flex; min-height: 23px; align-items: center; justify-content: space-between; gap: 5px; padding: 2px 3px; border-bottom: 1px solid #393939; }
  .dictionary-words li span { min-width: 0; overflow-wrap: anywhere; }
  .dictionary-words li button { width: 20px; height: 20px; flex: 0 0 auto; padding: 0; color: var(--text-dim); font-size: 14px; line-height: 1; }
  .dictionary-words .dictionary-empty { color: var(--text-dim); }
</style>
