<script lang="ts">
  import { onMount } from "svelte";
  import { dismissUpdate, installUpdate, startUpdateCheck, updater } from "./updater.svelte";

  onMount(() => startUpdateCheck());

  let busy = $derived(updater.phase === "downloading" || updater.phase === "installing");
  let percent = $derived(Math.round(updater.progress * 100));
  let title = $derived(
    updater.phase === "downloading" ? "Downloading update"
      : updater.phase === "installing" ? "Installing update"
        : updater.phase === "error" ? "Update failed"
          : "Update available",
  );
</script>

{#if updater.phase !== "idle"}
  <div
    class="update-banner"
    class:failed={updater.phase === "error"}
    role="alertdialog"
    aria-label={title}
    data-update-banner
    data-selection-ignore
  >
    <div class="update-head">
      <span class="update-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16"><path d="M8 2.5v7.5M4.8 6.9 8 10.1l3.2-3.2M3 12.8h10" /></svg>
      </span>
      <strong>{title}</strong>
    </div>

    <div class="update-versions" aria-label={`From ${updater.currentVersion || "this version"} to ${updater.version}`}>
      {#if updater.currentVersion}
        <span class="version current" title="Installed now">{updater.currentVersion}</span>
        <svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" /></svg>
      {/if}
      <span class="version next" title="New version">{updater.version}</span>
    </div>

    {#if updater.notes && updater.phase === "available"}
      <p class="update-notes">{updater.notes}</p>
    {/if}

    {#if updater.phase === "downloading"}
      <div class="update-progress" aria-hidden="true"><span style:width={`${updater.progress * 100}%`}></span></div>
      <span class="update-status">{percent}%</span>
    {:else if updater.phase === "installing"}
      <span class="update-status">Saving your work — hive will restart.</span>
    {:else if updater.phase === "error"}
      <span class="update-error" title={updater.error}>{updater.error}</span>
    {/if}

    <div class="update-actions">
      <button type="button" class="later" onclick={dismissUpdate} disabled={busy}>Later</button>
      <button type="button" class="install" onclick={() => void installUpdate()} disabled={busy}>
        {updater.phase === "error" ? "Retry" : "Update"}
      </button>
    </div>
  </div>
{/if}

<style>
  .update-banner {
    position: fixed;
    z-index: 10050;
    top: 46px;
    left: 50%;
    display: grid;
    width: min(320px, calc(100vw - 32px));
    gap: 10px;
    padding: 14px 14px 12px;
    border: 1px solid #4b4b4b;
    border-radius: 8px;
    color: var(--text);
    background: var(--bg-panel-raised);
    box-shadow: 0 12px 32px rgb(0 0 0 / 48%), 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
    transform: translateX(-50%);
    animation: update-in 160ms ease-out backwards;
  }

  :global(html[data-reduce-motion="true"]) .update-banner { animation: none; }

  @keyframes update-in {
    from { opacity: 0; transform: translate(-50%, -6px); }
  }

  .update-head {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .update-head strong {
    font-size: 13px;
    font-weight: 650;
  }

  .update-icon {
    display: grid;
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .update-icon svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.6;
  }

  .failed .update-icon { background: rgb(229 154 148 / 16%); }
  .failed .update-icon svg { stroke: #e59a94; }

  .update-versions {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 33px;
    font-variant-numeric: tabular-nums;
  }

  .version {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }

  .version.current {
    color: var(--text-dim);
    background: var(--bg-panel);
    box-shadow: 0 0 0 1px #464646 inset;
  }

  .version.next {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent) inset;
  }

  .arrow {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--text-dim);
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.4;
  }

  .update-notes {
    max-height: 96px;
    margin: 0 0 0 33px;
    overflow: auto;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
  }

  .update-status {
    margin-left: 33px;
    color: var(--text-dim);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .update-error {
    margin-left: 33px;
    color: #e59a94;
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  .update-progress {
    height: 4px;
    margin-left: 33px;
    overflow: hidden;
    border-radius: 2px;
    background: #3a3c40;
  }

  .update-progress span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 120ms linear;
  }

  .update-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 2px;
  }

  .update-actions button {
    padding: 5px 14px;
    border: 1px solid #484a50;
    border-radius: 5px;
    color: var(--text);
    background: transparent;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .update-actions button:hover:not(:disabled) { border-color: #6a6d74; background: var(--bg-hover); }
  .update-actions .install { border-color: var(--accent); color: #18191c; background: var(--accent); font-weight: 600; }
  .update-actions .install:hover:not(:disabled) { border-color: var(--accent-hover); background: var(--accent-hover); }
  .update-actions button:disabled { opacity: 0.55; cursor: default; }
</style>
