import { INLINE_IMAGE_PATTERN, TEXT_FORMAT_LANGUAGES, isSafeAttachmentName, type ImageRef } from "../attachments/types";
import { attachmentUrl } from "../attachments/service";
import { board } from "../model/board.svelte";
import type { Note as BoardNote, NoteKind } from "../model/note";
import { calculatorData } from "../calculator/calculators.svelte";
import { loadFormatText } from "../formats/formatLoad";
import { project } from "../project/project.svelte";
import { asParams, McpError, registerMcpMethod } from "./registry";
import {
  attachmentImagePayload,
  enforceImagePayloadBudget,
  imageMimeForFile,
  type ImagePayloadOmission,
} from "./content/imagePayload";
import { contentReaderFor, type ContentOptions } from "./content/readers";
import { extractUrls } from "./content/urls";

const DEFAULT_MAX_IMAGE_PX = 1024;
const DEFAULT_MAX_TEXT_CHARS = 200_000;
const MAX_TEXT_CHARS = 2_000_000;
const INLINE_IMAGE_LIMIT = 10;
const TIER_IMAGE_LIMIT = 10;

const DATA_FIELDS: readonly (keyof BoardNote)[] = [
  "scale", "headerHidden", "smoothLines", "smoothLineAnchors", "createdAt", "task", "time", "message",
  "embedSections", "taskMemory", "importance", "purposes", "moods", "color", "accentColor", "glow", "zoneId",
  "scope", "image", "opacity", "media", "pdfZoom", "recordings", "youtube", "frameHidden", "flipX", "flipY",
  "gifStopped", "tiers", "listItems", "source", "inboxGroup", "randomPick", "customMarks", "customMarkFrame", "listStats",
];

interface ParsedContentOptions extends ContentOptions {}

function requireProject(): void {
  if (!project.path.trim()) throw new McpError("no_project", "Open a project in hive before reading project data.");
  if (!project.ready) throw new McpError("busy", "The project is still loading. Retry this read request in a moment.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOptions(params: Record<string, unknown>): { id: string; options: ParsedContentOptions } {
  if (typeof params.id !== "string" || !params.id.trim()) {
    throw new McpError("invalid_params", "id must be a non-empty node id string.");
  }

  const maxImagePx = params.maxImagePx ?? DEFAULT_MAX_IMAGE_PX;
  if (typeof maxImagePx !== "number" || !Number.isSafeInteger(maxImagePx) || maxImagePx < 256 || maxImagePx > 2048) {
    throw new McpError("invalid_params", "maxImagePx must be an integer from 256 to 2048.");
  }

  const maxTextChars = params.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  if (typeof maxTextChars !== "number" || !Number.isSafeInteger(maxTextChars) || maxTextChars < 0 || maxTextChars > MAX_TEXT_CHARS) {
    throw new McpError("invalid_params", `maxTextChars must be an integer from 0 to ${MAX_TEXT_CHARS}.`);
  }

  let from = 1;
  let to = 30;
  if (params.pdfPages !== undefined) {
    if (!isRecord(params.pdfPages)) throw new McpError("invalid_params", "pdfPages must be an object with optional from and to page numbers.");
    if (params.pdfPages.from !== undefined) from = parsePageNumber(params.pdfPages.from, "pdfPages.from");
    if (params.pdfPages.to !== undefined) to = parsePageNumber(params.pdfPages.to, "pdfPages.to");
    if (to < from) throw new McpError("invalid_params", "pdfPages.to must be greater than or equal to pdfPages.from.");
  }

  return { id: params.id, options: { maxImagePx, maxTextChars, pdfPages: { from, to } } };
}

function parsePageNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100_000) {
    throw new McpError("invalid_params", `${field} must be a positive integer.`);
  }
  return value;
}

function copyJson<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function nodeData(note: BoardNote): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of DATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(note, field)) data[field] = copyJson(note[field]);
  }
  if (note.type === "calculator") data.calculator = copyJson(calculatorData(note.name));
  return data;
}

function omitted(omissions: ImagePayloadOmission[], file: string, reason: string): void {
  omissions.push({ file, reason });
}

async function readImage(
  image: Pick<ImageRef, "file" | "mime">,
  options: ParsedContentOptions,
  omissions: ImagePayloadOmission[],
): Promise<Awaited<ReturnType<typeof attachmentImagePayload>> | undefined> {
  try {
    return await attachmentImagePayload(image, options.maxImagePx);
  } catch (error) {
    omitted(omissions, image.file, error instanceof Error ? error.message : "Image could not be loaded.");
    return undefined;
  }
}

function imageFileFromMarkdown(text: string): { alt: string; file: string }[] {
  const images: { alt: string; file: string }[] = [];
  INLINE_IMAGE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(INLINE_IMAGE_PATTERN)) {
    const encodedFile = match[2];
    if (!encodedFile) continue;
    try {
      images.push({ alt: match[1] ?? "", file: decodeURIComponent(encodedFile) });
    } catch {
      images.push({ alt: match[1] ?? "", file: encodedFile });
    }
  }
  INLINE_IMAGE_PATTERN.lastIndex = 0;
  return images;
}

function extensionOf(file: string): string {
  return file.split(/[\\/]/).at(-1)?.split(".").at(-1)?.toLowerCase() ?? "";
}

