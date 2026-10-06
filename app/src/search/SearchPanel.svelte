<!-- Search overlay for T (R2.4). -->
<script module lang="ts">
  import "./commands.svelte";
</script>

<script lang="ts">
  import CommandButton from "../ui/CommandButton.svelte";
  import { board } from "../model/board.svelte";
  import { teleportToObject } from "../navigation/navigate";
  import {
    searchNotes,
    splitSearchMatch,
    type SearchNote,
    type SearchResult,
  } from "./matching";
  import {
    closeSearch,
    currentSearchResult,
    cycleSearchResults,
    searchState,
    selectSearchResult,
    setSearchQuery,
    setSearchResults,
  } from "./search.svelte";

  const SEARCH_DEBOUNCE_MS = 100;

  let searchInput = $state<HTMLInputElement>();
  let noteSnapshot = $derived.by((): SearchNote[] =>
    board.order.flatMap((id) => {
      const note = board.notes[id];
      return note
        ? [{ id: note.id, name: note.name, text: note.text, createdAt: note.createdAt, type: note.type, task: Boolean(note.task) }]
        : [];
    }),
  );
  let nameResults = $derived(searchState.results.filter((result) => result.kind === "name"));
  let kindResults = $derived(searchState.results.filter((result) => result.kind === "kind"));
  let textResults = $derived(searchState.results.filter((result) => result.kind === "text"));

  $effect(() => {
    if (!searchState.open) return;
    const frame = requestAnimationFrame(() => {
      searchInput?.focus();
      const end = searchInput?.value.length ?? 0;
      searchInput?.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    const query = searchState.query;
    const notes = noteSnapshot;
    const timeout = window.setTimeout(() => setSearchResults(searchNotes(query, notes)), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  });

  function updateQuery(event: Event): void {
    if (event.currentTarget instanceof HTMLInputElement) setSearchQuery(event.currentTarget.value);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    } else if (event.code === "ArrowDown" && searchState.results.length > 0) {
      event.preventDefault();
      cycleSearchResults(1);
    } else if (event.code === "ArrowUp" && searchState.results.length > 0) {
      event.preventDefault();
      cycleSearchResults(-1);
    } else if (event.code === "Enter" && event.target === searchInput && currentSearchResult()) {
      event.preventDefault();
      jumpToCurrent();
    }
  }

  function jumpToCurrent(): void {
    jumpToIndex(searchState.currentIndex);
  }

  function jumpToIndex(index: number): void {
    if (!selectSearchResult(index)) return;
    const result = currentSearchResult();
    if (result) teleportToObject(result.noteId, { label: "Search" });
  }

  function jumpToResult(result: SearchResult): void {
    const index = searchState.results.findIndex(
      (item) => item.noteId === result.noteId && item.kind === result.kind,
    );
    jumpToIndex(index);
  }

  function preventMouseFocus(event: MouseEvent): void {
    if (event.button === 0) event.preventDefault();
  }

  function resultId(result: SearchResult): string {
    return `search-result-${result.kind}-${result.noteId}`;
  }

  function resultObjectLabel(result: SearchResult): string {
    const type = result.objectKind;
    const kindLabel = type === "pro" ? "Plus"
      : type === "con" ? "Minus"
        : type ? type[0]!.toUpperCase() + type.slice(1)
          : "Object";
    return result.isTask && type === "note" ? "Task · Note" : kindLabel;
  }
</script>

<div class="search-trigger" data-selection-ignore>
  <CommandButton commandId="search.open" showLabel className="search-trigger-button" />
</div>

{#if searchState.open}
  <div class="search-overlay" data-selection-ignore onkeydown={handleKeydown} role="dialog" aria-modal="true" aria-label="Search notes" tabindex="-1">
    <button class="search-backdrop" type="button" aria-label="Close search" onclick={closeSearch}></button>
    <section class="search-dialog">
      <header class="search-heading">
        <label for="note-search-input">Search notes</label>
        <div class="search-help" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd><span>cycle</span><kbd>Enter</kbd><span>jump</span><kbd>Esc</kbd><span>close</span></div>
        <button class="close-button" type="button" aria-label="Close search" title="Close search" onclick={closeSearch}>×</button>
      </header>

      <input
        id="note-search-input"
        bind:this={searchInput}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="note-search-results"
        aria-activedescendant={currentSearchResult() ? resultId(currentSearchResult()!) : undefined}
        placeholder="Find a note by name or text…"
        autocomplete="off"
        value={searchState.query}
        oninput={updateQuery}
      />

      <div id="note-search-results" class="search-results" role="listbox" aria-label="Search results">
        {#if nameResults.length > 0}
          <section class="result-group" role="group" aria-label="Names">
            <h2>Names <span>{nameResults.length}</span></h2>
            {#each nameResults as result (resultId(result))}
              {@const index = searchState.results.findIndex((item) => item.noteId === result.noteId && item.kind === result.kind)}
              {@const parts = splitSearchMatch(result)}
              <button
                id={resultId(result)}
                class="search-result"
                class:current={index === searchState.currentIndex}
                type="button"
                role="option"
                aria-selected={index === searchState.currentIndex}
                onmousedown={preventMouseFocus}
                onclick={() => jumpToResult(result)}
              >
                <span class="result-mainline">
                  <span class="result-name">{parts.before}<mark>{parts.match}</mark>{parts.after}</span>
                  <span class="result-type">{resultObjectLabel(result)} · Name</span>
                </span>
              </button>
            {/each}
          </section>
        {/if}

        {#if kindResults.length > 0}
          <section class="result-group" role="group" aria-label="Kinds">
            <h2>Kinds <span>{kindResults.length}</span></h2>
            {#each kindResults as result (resultId(result))}
              {@const index = searchState.results.findIndex((item) => item.noteId === result.noteId && item.kind === result.kind)}
              {@const parts = splitSearchMatch(result)}
              <button
                id={resultId(result)}
                class="search-result"
                class:current={index === searchState.currentIndex}
                type="button"
                role="option"
                aria-selected={index === searchState.currentIndex}
                onmousedown={preventMouseFocus}
                onclick={() => jumpToResult(result)}
              >
                <span class="result-mainline">
                  <span class="result-name">{result.noteName}</span>
                  <span class="result-type">{resultObjectLabel(result)} · Type</span>
                </span>
                <span class="result-snippet"><mark>{parts.match}</mark></span>
              </button>
            {/each}
          </section>
        {/if}

        {#if textResults.length > 0}
          <section class="result-group" role="group" aria-label="Text">
            <h2>Text <span>{textResults.length}</span></h2>
            {#each textResults as result (resultId(result))}
              {@const index = searchState.results.findIndex((item) => item.noteId === result.noteId && item.kind === result.kind)}
              {@const parts = splitSearchMatch(result)}
              <button
                id={resultId(result)}
                class="search-result text-result"
                class:current={index === searchState.currentIndex}
                type="button"
                role="option"
                aria-selected={index === searchState.currentIndex}
                onmousedown={preventMouseFocus}
                onclick={() => jumpToResult(result)}
              >
                <span class="result-mainline">
                  <span class="result-name">{result.noteName}</span>
                  <span class="result-type">{resultObjectLabel(result)} · Text</span>
                </span>
                <span class="result-snippet">{parts.before}<mark>{parts.match}</mark>{parts.after}</span>
              </button>
            {/each}
          </section>
        {/if}
        {#if nameResults.length === 0 && kindResults.length === 0 && textResults.length === 0}
          <p class="empty-results">{searchState.query.trim() ? "No matching notes." : "Type to search notes."}</p>
        {/if}
      </div>

      <footer class="search-footer">
        <span class="result-position" aria-live="polite">
          {searchState.results.length ? searchState.currentIndex + 1 : 0} / {searchState.results.length}
        </span>
        <div class="result-controls">
          <button type="button" aria-label="Previous result" title="Previous result · ↑" disabled={searchState.results.length === 0} onmousedown={preventMouseFocus} onclick={() => cycleSearchResults(-1)}>Previous</button>
          <button type="button" aria-label="Next result" title="Next result · ↓" disabled={searchState.results.length === 0} onmousedown={preventMouseFocus} onclick={() => cycleSearchResults(1)}>Next</button>
          <button type="button" class="jump-button" disabled={searchState.results.length === 0} onmousedown={preventMouseFocus} onclick={jumpToCurrent}>Jump</button>
        </div>
      </footer>
    </section>
  </div>
{/if}

<style>
  .search-trigger {
    position: absolute;
    z-index: 6;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
  }

  :global(.search-trigger-button) {
    min-width: 86px;
    border-color: #3e3e3e;
    border-radius: 3px;
    background: var(--bg-panel);
  }

  .search-overlay {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    align-content: start;
    justify-items: center;
    padding: min(70px, 9vh) 12px 12px;
  }

  .search-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: rgb(0 0 0 / 42%);
    cursor: default;
  }

  .search-dialog {
    position: relative;
    display: flex;
    width: min(560px, 100%);
    max-height: min(600px, 82vh);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #4b4b4b;
    border-radius: 5px;
    background: var(--bg-panel);
    box-shadow: 0 12px 36px rgb(0 0 0 / 58%);
    color: var(--text);
  }

  .search-heading,
  .search-footer {
    display: flex;
    min-height: 34px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    border-bottom: 1px solid #3b3b3b;
  }

  .search-heading label {
    flex: 0 0 auto;
    color: var(--text);
    font-size: 11px;
    font-weight: 600;
  }

  .search-help {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 9px;
  }

  kbd {
    padding: 1px 4px;
    border: 1px solid #484848;
    border-radius: 2px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-family: var(--mono-font);
    white-space: nowrap;
  }

  .close-button {
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;
  }

  .close-button:hover {
    border-color: #555;
    background: var(--bg-hover);
    color: var(--text);
  }

  input {
    height: 36px;
    margin: 8px;
    padding: 5px 8px;
    border: 1px solid #57503d;
    border-radius: 3px;
    outline: none;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  input:focus-visible {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .search-results {
    min-height: 0;
    overflow: auto;
    padding: 0 5px 5px;
  }

  .result-group + .result-group {
    margin-top: 5px;
    padding-top: 3px;
    border-top: 1px solid #3b3b3b;
  }

  .result-group h2 {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 3px 4px;
    color: var(--text-dim);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .result-group h2 span {
    font-family: var(--mono-font);
    font-weight: 400;
  }

  .search-result {
    display: flex;
    width: 100%;
    min-height: 31px;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 3px;
    padding: 5px 7px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .search-result:hover,
  .search-result.current {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
  }

  .result-name,
  .result-snippet {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-mainline {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .result-mainline .result-name { min-width: 0; }

  .result-snippet,
  .result-type {
    color: var(--text-dim);
    font-size: 10px;
  }

  mark {
    border-radius: 1px;
    background: rgba(var(--accent-rgb), 0.28);
    color: var(--accent);
  }

  .empty-results {
    margin: 0;
    padding: 18px 8px;
    color: var(--text-dim);
    font-size: 11px;
    text-align: center;
  }

  .search-footer {
    min-height: 34px;
    border-top: 1px solid #3b3b3b;
    border-bottom: 0;
    color: var(--text-dim);
    font-size: 10px;
  }

  .result-position {
    min-width: 38px;
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
  }

  .result-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .result-controls button {
    min-height: 23px;
    padding: 3px 7px;
    border: 1px solid #424242;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .result-controls button:hover:not(:disabled) {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: var(--bg-hover);
  }

  .result-controls button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .result-controls .jump-button {
    border-color: rgba(var(--accent-rgb), 0.45);
    color: var(--accent);
  }

  @media (max-width: 460px) {
    .search-help span {
      display: none;
    }
  }
</style>
