import { describe, expect, it } from "vitest";
import {
  parseYouTubeRef,
  parseYouTubePlayerMessage,
  parseYouTubeUrl,
  youtubeEmbedErrorReason,
  youtubeEmbedUrl,
  youtubeOEmbedUrl,
  youtubePlayerCommand,
  youtubeThumbnailUrl,
} from "../src/youtube/logic";

describe("YouTube URL parsing", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abcdefghijk", "abcdefghijk", undefined],
    ["https://youtu.be/abcdefghijk?si=share", "abcdefghijk", undefined],
    ["https://youtube.com/shorts/abcdefghijk", "abcdefghijk", undefined],
    ["https://www.youtube.com/embed/abcdefghijk", "abcdefghijk", undefined],
    ["https://youtube.com/watch?v=abcdefghijk&t=1m30s", "abcdefghijk", 90],
    ["https://youtu.be/abcdefghijk?start=90", "abcdefghijk", 90],
    ["https://youtube.com/watch?v=abcdefghijk#t=1:30", "abcdefghijk", 90],
  ])("parses %s", (url, videoId, start) => {
    expect(parseYouTubeUrl(url)).toEqual({
      kind: "youtube",
      ref: { videoId, url, ...(start === undefined ? {} : { start }) },
    });
  });

  it("explains malformed supported-host URLs and leaves other text untouched", () => {
    expect(parseYouTubeUrl("https://youtube.com/watch?v=bad").kind).toBe("invalid");
    expect(parseYouTubeUrl("https://youtu.be/abcdefghijk?t=not-a-time")).toEqual({
      kind: "invalid",
      error: "The YouTube start time is invalid.",
    });
    expect(parseYouTubeUrl("https://youtube.com.evil/watch?v=abcdefghijk")).toEqual({ kind: "other" });
    expect(parseYouTubeUrl("ordinary pasted text")).toEqual({ kind: "other" });
  });
});

describe("YouTube embeds and persisted data", () => {
  it("constructs privacy-enhanced URLs with autoplay, origin and start time", () => {
    expect(youtubeEmbedUrl({ videoId: "abcdefghijk", start: 90 }, "tauri://localhost"))
      .toBe("https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1&controls=0&enablejsapi=1&start=90&origin=tauri%3A%2F%2Flocalhost");
    expect(new URL(youtubeEmbedUrl({ videoId: "abcdefghijk" }, "", true)).searchParams.get("controls")).toBe("1");
    expect(youtubeThumbnailUrl("abcdefghijk")).toBe("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
    expect(new URL(youtubeOEmbedUrl("https://youtu.be/abcdefghijk")).searchParams.get("format")).toBe("json");
  });

  it("validates persisted URLs and maps player errors to explanations", () => {
    expect(parseYouTubeRef({ videoId: "abcdefghijk", url: "https://youtu.be/abcdefghijk", title: "Title" }))
      .toEqual({ videoId: "abcdefghijk", url: "https://youtu.be/abcdefghijk", title: "Title" });
    expect(parseYouTubeRef({ videoId: "lmnopqrstuv", url: "https://youtu.be/abcdefghijk" })).toBeUndefined();
    expect(youtubeEmbedErrorReason(101)).toBe("The video owner does not allow playback on other websites.");
    expect(youtubeEmbedErrorReason(150)).toBe("The video owner does not allow playback on other websites.");
    expect(youtubeEmbedErrorReason(153)).toBe("YouTube could not identify this app.");
    expect(youtubeEmbedErrorReason(222)).toBe("YouTube player error 222.");
    expect(youtubeEmbedErrorReason("nope")).toBeNull();
  });

  it("parses player postMessage responses and explains embed errors", () => {
    expect(parseYouTubePlayerMessage(JSON.stringify({ event: "onStateChange", info: 1 })))
      .toEqual({ kind: "response", playerState: 1 });
    expect(parseYouTubePlayerMessage({ event: "infoDelivery", info: { currentTime: 12 } }))
      .toEqual({ kind: "response", currentTime: 12 });
    expect(parseYouTubePlayerMessage({ event: "onError", info: 153 }))
      .toEqual({ kind: "error", reason: "YouTube could not identify this app." });
    expect(parseYouTubePlayerMessage({ event: "onError", info: 101 }))
      .toEqual({ kind: "error", reason: "The video owner does not allow playback on other websites." });
    expect(parseYouTubePlayerMessage("not json")).toBeNull();
    expect(parseYouTubePlayerMessage({ event: "unrelated" })).toBeNull();
  });

  it("parses playback snapshots and encodes iframe commands", () => {
    expect(parseYouTubePlayerMessage({ event: "infoDelivery", info: { currentTime: 12.5, duration: 100, volume: 120, muted: false, playerState: 1 } }))
      .toEqual({ kind: "response", currentTime: 12.5, duration: 100, volume: 100, muted: false, playerState: 1 });
    expect(youtubePlayerCommand("seekTo", [42, true])).toBe('{"event":"command","func":"seekTo","args":[42,true]}');
    expect(youtubePlayerCommand("playVideo")).toBe('{"event":"command","func":"playVideo","args":[]}');
  });
});
