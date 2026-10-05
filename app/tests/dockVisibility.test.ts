import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("dock button visibility", () => {
  it("starts hidden by default and registers unbound visibility commands", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.resetModules();

    const { dockVisibility } = await import("../src/ui/dockVisibility.svelte");
    const { getCommand } = await import("../src/commands/registry.svelte");

    expect(dockVisibility).toEqual({ undoLog: false, tasks: false, trash: false, objects: false });
    expect(getCommand("dock.toggleUndoLog")?.keys).toEqual([]);
    expect(getCommand("dock.toggleTasks")?.keys).toEqual([]);
    expect(getCommand("dock.toggleTrash")?.keys).toEqual([]);
    expect(getCommand("dock.toggleObjects")?.keys).toEqual([]);
  });

  it("loads valid saved fields and persists toggles under the versioned key", async () => {
    const storage = memoryStorage({ "hive.dockVisibility.v1": JSON.stringify({ tasks: true, trash: "yes" }) });
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();

    const { DOCK_VISIBILITY_STORAGE_KEY, dockVisibility, toggleDockButtonVisible } = await import("../src/ui/dockVisibility.svelte");

    expect(dockVisibility).toEqual({ undoLog: false, tasks: true, trash: false, objects: false });
    toggleDockButtonVisible("trash");
    expect(JSON.parse(storage.getItem(DOCK_VISIBILITY_STORAGE_KEY) ?? "{}")).toEqual({
      undoLog: false,
      tasks: true,
      trash: true,
      objects: false,
    });
  });

  it("closes a dock panel when its button is hidden", async () => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.resetModules();

    const { setDockButtonVisible } = await import("../src/ui/dockVisibility.svelte");
    const { tasksPanel } = await import("../src/tasks/tasksPanelState.svelte");
    tasksPanel.open = true;

    setDockButtonVisible("tasks", true);
    setDockButtonVisible("tasks", false);

    expect(tasksPanel.open).toBe(false);
  });
});
