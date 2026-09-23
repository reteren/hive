import { afterEach, describe, expect, it } from "vitest";
import { resetProjectScopedState } from "../src/project/persistence.svelte";
import { lineInteraction } from "../src/links/interaction.svelte";
import { selectedLink } from "../src/links/selection.svelte";
import { tool } from "../src/tools/tool.svelte";
import { clearNavigationHistory, canNavigateBack, canNavigateForward, pushNavigation } from "../src/navigation/navigationHistory.svelte";
import { objectsPanel } from "../src/navigation/panelState.svelte";
import { searchState } from "../src/search/search.svelte";

describe("project-scoped state reset", () => {
  afterEach(() => {
    resetProjectScopedState();
    objectsPanel.open = false;
  });

  it("clears stale ids and searches while preserving the Objects panel visibility", () => {
    tool.active = "line-strong";
    lineInteraction.sourceId = "old-project-note";
    lineInteraction.preview = { x: 8, y: 12 };
    selectedLink.id = "old-project-link";
    pushNavigation({ x: 0, y: 0, zoom: 1 }, { x: 20, y: 30, zoom: 1.2 });
    searchState.open = true;
    searchState.query = "old project";
    searchState.results = [{
      noteId: "old-project-note",
      noteName: "Old project note",
      kind: "name",
      snippet: "Old project note",
      matchStart: 0,
      matchEnd: 3,
    }];
    searchState.currentIndex = 0;
    objectsPanel.open = true;
    objectsPanel.pinned = true;
    objectsPanel.query = "old project";
    objectsPanel.pinnedSearchIds = ["old-project-note"];

    resetProjectScopedState();

    expect(tool.active).toBe("select");
    expect(lineInteraction.sourceId).toBeNull();
    expect(lineInteraction.preview).toBeNull();
    expect(selectedLink.id).toBeNull();
    expect(canNavigateBack()).toBe(false);
    expect(canNavigateForward()).toBe(false);
    expect(searchState).toMatchObject({ open: false, query: "", results: [], currentIndex: 0 });
    expect(objectsPanel).toMatchObject({ open: true, pinned: false, query: "", pinnedSearchIds: null });
  });
});

