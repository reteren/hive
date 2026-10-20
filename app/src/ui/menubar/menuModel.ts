import { t } from "../../i18n/i18n.svelte";
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
      label: `${item.name}${item.exists ? "" : t(" (missing)")}`,
      disabled: !item.exists,
    }))
    : [{ kind: "command", commandId: "project.openRecent", label: t("No recent projects"), disabled: true }];

  return [...items, { kind: "separator" }, { kind: "command", commandId: "project.clearRecent", label: t("Clear recent") }];
}

export function buildFileMenu(projects: readonly RecentProject[], hasProject: boolean): MenuItem[] {
  return [
    { kind: "command", commandId: "project.new", label: t("New…") },
    { kind: "command", commandId: "project.open", label: t("Open…") },
    { kind: "submenu", id: "project.openRecent", label: t("Open recent"), items: buildRecentMenu(projects) },
    { kind: "command", commandId: "project.save", label: t("Save"), disabled: !hasProject },
    { kind: "command", commandId: "project.importZip", label: t("Import zip…") },
    { kind: "command", commandId: "project.export", label: t("Export zip…"), disabled: !hasProject },
    { kind: "separator" },
    { kind: "command", commandId: "app.quit", label: t("Quit") },
  ];
}

export function buildEditMenu(visibility: {
  undoLog: boolean;
  tasks: boolean;
  trash: boolean;
  objects: boolean;
}): MenuItem[] {
  return [
    { kind: "command", commandId: "edit.undo", label: t("Undo") },
    { kind: "command", commandId: "edit.redo", label: t("Redo") },
    {
      kind: "command",
      commandId: "dock.toggleUndoLog",
      label: t("Open undo history"),
      checked: visibility.undoLog,
      popupHint: { commandId: "ui.toggleUndoLog", buttonLabel: t("Undo log") },
    },
    { kind: "command", commandId: "search.open", label: t("Search") },
    { kind: "command", commandId: "ui.commandSearch", label: t("Command search") },
    {
      kind: "command",
      commandId: "dock.toggleTasks",
      label: t("Task"),
      checked: visibility.tasks,
      popupHint: { commandId: "ui.toggleTasks", buttonLabel: t("Tasks") },
    },
    {
      kind: "command",
      commandId: "dock.toggleTrash",
      label: t("Trash"),
      checked: visibility.trash,
      popupHint: { commandId: "ui.openTrash", buttonLabel: t("Trash") },
    },
    {
      kind: "command",
      commandId: "dock.toggleObjects",
      label: t("Object list"),
      checked: visibility.objects,
      popupHint: { commandId: "ui.toggleObjectsPanel", buttonLabel: t("Objects") },
    },
  ];
}
