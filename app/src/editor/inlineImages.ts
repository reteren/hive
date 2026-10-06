import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  attachmentUrl,
  clipboardImageFiles,
  importImageFile,
  importImagePath,
  registerFileDropHandler,
  reportImportError,
} from "../attachments/service";
import type { ImageRef } from "../attachments/types";
import { mountInlineGifDom, updateInlineGifDom } from "../attachments/gifDom";
import { formatInlineImageToken, parseInlineImageToken } from "./markdownSyntax";

export type BreakHistoryGroup = () => void;
type ParsedInlineImage = NonNullable<ReturnType<typeof parseInlineImageToken>>;

export interface InlineImageSelection {
  from: number;
  to: number;
}

export const inlineImageSelectionEffect = StateEffect.define<InlineImageSelection | null>();

export const inlineImageSelectionField = StateField.define<InlineImageSelection | null>({
  create: () => null,
  update(value, transaction) {
    let next = transaction.docChanged || transaction.selection !== undefined ? null : value;
    for (const effect of transaction.effects) {
      if (effect.is(inlineImageSelectionEffect)) next = effect.value;
    }
    return next;
  },
});

type ImageInsertionTarget = number | { from: number; to: number };
type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

const RESIZE_EDGES: ResizeEdge[] = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];

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
        const imageSelectionChanged = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(inlineImageSelectionEffect)),
        );
        if (update.docChanged || update.selectionSet || update.viewportChanged || imageSelectionChanged) {
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
        const startSelection = view.state.selection.main;
        void importFiles(view, files, startDoc, { from: startSelection.from, to: startSelection.to }, breakHistoryGroup);
        return true;
      },
      mousedown(event, view) {
        const target = event.target instanceof Element ? event.target.closest("[data-inline-image-widget]") : null;
        if (!target) clearImageSelectionState(view);
        return false;
      },
    }),
    inlineImageSelectionField,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
    Prec.highest(keymap.of([
      { key: "Backspace", run: (view) => deleteSelectedInlineImage(view, breakHistoryGroup) },
      { key: "Delete", run: (view) => deleteSelectedInlineImage(view, breakHistoryGroup) },
      { key: "ArrowLeft", run: (view) => moveCaretFromSelectedImage(view, -1) },
      { key: "ArrowRight", run: (view) => moveCaretFromSelectedImage(view, 1) },
      { key: "Escape", run: (view) => clearSelectedInlineImage(view) },
    ])),
    EditorView.baseTheme({
      ".cm-inline-image-widget": {
        position: "relative",
        display: "block",
        maxWidth: "100%",
        margin: "0.35em 0",
        overflow: "visible",
        boxSizing: "border-box",
        userSelect: "none",
        touchAction: "pan-y",
      },
      ".cm-inline-image-widget[data-selected='true']": {
        outline: "2px solid var(--accent)",
        outlineOffset: "1px",
      },
      ".cm-inline-image-widget[data-dragging='true']": {
        opacity: "0.55",
      },
      ".cm-inline-image-resize-frame": {
        position: "absolute",
        inset: "-5px",
        pointerEvents: "none",
      },
      ".cm-inline-image-resize": {
        position: "absolute",
        zIndex: "2",
        display: "none",
        width: "12px",
        height: "12px",
        padding: "0",
        border: "1px solid #171717",
        borderRadius: "3px",
        backgroundColor: "var(--accent)",
        cursor: "nwse-resize",
        pointerEvents: "auto",
        touchAction: "none",
      },
      ".cm-inline-image-widget[data-selected='true'] .cm-inline-image-resize": {
        display: "block",
      },
      ".cm-inline-image-resize[data-edge='n']": {
        top: "-6px",
        left: "50%",
        transform: "translateX(-50%)",
        cursor: "ns-resize",
      },
      ".cm-inline-image-resize[data-edge='s']": {
        bottom: "-6px",
        left: "50%",
        transform: "translateX(-50%)",
        cursor: "ns-resize",
      },
      ".cm-inline-image-resize[data-edge='e']": {
        top: "50%",
        right: "-6px",
        transform: "translateY(-50%)",
        cursor: "ew-resize",
      },
      ".cm-inline-image-resize[data-edge='w']": {
        top: "50%",
        left: "-6px",
        transform: "translateY(-50%)",
        cursor: "ew-resize",
      },
      ".cm-inline-image-resize[data-edge='ne']": { top: "-6px", right: "-6px", cursor: "nesw-resize" },
      ".cm-inline-image-resize[data-edge='nw']": { top: "-6px", left: "-6px", cursor: "nwse-resize" },
      ".cm-inline-image-resize[data-edge='se']": { bottom: "-6px", right: "-6px", cursor: "nwse-resize" },
      ".cm-inline-image-resize[data-edge='sw']": { bottom: "-6px", left: "-6px", cursor: "nesw-resize" },
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
        if (!token) return;
        const selected = state.field(inlineImageSelectionField, false);
        ranges.push({
          from,
          to,
          value: Decoration.replace({
            widget: new InlineImageWidget(
              from,
              to,
              raw,
              token,
              breakHistoryGroup,
              noteId,
              selected?.from === from && selected.to === to,
            ),
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

const currentImageWidget = new WeakMap<HTMLElement, InlineImageWidget>();
const inlineGifCleanups = new WeakMap<HTMLElement, () => void>();

class InlineImageWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly to: number,
    readonly raw: string,
    readonly token: ParsedInlineImage,
    readonly breakHistoryGroup: BreakHistoryGroup,
    readonly noteId: string,
    readonly selected: boolean,
  ) {
    super();
  }

  eq(other: InlineImageWidget): boolean {
    return other.from === this.from && other.to === this.to && other.raw === this.raw &&
      other.noteId === this.noteId && other.selected === this.selected;
  }

  private sameImage(other: InlineImageWidget): boolean {
    return other.token.file === this.token.file && other.token.alt === this.token.alt &&
      other.token.widthPercent === this.token.widthPercent && other.noteId === this.noteId;
  }

  updateDOM(dom: HTMLElement, _view: EditorView, from?: WidgetType): boolean {
    const previous = from instanceof InlineImageWidget ? from : currentImageWidget.get(dom);
    if (!previous || !this.sameImage(previous)) return false;
    currentImageWidget.set(dom, this);
    syncWidgetAttributes(dom, this);
    updateInlineGifDom(dom, this.from);
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = view.dom.ownerDocument.createElement("span");
    currentImageWidget.set(wrapper, this);
    wrapper.className = "cm-inline-image-widget";
    syncWidgetAttributes(wrapper, this);

    const url = attachmentUrl(this.token.file);
    if (this.token.file.toLowerCase().endsWith(".gif")) {
      wrapper.setAttribute("aria-busy", "true");
      inlineGifCleanups.set(wrapper, mountInlineGifDom(wrapper, {
        file: this.token.file,
        alt: this.token.alt,
        noteId: this.noteId,
        position: this.from,
      }));
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

    const frame = view.dom.ownerDocument.createElement("span");
    frame.className = "cm-inline-image-resize-frame";
    for (const edge of RESIZE_EDGES) {
      const handle = view.dom.ownerDocument.createElement("button");
      handle.type = "button";
      handle.className = "cm-inline-image-resize";
      handle.dataset.inlineImageResize = "";
      handle.dataset.edge = edge;
      handle.setAttribute("aria-label", `Resize image ${edge}`);
      handle.title = "Drag to resize image";
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const current = currentImageWidget.get(wrapper) ?? this;
        selectInlineImage(view, current.from, current.to, current.from);
        startResize(event, wrapper, view, current, edge);
      });
      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();
        const current = currentImageWidget.get(wrapper) ?? this;
        const positive = event.key === "ArrowRight" || event.key === "ArrowDown";
        commitInlineImageResize(view, current.from, current.to, current.raw, current.token,
          current.token.widthPercent + (positive ? 5 : -5), current.breakHistoryGroup);
      });
      frame.append(handle);
    }
    wrapper.append(frame);

    const selectAndStartDrag = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest("[data-inline-image-resize]"))) return;
      event.preventDefault();
      event.stopPropagation();
      const current = currentImageWidget.get(wrapper) ?? this;
      const bounds = wrapper.getBoundingClientRect();
      const position = event.clientX < bounds.left + bounds.width / 2 ? current.from : current.to;
      selectInlineImage(view, current.from, current.to, position);
      startImageDrag(event, wrapper, view, current, current.breakHistoryGroup);
    };
    wrapper.addEventListener("pointerdown", selectAndStartDrag);
    wrapper.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest("[data-inline-image-resize]")) return;
      event.preventDefault();
      event.stopPropagation();
    });
    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    inlineGifCleanups.get(dom)?.();
    inlineGifCleanups.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function syncWidgetAttributes(wrapper: HTMLElement, widget: InlineImageWidget): void {
  wrapper.dataset.inlineImageWidget = "";
  wrapper.dataset.attachmentFile = widget.token.file;
  wrapper.dataset.selected = String(widget.selected);
  wrapper.setAttribute("role", "group");
  wrapper.setAttribute("aria-label", widget.token.alt || widget.token.file);
  wrapper.setAttribute("aria-selected", String(widget.selected));
  wrapper.style.width = `${widget.token.widthPercent}%`;
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
  wrapper: HTMLElement,
  view: EditorView,
  widget: InlineImageWidget,
  edge: ResizeEdge,
): void {
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = widget.token.widthPercent;
  const image = wrapper.querySelector<HTMLElement>("img, canvas") ?? wrapper;
  const imageBounds = image.getBoundingClientRect();
  const startPixelWidth = Math.max(1, imageBounds.width || wrapper.getBoundingClientRect().width);
  const startPixelHeight = Math.max(1, imageBounds.height || wrapper.getBoundingClientRect().height);
  const columnWidth = Math.max(1, view.contentDOM.clientWidth);
  let nextWidth = startWidth;

  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== event.pointerId) return;
    nextWidth = resizedInlineImageWidth(
      edge,
      startWidth,
      startPixelWidth,
      startPixelHeight,
      moveEvent.clientX - startX,
      moveEvent.clientY - startY,
      columnWidth,
    );
    wrapper.style.width = `${nextWidth}%`;
  };
  const finish = (commit: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerCancel);
    const current = currentImageWidget.get(wrapper) ?? widget;
    if (commit) commitInlineImageResize(view, current.from, current.to, current.raw, current.token, nextWidth, current.breakHistoryGroup);
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
}

