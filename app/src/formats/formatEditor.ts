import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { formatLanguageForExtension } from "./formatLogic";

export function createFormatEditor(
  parent: HTMLElement,
  extension: string,
  text: string,
  onChange: (text: string) => void,
  onSave: () => void,
  highlight = true,
): EditorView {
  const language = highlight ? formatLanguageForExtension(extension) : "plain";
  const languageSupport = language === "markdown" ? markdown()
    : language === "javascript" ? javascript({ typescript: extension.toLowerCase() === "ts" })
      : language === "css" ? css()
        : language === "html" ? html()
          : null;
  const extensions = [
    lineNumbers(),
    history(),
    ...(languageSupport ? [languageSupport] : []),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    keymap.of([
      { key: "Mod-s", run: () => { onSave(); return true; } },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
    EditorView.contentAttributes.of({ "aria-label": "File contents" }),
    EditorView.theme({
      "&": { height: "100%", color: "var(--text)", backgroundColor: "transparent" },
      ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" },
      ".cm-content": { minHeight: "100%", padding: "8px 0" },
      ".cm-gutters": { color: "var(--text-dim)", backgroundColor: "#252525", borderRight: "1px solid #414141" },
      ".cm-activeLineGutter": { backgroundColor: "#303030" },
      ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 3%)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused": { outline: "none" },
    }),
  ];
  return new EditorView({
    parent,
    state: EditorState.create({ doc: text, extensions }),
  });
}
