import { describe, expect, it } from "vitest";
import { extractUrls, urlInfo, youtubeVideoId } from "../src/mcp/content/urls";

describe("MCP content URL extraction", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ?si=share", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=17", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/embed/dQw4w9WgXcQ?list=RD", "dQw4w9WgXcQ"],
    ["http://www.youtube.com/live/dQw4w9WgXcQ?si=1", "dQw4w9WgXcQ"],
  ])("recognizes YouTube form %s", (url, id) => {
    expect(youtubeVideoId(url)).toBe(id);
    expect(urlInfo(url)).toEqual({ url, kind: "youtube", videoId: id });
  });

  it.each([
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.test/shorts/dQw4w9WgXcQ",
    "javascript://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
  ])("rejects invalid or deceptive YouTube URL %s", (url) => {
    expect(youtubeVideoId(url)).toBeNull();
  });

  it("extracts Markdown and plain URLs, trims punctuation, classifies and deduplicates", () => {
    const links = extractUrls(
      "[watch](https://youtu.be/dQw4w9WgXcQ?si=share), again https://youtu.be/dQw4w9WgXcQ?si=share. Also https://example.test/path).",
      ["https://EXAMPLE.test/path", "file:///C:/private.txt"],
    );

    expect(links).toEqual([
      { url: "https://youtu.be/dQw4w9WgXcQ?si=share", kind: "youtube", videoId: "dQw4w9WgXcQ" },
      { url: "https://example.test/path", kind: "web" },
    ]);
  });

  it("caps the URL list at 50 entries", () => {
    const text = Array.from({ length: 60 }, (_, index) => `https://example.test/${index}`).join(" ");
    expect(extractUrls(text)).toHaveLength(50);
  });
});