function fileInfo(media: NonNullable<BoardNote["media"]>): { name: string; mime: string; size: number } {
  return { name: media.name ?? media.file, mime: media.mime, size: media.size };
}

async function readTextAttachment(file: string, maxTextChars: number): Promise<{ content: string; language: string; truncated: boolean; fileError?: string }> {
  const extension = extensionOf(file);
  const language = TEXT_FORMAT_LANGUAGES[extension as keyof typeof TEXT_FORMAT_LANGUAGES] ?? "plain";
  try {
    const loaded = await loadFormatText(file, attachmentUrl(file));
    return {
      content: loaded.text.slice(0, maxTextChars),
      language,
      truncated: loaded.text.length > maxTextChars,
    };
  } catch (error) {
    return {
      content: "",
      language,
      truncated: false,
      fileError: error instanceof Error ? error.message : "Text attachment could not be loaded.",
    };
  }
}

async function contentForNote(note: BoardNote, options: ParsedContentOptions): Promise<Record<string, unknown>> {
  const omissions: ImagePayloadOmission[] = [];
  const fields: Record<string, unknown> = {};
  const data = nodeData(note);
  const inlineImages = imageFileFromMarkdown(note.text);
  const inlinePayloads = [];
  for (const inline of inlineImages.slice(0, INLINE_IMAGE_LIMIT)) {
    const mime = imageMimeForFile(inline.file);
    if (!isSafeAttachmentName(inline.file) || !mime) {
      omitted(omissions, inline.file, "Inline image reference has an unsupported or invalid attachment name.");
      continue;
    }
    const payload = await readImage({ file: inline.file, mime }, options, omissions);
    if (payload) inlinePayloads.push(payload);
  }
  for (const inline of inlineImages.slice(INLINE_IMAGE_LIMIT)) {
    omitted(omissions, inline.file, "Only the first 10 inline images are included per node.");
  }
  fields.inlineImages = inlinePayloads;

  if (note.type === "image" && note.image) {
    const image = await readImage(note.image, options, omissions);
    if (image) fields.image = image;
    if (note.opacity !== undefined) fields.opacity = note.opacity;
    if (note.flipX !== undefined) fields.flipX = note.flipX;
    if (note.flipY !== undefined) fields.flipY = note.flipY;
  }

  if (note.type === "format" && note.media) {
    fields.file = fileInfo(note.media);
    const text = await readTextAttachment(note.media.file, options.maxTextChars);
    fields.content = text.content;
    fields.language = text.language;
    fields.truncated = text.truncated;
    if (text.fileError) fields.fileError = text.fileError;
  }

  if (note.type === "source" && note.source) {
    const source = {
      url: note.source.url,
      filePath: note.source.filePath,
      ...(note.source.file ? { file: note.source.file } : {}),
      description: note.source.description,
    };
    fields.source = source;
    if (note.source.file) {
      const file = note.source.file;
      const mime = imageMimeForFile(file);
      if (mime) {
        const image = await readImage({ file, mime }, options, omissions);
        if (image) fields.image = image;
      } else if (extensionOf(file) in TEXT_FORMAT_LANGUAGES && isSafeAttachmentName(file)) {
        const text = await readTextAttachment(file, options.maxTextChars);
        fields.content = text.content;
        fields.language = text.language;
        fields.truncated = text.truncated;
        if (text.fileError) fields.fileError = text.fileError;
      }
    }
  }

  if (note.type === "tierlist" && Array.isArray(note.tiers)) {
    const tierImages: Awaited<ReturnType<typeof attachmentImagePayload>>[] = [];
    const refs = note.tiers.flatMap((row) => row.cards.flatMap((card) => card.kind === "image" ? [card.image] : []));
    for (const imageRef of refs.slice(0, TIER_IMAGE_LIMIT)) {
      const payload = await readImage(imageRef, options, omissions);
      if (payload) tierImages.push(payload);
    }
    for (const imageRef of refs.slice(TIER_IMAGE_LIMIT)) {
      omitted(omissions, imageRef.file, "Only the first 10 tier images are included per node.");
    }
    fields.tierImages = tierImages;
  }

  const links = extractUrls(note.text, [note.source?.url, note.youtube?.url]);
  const content: Record<string, unknown> = {
    id: note.id,
    type: note.type,
    name: note.name,
    text: note.text,
    data,
    ...fields,
    links,
  };

  const reader = contentReaderFor(note.type as NoteKind);
  if (reader) {
    const readerFields = await reader(note, options);
    if (Array.isArray(readerFields.omittedImages)) {
      omissions.push(...readerFields.omittedImages.filter((item): item is ImagePayloadOmission =>
        isRecord(item) && typeof item.file === "string" && typeof item.reason === "string"));
    }
    Object.assign(content, readerFields);
    delete content.omittedImages;
  }

  const overBudget = enforceImagePayloadBudget(content);
  omissions.push(...overBudget);
  if (omissions.length > 0) content.omittedImages = omissions;
  return content;
}

registerMcpMethod({
  name: "nodes.content",
  mutating: false,
  run: async (rawParams) => {
    requireProject();
    const { id, options } = parseOptions(asParams(rawParams));
    const note = board.notes[id];
    if (!note) throw new McpError("not_found", `Node '${id}' not found. Use nodes.list or search to get ids.`);
    return contentForNote(note, options);
  },
});
