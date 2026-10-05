<script module lang="ts">
  import "../export/commands";
</script>

<script lang="ts">
  import { backupSettings, setBackupInterval } from "../backup/backupSettings.svelte";
  import { openBackupsPanel } from "../backup/panel.svelte";
  import { emptyTrash } from "../trash/trashActions.svelte";
  import { history, MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT, setHistoryLimit } from "../history/history.svelte";
  import { project } from "../project/project.svelte";
  import { trash } from "../model/retention.svelte";
  import { estimateJsonSize, formatStorageSize } from "../export/storage";
  import { exportCurrentProject, importProjectFromZip, refreshStorageStats } from "../export/actions";
  import { exportState } from "../export/exportState.svelte";
  import { preferences, setFitWidthToText, setRecordInBackground, setReduceAnimations } from "../settings/preferences.svelte";
  import { gifPlayback, setGifPlaybackMode } from "../attachments/gifPlayback.svelte";
  import { closeSettingsPanel, settingsPanel } from "../settings/settingsPanel.svelte";
  import QuickInputShortcutSetting from "../settings/QuickInputShortcutSetting.svelte";
  import ExportStatus from "../export/ExportStatus.svelte";
  import SpellcheckSettings from "../spell/SpellcheckSettings.svelte";
  import Select from "./Select.svelte";

  let historyLimitDraft = $state(String(history.limit));
  let closeButton = $state<HTMLButtonElement | null>(null);
  let confirmingEmptyTrash = $state(false);
  let emptyTrashCancelButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    historyLimitDraft = String(history.limit);
  });

  $effect(() => {
    if (!settingsPanel.open) return;
    if (project.path) void refreshStorageStats();
    const frame = requestAnimationFrame(() => closeButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!settingsPanel.open || !confirmingEmptyTrash || !emptyTrashCancelButton) return;
    const frame = requestAnimationFrame(() => emptyTrashCancelButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closeSettingsPanel();
  }

  function changeHistoryLimit(event: Event): void {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    setHistoryLimit(event.currentTarget.valueAsNumber);
    historyLimitDraft = String(history.limit);
  }

  function handleHistoryLimitKeydown(event: KeyboardEvent): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      historyLimitDraft = String(history.limit);
      input.blur();
    }
  }

  function changeBackupInterval(value: string): void {
    switch (Number(value)) {
      case 0: setBackupInterval(0); break;
      case 15: setBackupInterval(15); break;
      case 30: setBackupInterval(30); break;
      case 60: setBackupInterval(60); break;
    }
  }

  function requestEmptyTrash(): void {
    if (trash.entries.length > 0) confirmingEmptyTrash = true;
  }

  function confirmEmptyTrash(): void {
    if (trash.entries.length === 0) return;
    emptyTrash();
    confirmingEmptyTrash = false;
    exportState.message = "Trash emptied.";
    exportState.error = "";
    void refreshStorageStats();
  }

  function handleTrashConfirmKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      confirmingEmptyTrash = false;
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      confirmEmptyTrash();
    }
  }
</script>

<ExportStatus />

