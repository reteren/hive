import type { YouTubeRef } from "../attachments/types";

export type YouTubeUrlParseResult =
  | { kind: "youtube"; ref: YouTubeRef }
  | { kind: "invalid"; error: string }
  | { kind: "other" };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);

/** Parse the supported YouTube URL shapes without accepting lookalike domains. */
export function parseYouTubeUrl(value: string): YouTubeUrlParseResult {
  const original = value.trim();
  if (!original) return { kind: "other" };

  let url: URL;
  try {
    url = new URL(original);
  } catch {
    return looksLikeYouTubeUrl(original)
      ? { kind: "invalid", error: "Enter a valid YouTube video URL." }
      : { kind: "other" };
  }

  const host = url.hostname.toLocaleLowerCase();
  if (!isYouTubeHost(host)) return { kind: "other" };
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "invalid", error: "YouTube links must use HTTP or HTTPS." };
  }

  const path = url.pathname.split("/").filter(Boolean);
  let videoId: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = path[0] ?? null;
  } else if (url.pathname === "/watch" || url.pathname === "/watch/") {
    videoId = url.searchParams.get("v");
  } else if (["shorts", "embed"].includes(path[0] ?? "")) {
    videoId = path[1] ?? null;
  }

  if (!videoId || !VIDEO_ID.test(videoId)) {
    return { kind: "invalid", error: "This YouTube URL does not contain a valid video ID." };
  }

  const startValue = url.searchParams.get("t") ?? url.searchParams.get("start") ?? hashStart(url.hash);
  const start = startValue === null ? undefined : parseStartTime(startValue);
  if (start === null) {
    return { kind: "invalid", error: "The YouTube start time is invalid." };
  }

  return { kind: "youtube", ref: { videoId, url: original, ...(start === undefined ? {} : { start }) } };
}

/** Validate persisted YouTube data and keep only fields in the shared contract. */
export function parseYouTubeRef(value: unknown): YouTubeRef | undefined {
  if (!isRecord(value) || typeof value.videoId !== "string" || typeof value.url !== "string") return undefined;
  const parsed = parseYouTubeUrl(value.url);
  if (parsed.kind !== "youtube" || parsed.ref.videoId !== value.videoId) return undefined;
  if (value.start !== undefined && (typeof value.start !== "number" || !Number.isFinite(value.start) || value.start < 0)) {
    return undefined;
  }
  const title = nonEmptyString(value.title);
  const author = nonEmptyString(value.author);
  const start = value.start === undefined ? parsed.ref.start : value.start;
  if (value.loop !== undefined && value.loop !== true) return undefined;
  return {
    videoId: parsed.ref.videoId,
    url: value.url,
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(start === undefined ? {} : { start }),
    ...(value.loop === true ? { loop: true } : {}),
  };
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

export function youtubeOEmbedUrl(videoUrl: string): string {
  const query = new URLSearchParams({ url: videoUrl, format: "json" });
  return `https://www.youtube.com/oembed?${query.toString()}`;
}

export function youtubeEmbedUrl(ref: Pick<YouTubeRef, "videoId" | "start">, origin: string, nativeControls = false): string {
  const query = new URLSearchParams({ autoplay: "1", controls: nativeControls ? "1" : "0", enablejsapi: "1" });
  if (typeof ref.start === "number" && Number.isFinite(ref.start) && ref.start > 0) {
    query.set("start", String(Math.floor(ref.start)));
  }
  if (origin) query.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ref.videoId)}?${query.toString()}`;
}

/** Convert IFrame API error codes to a short explanation shown above the source action. */
export function youtubeEmbedErrorReason(value: unknown): string | null {
  const code = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(code)) return null;
  if (code === 101 || code === 150) return "The video owner does not allow playback on other websites.";
  if (code === 153) return "YouTube could not identify this app.";
  if (code === 100) return "The video was not found or is private.";
  if (code === 2) return "The video ID is invalid.";
  if (code === 5) return "The embedded player could not decode this video.";
  return `YouTube player error ${code}.`;
}

export interface YouTubePlayerInfo {
  currentTime?: number;
  duration?: number;
  volume?: number;
  muted?: boolean;
  playerState?: number;
}

export type YouTubePlayerMessage = { kind: "error"; reason: string } | ({ kind: "response" } & Partial<YouTubePlayerInfo>);

export function youtubePlayerCommand(func: "playVideo" | "pauseVideo" | "seekTo" | "setVolume" | "mute" | "unMute", args: readonly unknown[] = []): string {
  return JSON.stringify({ event: "command", func, args });
}

/** Parse the small subset of cross-window player messages used by the board. */
export function parseYouTubePlayerMessage(value: unknown): YouTubePlayerMessage | null {
  let message: unknown = value;
  if (typeof value === "string") {
    try {
      message = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(message)) return null;
  if (message.event === "onError") {
    return {
      kind: "error",
      reason: youtubeEmbedErrorReason(message.info) ?? "The embedded player returned an unknown error.",
    };
  }
  if (message.event === "onStateChange") {
    return typeof message.info === "number" && Number.isInteger(message.info)
      ? { kind: "response", playerState: message.info }
      : { kind: "response" };
  }
  if (message.event === "onReady") return { kind: "response" };
  if (message.event === "infoDelivery") {
    return { kind: "response", ...parsePlayerInfo(message.info) };
  }
  return null;
}

function parsePlayerInfo(value: unknown): { currentTime?: number; duration?: number; volume?: number; muted?: boolean; playerState?: number } {
  if (!isRecord(value)) return {};
  const currentTime = finiteNonNegative(value.currentTime);
  const duration = finiteNonNegative(value.duration);
  const volume = typeof value.volume === "number" && Number.isFinite(value.volume) ? Math.min(100, Math.max(0, value.volume)) : undefined;
  const playerState = typeof value.playerState === "number" && Number.isInteger(value.playerState) ? value.playerState : undefined;
  const muted = typeof value.muted === "boolean" ? value.muted : undefined;
  return {
    ...(currentTime === undefined ? {} : { currentTime }),
    ...(duration === undefined ? {} : { duration }),
    ...(volume === undefined ? {} : { volume }),
    ...(muted === undefined ? {} : { muted }),
    ...(playerState === undefined ? {} : { playerState }),
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseStartTime(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input);
  if (/^\d+(?:\.\d+)?s$/.test(input)) return Number(input.slice(0, -1));

  if (/^\d+(?::\d{1,2}){1,2}$/.test(input)) {
    const parts = input.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    const seconds = parts.at(-1)!;
    const minutes = parts.at(-2)!;
    const hours = parts.length === 3 ? parts[0] : 0;
    if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(input);
  if (!units || !units.slice(1).some(Boolean)) return null;
  return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
}

function hashStart(hash: string): string | null {
  if (!hash) return null;
  return new URLSearchParams(hash.slice(1)).get("t") ?? new URLSearchParams(hash.slice(1)).get("start");
}

function looksLikeYouTubeUrl(value: string): boolean {
  return /(?:^|[/:.])(?:youtube\.com|youtu\.be)(?:[/:?#]|$)/i.test(value);
}

function isYouTubeHost(host: string): boolean {
  return YOUTUBE_HOSTS.has(host) || host.endsWith(".youtube.com");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
