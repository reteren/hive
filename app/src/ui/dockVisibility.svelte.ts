import { registerCommand } from "../commands/registry.svelte";
import { closeUndoLog } from "../history/history.svelte";
import { closeTasksPanel } from "../tasks/tasksPanelState.svelte";
import { closeTrashPanel } from "../trash/trashPanelState.svelte";
import { closeObjectsPanel } from "../navigation/panelState.svelte";

export type DockButtonId = "undoLog" | "tasks" | "trash" | "objects";
export type DockVisibility = Record<DockButtonId, boolean>;

export const DOCK_VISIBILITY_STORAGE_KEY = "hive.dockVisibility.v1";

const defaults: DockVisibility = { undoLog: false, tasks: false, trash: false, objects: false };

function readVisibility(): DockVisibility {
  try {
    const raw = globalThis.localStorage?.getItem(DOCK_VISIBILITY_STORAGE_KEY);
    if (!raw) return { ...defaults };
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { ...defaults };
    const values = stored as Record<string, unknown>;
    return {
      undoLog: typeof values.undoLog === "boolean" ? values.undoLog : false,
      tasks: typeof values.tasks === "boolean" ? values.tasks : false,
      trash: typeof values.trash === "boolean" ? values.trash : false,
      objects: typeof values.objects === "boolean" ? values.objects : false,
    };
  } catch {
    return { ...defaults };
  }
}

export const dockVisibility = $state<DockVisibility>(readVisibility());

function persistVisibility(): void {
  try {
    globalThis.localStorage?.setItem(DOCK_VISIBILITY_STORAGE_KEY, JSON.stringify(dockVisibility));
  } catch {
    // Private browsing and storage quotas must not prevent changing dock visibility.
  }
}

function closeDockPanel(id: DockButtonId): void {
  if (id === "undoLog") closeUndoLog();
  else if (id === "tasks") closeTasksPanel();
  else if (id === "trash") closeTrashPanel();
  else closeObjectsPanel();
}

export function setDockButtonVisible(id: DockButtonId, visible: boolean): void {
  if (dockVisibility[id] === visible) return;
  dockVisibility[id] = visible;
  persistVisibility();
  if (!visible) closeDockPanel(id);
}

export function toggleDockButtonVisible(id: DockButtonId): void {
  setDockButtonVisible(id, !dockVisibility[id]);
}

registerCommand({
  id: "dock.toggleUndoLog",
  label: "Toggle Undo History Button",
  keys: [],
  run: () => toggleDockButtonVisible("undoLog"),
});

registerCommand({
  id: "dock.toggleTasks",
  label: "Toggle Tasks Button",
  keys: [],
  run: () => toggleDockButtonVisible("tasks"),
});

registerCommand({
  id: "dock.toggleTrash",
  label: "Toggle Trash Button",
  keys: [],
  run: () => toggleDockButtonVisible("trash"),
});

registerCommand({
  id: "dock.toggleObjects",
  label: "Toggle Objects Button",
  keys: [],
  run: () => toggleDockButtonVisible("objects"),
});
