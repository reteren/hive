import { mount } from "svelte";
import BackupsPanel from "./BackupsPanel.svelte";
import { registerCommand } from "../commands/registry.svelte";
import { initializeBackupScheduler } from "./scheduler.svelte";
import { openBackupsPanel, requestCreateBackup, requestProjectHealthCheck } from "./panel.svelte";

registerCommand({
  id: "backup.openPanel",
  label: "Backups",
  keys: [],
  run: openBackupsPanel,
});

registerCommand({
  id: "backup.createSnapshot",
  label: "Create snapshot",
  keys: [],
  run: requestCreateBackup,
});

registerCommand({
  id: "backup.checkHealth",
  label: "Check project health",
  keys: [],
  run: requestProjectHealthCheck,
});

const host = document.createElement("div");
host.dataset.backupsPanelHost = "";
document.body.append(host);
mount(BackupsPanel, { target: host });

initializeBackupScheduler();
