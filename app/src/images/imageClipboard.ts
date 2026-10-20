import { invoke, isTauri } from "@tauri-apps/api/core";
import { board } from "../model/board.svelte";
import { attachmentUrl } from "../attachments/service";
import { showLinkStatus } from "../links-in-text/contextMenu.svelte";
import { t } from "../i18n/i18n.svelte";

/**
 * Copy an image or GIF node to the system clipboard. On Windows the clipboard gets the original file
 * (a pasted GIF stays animated in Discord, Telegram, Explorer) plus the picture as PNG and bitmap;
 * elsewhere only the picture, through the web clipboard.
 */
export async function copyImageNoteToClipboard(noteId: string): Promise<boolean> {
  const note = board.notes[noteId];
  const image = note?.type === "image" ? note.image : undefined;
  if (!note || !image) return false;
  const isGif = image.mime === "image/gif";
  try {
    const png = await pictureAsPng(attachmentUrl(image.file));
    if (isTauri()) {
      await invoke("image_copy_to_clipboard", new Uint8Array(await png.arrayBuffer()), {
        headers: { "x-hive-file": image.file, "x-hive-name": encodeURIComponent(note.name || image.name || "image") },
      });
    } else {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    }
    showLinkStatus(isGif ? t("Gif copied.") : t("Image copied."));
    return true;
  } catch (error) {
    console.error("Could not copy the image", error);
    showLinkStatus(isGif ? t("Could not copy the gif.") : t("Could not copy the image."));
    return false;
  }
}

/** The picture (the first frame of a GIF) at full size, encoded as PNG. */
async function pictureAsPng(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not read the image (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
