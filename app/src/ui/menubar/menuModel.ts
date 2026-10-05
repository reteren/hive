export interface RecentProject {
  path: string;
  kind: "folder" | "zip";
  name: string;
  openedAt: number;
  exists: boolean;
}

export interface MenuCommandItem {
  kind: "command";
  commandId: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
  popupHint?: {
    commandId: string;
    buttonLabel: string;
  };
}

export interface MenuSeparatorItem {
  kind: "separator";
}

export interface MenuSubmenuItem {
  kind: "submenu";
  id: "project.openRecent";
  label: string;
  items: MenuItem[];
}

export type MenuItem = MenuCommandItem | MenuSeparatorItem | MenuSubmenuItem;

export function normalizeRecentProjects(projects: readonly RecentProject[]): RecentProject[] {
  return [...projects]
    .filter((item) => item && typeof item.path === "string" && item.path.length > 0)
    .sort((left, right) => right.openedAt - left.openedAt || left.name.localeCompare(right.name))
    .slice(0, 10)
    .map((item) => ({ ...item, name: item.name || item.path }));
}

export function buildRecentMenu(projects: readonly RecentProject[]): MenuItem[] {
  const recent = normalizeRecentProjects(projects);
  const items: MenuItem[] = recent.length > 0
    ? recent.map((item) => ({
      kind: "command",
      commandId: "project.openRecent",
      label: `${item.name}${item.exists ? "" : " (missing)"}`,
      disabled: !item.exists,
    }))
    : [{ kind: "command", commandId: "project.openRecent", label: "No recent projects", disabled: true }];

  return [...items, { kind: "separator" }, { kind: "command", commandId: "project.clearRecent", label: "Clear recent" }];
}

export function buildFileMenu(projects: readonly RecentProject[], hasProject: boolean): MenuItem[] {
  return [
    { kind: "command", commandId: "project.new", label: "New…" },
    { kind: "command", commandId: "project.open", label: "Open…" },
    { kind: "submenu", id: "project.openRecent", label: "Open recent", items: buildRecentMenu(projects) },
    { kind: "command", commandId: "project.save", label: "Save", disabled: !hasProject },
    { kind: "command", commandId: "project.importZip", label: "Import zip…" },
    { kind: "command", commandId: "project.export", label: "Export zip…", disabled: !hasProject },
    { kind: "separator" },
    { kind: "command", commandId: "app.quit", label: "Quit" },
  ];
}

export function buildEditMenu(visibility: {
  undoLog: boolean;
  tasks: boolean;
  trash: boolean;
  objects: boolean;
}): MenuItem[] {
  return [
    { kind: "command", commandId: "edit.undo", label: "Undo" },
    { kind: "command", commandId: "edit.redo", label: "Redo" },
    {
      kind: "command",
      commandId: "dock.toggleUndoLog",
      label: "Open undo history",
      checked: visibility.undoLog,
      popupHint: { commandId: "ui.toggleUndoLog", buttonLabel: "Undo log" },
    },
    { kind: "command", commandId: "search.open", label: "Search" },
    { kind: "command", commandId: "ui.commandSearch", label: "Command search" },
    {
      kind: "command",
      commandId: "dock.toggleTasks",
      label: "Task",
      checked: visibility.tasks,
      popupHint: { commandId: "ui.toggleTasks", buttonLabel: "Tasks" },
    },
    {
      kind: "command",
      commandId: "dock.toggleTrash",
      label: "Trash",
      checked: visibility.trash,
      popupHint: { commandId: "ui.openTrash", buttonLabel: "Trash" },
    },
    {
      kind: "command",
      commandId: "dock.toggleObjects",
      label: "Object list",
      checked: visibility.objects,
      popupHint: { commandId: "ui.toggleObjectsPanel", buttonLabel: "Objects" },
    },
  ];
}
