import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { mount, unmount } from "svelte";
import { createHighlightChange, DEFAULT_HIGHLIGHT_COLOR } from "./highlight";
import HexColorPicker from "../color/HexColorPicker.svelte";
import "./highlightPalette.css";

const paletteColors = [
  DEFAULT_HIGHLIGHT_COLOR,
  "#8dd17e",
  "#6db7f5",
  "#ee8eb7",
  "#b5a0f6",
];

const palettes = new WeakMap<EditorView, HTMLDivElement>();
const pickers = new WeakMap<EditorView, Record<string, unknown>>();
const paletteListeners = new WeakMap<EditorView, {
  pointerdown: (event: PointerEvent) => void;
  keydown: (event: KeyboardEvent) => void;
}>();
const paletteCommits = new WeakMap<EditorView, () => void>();
let lastColor = DEFAULT_HIGHLIGHT_COLOR;

export function applyHighlightColor(view: EditorView, color: string): boolean {
  const selection = view.state.selection.main;
  const change = createHighlightChange(
    view.state.doc.toString(),
    selection.from,
    selection.to,
    color,
  );
  if (!change) return false;

  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.selectionFrom, head: change.selectionTo },
    annotations: Transaction.userEvent.of("input.format"),
  });
  return true;
}

function placePalette(view: EditorView, palette: HTMLElement): void {
  const anchor = view.coordsAtPos(view.state.selection.main.from) ?? view.dom.getBoundingClientRect();
  const size = palette.getBoundingClientRect();
  const inset = 6;
  const below = anchor.bottom + 6;
  const top = below + size.height <= window.innerHeight - inset ? below : Math.max(inset, anchor.top - size.height - 6);
  const left = Math.min(Math.max(inset, anchor.left), window.innerWidth - size.width - inset);
  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
}

export function closeHighlightPalette(view: EditorView): void {
  const listeners = paletteListeners.get(view);
  if (listeners) {
    document.removeEventListener("pointerdown", listeners.pointerdown, true);
    document.removeEventListener("keydown", listeners.keydown, true);
    paletteListeners.delete(view);
  }
  paletteCommits.delete(view);
  const picker = pickers.get(view);
  if (picker) void unmount(picker);
  pickers.delete(view);
  palettes.get(view)?.remove();
  palettes.delete(view);
}

export function openHighlightPalette(view: EditorView): boolean {
  const commitExisting = paletteCommits.get(view);
  if (commitExisting) {
    commitExisting();
    return true;
  }
  if (view.state.selection.main.empty) return true;
  closeHighlightPalette(view);

  const palette = document.createElement("div");
  palette.className = "hive-highlight-palette";
  palette.setAttribute("data-selection-ignore", "");
  palette.setAttribute("role", "toolbar");
  palette.setAttribute("aria-label", "Highlight color palette");
  palette.addEventListener("mousedown", (event) => {
    // The HEX field needs focus; everything else keeps the editor selection.
    if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    event.stopPropagation();
  });
  palette.addEventListener("click", (event) => event.stopPropagation());
  let draftColor = lastColor;
  let dirty = false;
  const commitDraft = () => {
    if (dirty) {
      lastColor = draftColor;
      applyHighlightColor(view, draftColor);
    }
    closeHighlightPalette(view);
    view.focus();
  };
  paletteCommits.set(view, commitDraft);
  const onPointerDown = (event: PointerEvent) => {
    if (event.target instanceof Node && palette.contains(event.target)) return;
    commitDraft();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeHighlightPalette(view);
    view.focus();
  };
  paletteListeners.set(view, { pointerdown: onPointerDown, keydown: onKeyDown });
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  const label = document.createElement("span");
  label.className = "hive-highlight-title";
  label.textContent = "Highlight";
  palette.append(label);

  const colors = [lastColor, ...paletteColors.filter((color) => color !== lastColor)];
  for (const [index, color] of colors.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hive-highlight-swatch";
    button.style.backgroundColor = color;
    button.setAttribute(
      "aria-label",
      index === 0 ? `Use last highlight color ${color}` : `Highlight with ${color}`,
    );
    if (index === 0) button.setAttribute("data-last-color", "true");
    button.addEventListener("click", () => {
      draftColor = color;
      dirty = true;
    });
    palette.append(button);
  }

  const pickerHost = document.createElement("div");
  pickerHost.className = "hive-highlight-picker";
  palette.append(pickerHost);
  const picker = mount(HexColorPicker, {
    target: pickerHost,
    props: {
      value: lastColor,
      label: "Highlight colour",
      oninput: (color: string) => {
        draftColor = color;
        dirty = true;
      },
      onchange: (color: string) => {
        draftColor = color;
        dirty = true;
      },
    },
  });

  // Lives in <body>: inside the note it was clipped by the node frame.
  document.body.append(palette);
  palettes.set(view, palette);
  pickers.set(view, picker);
  placePalette(view, palette);
  palette.querySelector("button")?.focus();
  return true;
}
