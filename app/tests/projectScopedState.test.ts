import { afterEach, describe, expect, it } from "vitest";
import { resetProjectScopedState } from "../src/project/persistence.svelte";
import { lineInteraction } from "../src/links/interaction.svelte";
import { selectedLink } from "../src/links/selection.svelte";
import { tool } from "../src/tools/tool.svelte";
import { clearNavigationHistory, canNavigateBack, canNavigateForward, pushNavigation } from "../src/navigation/navigationHistory.svelte";
import { objectsPanel } from "../src/navigation/panelState.svelte";
import { searchState } from "../src/search/search.svelte";
import { tasksPanel } from "../src/tasks/tasksPanelState.svelte";
import { modulePicker } from "../src/modules/pickerState.svelte";
import { moduleDropPreview } from "../src/modules/moduleActions.svelte";
import { transferUi } from "../src/transfer/sync.svelte";

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
    tasksPanel.open = true;
    tasksPanel.historyOpen = true;
    modulePicker.noteId = "old-project-note";
    modulePicker.kind = "importance";
    moduleDropPreview.moduleId = "old-project-module";
    moduleDropPreview.targetId = "old-project-note";
    moduleDropPreview.allowed = true;
    moduleDropPreview.reason = null;
    transferUi.prompts = [{
      linkId: "old-project-link",
      sourceId: "old-project-source",
      targetId: "old-project-note",
      sourceName: "Old source",
      targetName: "Old task",
    }];
    transferUi.warnings = [{
      id: "old-project-note",
      targetId: "old-project-note",
      message: "Old transfer warning",
    }];
    transferUi.inactive = [{
      id: "old-project-link",
      targetId: "old-project-note",
      message: "Old inactive transfer",
    }];

    resetProjectScopedState();

    expect(tool.active).toBe("select");
    expect(lineInteraction.sourceId).toBeNull();
    expect(lineInteraction.preview).toBeNull();
    expect(selectedLink.id).toBeNull();
    expect(canNavigateBack()).toBe(false);
    expect(canNavigateForward()).toBe(false);
    expect(searchState).toMatchObject({ open: false, query: "", results: [], currentIndex: 0 });
    expect(objectsPanel).toMatchObject({ open: true, pinned: false, query: "", pinnedSearchIds: null });
    expect(tasksPanel).toMatchObject({ open: false, historyOpen: false });
    expect(modulePicker).toMatchObject({ noteId: null, kind: null });
    expect(moduleDropPreview).toMatchObject({ moduleId: null, targetId: null, allowed: false, reason: null });
    expect(transferUi.prompts).toEqual([]);
    expect(transferUi.warnings).toEqual([]);
    expect(transferUi.inactive).toEqual([]);
  });
});
