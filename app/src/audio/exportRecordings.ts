import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exportAttachmentAs, reportImportError } from "../attachments/service";
import type { MediaRef } from "../attachments/types";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import type { Note } from "../model/note";
import { t } from "../i18n/i18n.svelte";

export interface RecordingExport {
  media: MediaRef;
  /** File name with extension; repeats are numbered by the exporter, not here. */
  name: string;
}

/** The display name plus the attachment's extension, unless the name already carries one. */
export function recordingFileName(name: string, media: MediaRef): string {
  if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const extension = media.name?.split(".").at(-1) ?? media.file.split(".").at(-1) ?? "webm";
  return `${name}.${extension}`;
}

/** Every audio file of the given nodes: a plain audio node's file and each dictaphone take. */
export function recordingExports(notes: readonly (Note | undefined)[]): RecordingExport[] {
  const exports: RecordingExport[] = [];
  for (const note of notes) {
    if (note?.type !== "audio") continue;
    if (Array.isArray(note.recordings)) {
      for (const recording of note.recordings) {
        exports.push({ media: recording.media, name: recordingFileName(recording.name, recording.media) });
      }
    } else if (note.media?.kind === "audio") {
      exports.push({ media: note.media, name: recordingFileName(note.name, note.media) });
    }
  }
  return exports;
}

/**
 * One file goes through the save dialog. Several go into a folder the user picks; the backend names
 * repeats "name (2)", "name (3)", … and never overwrites what is already there.
 */
export async function exportRecordings(exports: readonly RecordingExport[]): Promise<void> {
  if (exports.length === 0) return;
  if (exports.length === 1 || !isTauri()) {
    for (const item of exports) await exportAttachmentAs(item.media, item.name);
    return;
  }
  try {
    const directory = await open({ title: t("Choose a folder for the recordings"), directory: true, multiple: false });
    if (typeof directory !== "string" || directory.length === 0) return;
    const written = await invoke<string[]>("attachment_export_many", {
      items: exports.map((item) => ({ file: item.media.file, name: item.name })),
      directory,
    });
    showLinkStatus(t("Recordings exported: {count}", { count: written.length }));
  } catch (error) {
    reportImportError(error instanceof Error ? error.message : String(error));
  }
}
