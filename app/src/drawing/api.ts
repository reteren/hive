import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DrawingIndex, TileKey } from "./types";

export interface DrawingTileChange {
  key: TileKey;
  png: Uint8Array | null;
}

export interface DrawingLoadResult {
  index: DrawingIndex | null;
}

// Vite smoke tests have no active native project; keep their drawing in this module.
let browserIndex: DrawingIndex | null = null;
const browserTiles = new Map<TileKey, Uint8Array>();

function ownedPng(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export async function drawingLoad(): Promise<DrawingLoadResult> {
  if (isTauri()) return invoke<DrawingLoadResult>("drawing_load");
  return { index: browserIndex ? { ...browserIndex, tiles: [...browserIndex.tiles] } : null };
}

export async function drawingReadTile(key: TileKey): Promise<Uint8Array<ArrayBuffer>> {
  if (isTauri()) return ownedPng(Uint8Array.from(await invoke<number[]>("drawing_read_tile", { key })));
  const png = browserTiles.get(key);
  if (!png) throw new Error(`Drawing tile ${key} is missing.`);
  return ownedPng(png);
}

export async function drawingSave(changes: readonly DrawingTileChange[], index: DrawingIndex): Promise<void> {
  if (isTauri()) {
    await invoke("drawing_save", {
      changes: changes.map(({ key, png }) => ({ key, png: png === null ? null : Array.from(png) })),
      index,
    });
    return;
  }
  for (const { key, png } of changes) {
    if (png === null) browserTiles.delete(key);
    else browserTiles.set(key, ownedPng(png));
  }
  browserIndex = { ...index, tiles: [...index.tiles] };
}