{#if settingsPanel.open}
  <div class="settings-overlay" data-selection-ignore>
    <button class="settings-backdrop" type="button" aria-label="Close settings" onclick={closeSettingsPanel}></button>
    <div class="settings-window" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1" onkeydown={handleKeydown}>
      <header class="settings-heading">
        <h1 id="settings-title">Settings</h1>
        <button bind:this={closeButton} class="close-button" type="button" aria-label="Close settings" title="Close settings" onclick={closeSettingsPanel}>×</button>
      </header>

      <div class="settings-content">
        <section class="settings-section" aria-labelledby="general-settings-title">
          <h2 id="general-settings-title">General</h2>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Reduce animations</span>
              <span class="setting-description">Use less motion throughout the interface.</span>
            </span>
            <input
              type="checkbox"
              checked={preferences.reduceAnimations}
              onchange={(event) => setReduceAnimations(event.currentTarget.checked)}
            />
          </label>
          <label class="setting-row">
            <span class="setting-copy">
              <span>GIF playback</span>
              <span class="setting-description">Stopped GIFs stay still until you choose Play gif.</span>
            </span>
            <span class="gif-playback-select">
              <Select id="settings-gif-playback" ariaLabel="GIF playback" value={gifPlayback.mode} options={[
                { value: "always", label: "Always" },
                { value: "hover", label: "On hover" },
                { value: "selected", label: "When selected" },
              ]} onchange={setGifPlaybackMode} />
            </span>
          </label>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Record in background</span>
              <span class="setting-description">Keep an active audio recording when the window loses focus.</span>
            </span>
            <input
              type="checkbox"
              checked={preferences.recordInBackground}
              onchange={(event) => setRecordInBackground(event.currentTarget.checked)}
            />
          </label>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Fit note width to text (beta)</span>
              <span class="setting-description">Grow while typing to keep each line unwrapped.</span>
            </span>
            <input
              type="checkbox"
              checked={preferences.fitWidthToText}
              onchange={(event) => setFitWidthToText(event.currentTarget.checked)}
            />
          </label>
          <QuickInputShortcutSetting />
        </section>

        <SpellcheckSettings />

        <section class="settings-section" aria-labelledby="history-settings-title">
          <h2 id="history-settings-title">History</h2>
          <label class="setting-row">
            <span class="setting-copy">
              <span>Undo history limit</span>
              <span class="setting-description">Retain between {MIN_HISTORY_LIMIT} and {MAX_HISTORY_LIMIT} steps.</span>
            </span>
            <input
              class="history-limit"
              type="number"
              min={MIN_HISTORY_LIMIT}
              max={MAX_HISTORY_LIMIT}
              step="1"
              value={historyLimitDraft}
              aria-label={`Undo history limit, from ${MIN_HISTORY_LIMIT} to ${MAX_HISTORY_LIMIT}`}
              oninput={(event) => (historyLimitDraft = event.currentTarget.value)}
              onchange={changeHistoryLimit}
              onkeydown={handleHistoryLimitKeydown}
            />
          </label>
        </section>

        <section class="settings-section" aria-labelledby="storage-settings-title" data-storage-settings>
          <h2 id="storage-settings-title">Storage</h2>
          <div class="storage-row">
            <span>Trash</span>
            <span class="storage-value">{trash.entries.length} entr{trash.entries.length === 1 ? "y" : "ies"} · approx. {formatStorageSize(estimateJsonSize(trash.entries))}</span>
          </div>
          <div class="storage-row">
            <span>Snapshots</span>
            <span class="storage-value">{exportState.storageStats?.snapshotCount ?? "—"} snapshots · {formatStorageSize(exportState.storageStats?.snapshotBytes ?? 0)}</span>
          </div>
          <div class="storage-row">
            <span>Undo history</span>
            <span class="storage-value">{history.entries.length} entries in memory</span>
          </div>
          <div class="storage-row">
            <span>Project folder</span>
            <span class="storage-value">{formatStorageSize(exportState.storageStats?.projectBytes ?? 0)}</span>
          </div>
          {#if exportState.storageError}
            <p class="storage-error" role="alert">{exportState.storageError}</p>
          {/if}
          <div class="storage-actions">
            <label class="interval-control">
              <span>Backup interval</span>
              <span class="interval-select">
                <Select id="settings-backup-interval" ariaLabel="Automatic snapshot interval" value={String(backupSettings.interval)} options={[
                  { value: "0", label: "Off" },
                  { value: "15", label: "15 min" },
                  { value: "30", label: "30 min" },
                  { value: "60", label: "60 min" },
                ]} onchange={changeBackupInterval} />
              </span>
            </label>
            <button type="button" data-settings-empty-trash onclick={requestEmptyTrash} disabled={trash.entries.length === 0}>Empty trash…</button>
            <button type="button" onclick={openBackupsPanel}>Open backups</button>
            <button type="button" onclick={() => void refreshStorageStats()} disabled={exportState.refreshingStorage}>
              {exportState.refreshingStorage ? "Refreshing…" : "Refresh storage"}
            </button>
          </div>
          {#if confirmingEmptyTrash}
            <div class="storage-trash-confirm" data-settings-trash-confirm role="dialog" aria-modal="false" aria-label="Confirm empty trash" tabindex="-1" onkeydown={handleTrashConfirmKeydown}>
              <p>Permanently delete all <strong>{trash.entries.length}</strong> {trash.entries.length === 1 ? "entry" : "entries"}? This cannot be undone.</p>
              <div class="storage-trash-confirm-actions">
                <button bind:this={emptyTrashCancelButton} type="button" data-settings-trash-cancel onclick={() => (confirmingEmptyTrash = false)}>Cancel</button>
                <button type="button" data-settings-trash-confirm-action onclick={confirmEmptyTrash}>Empty trash</button>
              </div>
            </div>
          {/if}
          <div class="storage-actions transfer-actions">
            <button type="button" onclick={() => void exportCurrentProject()} disabled={!project.path || exportState.busy}>
              {exportState.busy ? "Working…" : "Export project…"}
            </button>
            <button type="button" onclick={() => void importProjectFromZip()} disabled={exportState.busy}>
              Import project from .zip…
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    z-index: 1001;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 12px;
  }

  .settings-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgb(0 0 0 / 48%);
    cursor: default;
  }

  .settings-window {
    position: relative;
    display: flex;
    width: min(420px, 100%);
    max-height: min(520px, 100%);
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #4b4b4b;
    border-radius: 5px;
    background: var(--bg-panel);
    box-shadow: 0 12px 36px rgb(0 0 0 / 58%);
    color: var(--text);
  }

  .settings-heading {
    display: flex;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    padding: 4px 7px 4px 12px;
    border-bottom: 1px solid #3b3b3b;
  }

  h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
  }

  .close-button {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-dim);
    font: inherit;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .close-button:hover,
  .close-button:focus-visible {
    border-color: #555;
    background: #333;
    color: var(--text);
  }

  .settings-content {
    min-height: 0;
    overflow: auto;
    padding: 4px 12px 12px;
  }

  .settings-section {
    padding: 9px 0 3px;
  }

  .settings-section + .settings-section {
    margin-top: 6px;
    border-top: 1px solid #3b3b3b;
  }

  h2 {
    margin: 0 0 7px;
    color: var(--text-dim);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .setting-row {
    display: flex;
    min-height: 38px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 2px;
    font-size: 11px;
  }

  .setting-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .setting-description {
    color: var(--text-dim);
    font-size: 9px;
    line-height: 1.35;
  }

  input[type="checkbox"] {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
    accent-color: var(--accent);
  }

  .history-limit {
    width: 64px;
    height: 24px;
    flex: 0 0 auto;
    padding: 2px 5px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #181818;
    color: var(--text);
    font: inherit;
    font-family: var(--mono-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .history-limit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .storage-row {
    display: flex;
    min-height: 25px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 2px;
    font-size: 10px;
  }

  .storage-value {
    color: var(--text-dim);
    font-family: var(--mono-font);
    font-size: 9px;
    text-align: right;
  }

  .storage-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }

  .storage-actions button {
    min-height: 25px;
    padding: 3px 7px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #252525;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .storage-actions button:hover:not(:disabled),
  .storage-actions button:focus-visible {
    border-color: #806b2d;
    background: #343019;
  }

  .storage-actions button:disabled {
    color: #777;
    cursor: default;
  }

  .storage-trash-confirm {
    margin-top: 7px;
    padding: 8px;
    border: 1px solid #6c5144;
    border-radius: 3px;
    background: #302723;
    color: var(--text);
    font-size: 10px;
    line-height: 1.4;
  }

  .storage-trash-confirm p {
    margin: 0 0 6px;
  }

  .storage-trash-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 5px;
  }

  .storage-trash-confirm-actions button {
    min-height: 24px;
    padding: 3px 7px;
    border: 1px solid #484848;
    border-radius: 3px;
    background: #252525;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }

  .storage-trash-confirm-actions button:last-child {
    border-color: #985b55;
    color: #e2a19a;
  }

  .interval-control {
    display: flex;
    min-height: 25px;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    color: var(--text-dim);
    font-size: 10px;
  }

  .interval-select {
    display: block;
    width: 75px;
    flex: 0 0 75px;
  }

  .gif-playback-select {
    display: block;
    width: 126px;
    flex: 0 0 126px;
  }

  .storage-error {
    margin: 5px 2px;
    color: #ffb0a6;
    font-size: 9px;
    overflow-wrap: anywhere;
  }

  .transfer-actions {
    padding-top: 7px;
    border-top: 1px solid #3b3b3b;
  }
</style>
