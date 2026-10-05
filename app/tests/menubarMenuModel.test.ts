import { describe, expect, it } from "vitest";
import { buildEditMenu, buildFileMenu, buildRecentMenu, normalizeRecentProjects, type MenuCommandItem, type RecentProject } from "../src/ui/menubar/menuModel";

const project = (name: string, openedAt: number, exists = true, kind: RecentProject["kind"] = "folder"): RecentProject => ({
  path: `C:/projects/${name}`,
  kind,
  name,
  openedAt,
  exists,
});

describe("menubar menu model", () => {
  it("orders recent projects newest first, keeps ten, and marks missing entries disabled", () => {
    const entries = Array.from({ length: 12 }, (_, index) => project(`project-${index}`, index, index !== 11));
    const ordered = normalizeRecentProjects(entries);

    expect(ordered).toHaveLength(10);
    expect(ordered[0]?.name).toBe("project-11");
    const menu = buildRecentMenu(entries);
    expect(menu[0]).toMatchObject({ label: "project-11 (missing)", disabled: true });
    expect(menu[9]).toMatchObject({ label: "project-2", disabled: false });
    expect(menu.at(-1)).toMatchObject({ commandId: "project.clearRecent", label: "Clear recent" });
    expect(buildRecentMenu([project("offline", 1, false)])[0]).toMatchObject({ label: "offline (missing)", disabled: true });
  });

  it("puts file actions in the expected order and disables project-only actions without a project", () => {
    const items = buildFileMenu([project("archive", 1, true, "zip")], false);
    expect(items.map((item) => item.kind === "separator" ? "separator" : item.label)).toEqual([
      "New…", "Open…", "Open recent", "Save", "Import zip…", "Export zip…", "separator", "Quit",
    ]);
    expect(items[3]).toMatchObject({ disabled: true });
    expect(items[5]).toMatchObject({ disabled: true });
    expect(items[2]).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ commandId: "project.openRecent" })]) });
  });

  it("reflects visible dock buttons with checkmarks", () => {
    const items = buildEditMenu({ undoLog: true, tasks: false, trash: true, objects: false });
    expect(items.filter((item): item is MenuCommandItem => item.kind === "command" && Boolean(item.checked)).map((item) => item.commandId)).toEqual([
      "dock.toggleUndoLog", "dock.toggleTrash",
    ]);
  });

  it("uses each centred popup command as the shortcut hint for its dock button", () => {
    const items = buildEditMenu({ undoLog: false, tasks: false, trash: false, objects: false });
    expect(items.filter((item): item is MenuCommandItem => item.kind === "command" && Boolean(item.popupHint)).map((item) => ({
      commandId: item.commandId,
      buttonLabel: item.popupHint?.buttonLabel,
      shortcutCommandId: item.popupHint?.commandId,
    }))).toEqual([
      { commandId: "dock.toggleUndoLog", buttonLabel: "Undo log", shortcutCommandId: "ui.toggleUndoLog" },
      { commandId: "dock.toggleTasks", buttonLabel: "Tasks", shortcutCommandId: "ui.toggleTasks" },
      { commandId: "dock.toggleTrash", buttonLabel: "Trash", shortcutCommandId: "ui.openTrash" },
      { commandId: "dock.toggleObjects", buttonLabel: "Objects", shortcutCommandId: "ui.toggleObjectsPanel" },
    ]);
  });
});
