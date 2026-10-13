import { describe, expect, it } from "vitest";
import { meaningfulReleaseNotes } from "../src/updater/updater.svelte";

describe("update banner notes", () => {
  it("hides notes that only repeat the version", () => {
    expect(meaningfulReleaseNotes("hive 1.9.3", "1.9.3")).toBe("");
    expect(meaningfulReleaseNotes("  v1.9.3 ", "1.9.3")).toBe("");
    expect(meaningfulReleaseNotes(undefined, "1.9.3")).toBe("");
  });

  it("keeps real release notes", () => {
    expect(meaningfulReleaseNotes("New Q menu with categories", "1.9.4")).toBe("New Q menu with categories");
  });
});
