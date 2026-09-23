<script lang="ts">
  import { keepLocalVersion, useExternalVersion } from "../project/persistence.svelte";
  import { project } from "../project/project.svelte";
</script>

{#if project.conflicts.length > 0}
  <div class="conflict-list" role="status" aria-live="polite" aria-label="External note changes">
    {#each project.conflicts as conflict (conflict.noteId)}
      <section class="conflict">
        <div class="conflict-copy">
          <strong>External change:</strong>
          <span class="note-name" title={conflict.noteName}>{conflict.noteName}</span>
          <span class="detail">
            {#if conflict.savingCopies}
              Saving both versions…
            {:else if conflict.copyError}
              {conflict.copyError}
            {:else}
              Both versions are preserved.
            {/if}
          </span>
        </div>
        <div class="actions">
          <button
            type="button"
            disabled={conflict.savingCopies}
            onclick={() => useExternalVersion(conflict.noteId)}
          >Use external</button>
          <button
            type="button"
            disabled={conflict.savingCopies || !conflict.externalCopyFile}
            onclick={() => void keepLocalVersion(conflict.noteId)}
          >Keep mine</button>
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .conflict-list {
    display: grid;
    width: min(430px, calc(100vw - 12px));
    gap: 4px;
  }

  .conflict {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: 6px 7px;
    border: 1px solid #805e28;
    border-radius: 3px;
    background: #292419;
    box-shadow: 0 5px 15px #0009;
    color: #f1d89b;
    font-size: 10px;
  }

  .conflict-copy {
    display: grid;
    min-width: 0;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 2px 5px;
    align-items: baseline;
  }

  .note-name {
    overflow: hidden;
    color: #fff1cb;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    grid-column: 1 / -1;
    color: #c9b994;
    font-size: 9px;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }

  button {
    min-height: 24px;
    padding: 3px 6px;
    border: 1px solid #66532f;
    border-radius: 2px;
    background: #322a1d;
    color: #f6e8c5;
    font: inherit;
    font-size: 9px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: #b48c43;
    background: #43371f;
  }

  button:disabled {
    opacity: 0.48;
    cursor: default;
  }
</style>
