import type { Point } from "../board/cameraMath";
import type { EditorView } from "@codemirror/view";
import type { SpellcheckContext } from "./spellcheck";

export const spellcheckMenu = $state({
  open: false,
  context: null as SpellcheckContext | null,
  editor: null as EditorView | null,
  anchor: null as Point | null,
  zoomAtOpen: 1,
  suggestions: [] as string[],
  loading: false,
  error: "",
});

export function closeSpellcheckMenu(): void {
  spellcheckMenu.open = false;
  spellcheckMenu.context = null;
  spellcheckMenu.editor = null;
  spellcheckMenu.anchor = null;
  spellcheckMenu.suggestions = [];
  spellcheckMenu.loading = false;
  spellcheckMenu.error = "";
}
