import { invoke } from "@tauri-apps/api/core";
import { isSafeAttachmentName } from "../attachments/types";
import { decodeFormatText, type FormatTextEncoding } from "./textEncoding";
import { t } from "../i18n/i18n.svelte";

export interface LoadedFormatText {
  text: string;
  encoding: FormatTextEncoding;
  byteLength: number;
}

export interface LoadedFormatPreview {
  text: string;
  truncated: boolean;
}

export interface FormatTextLoadDependencies {
  fetchBytes(url: string): Promise<Uint8Array>;
  attachmentDirectory(): Promise<string>;
  readDroppedText(path: string): Promise<string>;
}

const defaultDependencies: FormatTextLoadDependencies = {
  async fetchBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  attachmentDirectory: () => invoke<string>("attachment_directory"),
  readDroppedText: (path) => invoke<string>("read_dropped_text", { path }),
};

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || "Unknown error");
}

/** A blocked asset fetch falls back to the original attachment on disk. */
export async function loadFormatText(
  file: string,
  assetUrl: string,
  dependencies: FormatTextLoadDependencies = defaultDependencies,
): Promise<LoadedFormatText> {
  if (!isSafeAttachmentName(file)) {
    throw new Error(t("Could not load file: invalid attachment name."));
  }

  let assetFailure = t("No asset URL available");
  if (assetUrl) {
    try {
      const bytes = await dependencies.fetchBytes(assetUrl);
      return { ...decodeFormatText(bytes), byteLength: bytes.byteLength };
    } catch (error) {
      assetFailure = reason(error);
    }
  }

  try {
    const directory = await dependencies.attachmentDirectory();
    const separator = directory.includes("\\") ? "\\" : "/";
    const path = `${directory.replace(/[\\/]+$/, "")}${separator}${file}`;
    const text = await dependencies.readDroppedText(path);
    const bytes = new TextEncoder().encode(text);
    return { ...decodeFormatText(bytes), byteLength: bytes.byteLength };
  } catch (error) {
    throw new Error(t("Could not load file: {reason} (asset URL: {assetFailure}).", { reason: reason(error), assetFailure: assetFailure }));
  }
}

/** Read only a small prefix for an unselected Format node; CodeMirror owns the full edit path. */
export async function loadFormatPreview(file: string, assetUrl: string, maxBytes = 8_192): Promise<LoadedFormatPreview> {
  if (!isSafeAttachmentName(file)) throw new Error(t("Could not load file: invalid attachment name."));
  if (!assetUrl) throw new Error(t("Could not load preview: attachment URL unavailable."));
  const response = await fetch(assetUrl);
  if (!response.ok) throw new Error(t("Could not load preview: HTTP {status}.", { status: response.status }));
  const reader = response.body?.getReader();
  if (!reader) {
    await response.body?.cancel();
    throw new Error(t("Could not load preview: streaming is unavailable."));
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  try {
    while (length < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - length;
      const chunk = value.subarray(0, remaining);
      chunks.push(chunk);
      length += chunk.byteLength;
      if (value.byteLength > remaining) { truncated = true; break; }
    }
    if (length === maxBytes) truncated = true;
  } finally {
    if (truncated) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return decodePreview(bytes, truncated);
}

function decodePreview(bytes: Uint8Array, truncated: boolean): LoadedFormatPreview {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bom ? bytes.subarray(3) : bytes);
  if (truncated) text = text.replace(/\ufffd$/, "");
  return { text: text.replace(/\r\n?/g, "\n"), truncated };
}
