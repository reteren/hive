import { invoke } from "@tauri-apps/api/core";
import { decodeFormatText, type FormatTextEncoding } from "./textEncoding";

export interface LoadedFormatText {
  text: string;
  encoding: FormatTextEncoding;
  byteLength: number;
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
  if (!/^[0-9a-f]{64}\.[a-z0-9]{1,8}$/i.test(file)) {
    throw new Error("Could not load file: invalid attachment name.");
  }

  let assetFailure = "No asset URL available";
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
    throw new Error(`Could not load file: ${reason(error)} (asset URL: ${assetFailure}).`);
  }
}
