<script lang="ts">
  import { dismissExportNotice, exportState } from "./exportState.svelte";
</script>

{#if exportState.message || exportState.error}
  <div class="export-notice" data-export-status role={exportState.error ? "alert" : "status"} aria-live="polite">
    <span class:error={Boolean(exportState.error)}>{exportState.error || exportState.message}</span>
    <button type="button" aria-label="Dismiss project transfer message" title="Dismiss" onclick={dismissExportNotice}>×</button>
  </div>
{/if}

<style>
  .export-notice {
    display: flex;
    position: fixed;
    z-index: 1200;
    top: 8px;
    right: 8px;
    max-width: min(460px, calc(100vw - 16px));
    align-items: start;
    gap: 10px;
    padding: 8px 9px 8px 11px;
    border: 1px solid #4b4b4b;
    border-radius: 4px;
    background: #202020;
    box-shadow: 0 5px 18px rgb(0 0 0 / 42%);
    color: var(--text);
    font-size: 11px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .export-notice .error {
    color: #ffb0a6;
  }

  button {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
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

  button:hover,
  button:focus-visible {
    border-color: #555;
    background: #333;
    color: var(--text);
  }
</style>
