import type { Note } from "../model/note";
import type { Link } from "../model/link";
import type { TaskLogEntry } from "../tasks/taskLog.svelte";

const WORDS_PER_MINUTE = 200;

export interface TextStats {
  words: number;
  characters: number;
  lines: number;
  /** Whole minutes, at least 1 for any text. */
  readingMinutes: number;
}

/** Words, characters, lines and reading time of a note's Markdown (markup characters not counted as words). */
export function textStats(text: string): TextStats {
  const plain = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, " "))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ");
  const words = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  const trimmed = text.replace(/\s+$/u, "");
  return {
    words,
    characters: [...text].length,
    lines: trimmed ? trimmed.split(/\r?\n/).length : 0,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
  };
}

export interface CollectionStats {
  items: number;
  /** Items whose task is done; null when the kind has no notion of done. */
  done: number | null;
}

/** Item counts for Lists (rows), Inbox (linked entries) and Tierlists (cards). */
export function collectionStats(note: Note, notes: Readonly<Record<string, Note>>, links: readonly Link[]): CollectionStats | null {
  const isDone = (id: string | null | undefined) => Boolean(id && notes[id]?.task?.done);
  if (note.type === "list") {
    const items = note.listItems ?? [];
    return { items: items.length, done: items.filter((item) => isDone(item.targetId)).length };
  }
  if (note.type === "inbox") {
    const entries = links.filter((link) => link.from === note.id && link.kind === "strong" && notes[link.to]);
    return { items: entries.length, done: entries.filter((link) => isDone(link.to)).length };
  }
  if (note.type === "tierlist") {
    const cards = (note.tiers ?? []).flatMap((row) => row.cards);
    return { items: cards.length, done: null };
  }
  return null;
}

export interface TaskStats {
  doneAt: number | null;
  /** From creation to the current completion, when both are known. */
  openForMs: number | null;
  /** How many times the task was completed (the task log keeps every completion). */
  timesCompleted: number;
}

export function taskStats(note: Note, log: readonly TaskLogEntry[]): TaskStats | null {
  if (!note.task) return null;
  const doneAt = note.task.done ? note.task.doneAt : null;
  return {
    doneAt,
    openForMs: doneAt !== null && note.createdAt !== undefined ? Math.max(0, doneAt - note.createdAt) : null,
    timesCompleted: log.filter((entry) => entry.noteId === note.id).length,
  };
}

export interface MediaFacts {
  name: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Attachment files of this node (for its size on disk). */
  files: string[];
}

export function mediaFacts(note: Note): MediaFacts | null {
  const ref = note.image ?? note.media;
  const recordings = note.recordings ?? [];
  if (!ref && recordings.length === 0) return null;
  const files = [
    ...(ref ? [ref.file] : []),
    ...recordings.map((recording) => recording.media.file),
  ].filter((file, index, all) => file && all.indexOf(file) === index);
  if (!ref) {
    const total = recordings.reduce((sum, recording) => sum + (recording.media.duration ?? 0), 0);
    return { name: null, format: formatOf(recordings[0]!.media.mime), width: null, height: null, durationSeconds: total || null, files };
  }
  const image = note.image;
  return {
    name: ref.name ?? null,
    format: formatOf(ref.mime),
    width: image ? image.naturalWidth : note.media?.naturalWidth ?? null,
    height: image ? image.naturalHeight : note.media?.naturalHeight ?? null,
    durationSeconds: note.media?.duration ?? null,
    files,
  };
}

/** "image/png" → "PNG", "audio/mpeg" → "MP3". */
export function formatOf(mime: string | undefined): string | null {
  if (!mime) return null;
  const subtype = mime.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    mpeg: "MP3", "svg+xml": "SVG", "x-wav": "WAV", wav: "WAV", "x-m4a": "M4A", quicktime: "MOV", "x-matroska": "MKV",
  };
  return known[subtype] ?? (subtype ? subtype.toUpperCase() : null);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 0:42, 12:05, 1:02:03. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** "45 s", "12 min", "3 h 5 min", "4 days", "2 months". */
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 61) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.floor(days / 30.4);
  if (months < 24) return `${months} months`;
  return `${Math.floor(days / 365)} years`;
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago", or the date for anything older than a month. */
export function formatAgo(at: number, now = Date.now()): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return days === 1 ? "yesterday" : `${days} days ago`;
  return formatDate(at);
}

export function formatDate(at: number): string {
  return new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
