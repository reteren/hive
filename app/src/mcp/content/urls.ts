/** A URL mentioned by a node, classified so clients can hand YouTube links to a reader. */
export interface UrlInfo {
  url: string;
  kind: "youtube" | "web";
  videoId?: string;
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;

/** Return the video id for the supported YouTube URL forms, or null for any other URL. */
export function youtubeVideoId(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  let videoId: string | null = null;
  if (parsed.hostname.toLowerCase().endsWith("youtu.be")) {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
    videoId = parsed.searchParams.get("v");
  } else {
    const match = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/i);
    videoId = match?.[1] ?? null;
  }
  return videoId && YOUTUBE_ID.test(videoId) ? videoId : null;
}

/** Classify one candidate URL and keep the spelling supplied in the node. */
export function urlInfo(value: string): UrlInfo | null {
  const url = cleanUrl(value);
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const videoId = youtubeVideoId(url);
  return videoId ? { url, kind: "youtube", videoId } : { url, kind: "web" };
}

/** Extract unique HTTP(S) URLs from Markdown/plain text, then append stored URL fields. */
export function extractUrls(text: string, extraUrls: readonly (string | null | undefined)[] = []): UrlInfo[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(HTTP_URL_PATTERN)) candidates.push(trimTrailingPunctuation(match[0]));
  for (const extra of extraUrls) if (typeof extra === "string") candidates.push(extra);

  const seen = new Set<string>();
  const result: UrlInfo[] = [];
  for (const candidate of candidates) {
    const info = urlInfo(candidate);
    if (!info) continue;
    const key = canonicalUrl(info.url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(info);
    if (result.length === 50) break;
  }
  return result;
}

function cleanUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimTrailingPunctuation(trimmed);
}

function trimTrailingPunctuation(value: string): string {
  let result = value;
  while (/[.,!?;:'"…]$/u.test(result)) result = result.slice(0, -1);
  // A closing bracket is part of a URL only when it has a matching opener in the path/query.
  while (/[)\]}]$/.test(result)) {
    const close = result.at(-1)!;
    const open = close === ")" ? "(" : close === "]" ? "[" : "{";
    if (count(result, close) <= count(result, open)) break;
    result = result.slice(0, -1);
  }
  return result;
}

function canonicalUrl(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

function count(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}
