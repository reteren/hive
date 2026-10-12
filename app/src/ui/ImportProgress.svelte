<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import {
    receiveImportProgress,
    requestImportCancel,
    subscribeImportProgress,
    type ImportProgressEvent,
    type ImportProgressState,
  } from "../attachments/service";

  let progress = $state<ImportProgressState>({
    id: null, active: false, label: "", total: 0, completed: 0,
    succeeded: 0, failed: 0, currentFile: "", cancelRequested: false,
  });

  let cancelButton = $state<HTMLButtonElement>();

  onMount(() => {
    const unsubscribe = subscribeImportProgress((next) => Object.assign(progress, next));
    const unlisten = isTauri()
      ? listen<ImportProgressEvent>("attachment-import-progress", ({ payload }) => receiveImportProgress(payload))
      : Promise.resolve(() => undefined);
    const focusCancel = () => cancelButton?.focus({ preventScroll: true });
    const trapInput = (event: KeyboardEvent) => {
      if (!progress.active) return;
      if (event.code === "Escape") {
        requestImportCancel();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.code === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusCancel();
        return;
      }
      if ((event.code === "Enter" || event.code === "Space") && event.target === cancelButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", trapInput, true);
    const focusTimer = window.setInterval(() => {
      if (progress.active && !document.activeElement?.closest("[data-import-progress]")) focusCancel();
    }, 100);
    return () => {
      window.removeEventListener("keydown", trapInput, true);
      window.clearInterval(focusTimer);
      unsubscribe();
      void unlisten.then((dispose) => dispose());
    };
  });

  let percent = $derived(progress.total > 0
    ? Math.min(100, Math.round(progress.completed / progress.total * 100))
    : 0);
</script>

{#if progress.active}
  <div class="import-backdrop" data-selection-ignore>
    <dialog open
      class="import-card"
      data-import-progress
      aria-modal="true"
      aria-labelledby="import-title"
      aria-describedby="import-description"
    >
      <div class="import-heading">
        <span class="import-mark" aria-hidden="true">⇣</span>
        <div>
          <h2 id="import-title">{progress.label}</h2>
          <p id="import-description" aria-live="polite">
            {#if progress.cancelRequested}
              Finishing the current batch before stopping…
            {:else}
              {progress.completed.toLocaleString()} of {progress.total.toLocaleString()} files
            {/if}
          </p>
        </div>
        <strong class="import-percent">{percent}%</strong>
      </div>

      <progress max={Math.max(1, progress.total)} value={progress.completed} aria-label="Import progress"></progress>

      <div class="import-details">
        <span>{progress.succeeded.toLocaleString()} imported</span>
        {#if progress.failed > 0}
          <span class="import-failed">{progress.failed.toLocaleString()} skipped</span>
        {/if}
      </div>
      {#if progress.currentFile}
        <p class="import-current" title={progress.currentFile}>{progress.currentFile}</p>
      {/if}

      <button
        bind:this={cancelButton}
        class="import-cancel"
        type="button"
        disabled={progress.cancelRequested}
        onclick={requestImportCancel}
      >
        {progress.cancelRequested ? "Stopping…" : "Cancel import"}
      </button>
    </dialog>
  </div>
{/if}

<style>
  .import-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(12 16 22 / 28%);
    backdrop-filter: blur(3px);
  }

  .import-card {
    position: relative;
    margin: 0;
    width: min(440px, 100%);
    padding: 22px;
    border: 1px solid rgb(255 255 255 / 11%);
    border-radius: 16px;
    background: #20252d;
    color: #f3f5f8;
    box-shadow: 0 22px 70px rgb(0 0 0 / 38%);
  }

  .import-heading {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .import-mark {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 11px;
    background: rgb(118 185 158 / 16%);
    color: #92d2b4;
    font-size: 24px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }

  .import-heading p {
    margin: 4px 0 0;
    color: #b7c0cb;
    font-size: 12px;
  }

  .import-percent {
    margin-left: auto;
    color: #92d2b4;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }

  progress {
    display: block;
    width: 100%;
    height: 8px;
    margin: 20px 0 10px;
    overflow: hidden;
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #343b45;
  }

  progress::-webkit-progress-bar { border-radius: 999px; background: #343b45; }
  progress::-webkit-progress-value { border-radius: 999px; background: #77c49e; transition: width 120ms linear; }
  progress::-moz-progress-bar { border-radius: 999px; background: #77c49e; }

  .import-details {
    display: flex;
    gap: 14px;
    color: #9ca7b4;
    font-size: 11px;
  }

  .import-failed { color: #edbd82; }

  .import-current {
    margin: 13px 0 0;
    overflow: hidden;
    color: #b7c0cb;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .import-cancel {
    display: block;
    margin: 18px 0 0 auto;
    padding: 8px 12px;
    border: 1px solid rgb(255 255 255 / 16%);
    border-radius: 9px;
    background: #303741;
    color: #f3f5f8;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .import-cancel:hover:not(:disabled) { background: #3a444f; }
  .import-cancel:focus-visible { outline: 2px solid #92d2b4; outline-offset: 2px; }
  .import-cancel:disabled { cursor: wait; opacity: .72; }
</style>
