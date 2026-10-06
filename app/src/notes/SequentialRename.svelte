<script lang="ts">
  import { tick } from "svelte";
  import {
    commitCurrentRename,
    sequentialRenameState,
    skipCurrentRename,
    takeSequentialRenameReturnFocus,
  } from "./sequentialRenameState.svelte";

  let renameInput = $state<HTMLInputElement>();
  let session = $derived(sequentialRenameState.session);
  let current = $derived(session?.items[session.index]);
  let wasOpen = false;

  $effect(() => {
    if (!session) {
      if (wasOpen) {
        wasOpen = false;
        const returnFocus = takeSequentialRenameReturnFocus();
        void tick().then(() => {
          if (returnFocus?.isConnected) returnFocus.focus();
        });
      }
      return;
    }
    wasOpen = true;
    const itemId = current?.id;
    if (!itemId) return;
    void tick().then(() => {
      if (current?.id !== itemId) return;
      renameInput?.focus();
      renameInput?.select();
    });
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.code === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitCurrentRename();
    } else if (event.code === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      skipCurrentRename();
    }
  }
</script>

{#if session && current}
  <div class="rename-overlay">
    <dialog open class="rename-panel" aria-modal="true" aria-labelledby="sequential-rename-title">
      <header class="rename-heading">
        <div>
          <h2 id="sequential-rename-title">Rename selection</h2>
          <span>{session.index + 1} of {session.items.length} · {current.name}</span>
        </div>
        <span class="rename-hint">Enter next · Esc skip</span>
      </header>
      <label for="sequential-rename-input">New name</label>
      <input
        id="sequential-rename-input"
        bind:this={renameInput}
        bind:value={session.draft}
        aria-label={`New name for ${current.name}`}
        oninput={() => { sequentialRenameState.error = ""; }}
        onkeydown={handleKeydown}
      />
      {#if sequentialRenameState.error}
        <p class="rename-error" role="alert">{sequentialRenameState.error}</p>
      {/if}
      <footer>
        <button type="button" class="skip-button" onclick={skipCurrentRename}>Skip</button>
        <button type="button" class="commit-button" onclick={commitCurrentRename}>Save and next</button>
      </footer>
    </dialog>
  </div>
{/if}

<style>
  .rename-overlay {
    position: fixed;
    z-index: 1001;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 40%);
  }

  .rename-panel {
    display: grid;
    width: min(390px, 100%);
    gap: 9px;
    padding: 12px;
    border: 1px solid #5b5136;
    border-radius: 4px;
    background: var(--bg-panel);
    box-shadow: 0 12px 32px rgb(0 0 0 / 55%);
    color: var(--text);
  }

  .rename-error {
    margin: 0;
    color: #f0a69c;
    font-size: 12px;
  }

  .rename-heading,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  h2 {
    margin: 0 0 3px;
    font-size: 12px;
  }

  .rename-heading span,
  label {
    color: var(--text-dim);
    font-size: 10px;
  }

  .rename-hint {
    flex: 0 0 auto;
    font-family: var(--mono-font);
  }

  input {
    width: 100%;
    min-width: 0;
    height: 30px;
    padding: 4px 7px;
    border: 1px solid #62562f;
    border-radius: 3px;
    outline: none;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button {
    min-height: 27px;
    padding: 3px 8px;
    border: 1px solid #454545;
    border-radius: 3px;
    background: var(--bg-panel-raised);
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  button:hover {
    border-color: #777;
    background: var(--bg-hover);
  }

  .commit-button {
    border-color: rgba(var(--accent-rgb), 0.45);
    background: rgba(var(--accent-rgb), 0.16);
    color: var(--accent);
  }
</style>
