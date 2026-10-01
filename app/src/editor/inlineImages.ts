import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  attachmentUrl,
  clipboardImageFiles,
  importImageFile,
  importImagePath,
  registerFileDropHandler,
  reportImportError,
} from "../attachments/service";
import type { ImageRef } from "../attachments/types";
import { mountInlineGifDom } from "../attachments/gifDom";
import { formatInlineImageToken, parseInlineImageToken } from "./markdownSyntax";

export type BreakHistoryGroup = () => void;
type ParsedInlineImage = NonNullable<ReturnType<typeof parseInlineImageToken>>;

export function inlineImagesExtension(breakHistoryGroup: BreakHistoryGroup, noteId: string): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private destroyed = false;
      private readonly unregisterDrop: () => void;

      constructor(private readonly view: EditorView) {
        this.decorations = imageDecorations(view, breakHistoryGroup, noteId);
        this.unregisterDrop = registerFileDropHandler(20, (paths, target, client) => {
          if (!paths.length || !target || !view.dom.contains(target) || this.destroyed || !view.dom.isConnected) {
            return false;
          }
          const state = view.state;
          const position = view.posAtCoords({ x: client.x, y: client.y }) ?? state.selection.main.head;
          void importPaths(view, paths, position, state.doc, breakHistoryGroup, () => !this.destroyed);
          return true;
        });
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = imageDecorations(update.view, breakHistoryGroup, noteId);
        }
      }

      destroy(): void {
        this.destroyed = true;
        this.unregisterDrop();
      }
    },
    { decorations: (value) => value.decorations },
  );

  return [
    plugin,
    EditorView.domEventHandlers({
      paste(event, view) {
        const files = clipboardImageFiles(event);
        if (files.length === 0) return false;
        event.preventDefault();
        const startDoc = view.state.doc;
        void importFiles(view, files, startDoc, breakHistoryGroup);
        return true;
      },
    }),
    EditorView.baseTheme({
      ".cm-inline-image-widget": {
        position: "relative",
        display: "block",
        maxWidth: "100%",
        margin: "0.35em 0",
        overflow: "visible",
        boxSizing: "border-box",
      },
      ".cm-inline-image-widget img": {
        display: "block",
        width: "100%",
        height: "auto",
        maxHeight: "none",
        objectFit: "contain",
        borderRadius: "2px",
      },
      ".cm-inline-gif-surface": {
        position: "relative",
        display: "block",
        width: "100%",
        overflow: "hidden",
      },
      ".cm-inline-gif-picture": {
        display: "block",
        width: "100%",
        height: "auto",
        maxHeight: "none",
        objectFit: "contain",
        borderRadius: "2px",
      },
      ".cm-inline-gif-picture[hidden]": {
        display: "none",
      },
      ".cm-inline-image-widget[aria-busy='true']": {
        minHeight: "24px",
        backgroundColor: "rgba(255,255,255,0.035)",
      },
      ".cm-inline-image-missing": {
        display: "flex",
        minHeight: "36px",
        alignItems: "center",
        padding: "6px 9px",
        boxSizing: "border-box",
        border: "1px solid #4b4b4b",
        borderRadius: "3px",
        backgroundColor: "#292929",
        color: "#b0b0b0",
        fontFamily: "var(--ui-font)",
        fontSize: "12px",
        overflowWrap: "anywhere",
      },
      ".cm-inline-image-resize": {
        position: "absolute",
        zIndex: "1",
        top: "50%",
        right: "-5px",
        width: "10px",
        height: "24px",
        padding: "0",
        transform: "translateY(-50%)",
        border: "1px solid #171717",
        borderRadius: "3px",
        backgroundColor: "var(--accent)",
        cursor: "ew-resize",
        touchAction: "none",
      },
      ".cm-inline-image-resize:focus-visible": {
        outline: "2px solid #fff",
        outlineOffset: "2px",
      },
    }),
  ];
}

