import { describe, expect, it } from "vitest";
import { decideExternalNoteChange } from "../src/project/externalChanges";

describe("external note change decisions", () => {
  it("does not reload when disk already matches the note", () => {
    expect(decideExternalNoteChange({
      externalText: "same",
      localText: "same",
      savedText: "same",
      isEditing: true,
    })).toBe("unchanged");
  });

  it("reloads an externally changed clean note", () => {
    expect(decideExternalNoteChange({
      externalText: "external",
      localText: "saved",
      savedText: "saved",
      isEditing: false,
    })).toBe("reload");
  });

  it("keeps both versions when the note is being edited", () => {
    expect(decideExternalNoteChange({
      externalText: "external",
      localText: "saved",
      savedText: "saved",
      isEditing: true,
    })).toBe("conflict");
  });

  it("keeps both versions when the note has unsaved local text", () => {
    expect(decideExternalNoteChange({
      externalText: "external",
      localText: "local edit",
      savedText: "saved",
      isEditing: false,
    })).toBe("conflict");
  });

  it("keeps both versions when there is no saved local baseline", () => {
    expect(decideExternalNoteChange({
      externalText: "external",
      localText: "local",
      savedText: undefined,
      isEditing: false,
    })).toBe("conflict");
  });
});
