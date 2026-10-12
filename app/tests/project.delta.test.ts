import { describe, expect, it } from "vitest";
import { DeltaMutationJournal, materializeCollectionDelta, materializeKeyedCollectionDelta, taskLogRecordId } from "../src/project/delta";

describe("project delta journals", () => {
  it("materializes only changed ids and keeps the capture safe across a later mutation", () => {
    const journal = new DeltaMutationJournal<{ value: number }>();
    journal.markUpsert("changed", undefined, 4);
    journal.markDelete("removed");
    const capture = journal.capture();
    const delta = materializeCollectionDelta(capture, (id) => id === "changed" ? { value: 2 } : undefined);

    expect(delta).toEqual({
      upserts: [{ id: "changed", order: 4, record: { value: 2 } }],
      deleteIds: ["removed"],
    });

    journal.markUpsert("changed", { value: 3 });
    journal.acknowledge(capture);
    expect(journal.pendingIds()).toEqual(["changed"]);
  });

  it("expands a full replacement against current and saved ids", () => {
    const journal = new DeltaMutationJournal<{ value: number }>();
    journal.markAll();
    const capture = journal.capture(["kept", "added"], ["kept", "deleted"]);
    const delta = materializeCollectionDelta(capture, (id) => id === "deleted" ? undefined : { value: id === "kept" ? 1 : 2 });
    expect(delta.upserts).toEqual([
      { id: "kept", record: { value: 1 } },
      { id: "added", record: { value: 2 } },
    ]);
    expect(delta.deleteIds).toEqual(["deleted"]);
    journal.acknowledge(capture);
    expect(journal.hasChanges()).toBe(false);
  });

  it("materializes keyed records and uses note plus completion time for task log identity", () => {
    const journal = new DeltaMutationJournal<{ total: number }>();
    journal.markUpsert("groceries", undefined);
    journal.markDelete("old-bank");
    expect(materializeKeyedCollectionDelta(journal.capture(), (id) => id === "groceries" ? { total: 5 } : undefined)).toEqual({
      upserts: [{ id: "groceries", record: { total: 5 } }],
      deleteIds: ["old-bank"],
    });
    expect(taskLogRecordId({ noteId: "n1", doneAt: 42 })).toBe(JSON.stringify(["n1", 42]));
  });
});