function imageDecorations(view: EditorView, breakHistoryGroup: BreakHistoryGroup, noteId: string): DecorationSet {
  const ranges: Array<{ from: number; to: number; value: ReturnType<typeof Decoration.replace> }> = [];
  const state = view.state;
  for (const visible of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== "Image") return;
        const from = node.from;
        const to = node.to;
        const raw = state.sliceDoc(from, to);
        const token = parseInlineImageToken(raw);
        if (!token || selectionTouchesToken(state, from, to)) return;
        ranges.push({
          from,
          to,
          value: Decoration.replace({
            widget: new InlineImageWidget(from, to, raw, token, breakHistoryGroup, noteId),
            // Block decorations are not allowed from a ViewPlugin (CodeMirror throws "No tile at position");
            // the widget is inline and laid out as a block by its own CSS instead.
            block: false,
          }),
        });
        return false;
      },
    });
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

function selectionTouchesToken(state: EditorView["state"], from: number, to: number): boolean {
  return state.selection.ranges.some((range) =>
    range.empty ? range.head > from && range.head < to : range.from < to && range.to > from,
  );
}

class InlineImageWidget extends WidgetType {
  private gifCleanup: (() => void) | null = null;

  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly raw: string,
    private readonly token: ParsedInlineImage,
    private readonly breakHistoryGroup: BreakHistoryGroup,
    private readonly noteId: string,
  ) {
    super();
  }

  eq(other: InlineImageWidget): boolean {
    return other.from === this.from && other.to === this.to && other.raw === this.raw && other.noteId === this.noteId;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = view.dom.ownerDocument.createElement("span");
    wrapper.className = "cm-inline-image-widget";
    wrapper.dataset.inlineImageWidget = "";
    wrapper.dataset.attachmentFile = this.token.file;
    wrapper.setAttribute("role", "group");
    wrapper.setAttribute("aria-label", this.token.alt || this.token.file);
    wrapper.style.width = `${this.token.widthPercent}%`;

    const url = attachmentUrl(this.token.file);
    if (this.token.file.toLowerCase().endsWith(".gif")) {
      wrapper.setAttribute("aria-busy", "true");
      this.gifCleanup = mountInlineGifDom(wrapper, {
        file: this.token.file,
        alt: this.token.alt,
        noteId: this.noteId,
        position: this.from,
      });
    } else if (url) {
      const image = view.dom.ownerDocument.createElement("img");
      image.alt = this.token.alt;
      image.loading = "lazy";
      wrapper.setAttribute("aria-busy", "true");
      image.addEventListener("load", () => wrapper.removeAttribute("aria-busy"), { once: true });
      image.addEventListener("error", () => {
        wrapper.removeAttribute("aria-busy");
        showMissingFile(wrapper, this.token.alt, this.token.file);
      }, { once: true });
      image.src = url;
      wrapper.append(image);
    } else {
      showMissingFile(wrapper, this.token.alt, this.token.file);
    }

    const handle = view.dom.ownerDocument.createElement("button");
    handle.type = "button";
    handle.className = "cm-inline-image-resize";
    handle.dataset.inlineImageResize = "";
    handle.setAttribute("aria-label", "Resize image");
    handle.title = "Drag to resize image";
    wrapper.append(handle);

    wrapper.addEventListener("mousedown", (event) => {
      if (handle.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = wrapper.getBoundingClientRect();
      const position = event.clientX < bounds.left + bounds.width / 2 ? this.from : this.to;
      view.dispatch({ selection: { anchor: position } });
      view.focus();
    });

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      startResize(event, handle, wrapper, view, this.from, this.to, this.raw, this.token, this.breakHistoryGroup);
    });
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 5 : -5;
      commitInlineImageResize(view, this.from, this.to, this.raw, this.token, this.token.widthPercent + delta, this.breakHistoryGroup);
    });
    return wrapper;
  }

  destroy(): void {
    this.gifCleanup?.();
    this.gifCleanup = null;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function showMissingFile(wrapper: HTMLElement, alt: string, file: string): void {
  const missing = wrapper.ownerDocument.createElement("span");
  missing.className = "cm-inline-image-missing";
  missing.textContent = `File missing: ${alt || file}`;
  wrapper.insertBefore(missing, wrapper.querySelector("button"));
  wrapper.querySelector("img")?.remove();
}

function startResize(
  event: PointerEvent,
  handle: HTMLButtonElement,
  wrapper: HTMLElement,
  view: EditorView,
  from: number,
  to: number,
  raw: string,
  token: ParsedInlineImage,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  const startX = event.clientX;
  const startWidth = token.widthPercent;
  const columnWidth = Math.max(1, view.contentDOM.clientWidth);
  let nextWidth = startWidth;

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    nextWidth = clampWidth(startWidth + ((moveEvent.clientX - startX) / columnWidth) * 100);
    wrapper.style.width = `${nextWidth}%`;
  };
  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerCancel);
    if (commit) commitInlineImageResize(view, from, to, raw, token, nextWidth, breakHistoryGroup);
    else wrapper.style.width = `${startWidth}%`;
  };
  const pointerUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId === event.pointerId) finish(true);
  };
  const pointerCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === event.pointerId) finish(false);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerCancel);
  handle.focus({ preventScroll: true });
}

