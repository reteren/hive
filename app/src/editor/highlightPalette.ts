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
  const picker = pickers.get(view);
  if (picker) void unmount(picker);
  pickers.delete(view);
  palettes.get(view)?.remove();
  palettes.delete(view);
}

export function openHighlightPalette(view: EditorView): boolean {
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
  palette.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeHighlightPalette(view);
    view.focus();
  });

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
      lastColor = color;
      applyHighlightColor(view, color);
      closeHighlightPalette(view);
      view.focus();
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
      onchange: (color: string) => {
        lastColor = color;
        applyHighlightColor(view, color);
        closeHighlightPalette(view);
        view.focus();
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
