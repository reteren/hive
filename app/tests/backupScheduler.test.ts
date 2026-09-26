import { describe, expect, it } from "vitest";
import { shouldCreateScheduledBackup } from "../src/backup/scheduler";

describe("automatic backup change detection", () => {
  it("takes a periodic snapshot only for supported intervals and changed project contents", () => {
    const changed = { fingerprint: "current", lastSnapshotFingerprint: "previous" };
    const unchanged = { fingerprint: "same", lastSnapshotFingerprint: "same" };

    expect(shouldCreateScheduledBackup(30, changed)).toBe(true);
    expect(shouldCreateScheduledBackup(15, unchanged)).toBe(false);
    expect(shouldCreateScheduledBackup(0, changed)).toBe(false);
    expect(shouldCreateScheduledBackup(20, changed)).toBe(false);
  });

  it("creates a scheduled snapshot when no previous snapshot exists", () => {
    expect(shouldCreateScheduledBackup(60, { fingerprint: "first", lastSnapshotFingerprint: null })).toBe(true);
  });
});