export function commitInlineImageResize(
  view: EditorView,
  from: number,
  to: number,
  raw: string,
  token: ParsedInlineImage,
  requestedWidth: number,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  if (view.state.sliceDoc(from, to) !== raw) return;
  const replacement = formatInlineImageToken(token.alt, token.file, requestedWidth);
  if (replacement === raw) return;
  breakHistoryGroup();
  view.dispatch({
    changes: { from, to, insert: replacement },
    annotations: [Transaction.userEvent.of("input.inlineImageResize"), isolateHistory.of("full")],
  });
  breakHistoryGroup();
}

async function importFiles(
  view: EditorView,
  files: File[],
  startDoc: EditorView["state"]["doc"],
  breakHistoryGroup: BreakHistoryGroup,
): Promise<void> {
  try {
    const images = await Promise.all(files.map(async (file) => {
      const result = await importImageFile(file);
      if (!result.ok) throw new Error(result.error);
      return result.image;
    }));
    if (!view.dom.isConnected) return;
    const position = view.state.doc === startDoc ? undefined : view.state.selection.main.head;
    insertImportedImages(view, images, position, breakHistoryGroup);
  } catch (error) {
    reportImportError(errorMessage(error));
  }
}

async function importPaths(
  view: EditorView,
  paths: string[],
  position: number,
  startDoc: EditorView["state"]["doc"],
  breakHistoryGroup: BreakHistoryGroup,
  isActive: () => boolean,
): Promise<void> {
  try {
    const images: ImageRef[] = [];
    for (const path of paths) {
      const result = await importImagePath(path);
      if (!result.ok) throw new Error(result.error);
      images.push(result.image);
    }
    if (!isActive() || !view.dom.isConnected) return;
    const insertionPosition = view.state.doc === startDoc ? position : view.state.selection.main.head;
    insertImportedImages(view, images, insertionPosition, breakHistoryGroup);
  } catch (error) {
    reportImportError(errorMessage(error));
  }
}

export function insertImportedImages(
  view: EditorView,
  images: ImageRef[],
  requestedPosition: number | undefined,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  if (images.length === 0) return;
  const state = view.state;
  const selection = requestedPosition === undefined
    ? state.selection.main
    : { from: Math.max(0, Math.min(state.doc.length, requestedPosition)), to: Math.max(0, Math.min(state.doc.length, requestedPosition)) };
  const startLine = state.doc.lineAt(selection.from);
  const endLine = state.doc.lineAt(selection.to);
  const prefix = state.sliceDoc(startLine.from, selection.from);
  const suffix = state.sliceDoc(selection.to, endLine.to);
  const leadingBreak = prefix.length > 0 ? "\n" : "";
  const trailingBreak = suffix.length > 0 ? "\n" : "";
  const imageLines = images.map((image) => formatInlineImageToken(image.name ?? "Image", image.file, 50));
  const imageText = imageLines.join("\n");
  const insert = leadingBreak + imageText + trailingBreak;
  const cursor = selection.from + leadingBreak.length + imageText.length;

  breakHistoryGroup();
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: cursor },
    annotations: [Transaction.userEvent.of("input.inlineImageInsert"), isolateHistory.of("full")],
  });
  breakHistoryGroup();
}

function clampWidth(width: number): number {
  return Math.max(5, Math.min(100, Math.round(width)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
