import { describe, expect, it } from "vitest";
import type { Link } from "../src/model/link";
import type { Note } from "../src/model/note";
import {
  acceptedSourcesToDeactivate,
  classifyTransfer,
  needsTransferConfirmation,
  selectActiveTransfers,
  stabilizeActiveTransfers,
} from "../src/transfer/logic";

function makeNote(id: string, options: Partial<Note> = {}): Note {
  return {
    id,
    type: "note",
    name: id.toUpperCase(),
    text: "",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...options,
  };
}

function makeLink(id: string, from: string, to: string, kind: Link["kind"] = "strong", extra: Partial<Link> = {}): Link {
  return { id, from, to, kind, shape: "straight", ...extra };
}

describe("Text → Task transfer rules", () => {
  it("applies only to strong non-task-to-task links", () => {
    const ordinary = makeNote("ordinary");
    const plus = makeNote("plus", { type: "pro" });
    const minus = makeNote("minus", { type: "con" });
    const module = makeNote("module", { type: "importance" });
    const task = makeNote("task", { task: { done: false, doneAt: null } });
    const otherTask = makeNote("otherTask", { task: { done: true, doneAt: 123 } });
    const notes = { ordinary, plus, minus, module, task, otherTask };

    expect(classifyTransfer(makeLink("strong", ordinary.id, task.id), notes)).toBe("transfer");
    expect(classifyTransfer(makeLink("plus", plus.id, task.id), notes)).toBe("transfer");
    expect(classifyTransfer(makeLink("minus", minus.id, task.id), notes)).toBe("transfer");
    expect(classifyTransfer(makeLink("weak", ordinary.id, task.id, "weak"), notes)).toBe("weak");
    expect(classifyTransfer(makeLink("dependency", task.id, otherTask.id), notes)).toBe("dependency");
    expect(classifyTransfer(makeLink("ordinary-pair", ordinary.id, plus.id), notes)).toBe("none");
    expect(classifyTransfer(makeLink("task-to-note", task.id, ordinary.id), notes)).toBe("none");
    expect(classifyTransfer(makeLink("module-source", module.id, task.id), notes)).toBe("none");
    expect(classifyTransfer(makeLink("module-target", ordinary.id, module.id), notes)).toBe("none");
    expect(classifyTransfer(makeLink("missing", "gone", task.id), notes)).toBe("missing-endpoint");
  });

  it("asks before replacing non-empty task text until the link has a stored choice", () => {
    const task = makeNote("task", { task: { done: false, doneAt: null }, text: "my draft" });
    const unchosen = makeLink("unchosen", "source", task.id);

    expect(needsTransferConfirmation(unchosen, task)).toBe(true);
    expect(needsTransferConfirmation({ ...unchosen, transferDeclined: false }, task)).toBe(false);
    expect(needsTransferConfirmation({ ...unchosen, transferDeclined: true }, task)).toBe(false);
    expect(needsTransferConfirmation(unchosen, { ...task, text: "" })).toBe(false);
  });

  it("lets the latest accepted source win and restores the prior one when the winner is declined", () => {
    const task = makeNote("task", { task: { done: false, doneAt: null }, text: "existing" });
    const notes = { a: makeNote("a"), b: makeNote("b"), task };
    const first = makeLink("first", "a", task.id, "strong", { transferDeclined: false });
    const second = makeLink("second", "b", task.id, "strong", { transferDeclined: false });

    const selected = selectActiveTransfers([first, second], notes);
    expect(selected.activeByTarget.get(task.id)?.id).toBe(second.id);
    expect(selected.states.map(({ link, status }) => [link.id, status])).toEqual([
      [first.id, "inactive-superseded"],
      [second.id, "active"],
    ]);

    const afterKeep = selectActiveTransfers([{ ...second, transferDeclined: true }, first], notes);
    expect(afterKeep.activeByTarget.get(task.id)?.id).toBe(first.id);
    expect(afterKeep.states.find((state) => state.link.id === second.id)?.status).toBe("declined");
  });

  it("requires a choice for a second source even when its task is empty", () => {
    const task = makeNote("task", { task: { done: false, doneAt: null } });
    const notes = { a: makeNote("a"), b: makeNote("b"), task };
    const first = makeLink("first", "a", task.id, "strong", { transferDeclined: false });
    const second = makeLink("second", "b", task.id);

    const selected = selectActiveTransfers([first, second], notes);
    expect(selected.activeByTarget.get(task.id)?.id).toBe(first.id);
    expect(selected.states.find((state) => state.link.id === second.id)?.status).toBe("awaiting-confirmation");
    expect(needsTransferConfirmation(second, task, true)).toBe(true);
  });

  it("deactivates older accepted sources so unlinking the selected one cannot revive them", () => {
    const task = makeNote("task", { task: { done: false, doneAt: null }, text: "from C" });
    const notes = { a: makeNote("a", { text: "from A" }), c: makeNote("c", { text: "from C" }), task };
    const first = makeLink("first", "a", task.id, "strong", { transferDeclined: false });
    const second = makeLink("second", "c", task.id, "strong", { transferDeclined: false });

    expect(acceptedSourcesToDeactivate(second, [first, second], notes)).toEqual([first]);

    const selected = selectActiveTransfers([first, second], notes);
    const stabilizedSelection = stabilizeActiveTransfers(selected, [first, second], notes, new Map());
    expect(stabilizedSelection.activeByTarget.get(task.id)?.id).toBe(second.id);
    expect(stabilizedSelection.linksToDeactivate.map(({ id }) => id)).toEqual([first.id]);

    const afterSelection = selectActiveTransfers([
      { ...first, transferDeclined: true },
      second,
    ], notes);
    expect(afterSelection.activeByTarget.get(task.id)?.id).toBe(second.id);

    const linksAfterUnlink = [
      { ...first, transferDeclined: true },
    ];
    const afterUnlink = stabilizeActiveTransfers(
      selectActiveTransfers(linksAfterUnlink, notes),
      linksAfterUnlink,
      notes,
      new Map([[task.id, second.id]]),
    );
    expect(afterUnlink.activeByTarget.size).toBe(0);
    expect(afterUnlink.linksToDeactivate).toEqual([]);
    expect(task.text).toBe("from C");

    const linksAfterUndo = [{ ...first, transferDeclined: true }, second];
    const afterUndo = stabilizeActiveTransfers(
      selectActiveTransfers(linksAfterUndo, notes),
      linksAfterUndo,
      notes,
      new Map([[task.id, second.id]]),
    );
    expect(afterUndo.activeByTarget.get(task.id)?.id).toBe(second.id);
  });
});
