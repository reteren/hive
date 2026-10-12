import { describe, expect, it } from "vitest";
import { replaceBoard, updateNote } from "../src/model/board.svelte";
import { addLink, removeLink, replaceLinks } from "../src/model/links.svelte";
import type { Note } from "../src/model/note";
import { RevisionCache } from "../src/scope/revisionCache";
import { reactiveLinkRevisionFor, scopeSummaryRevision } from "../src/scope/scopeRevision.svelte";

function taskNote(): Note {
  return {
    id: "task", type: "note", name: "Task", text: "Words here", x: 0, y: 0, width: 30, height: null,
    task: { done: false, doneAt: null },
  };
}

describe("RevisionCache", () => {
  it("reuses one scope value until its semantic revision changes", () => {
    const cache = new RevisionCache<{ count: number }>();
    let calculations = 0;
    const calculate = () => ({ count: ++calculations });

    const first = cache.get("board", "r1", calculate);
    expect(cache.get("board", "r1", calculate)).toBe(first);
    expect(calculations).toBe(1);

    const next = cache.get("board", "r2", calculate);
    expect(next).not.toBe(first);
    expect(next.count).toBe(2);
  });
});

describe("scoped summary revisions", () => {
  it("ignores position-only changes and advances for task and text inputs", () => {
    const note = taskNote();
    replaceBoard([note]);
    const scope = { kind: "board" } as const;
    const beforeProgress = scopeSummaryRevision(scope, "progress");
    const beforeText = scopeSummaryRevision(scope, "text");

    updateNote("task", { x: 80, y: 40 });
    expect(scopeSummaryRevision(scope, "progress")).toBe(beforeProgress);
    expect(scopeSummaryRevision(scope, "text")).toBe(beforeText);

    updateNote("task", { task: { done: true, doneAt: 10 } });
    expect(scopeSummaryRevision(scope, "progress")).not.toBe(beforeProgress);
    const afterTask = scopeSummaryRevision(scope, "text");
    updateNote("task", { text: "Changed" });
    expect(scopeSummaryRevision(scope, "text")).not.toBe(afterTask);
    replaceBoard([]);
  });

  it("advances task-summary and per-note link revisions when module links change", () => {
    const task = taskNote();
    const module: Note = {
      id: "importance", type: "importance", name: "Importance", text: "", x: 0, y: 0, width: 14, height: 4,
      importance: "absolute",
    };
    replaceBoard([task, module]);
    replaceLinks([]);
    const scope = { kind: "board" } as const;
    const beforeProgress = scopeSummaryRevision(scope, "progress");
    const beforeNoteLinks = reactiveLinkRevisionFor("task");
    addLink({ id: "task-importance", from: "importance", to: "task", kind: "strong", shape: "base" });
    expect(scopeSummaryRevision(scope, "progress")).not.toBe(beforeProgress);
    expect(reactiveLinkRevisionFor("task")).not.toBe(beforeNoteLinks);
    removeLink("task-importance");
    replaceLinks([]);
  });

  it("does not invalidate a beacon summary when a member only changes zones", () => {
    const beacon: Note = { id: "beacon", type: "beacon", name: "Beacon", text: "", x: 0, y: 0, width: 7, height: 7 };
    replaceBoard([beacon, taskNote()]);
    replaceLinks([{ id: "scope", from: "beacon", to: "task", kind: "strong", shape: "base" }]);
    const scope = { kind: "beacon", id: "beacon" } as const;
    const before = scopeSummaryRevision(scope, "progress");
    updateNote("task", { zoneId: "zone-a" });
    expect(scopeSummaryRevision(scope, "progress")).toBe(before);
    replaceLinks([]);
  });
});
