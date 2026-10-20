<script lang="ts">
  import Select from "../../ui/Select.svelte";
  import { backupSettings, setBackupInterval } from "../../backup/backupSettings.svelte";
  import { openBackupsPanel } from "../../backup/panel.svelte";
  import { emptyTrash } from "../../trash/trashActions.svelte";
  import { history } from "../../history/history.svelte";
  import { project } from "../../project/project.svelte";
  import { trash } from "../../model/retention.svelte";
  import { estimateJsonSize, formatStorageSize } from "../../export/storage";
  import { exportCurrentProject, importProjectFromZip, refreshStorageStats } from "../../export/actions";
  import { exportState } from "../../export/exportState.svelte";
  import { t } from "../../i18n/i18n.svelte";

  let confirmingEmptyTrash = $state(false);
  let emptyTrashCancelButton = $state<HTMLButtonElement | null>(null);

  const stats = $derived(exportState.storageStats);

  $effect(() => {
    if (!confirmingEmptyTrash || !emptyTrashCancelButton) return;
    const frame = requestAnimationFrame(() => emptyTrashCancelButton?.focus());
    return () => cancelAnimationFrame(frame);
  });

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
    exportState.message = t("Trash emptied.");
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

<section class="settings-block" aria-labelledby="storage-settings-title" data-storage-settings>
  <div class="settings-block-header">
    <h3 id="storage-settings-title" class="settings-block-title">{t("This project")}</h3>
    <button class="settings-button" type="button" onclick={() => void refreshStorageStats()} disabled={exportState.refreshingStorage}>
      <svg class="refresh-icon" class:spinning={exportState.refreshingStorage} viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></svg>
      {exportState.refreshingStorage ? t("Refreshing…") : t("Refresh")}
    </button>
  </div>
  <div class="storage-stats">
    <div class="storage-stat is-main">
      <span class="stat-label">{t("Project folder")}</span>
      <span class="stat-value">{formatStorageSize(stats?.projectBytes ?? 0)}</span>
      <span class="stat-detail">{t("on disk")}</span>
    </div>
    <div class="storage-stat">
      <span class="stat-label">{t("Snapshots")}</span>
      <span class="stat-value">{formatStorageSize(stats?.snapshotBytes ?? 0)}</span>
      <span class="stat-detail">{stats?.snapshotCount ?? "—"} saved</span>
    </div>
    <div class="storage-stat">
      <span class="stat-label">{t("Trash")}</span>
      <span class="stat-value">{formatStorageSize(estimateJsonSize(trash.entries))}</span>
      <span class="stat-detail">{t("{count} entr{value}, approx.", { count: trash.entries.length, value: trash.entries.length === 1 ? "y" : "ies" })}</span>
    </div>
    <div class="storage-stat">
      <span class="stat-label">{t("Undo history")}</span>
      <span class="stat-value">{history.entries.length}</span>
      <span class="stat-detail">{t("steps in memory")}</span>
    </div>
  </div>
  {#if exportState.storageError}
    <p class="settings-error" role="alert">{exportState.storageError}</p>
  {/if}
</section>

<section class="settings-block" aria-labelledby="backup-settings-title">
  <div class="settings-block-header"><h3 id="backup-settings-title" class="settings-block-title">{t("Backups")}</h3></div>
  <div class="settings-group">
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Automatic snapshots")}</span>
        <span class="setting-description">{t("Save a snapshot of the project on a timer.")}</span>
      </span>
      <span class="settings-select">
        <Select id="settings-backup-interval" ariaLabel={t("Automatic snapshot interval")} value={String(backupSettings.interval)} options={[
          { value: "0", label: t("Off") },
          { value: "15", label: t("Every 15 min") },
          { value: "30", label: t("Every 30 min") },
          { value: "60", label: t("Every 60 min") },
        ]} onchange={changeBackupInterval} />
      </span>
    </div>
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Snapshots")}</span>
        <span class="setting-description">{t("Browse saved snapshots and restore one.")}</span>
      </span>
      <button class="settings-button" type="button" onclick={openBackupsPanel}>{t("Open backups…")}</button>
    </div>
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Trash")}</span>
        <span class="setting-description">{t("Deleted items wait here until the trash is emptied.")}</span>
      </span>
      <button class="settings-button is-danger" type="button" data-settings-empty-trash onclick={requestEmptyTrash} disabled={trash.entries.length === 0}>{t("Empty trash…")}</button>
    </div>
    {#if confirmingEmptyTrash}
      <div class="settings-inline-panel is-danger" data-settings-trash-confirm role="dialog" aria-modal="false" aria-label={t("Confirm empty trash")} tabindex="-1" onkeydown={handleTrashConfirmKeydown}>
        <p>{t("Permanently delete all")} <strong>{trash.entries.length}</strong> {t("{value}? This cannot be undone.", { value: trash.entries.length === 1 ? "entry" : "entries" })}</p>
        <span class="setting-control">
          <button bind:this={emptyTrashCancelButton} class="settings-button" type="button" data-settings-trash-cancel onclick={() => (confirmingEmptyTrash = false)}>{t("Cancel")}</button>
          <button class="settings-button is-danger is-solid" type="button" data-settings-trash-confirm-action onclick={confirmEmptyTrash}>{t("Empty trash")}</button>
        </span>
      </div>
    {/if}
  </div>
</section>

<section class="settings-block" aria-labelledby="transfer-settings-title">
  <div class="settings-block-header"><h3 id="transfer-settings-title" class="settings-block-title">{t("Move a project")}</h3></div>
  <div class="settings-group">
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Export project")}</span>
        <span class="setting-description">{t("Pack the open project with its files into one .zip.")}</span>
      </span>
      <button class="settings-button" type="button" onclick={() => void exportCurrentProject()} disabled={!project.path || exportState.busy}>
        {exportState.busy ? t("Working…") : t("Export…")}
      </button>
    </div>
    <div class="setting-row">
      <span class="setting-copy">
        <span class="setting-title">{t("Import project")}</span>
        <span class="setting-description">{t("Open a project from a .zip made by Export.")}</span>
      </span>
      <button class="settings-button" type="button" onclick={() => void importProjectFromZip()} disabled={exportState.busy}>{t("Import .zip…")}</button>
    </div>
  </div>
</section>

<style>
  .storage-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .storage-stat {
    display: grid;
    gap: 4px;
    padding: 14px 16px;
    border: 1px solid var(--settings-line);
    border-radius: var(--settings-radius);
    background: var(--bg-panel-raised);
  }

  .storage-stat.is-main {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-panel-raised));
  }

  .stat-label {
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .stat-value {
    color: var(--text);
    font-size: 19px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .stat-detail {
    color: var(--text-dim);
    font-size: 11px;
  }

  .refresh-icon {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .refresh-icon.spinning { animation: storage-spin 0.9s linear infinite; }

  @keyframes storage-spin { to { rotate: 360deg; } }

  @media (max-width: 760px) {
    .storage-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
