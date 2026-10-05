<script lang="ts">
  import { onMount } from "svelte";
  import { dismissUpdate, installUpdate, startUpdateCheck, updater } from "./updater.svelte";

  onMount(() => startUpdateCheck());

  let busy = $derived(updater.phase === "downloading" || updater.phase === "installing");
</script>

{#if updater.phase !== "idle"}
  <div class="update-banner" role="alertdialog" aria-label="Update available" data-update-banner data-selection-ignore>
    <div class="update-copy">
      <strong>ОБНОВИТЬ?</strong>
      <span class="update-version">hive {updater.version} is available.</span>
      {#if updater.phase === "downloading"}
        <span class="update-status">Downloading… {Math.round(updater.progress * 100)}%</span>
      {:else if updater.phase === "installing"}
        <span class="update-status">Saving and installing — hive will restart.</span>
      {:else if updater.phase === "error"}
        <span class="update-error" title={updater.error}>Update failed: {updater.error}</span>
      {/if}
    </div>
    {#if updater.notes && updater.phase === "available"}
      <p class="update-notes">{updater.notes}</p>
    {/if}
    <div class="update-actions">
      <button type="button" class="later" onclick={dismissUpdate} disabled={busy}>Later</button>
      <button type="button" class="install" onclick={() => void installUpdate()} disabled={busy}>
        {updater.phase === "error" ? "Retry" : "Update"}
      </button>
    </div>
    {#if updater.phase === "downloading"}
      <div class="update-progress" aria-hidden="true"><span style:width={`${updater.progress * 100}%`}></span></div>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    position: fixed;
    z-index: 10050;
    top: 46px;
    left: 50%;
    display: grid;
    width: min(380px, calc(100vw - 32px));
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    color: var(--text);
    background: var(--bg-panel-raised);
    box-shadow: 0 10px 30px rgb(0 0 0 / 45%);
    transform: translateX(-50%);
    animation: update-in 160ms ease-out backwards;
  }

  :global(html[data-reduce-motion="true"]) .update-banner { animation: none; }

  @keyframes update-in {
    from { opacity: 0; transform: translate(-50%, -6px); }
  }

  .update-copy { display: grid; gap: 3px; }
  .update-copy strong { color: var(--accent); font-size: 14px; letter-spacing: 0.02em; }
  .update-version, .update-status { color: var(--text-dim); font-size: 12px; }
  .update-error { color: #e59a94; font-size: 12px; overflow-wrap: anywhere; }

  .update-notes {
    max-height: 96px;
    margin: 0;
    overflow: auto;
    color: var(--text-dim);
    font-size: 11px;
    white-space: pre-wrap;
  }

  .update-actions { display: flex; justify-content: flex-end; gap: 6px; }

  .update-actions button {
    padding: 4px 12px;
    border: 1px solid #484a50;
    border-radius: 4px;
    color: var(--text);
    background: #26282c;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .update-actions button:hover:not(:disabled) { border-color: #6a6d74; }
  .update-actions .install { border-color: var(--accent); color: #18191c; background: var(--accent); font-weight: 600; }
  .update-actions .install:hover:not(:disabled) { border-color: #f4c860; background: #f4c860; }
  .update-actions button:disabled { opacity: 0.55; cursor: default; }

  .update-progress { height: 3px; overflow: hidden; border-radius: 2px; background: #3a3c40; }
  .update-progress span { display: block; height: 100%; background: var(--accent); }
</style>
