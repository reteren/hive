import { invoke } from "@tauri-apps/api/core";
import { board } from "../../model/board.svelte";
import { ME_OBJECT_ID } from "../../model/link";
import { hasMeBeacon } from "../../beacons/beaconState.svelte";
import { BEACON_SIZE, type Note } from "../../model/note";
import { noteBounds } from "../../notes/layout.svelte";
import { asParams, McpError } from "../registry";
import { withCameraFit, type BBox } from "./camera";
import { waitForBoardRender } from "./settle";

const DEFAULT_MAX_PX = 1_600;
const MIN_MAX_PX = 512;
const MAX_MAX_PX = 3_000;
const MAX_CAPTURE_IDS = 500;

interface CaptureParams {
  ids?: string[];
  bbox?: BBox;
  maxPx: number;
}

export interface CaptureImage {
  file: "board-capture.png";
  mime: "image/png";
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

export interface CaptureResult {
  image: CaptureImage;
  bbox: BBox;
  zoom: number;
}

export async function captureBoard(rawParams: unknown): Promise<CaptureResult> {
  const params = parseParams(rawParams);
  const target = requestedBounds(params);
  return withCameraFit(target, async ({ bbox, zoom }) => {
    await waitForBoardRender();
    const pngBytes = await requestPreview();
    const image = await downscalePng(pngBytes, params.maxPx);
    return { image, bbox, zoom };
  });
}

function parseParams(value: unknown): CaptureParams {
  const params = asParams(value);
  const unknown = Object.keys(params).find((key) => !["ids", "bbox", "maxPx"].includes(key));
  if (unknown) throw new McpError("invalid_params", `Unknown view.capture parameter '${unknown}'.`);

  let ids: string[] | undefined;
  if (params.ids !== undefined) {
    if (!Array.isArray(params.ids) || params.ids.some((id) => typeof id !== "string" || id.trim().length === 0)) {
      throw new McpError("invalid_params", "ids must be an array of non-empty node id strings.");
    }
    if (params.ids.length > MAX_CAPTURE_IDS) {
      throw new McpError("invalid_params", `ids accepts at most ${MAX_CAPTURE_IDS} node ids per capture.`);
    }
    ids = [...new Set(params.ids as string[])];
  }

  let bbox: BBox | undefined;
  if (params.bbox !== undefined) {
    const input = params.bbox;
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new McpError("invalid_params", "bbox must contain finite x, y, width, and height values.");
    }
    const candidate = input as Record<string, unknown>;
    const allowed = new Set(["x", "y", "width", "height"]);
    const extra = Object.keys(candidate).find((key) => !allowed.has(key));
    if (extra) throw new McpError("invalid_params", `Unknown bbox field '${extra}'.`);
    if (["x", "y", "width", "height"].some((key) => typeof candidate[key] !== "number" || !Number.isFinite(candidate[key]))) {
      throw new McpError("invalid_params", "bbox must contain finite x, y, width, and height values.");
    }
    if ((candidate.width as number) <= 0 || (candidate.height as number) <= 0) {
      throw new McpError("invalid_params", "bbox width and height must be greater than zero.");
    }
    bbox = { x: candidate.x as number, y: candidate.y as number, width: candidate.width as number, height: candidate.height as number };
  }
  if (ids?.length === 0 && !bbox) throw new McpError("invalid_params", "Provide at least one node id or a bbox, or omit both to capture the current viewport.");

  const maxPx = params.maxPx === undefined ? DEFAULT_MAX_PX : params.maxPx;
  if (typeof maxPx !== "number" || !Number.isSafeInteger(maxPx) || maxPx < MIN_MAX_PX || maxPx > MAX_MAX_PX) {
    throw new McpError("invalid_params", `maxPx must be an integer from ${MIN_MAX_PX} to ${MAX_MAX_PX}.`);
  }
  return { ...(ids === undefined ? {} : { ids }), ...(bbox ? { bbox } : {}), maxPx };
}

function requestedBounds(params: CaptureParams): BBox | null {
  if (params.ids === undefined && params.bbox === undefined) return null;
  const bounds: BBox[] = params.bbox ? [params.bbox] : [];
  for (const id of params.ids ?? []) {
    if (id === ME_OBJECT_ID) {
      if (!hasMeBeacon()) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get valid ids.`);
      bounds.push({ x: -BEACON_SIZE / 2, y: -BEACON_SIZE / 2, width: BEACON_SIZE, height: BEACON_SIZE });
      continue;
    }
    const note: Note | undefined = board.notes[id];
    if (!note) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
    bounds.push(noteBounds(note));
  }
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map(({ x }) => x));
  const minY = Math.min(...bounds.map(({ y }) => y));
  const maxX = Math.max(...bounds.map(({ x, width }) => x + width));
  const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

async function requestPreview(): Promise<Uint8Array> {
  let result: number[];
  try {
    result = await invoke<number[]>("capture_board_preview");
  } catch (error) {
    const message = errorText(error);
    if (message.startsWith("unsupported:")) throw new McpError("unsupported", message.slice("unsupported:".length).trim());
    throw new McpError("internal", "Hive could not capture the board preview.");
  }
  if (!Array.isArray(result) || result.length < 24 || result.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new McpError("internal", "Hive returned an invalid board preview.");
  }
  const bytes = Uint8Array.from(result);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((byte, index) => bytes[index] !== byte)) {
    throw new McpError("internal", "Hive returned an invalid board preview.");
  }
  return bytes;
}

async function downscalePng(bytes: Uint8Array, maxPx: number): Promise<CaptureImage> {
  let bitmap: ImageBitmap;
  try {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "image/png" });
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new McpError("internal", "Hive returned a board preview that could not be decoded.");
  }
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new McpError("internal", "Hive returned an empty board preview.");
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const scale = Math.min(1, maxPx / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new McpError("internal", "Hive could not prepare the board preview image.");
    context.drawImage(bitmap, 0, 0, width, height);
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png");
    }).catch(() => {
      throw new McpError("internal", "Hive could not encode the board preview image.");
    });
    const outputBytes = new Uint8Array(await output.arrayBuffer());
    return {
      file: "board-capture.png",
      mime: "image/png",
      data: encodeBase64(outputBytes),
      width,
      height,
      originalWidth,
      originalHeight,
    };
  } finally {
    bitmap.close();
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
