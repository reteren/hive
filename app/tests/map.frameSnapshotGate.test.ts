import { describe, expect, it } from "vitest";
import { FrameSnapshotGate } from "../src/map/frameSnapshotGate";

describe("FrameSnapshotGate", () => {
  it("coalesces invalidations and permits at most one rebuild per frame", () => {
    const gate = new FrameSnapshotGate();
    expect(gate.claimBuild()).toBe(true);
    expect(gate.claimBuild()).toBe(false);

    gate.invalidate();
    expect(gate.claimBuild()).toBe(false);
    gate.beginFrame();
    expect(gate.claimBuild()).toBe(true);
    gate.invalidate();
    expect(gate.claimBuild()).toBe(false);
    gate.beginFrame();
    expect(gate.claimBuild()).toBe(true);
  });

  it("keeps a failed snapshot dirty for the next frame", () => {
    const gate = new FrameSnapshotGate();
    expect(gate.claimBuild()).toBe(true);
    gate.buildFailed();
    expect(gate.claimBuild()).toBe(false);
    gate.beginFrame();
    expect(gate.claimBuild()).toBe(true);
  });
});
