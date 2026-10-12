import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import { EnabledTimeIndex } from "../src/time/scheduleIndex";

function note(id: string, enabled: boolean): Note {
  return {
    id, type: "time", name: id, text: "", x: 0, y: 0, width: 30, height: null,
    time: { schedule: { kind: "at", date: null, time: "09:00" }, enabled },
  };
}

describe("EnabledTimeIndex", () => {
  it("tracks enabled Time data incrementally and replaces on board open", () => {
    const index = new EnabledTimeIndex();
    const notes = { enabled: note("enabled", true), disabled: note("disabled", false) };
    index.replace(["enabled", "disabled"], notes);
    expect([...index.values()]).toEqual(["enabled"]);

    index.update("enabled", note("enabled", false));
    index.update("disabled", note("disabled", true));
    expect([...index.values()]).toEqual(["disabled"]);

    index.replace(["enabled"], { enabled: note("enabled", true) });
    expect([...index.values()]).toEqual(["enabled"]);
  });
});