export function resizedInlineImageWidth(
  edge: ResizeEdge,
  startPercent: number,
  startWidthPx: number,
  startHeightPx: number,
  dx: number,
  dy: number,
  columnWidthPx: number,
): number {
  const widthToHeight = startHeightPx > 0 ? startWidthPx / startHeightPx : 1;
  const horizontalDelta = edge.includes("e") ? dx : edge.includes("w") ? -dx : 0;
  const verticalMovement = edge.includes("s") ? dy : edge.includes("n") ? -dy : 0;
  const verticalDelta = verticalMovement * widthToHeight;
  const selectedDelta = horizontalDelta === 0 ? verticalDelta
    : verticalDelta === 0 ? horizontalDelta
      : Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta;
  const safeColumnWidth = Math.max(1, columnWidthPx);
  return clampWidth(startPercent + selectedDelta / safeColumnWidth * 100);
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
    selection: { anchor: from + replacement.length },
    effects: inlineImageSelectionEffect.of({ from, to: from + replacement.length }),
    annotations: [Transaction.userEvent.of("input.inlineImageResize"), isolateHistory.of("full")],
  });
  focusEditor(view);
  breakHistoryGroup();
}

async function importFiles(
  view: EditorView,
  files: File[],
  startDoc: EditorView["state"]["doc"],
  startSelection: { from: number; to: number },
  breakHistoryGroup: BreakHistoryGroup,
): Promise<void> {
  try {
    const images = await Promise.all(files.map(async (file) => {
      const result = await importImageFile(file);
      if (!result.ok) throw new Error(result.error);
      return result.image;
    }));
    if (!view.dom.isConnected) return;
    const position = view.state.doc === startDoc ? startSelection : view.state.selection.main.head;
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
  requestedPosition: ImageInsertionTarget | undefined,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  if (images.length === 0) return;
  const state = view.state;
  const requestedFrom = typeof requestedPosition === "number" ? requestedPosition : requestedPosition?.from;
  const requestedTo = typeof requestedPosition === "number" ? requestedPosition : requestedPosition?.to;
  const selection = requestedFrom === undefined || requestedTo === undefined
    ? state.selection.main
    : {
      from: Math.max(0, Math.min(state.doc.length, requestedFrom)),
      to: Math.max(0, Math.min(state.doc.length, requestedTo)),
    };
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
  focusEditor(view);
  breakHistoryGroup();
}

export function selectInlineImage(view: EditorView, from: number, to: number, cursor = to): void {
  view.dispatch({
    selection: { anchor: cursor },
    effects: inlineImageSelectionEffect.of({ from, to }),
  });
  focusEditor(view);
}

export function selectedInlineImageDeletionRange(
  doc: EditorView["state"]["doc"],
  selection: InlineImageSelection,
): { from: number; to: number; cursor: number } {
  const from = Math.max(0, Math.min(selection.from, doc.length));
  const to = Math.max(from, Math.min(selection.to, doc.length));
  const line = doc.lineAt(from);
  const aloneOnLine = doc.lineAt(to).number === line.number
    && doc.sliceString(line.from, from).trim() === ""
    && doc.sliceString(to, line.to).trim() === "";
  let deleteFrom = from;
  let deleteTo = to;
  if (aloneOnLine) {
    if (line.number < doc.lines) {
      deleteFrom = line.from;
      deleteTo = doc.line(line.number + 1).from;
    } else if (line.number > 1) {
      deleteFrom = doc.line(line.number - 1).to;
      deleteTo = line.to;
    } else {
      deleteFrom = line.from;
      deleteTo = line.to;
    }
  }
  return { from: deleteFrom, to: deleteTo, cursor: deleteFrom };
}

function deleteSelectedInlineImage(view: EditorView, breakHistoryGroup: BreakHistoryGroup): boolean {
  const selection = view.state.field(inlineImageSelectionField, false);
  if (!selection) return false;
  const { from, to, cursor } = selectedInlineImageDeletionRange(view.state.doc, selection);
  breakHistoryGroup();
  view.dispatch({
    changes: { from, to },
    selection: { anchor: cursor },
    effects: inlineImageSelectionEffect.of(null),
    annotations: [Transaction.userEvent.of("delete.inlineImage"), isolateHistory.of("full")],
  });
  breakHistoryGroup();
  focusEditor(view);
  return true;
}

function moveCaretFromSelectedImage(view: EditorView, direction: -1 | 1): boolean {
  const selection = view.state.field(inlineImageSelectionField, false);
  if (!selection) return false;
  view.dispatch({
    selection: { anchor: direction < 0 ? selection.from : selection.to },
    effects: inlineImageSelectionEffect.of(null),
  });
  focusEditor(view);
  return true;
}

function clearSelectedInlineImage(view: EditorView): boolean {
  if (!view.state.field(inlineImageSelectionField, false)) return false;
  view.dispatch({ effects: inlineImageSelectionEffect.of(null) });
  focusEditor(view);
  return true;
}

function startImageDrag(
  event: PointerEvent,
  wrapper: HTMLElement,
  view: EditorView,
  widget: InlineImageWidget,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  const move = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
    moved = true;
    wrapper.dataset.dragging = "true";
    moveEvent.preventDefault();
  };
  const finish = (finishEvent: PointerEvent, cancelled: boolean) => {
    if (finishEvent.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", pointerCancel);
    delete wrapper.dataset.dragging;
    if (!moved || cancelled || !view.dom.isConnected) return;
    const destination = view.posAtCoords({ x: finishEvent.clientX, y: finishEvent.clientY });
    const current = currentImageWidget.get(wrapper) ?? widget;
    if (destination !== null) moveInlineImage(view, current, destination, breakHistoryGroup);
  };
  const pointerUp = (finishEvent: PointerEvent) => finish(finishEvent, false);
  const pointerCancel = (finishEvent: PointerEvent) => finish(finishEvent, true);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", pointerCancel);
}

function moveInlineImage(
  view: EditorView,
  widget: InlineImageWidget,
  destination: number,
  breakHistoryGroup: BreakHistoryGroup,
): void {
  const { from, to, raw } = widget;
  if (view.state.sliceDoc(from, to) !== raw || destination >= from && destination <= to) return;
  const target = Math.max(0, Math.min(view.state.doc.length, destination));
  const afterDrop = target > to ? target - (to - from) : target;
  const changes = target < from
    ? [{ from: target, to: target, insert: raw }, { from, to, insert: "" }]
    : [{ from, to, insert: "" }, { from: target, to: target, insert: raw }];
  breakHistoryGroup();
  view.dispatch({
    changes,
    selection: { anchor: afterDrop + raw.length },
    effects: inlineImageSelectionEffect.of(null),
    annotations: [Transaction.userEvent.of("input.inlineImageMove"), isolateHistory.of("full")],
  });
  focusEditor(view);
  breakHistoryGroup();
}

function clearImageSelectionState(view: EditorView): void {
  if (view.state.field(inlineImageSelectionField, false)) {
    view.dispatch({ effects: inlineImageSelectionEffect.of(null) });
  }
}

function focusEditor(view: EditorView): void {
  if (typeof view.focus === "function") view.focus();
}

function clampWidth(width: number): number {
  return Math.max(5, Math.min(100, Math.round(width)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
