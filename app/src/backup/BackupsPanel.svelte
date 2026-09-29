<script lang="ts">
  import { backupSettings, setBackupInterval, type BackupInterval } from "./backupSettings.svelte";
  import { backupPanelState, closeBackupsPanel } from "./panel.svelte";
  import { checkProjectHealth, createBackup, deleteBackup, listBackups, restoreBackup, type BackupInfo } from "./api";
  import Select from "../ui/Select.svelte";

  let backups = $state<BackupInfo[]>([]);
  let totalSizeBytes = $state(0);
  let busy = $state(false);

  $effect(() => {
    if (backupPanelState.open) void refresh();
  });

  $effect(() => {
    const action = backupPanelState.pendingAction;
    if (!backupPanelState.open || action === "none") return;
    backupPanelState.pendingAction = "none";
    if (action === "create") void makeSnapshot();
    else void runHealthCheck();
  });

  async function refresh(): Promise<void> {
    try {
      const listing = await listBackups();
      backups = listing.backups;
      totalSizeBytes = listing.totalSizeBytes;
      backupPanelState.error = "";
    } catch (error) {
      backupPanelState.error = errorMessage(error);
    }
  }

  async function makeSnapshot(): Promise<void> {
    busy = true;
    backupPanelState.error = "";
    try {
      await createBackup();
      await refresh();
    } catch (error) {
      backupPanelState.error = errorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function runHealthCheck(): Promise<void> {
    busy = true;
    backupPanelState.error = "";
    backupPanelState.healthFindings = null;
    try {
      backupPanelState.healthFindings = (await checkProjectHealth()).findings;
    } catch (error) {
      backupPanelState.error = errorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function restore(item: BackupInfo): Promise<void> {
    if (!window.confirm(`Restore the project from ${formatDate(item.date)}? The current project will first be snapshotted, then board.json and notes will be replaced.`)) return;
    busy = true;
    backupPanelState.error = "";
    try {
      await restoreBackup(item.id);
      await refresh();
      backupPanelState.healthFindings = null;
    } catch (error) {
      backupPanelState.error = errorMessage(error);
    } finally {
      busy = false;
    }
  }

  async function remove(item: BackupInfo): Promise<void> {
    if (!window.confirm(`Delete the snapshot from ${formatDate(item.date)} permanently?`)) return;
    busy = true;
    backupPanelState.error = "";
    try {
      await deleteBackup(item.id);
      await refresh();
    } catch (error) {
      backupPanelState.error = errorMessage(error);
    } finally {
      busy = false;
    }
  }

  function setInterval(value: string): void {
    const interval = Number(value);
    if (interval === 0 || interval === 15 || interval === 30 || interval === 60) setBackupInterval(interval as BackupInterval);
  }

  function formatDate(value: string): string {
    const iso = value.replace(/T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z(?:-\d+)?$/, "T$1:$2:$3.$4Z");
    const date = new Date(iso);
    return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function formatSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
</script>

{#if backupPanelState.open}
  <div class="backup-overlay" data-selection-ignore>
    <button class="backup-backdrop" type="button" aria-label="Close backups" onclick={closeBackupsPanel}></button>
    <dialog open class="backup-dialog" data-backup-panel aria-modal="true" aria-labelledby="backup-title" onkeydown={(event) => event.key === "Escape" && closeBackupsPanel()}>
      <header class="backup-heading">
        <div>
          <h2 id="backup-title">Project backups</h2>
          <p>{backups.length} snapshots · {formatSize(totalSizeBytes)} total</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close backups" onclick={closeBackupsPanel}>×</button>
      </header>

      <div class="backup-actions">
        <button type="button" disabled={busy} onclick={makeSnapshot}>Create snapshot</button>
        <button type="button" disabled={busy} onclick={runHealthCheck}>Check project health</button>
        <label>
          Automatic snapshots
          <span class="backup-interval-select">
            <Select id="backup-panel-interval" ariaLabel="Automatic snapshot interval" value={String(backupSettings.interval)} options={[
              { value: "0", label: "Off" },
              { value: "15", label: "Every 15 minutes" },
              { value: "30", label: "Every 30 minutes" },
              { value: "60", label: "Every 60 minutes" },
            ]} onchange={setInterval} />
          </span>
        </label>
      </div>

      {#if backupPanelState.error}
        <p class="backup-error" role="alert">{backupPanelState.error}</p>
      {/if}

      {#if backupPanelState.healthFindings !== null}
        <section class="health-report" data-project-health aria-label="Project health report">
          <h3>Project health</h3>
          {#if backupPanelState.healthFindings.length === 0}
            <p class="health-ok">No integrity issues found.</p>
          {:else}
            <ul>
              {#each backupPanelState.healthFindings as finding, index (`${index}-${finding}`)}
                <li>{finding}</li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <div class="backup-list" aria-label="Snapshots">
        {#each backups as item (item.id)}
          <article class="backup-item" data-backup-id={item.id}>
            <div class="backup-copy">
              <strong>{formatDate(item.date)}</strong>
              <span>{item.noteCount} notes · {formatSize(item.sizeBytes)}</span>
            </div>
            <div class="backup-item-actions">
              <button type="button" disabled={busy} onclick={() => void restore(item)}>Restore</button>
              <button class="danger" type="button" disabled={busy} onclick={() => void remove(item)}>Delete</button>
            </div>
          </article>
        {:else}
          <p class="backup-empty">No snapshots yet.</p>
        {/each}
      </div>
    </dialog>
  </div>
{/if}

<style>
  .backup-overlay { position: fixed; z-index: 1200; inset: 0; display: grid; place-items: center; padding: 16px; }
  .backup-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #0009; cursor: default; }
  .backup-dialog { position: relative; display: flex; width: min(620px, 100%); max-height: min(720px, 88vh); flex-direction: column; overflow: hidden; border: 1px solid #4d5056; border-radius: 5px; color: var(--text); background: var(--bg-panel); box-shadow: 0 14px 40px #0009; }
  .backup-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #3b3e44; }
  h2, h3, p { margin: 0; }
  h2 { font-size: 14px; }
  .backup-heading p { margin-top: 4px; color: #aeb2ba; font-size: 11px; }
  .icon-button { width: 26px; height: 26px; border: 1px solid #474b52; border-radius: 3px; color: var(--text); background: #303238; font: inherit; cursor: pointer; }
  .backup-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 9px 12px; border-bottom: 1px solid #3b3e44; }
  button { min-height: 27px; padding: 5px 8px; border: 1px solid #4b4f57; border-radius: 3px; color: var(--text); background: #303238; font: inherit; font-size: 11px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .55; cursor: default; }
  .backup-actions label { display: flex; align-items: center; gap: 7px; margin-left: auto; color: #c0c2c8; font-size: 11px; }
  .backup-interval-select { display: block; width: 150px; flex: 0 0 150px; }
  .backup-list { min-height: 90px; overflow: auto; }
  .backup-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #363940; }
  .backup-copy { display: grid; gap: 4px; min-width: 0; }
  .backup-copy strong { overflow-wrap: anywhere; font-size: 11px; font-weight: 600; }
  .backup-copy span, .backup-empty { color: #aeb2ba; font-size: 10px; }
  .backup-item-actions { display: flex; flex-shrink: 0; gap: 5px; }
  .danger { color: #f2c6c6; }
  .backup-empty { padding: 18px 12px; }
  .backup-error { padding: 8px 12px; color: #ffc0bc; background: #482e31; font-size: 11px; overflow-wrap: anywhere; }
  .health-report { max-height: 170px; overflow: auto; padding: 9px 12px; border-bottom: 1px solid #3b3e44; background: #222429; }
  h3 { margin-bottom: 6px; font-size: 11px; }
  .health-report p, .health-report li { color: #c1c3c9; font-size: 10px; line-height: 1.45; }
  .health-ok { color: #bfe0c1 !important; }
  .health-report ul { display: grid; gap: 3px; margin: 0; padding-left: 17px; }
  @media (max-width: 520px) { .backup-item { align-items: flex-start; flex-direction: column; } .backup-actions label { margin-left: 0; } }
</style>
