import { describe, expect, it } from "vitest";
import { VIDEO_VOLUME_POPOVER } from "../src/video/volumePopover";

describe("video volume popover sizing", () => {
  it("keeps the volume control compact beside the media button", () => {
    expect(VIDEO_VOLUME_POPOVER).toEqual({ width: 32, height: 90 });
  });
});
