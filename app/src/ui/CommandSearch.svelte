<script lang="ts">
  import { tick } from "svelte";
  import { searchCommands } from "../commands/commandSearch";
  import { closeCommandSearch, commandSearchState } from "../commands/commandSearch.svelte";
  import { formatKey } from "../commands/keys";
  import { getCommands, runCommand, type Command } from "../commands/registry.svelte";

  let searchInput = $state<HTMLInputElement>();
  let query = $state("");
  let selectedIndex = $state(0);
  let registeredCommands = $derived(getCommands());
  let results = $derived(searchCommands(registeredCommands, query));
  let selectedCommand = $derived(results[selectedIndex]);

  $effect(() => {
    if (!commandSearchState.open) return;
    query = "";
    selectedIndex = 0;
    void tick().then(() => searchInput?.focus());
  });

  function close(restoreFocus = true): void {
    const returnFocus = closeCommandSearch();
    void tick().then(() => {
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    });
  }

  function run(command: Command): void {
    runCommand(command.id);
    const transfersFocus = command.id === "ui.keymap" ||
      (command.id === "notes.renameSequence" && command.isActive?.() === true);
    close(!transfersFocus);
  }

  function openKeymap(): void {
    runCommand("ui.keymap");
    close(false);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.code === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % results.length;
    } else if (event.code === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
    } else if (event.code === "Enter" && selectedCommand) {
      event.preventDefault();
      run(selectedCommand);
    }
  }

  function updateQuery(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    query = input.value;
    selectedIndex = 0;
  }

  function preventMouseFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

{#if commandSearchState.open}
  <div class="search-overlay">
    <button class="search-backdrop" type="button" aria-label="Close command search" onclick={() => close()}></button>
    <dialog open class="search-dialog" aria-modal="true" aria-label="Command search">
      <header class="search-heading">
        <label for="command-search-input">Command search</label>
        <div class="search-help"><kbd>↑</kbd><kbd>↓</kbd><span>navigate</span><kbd>Enter</kbd><span>run</span><kbd>Esc</kbd><span>close</span></div>
      </header>
      <input
        id="command-search-input"
        bind:this={searchInput}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="command-search-results"
        aria-activedescendant={selectedCommand ? `command-result-${selectedCommand.id}` : undefined}
        placeholder="Search commands by name or id…"
        oninput={updateQuery}
        onkeydown={handleKeydown}
      />
      <div id="command-search-results" class="search-results" role="listbox" aria-label="Commands">
        {#each results as command, index (command.id)}
          <button
            id={`command-result-${command.id}`}
            class="command-result"
            class:selected={index === selectedIndex}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            onmousedown={preventMouseFocus}
            onclick={() => run(command)}
          >
            <span class="result-copy">
              <span class="result-label">{command.label}</span>
              <span class="result-id">{command.id}</span>
            </span>
            <span class="result-binding">
              {#if command.keys.length > 0}
                {#each command.keys as key, bindingIndex (key)}
                  {#if bindingIndex > 0}<span>/</span>{/if}<kbd>{formatKey(key)}</kbd>
                {/each}
              {:else}
                <span>Unbound</span>
              {/if}
            </span>
          </button>
        {:else}
          <p class="empty-results">No matching commands.</p>
        {/each}
      </div>
      <footer class="search-footer">
        <span>{results.length} commands</span>
        <button type="button" onmousedown={preventMouseFocus} onclick={openKeymap}>Edit key bindings</button>
      </footer>
    </dialog>
  </div>
{/if}

<style>
  .search-overlay {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    align-content: start;
    justify-items: center;
    padding: min(15vh, 110px) 14px 14px;
  }

  .search-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: rgb(0 0 0 / 48%);
    cursor: default;
  }

  .search-dialog {
    position: relative;
    display: flex;
    width: min(620px, 100%);
    max-height: min(560px, 78vh);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #4d4d4d;
    border-radius: 5px;
    background: var(--bg-panel);
    box-shadow: 0 14px 40px rgb(0 0 0 / 60%);
    color: var(--text);
  }

  .search-heading,
  .search-footer {
    display: flex;
    min-height: 35px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 9px;
    border-bottom: 1px solid #3b3b3b;
  }

  label {
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
    background: #202020;
    color: #e2e2e2;
    font: inherit;
    font-family: var(--mono-font);
    white-space: nowrap;
  }

  input {
    height: 38px;
    margin: 8px 9px;
    padding: 5px 9px;
    border: 1px solid #57503d;
    border-radius: 3px;
    outline: none;
    background: #181818;
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }

  input:focus-visible {
    border-color: var(--accent);
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .search-results {
    min-height: 0;
    overflow: auto;
    padding: 2px 5px 5px;
  }

  .command-result {
    display: flex;
    width: 100%;
    min-height: 41px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .command-result:hover,
  .command-result.selected {
    border-color: #534a30;
    background: #343019;
  }

  .result-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }

  .result-label {
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-id {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
  }

  .result-binding {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 9px;
  }

  .empty-results {
    margin: 0;
    padding: 20px 10px;
    color: var(--text-dim);
    font-size: 11px;
    text-align: center;
  }

  .search-footer {
    min-height: 32px;
    border-top: 1px solid #3b3b3b;
    border-bottom: 0;
    color: var(--text-dim);
    font-size: 9px;
  }

  .search-footer button {
    padding: 3px 6px;
    border: 1px solid #424242;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }
</style>
