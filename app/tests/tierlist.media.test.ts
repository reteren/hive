import { describe, expect, it } from "vitest";
import type { Note } from "../src/model/note";
import tierlistBodySource from "../src/tierlist/TierlistBody.svelte?raw";
import videoPreviewSource from "../src/tierlist/videoPreview.ts?raw";
import { isTierlistAudioPlayTarget, tierCardPreview } from "../src/tierlist/logic";
import { videoFrameSeekTime, videoFrameTimeoutFallbackTime } from "../src/tierlist/videoPreview";

function mediaNode(overrides: Partial<Note>): Note {
  return {
    id: "source",
    type: "note",
    name: "Source",
    text: "A note caption",
    x: 0,
    y: 0,
    width: 30,
    height: null,
    ...overrides,
  };
}

describe("Tierlist media previews", () => {
  const card = { id: "linked", kind: "note" as const, noteId: "source" };

  it("uses a mid-frame video preview for a linked video node", () => {
    const video = mediaNode({
      type: "video",
      media: {
        file: `${"a".repeat(64)}.mp4`,
        mime: "video/mp4",
        size: 2048,
        kind: "video",
        duration: 120,
        naturalWidth: 1920,
        naturalHeight: 1080,
      },
    });

    expect(tierCardPreview(card, { source: video })).toMatchObject({
      kind: "video",
      file: video.media?.file,
      duration: 120,
      naturalWidth: 1920,
      naturalHeight: 1080,
      name: "Source",
      lines: ["A note caption"],
    });
  });

  it("uses a playable audio preview for a linked audio node", () => {
    const audio = mediaNode({
      type: "audio",
      media: {
        file: `${"b".repeat(64)}.webm`,
        mime: "audio/webm",
        size: 2048,
        kind: "audio",
      },
    });

    expect(tierCardPreview(card, { source: audio })).toMatchObject({
      kind: "audio",
      file: audio.media?.file,
      name: "Source",
      lines: ["A note caption"],
    });
  });

  it("uses the hqdefault thumbnail and title for a linked YouTube node", () => {
    const youtube = mediaNode({
      type: "youtube",
      youtube: {
        videoId: "dQw4w9WgXcQ",
        url: "https://youtu.be/dQw4w9WgXcQ",
        title: "Video title",
      },
    });

    expect(tierCardPreview(card, { source: youtube })).toEqual({
      kind: "youtube",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      name: "Video title",
      lines: ["A note caption"],
    });
  });

  it("keeps the existing missing-target preview and handles unavailable media metadata", () => {
    expect(tierCardPreview(card, {})).toEqual({ kind: "note", name: "content missing", lines: [], missing: true });
    expect(videoFrameSeekTime(120)).toBe(60);
    expect(videoFrameSeekTime(1.5)).toBe(0.75);
    expect(videoFrameSeekTime(0)).toBe(0);
    expect(videoFrameSeekTime(Number.NaN)).toBe(1);
    expect(videoFrameSeekTime(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("routes playback-button pointer input away from card dragging", () => {
    const playTarget = { closest: (selector: string) => selector === "[data-tier-audio-play]" ? {} : null };
    const cardTarget = { closest: () => null };
    expect(isTierlistAudioPlayTarget(playTarget)).toBe(true);
    expect(isTierlistAudioPlayTarget(cardTarget)).toBe(false);
    expect(tierlistBodySource).toContain("data-tier-audio-play");
    expect(tierlistBodySource).toContain("onpointerdown={(event) => event.stopPropagation()}");
    expect(tierlistBodySource).toContain("onclick={(event) => {");
  });

  it("falls back to a first-frame seek if the middle-frame capture times out", () => {
    expect(videoFrameTimeoutFallbackTime()).toBe(0.1);
    expect(videoPreviewSource).toContain("window.setTimeout(requestFirstFrame, TIERLIST_VIDEO_FRAME_TIMEOUT_MS)");
    expect(videoPreviewSource).toContain("video.currentTime = videoFrameTimeoutFallbackTime()");
    expect(videoPreviewSource).not.toContain("toDataURL");
  });
});
