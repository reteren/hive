import { convertFileSrc } from "@tauri-apps/api/core";
import { attachmentUrl } from "../../attachments/service";
import type { MediaRef } from "../../attachments/types";
import type { Note, NoteKind } from "../../model/note";
import { McpError } from "../registry";
import { registerContentReader, type ContentOptions, type ImagePayload } from "./readers";
import { imagePayloadFromSource } from "./imagePayload";

interface ContentFile {
  name: string;
  mime: string;
  size: number;
}

interface MediaMetadata {
  duration?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  poster?: ImagePayload;
}

function mediaFor(note: Note, kind: MediaRef["kind"]): MediaRef | undefined {
  return note.media?.kind === kind ? note.media : undefined;
}

function contentFile(media: Pick<MediaRef, "file" | "mime" | "size" | "name">): ContentFile {
  return { name: media.name || media.file, mime: media.mime, size: media.size };
}

function mediaUrl(media: MediaRef): string {
  return media.externalPath ? convertFileSrc(media.externalPath) : attachmentUrl(media.file);
}

/** A HEAD probe never downloads a potentially multi-gigabyte media attachment. */
async function fileIsMissing(url: string): Promise<boolean> {
  if (!url || typeof fetch !== "function") return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: controller.signal });
    return response.status === 404 || response.status === 410;
  } catch {
    // A blocked asset protocol or an offline test environment does not prove that a file is gone.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function readPdf(note: Note, options: ContentOptions): Promise<Record<string, unknown>> {
  const media = mediaFor(note, "pdf");
  if (!media) return { file: null, pageCount: 0, pages: [], truncated: false };
  const url = attachmentUrl(media.file);
  if (!url) {
    return { file: contentFile(media), pageCount: 0, pages: [], truncated: true, missing: true };
  }

  const { pdfjs } = await import("../../formats/pdfjsClient");
  const loadingTask = pdfjs.getDocument({ url });
  try {
    const document = await loadingTask.promise;
    const from = Math.max(1, options.pdfPages.from);
    const to = Math.max(from, options.pdfPages.to);
    const lastPage = Math.min(document.numPages, to);
    const pages: Array<{ page: number; text: string }> = [];

    for (let pageNumber = from; pageNumber <= lastPage; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pages.push({ page: pageNumber, text: pdfText(textContent.items) });
    }

    return {
      file: contentFile(media),
      pageCount: document.numPages,
      pages,
      truncated: from > 1 || to < document.numPages,
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new McpError(
      "not_found",
      `PDF attachment '${media.name || media.file}' could not be read.${reason} Restore the file or replace the PDF attachment, then retry.`,
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

function pdfText(items: readonly unknown[]): string {
  const lines: string[] = [];
  let current: string[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.str !== "string") continue;
    if (item.str) current.push(item.str);
    if (item.hasEOL === true) {
      lines.push(joinPdfLine(current));
      current = [];
    }
  }
  if (current.length > 0) lines.push(joinPdfLine(current));
  return lines.filter(Boolean).join("\n");
}

function joinPdfLine(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

async function readAudio(note: Note): Promise<Record<string, unknown>> {
  const media = mediaFor(note, "audio");
  if (!media) return { file: null, recordings: [] };
  const url = mediaUrl(media);
  const missing = await fileIsMissing(url);
  const duration = media.duration ?? (missing ? undefined : await readAudioDuration(url));
  const recordings = await Promise.all((note.recordings ?? []).map(async (recording) => {
    const recordingUrl = attachmentUrl(recording.media.file);
    const recordingDuration = recording.media.duration ?? (await readAudioDuration(recordingUrl));
    return {
      id: recording.id,
      name: recording.name,
      file: contentFile(recording.media),
      ...(recordingDuration === undefined ? {} : { duration: recordingDuration }),
    };
  }));
  return {
    file: contentFile(media),
    ...(media.externalPath ? { externalPath: media.externalPath } : {}),
    ...(missing ? { missing: true } : {}),
    ...(duration === undefined ? {} : { duration }),
    recordings,
  };
}

function readAudioDuration(url: string): Promise<number | undefined> {
  if (!url || typeof document === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    let settled = false;
    const timeout = setTimeout(() => finish(undefined), 2_000);
    const finish = (duration: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      try {
        audio.removeAttribute("src");
        audio.load();
      } catch {
        // Detached media elements may not implement every browser method in tests.
      }
      resolve(duration);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration >= 0 ? audio.duration : undefined);
    audio.onerror = () => finish(undefined);
    audio.src = url;
    audio.load();
  });
}

async function readVideo(note: Note, options: ContentOptions): Promise<Record<string, unknown>> {
  const media = mediaFor(note, "video");
  if (!media) return { file: null };
  const url = mediaUrl(media);
  const missing = await fileIsMissing(url);
  const metadata = missing ? {} : await readVideoMetadata(url, media.file, options.maxImagePx);
  const duration = media.duration ?? metadata.duration;
  const naturalWidth = media.naturalWidth ?? metadata.naturalWidth;
  const naturalHeight = media.naturalHeight ?? metadata.naturalHeight;
  return {
    file: contentFile(media),
    ...(media.externalPath ? { externalPath: media.externalPath } : {}),
    ...(missing ? { missing: true } : {}),
    ...(duration === undefined ? {} : { duration }),
    ...(naturalWidth === undefined ? {} : { naturalWidth }),
    ...(naturalHeight === undefined ? {} : { naturalHeight }),
    ...(metadata.poster ? { poster: metadata.poster } : {}),
  };
}

function readYouTube(note: Note): Promise<Record<string, unknown>> {
  return Promise.resolve({ ...(note.youtube ? { youtube: { ...note.youtube } } : {}) });
}

async function readVideoMetadata(url: string, file: string, maxImagePx: number): Promise<MediaMetadata> {
  if (!url || typeof document === "undefined") return {};

  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const timeout = setTimeout(() => finish({}), 4_000);

    const finish = (metadata: MediaMetadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // Detached media elements may not implement every browser method in tests.
      }
      resolve(metadata);
    };

    video.preload = "metadata";
    video.muted = true;
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration >= 0 ? video.duration : undefined;
      const naturalWidth = video.videoWidth > 0 ? video.videoWidth : undefined;
      const naturalHeight = video.videoHeight > 0 ? video.videoHeight : undefined;
      const base = {
        ...(duration === undefined ? {} : { duration }),
        ...(naturalWidth === undefined ? {} : { naturalWidth }),
        ...(naturalHeight === undefined ? {} : { naturalHeight }),
      };
      if (!naturalWidth || !naturalHeight || duration === undefined || duration <= 0) {
        finish(base);
        return;
      }

      video.onseeked = () => {
        void capturePoster(video, file, naturalWidth, naturalHeight, maxImagePx)
          .then((poster) => finish({ ...base, ...(poster ? { poster } : {}) }))
          .catch(() => finish(base));
      };
      try {
        video.currentTime = duration * 0.1;
      } catch {
        finish(base);
      }
    };
    video.onerror = () => finish({});
    video.src = url;
    video.load();
  });
}

function capturePoster(
  video: HTMLVideoElement,
  file: string,
  originalWidth: number,
  originalHeight: number,
  maxPx: number,
): Promise<ImagePayload> {
  // The shared converter scales to maxPx and preserves the source dimensions in the payload.
  return imagePayloadFromSource(video, file, originalWidth, originalHeight, maxPx);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const readers: ReadonlyArray<[NoteKind, (note: Note, options: ContentOptions) => Promise<Record<string, unknown>>]> = [
  ["pdf", readPdf],
  ["audio", readAudio],
  ["video", readVideo],
  ["youtube", readYouTube],
];

for (const [kind, reader] of readers) registerContentReader(kind, reader);
