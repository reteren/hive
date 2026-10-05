import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../src/model/note";
import type { ContentOptions } from "../src/mcp/content/readers";

const { getDocument, imagePayloadFromSource, attachmentUrl, convertFileSrc } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  imagePayloadFromSource: vi.fn(),
  attachmentUrl: vi.fn((file: string) => `asset://project/${file}`),
  convertFileSrc: vi.fn((path: string) => `asset://external/${path}`),
}));

vi.mock("../src/formats/pdfjsClient", () => ({ pdfjs: { getDocument } }));
vi.mock("../src/mcp/content/imagePayload", () => ({ imagePayloadFromSource }));
vi.mock("../src/attachments/service", () => ({ attachmentUrl }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc }));

import "../src/mcp/content/media";
import { contentReaderFor } from "../src/mcp/content/readers";

const options: ContentOptions = {
  maxImagePx: 512,
  pdfPages: { from: 2, to: 3 },
  maxTextChars: 200_000,
};

function note(type: Note["type"], patch: Partial<Note> = {}): Note {
  return {
    id: "media-node",
    type,
    name: "Media node",
    text: "",
    x: 0,
    y: 0,
    width: 48,
    height: null,
    ...patch,
  };
}

async function read(type: Note["type"], value: Note, config = options): Promise<Record<string, unknown>> {
  const reader = contentReaderFor(type);
  if (!reader) throw new Error(`No content reader registered for ${type}`);
  return reader(value, config);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP media content readers", () => {
  it("extracts PDF text only from the requested 1-based page range", async () => {
    const getPage = vi.fn(async (page: number) => ({
      getTextContent: vi.fn(async () => ({
        items: [
          { str: `Page ${page}`, hasEOL: false },
          { str: "text", hasEOL: true },
        ],
      })),
    }));
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 4, getPage }),
      destroy,
    });

    const result = await read("pdf", note("pdf", {
      media: { file: "report.pdf", mime: "application/pdf", size: 800, kind: "pdf", name: "Report" },
    }));

    expect(result).toMatchObject({
      file: { name: "Report", mime: "application/pdf", size: 800 },
      pageCount: 4,
      pages: [
        { page: 2, text: "Page 2 text" },
        { page: 3, text: "Page 3 text" },
      ],
      truncated: true,
    });
    expect(getPage.mock.calls.map(([page]) => page)).toEqual([2, 3]);
    expect(getDocument).toHaveBeenCalledWith({ url: "asset://project/report.pdf" });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("returns stored audio metadata and dictaphone recording durations", async () => {
    const result = await read("audio", note("audio", {
      media: { file: "interview.mp3", mime: "audio/mpeg", size: 900, kind: "audio", duration: 42.5 },
      recordings: [{
        id: "rec-1",
        name: "Opening",
        media: { file: "opening.webm", mime: "audio/webm", size: 300, kind: "audio", duration: 6.25 },
      }],
    }));

    expect(result).toEqual({
      file: { name: "interview.mp3", mime: "audio/mpeg", size: 900 },
      duration: 42.5,
      recordings: [{
        id: "rec-1",
        name: "Opening",
        file: { name: "opening.webm", mime: "audio/webm", size: 300 },
        duration: 6.25,
      }],
    });
    expect(fetch).toHaveBeenCalledWith("asset://project/interview.mp3", expect.objectContaining({ method: "HEAD" }));
  });

  it("marks missing external media and preserves its absolute path", async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 404, ok: false } as Response);
    const result = await read("video", note("video", {
      media: {
        file: "large-video.mp4",
        mime: "video/mp4",
        size: 4_000_000_000,
        kind: "video",
        externalPath: "C:/Media/large-video.mp4",
        duration: 75,
        naturalWidth: 1920,
        naturalHeight: 1080,
      },
    }));

    expect(result).toEqual({
      file: { name: "large-video.mp4", mime: "video/mp4", size: 4_000_000_000 },
      externalPath: "C:/Media/large-video.mp4",
      missing: true,
      duration: 75,
      naturalWidth: 1920,
      naturalHeight: 1080,
    });
    expect(convertFileSrc).toHaveBeenCalledWith("C:/Media/large-video.mp4");
  });

  it("captures a scaled video poster near ten percent of the duration", async () => {
    const videoElement = {
      duration: 100,
      videoWidth: 1920,
      videoHeight: 1080,
      onloadedmetadata: null as null | (() => void),
      onseeked: null as null | (() => void),
      onerror: null as null | (() => void),
      src: "",
      currentTime: 0,
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    };
    Object.defineProperty(videoElement, "src", {
      set: () => queueMicrotask(() => videoElement.onloadedmetadata?.()),
    });
    Object.defineProperty(videoElement, "currentTime", {
      set: (value: number) => {
        expect(value).toBe(10);
        queueMicrotask(() => videoElement.onseeked?.());
      },
    });
    const video = videoElement as unknown as HTMLVideoElement;
    vi.stubGlobal("document", {
      createElement: () => video,
    });
    imagePayloadFromSource.mockImplementation(async (_source, file, originalWidth, originalHeight, maxPx) => {
      const scale = Math.min(1, maxPx / Math.max(originalWidth, originalHeight));
      return {
        file,
        mime: "image/jpeg",
        data: "poster-base64",
        width: Math.round(originalWidth * scale),
        height: Math.round(originalHeight * scale),
        originalWidth,
        originalHeight,
      };
    });

    const result = await read("video", note("video", {
      media: { file: "clip.mp4", mime: "video/mp4", size: 1000, kind: "video" },
    }));

    expect(result).toMatchObject({
      duration: 100,
      naturalWidth: 1920,
      naturalHeight: 1080,
      poster: {
        file: "clip.mp4",
        mime: "image/jpeg",
        data: "poster-base64",
        width: 512,
        height: 288,
        originalWidth: 1920,
        originalHeight: 1080,
      },
    });
    expect(imagePayloadFromSource).toHaveBeenCalledWith(video, "clip.mp4", 1920, 1080, 512);
  });

  it("returns the stored YouTube reference without fetching or changing it", async () => {
    const youtube = {
      videoId: "abcdefghijk",
      url: "https://youtu.be/abcdefghijk?t=15",
      title: "Stored title",
      author: "Author",
      start: 15,
      loop: true as const,
    };
    const result = await read("youtube", note("youtube", { youtube }));

    expect(result).toEqual({ youtube });
    expect(fetch).not.toHaveBeenCalled();
  });
});
