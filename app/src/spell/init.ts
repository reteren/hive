import { mount } from "svelte";
import { EditorSelection } from "@codemirror/state";
import { camera, viewport } from "../board/camera.svelte";
import { screenToWorld, type Point } from "../board/cameraMath";
import { registerNodeBody } from "../notes/nodeBodies";
import DictionaryNodeBody from "./DictionaryNodeBody.svelte";
import SpellcheckContextMenu from "./SpellcheckContextMenu.svelte";
import { closeLinkContextMenu } from "../links-in-text/contextMenu.svelte";
import { editorForNote } from "../editor/editorSession";
import { closeSpellcheckMenu, spellcheckMenu } from "./contextMenu.svelte";
import { initializeSpellSettings, spellSettings } from "./settings.svelte";
import { getSpellcheckContextAt } from "./spellcheck";
import { suggestSpelling } from "./engine";
import { fitBoardPopupAnchor } from "../ui/boardAnchor";
import { refreshUserDictionary } from "./dictionary.svelte";
import "./focus.css";

registerNodeBody("glossary", DictionaryNodeBody);
void initializeSpellSettings();
void refreshUserDictionary();

if (typeof document !== "undefined") {
  const host = document.createElement("div");
  host.dataset.spellcheckOverlay = "";
  document.body.append(host);
  mount(SpellcheckContextMenu, { target: host });
  window.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element)) return;
    const content = event.target.closest<HTMLElement>(".cm-content");
    const note = content?.closest<HTMLElement>("[data-note-id]");
    if (!content || !note) return;
    const view = editorForNote(note.dataset.noteId ?? "");
    if (!view) return;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    const context = spellSettings.enabled ? getSpellcheckContextAt(view, position) : null;
    const linkUrl = event.target.closest<HTMLElement>("[data-hive-link]")?.dataset.hiveLink ?? null;
    const selection = view.state.selection.main;
    if (selection.empty || position < selection.from || position > selection.to) {
      view.dispatch({ selection: EditorSelection.cursor(position) });
    }

    const board = document.querySelector<HTMLElement>(".board");
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const world = screenToWorld(camera, viewport, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const anchor: Point = fitBoardPopupAnchor(camera, viewport, world, { width: 216, height: 360 });
    event.preventDefault();
    event.stopPropagation();
    closeLinkContextMenu();
    spellcheckMenu.open = true;
    spellcheckMenu.context = context;
    spellcheckMenu.linkUrl = linkUrl;
    spellcheckMenu.editor = view;
    spellcheckMenu.anchor = anchor;
    spellcheckMenu.zoomAtOpen = camera.zoom;
    spellcheckMenu.suggestions = [];
    spellcheckMenu.loading = Boolean(context);
    spellcheckMenu.error = "";
    if (context) {
      void suggestSpelling(context.word, context.languages).then((suggestions) => {
        if (spellcheckMenu.context !== context) return;
        spellcheckMenu.suggestions = suggestions.slice(0, 5);
        spellcheckMenu.loading = false;
      });
    }
  }, true);
  window.addEventListener("blur", closeSpellcheckMenu);
}
