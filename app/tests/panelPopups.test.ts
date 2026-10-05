import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
});

describe("panel popups", () => {
  it("keeps only one panel popup open and the same toggle closes it", async () => {
    vi.resetModules();
    const { panelPopupState, togglePanelPopup } = await import("../src/ui/popups/panelPopupState.svelte");

    togglePanelPopup("tasks");
    expect(panelPopupState.active).toBe("tasks");

    togglePanelPopup("objects");
    expect(panelPopupState.active).toBe("objects");

    togglePanelPopup("objects");
    expect(panelPopupState.active).toBe(null);
  });

  it("closes Search and Command Search before opening a panel popup", async () => {
    vi.resetModules();
    const { searchState } = await import("../src/search/search.svelte");
    const { commandSearchState } = await import("../src/commands/commandSearch.svelte");
    const { panelPopupState, togglePanelPopup } = await import("../src/ui/popups/panelPopupState.svelte");
    searchState.open = true;
    commandSearchState.open = true;

    togglePanelPopup("undo-log");

    expect(searchState.open).toBe(false);
    expect(commandSearchState.open).toBe(false);
    expect(panelPopupState.active).toBe("undo-log");
  });
});
