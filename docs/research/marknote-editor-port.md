# MarkNote editor port: research for hive R1.3

Read-only inspection of `C:\marknote` and the current `C:\hive\app\src` scaffold, 2026-09-23. No source files in either project were changed. MarkNote declares CodeMirror 6 packages (`@codemirror/view` `^6.43.11`, `@codemirror/state` `^6.7.4`, `@codemirror/commands` `^6.11.0`, `@codemirror/lang-markdown` `^6.5.2`); hive currently declares none of them.

## 1. MarkNote editor architecture

- `C:\marknote\src\editor\createEditor.ts` (~20 KB) builds an `EditorState` and mounts an `EditorView`. It assembles Markdown/live-preview, keymaps, search, settings compartments, theme, image resolution, stats, and change callbacks. Markdown is `markdown({ extensions: marknoteMarkdown })`; live preview is a separate extension (`createEditor.ts:295-303, 379-402`).
- `C:\marknote\src\editor\markdownExtensions.ts` (~9.5 KB) adds GFM and custom Lezer nodes/parsers: `==highlight==`, `%%comment%%`, `$inline math$`, `$$block math$$`, callouts and footnotes (`markdownExtensions.ts:14-16, 58-103, 269-275`). The queried `==text=={{#hex}}` color suffix does **not** appear in the source. Highlight is a fixed theme token, `var(--text-highlight-bg)` (`livePreview/blocks.ts:243`).
- `C:\marknote\src\editor\livePreview\` plus `widgets\` is ~131 KB. A view plugin parses the syntax tree and creates decorations/widgets; it hides delimiters away from the active cursor, renders links/images, and has dedicated block builders for code, tables, callouts and footnotes. This is a substantial product feature set, not the minimum editor (`livePreview/index.ts`, `plugin.ts`, `inline.ts`).
- KaTeX is lazy-loaded only when a math widget appears; rendered HTML is cached (max 256 entries) and KaTeX runs with `trust: false`, `throwOnError: false` (`livePreview/widgets/Math.ts:15-59`). Defer this for R1.3.
- `C:\marknote\src\editor\spellcheck.ts` (~21.6 KB) is a custom async CodeMirror `ViewPlugin` with decorations and suggestion UI. `spellEngine.ts` calls Tauri commands `spellcheck_check`, `spellcheck_suggest`, etc.; Rust spellcheck and bundled dictionaries are part of it. It disables native `spellcheck` on the content element (`spellcheck.ts:507-551`, `spellEngine.ts`). This is not a standalone editor extension; defer it.
- `C:\marknote\src\editor\keymap.ts` (~31 KB) includes history, formatting/list helpers, default editing bindings, Cyrillic physical-key fallback, and callbacks for MarkNote's New/Open/Save/Close window/search/zoom/image commands (`keymap.ts:707-729, 822-826`). The window/file commands must not be ported into hive's editor.
- `C:\marknote\src\editor\zoom.ts` (~5.7 KB) changes editor font size with a theme compartment and persists MarkNote settings/localStorage. It is font zoom, not the board's CSS camera transform. The editor theme uses MarkNote CSS variables (`theme.ts`, ~2.7 KB).
- MarkNote keeps one `EditorView` and swaps tab-owned `EditorState`s; it stores/restores scroll separately (`createEditor.ts:424-496`). `src/state/workspace.svelte.ts` and `document.svelte.ts` (~7.3 KB / ~9.4 KB) make those tabs file documents with paths, format, dirty/read-only/conflict state. `src/state/actions.ts` owns Tauri file/window operations and is shell code. `createEditor` itself exposes callbacks and explicitly leaves shell commands to its caller (`createEditor.ts:498+`). None of the tab/path/window model is the hive note model.

## 2. Reuse, adapt, leave out

| Source | Approx. size | Recommendation for hive |
| --- | ---: | --- |
| MarkNote package entries for `@codemirror/state`, `view`, `commands`, `lang-markdown` | small | Reuse the CM6 stack/API shape. Add only the packages hive imports, after the dependency decision; do not bring all MarkNote dependencies. Hive has no CM6 package today. |
| `src/editor/createEditor.ts` | 20 KB | Adapt its small core pattern: one `EditorView`, `EditorState`, update listener to note text, and explicit `destroy` lifecycle. Rebuild a much smaller hive factory; most of this file is formats, settings, images, search and tab plumbing. |
| `src/editor/markdownExtensions.ts` | 9.5 KB | Reuse the standard Markdown/GFM parser. Port custom Lezer syntax only when hive decides to support each extension. The custom grammar has no per-highlight hex color feature. |
| `src/editor/keymap.ts` | 31 KB | Extract/adapt only basic formatting transactions and ordinary editing bindings. Route Undo/Redo to hive's history command; route hive board actions through its command registry. Leave file/window bindings, MarkNote shortcut policy, and the 747-line full keymap out. |
| `src/editor/theme.ts` and `livePreview/blocks.ts` | 2.7 KB + part of 131 KB | Use as visual reference only; rewrite theme tokens for hive. Do not import MarkNote CSS variables or its large live-preview package into the first note. |
| `src/editor/zoom.ts` | 5.7 KB | Leave out. Hive camera zoom is board geometry, and this module changes font size and stores MarkNote preferences. |
| `src/editor/livePreview/**`, `src/editor/spellcheck.ts`, `spellEngine.ts`, Rust spellcheck/dictionaries | ~131 KB + 21.6 KB + native code/data | Leave out of R1.3. Revisit individual features in R1.8 or a separate spellcheck decision; they are coupled to settings, Tauri commands, image/file paths, and MarkNote UI. |
| `src/state/document.svelte.ts`, `workspace.svelte.ts`, `actions.ts` | 9.4 KB, 7.3 KB, larger shell module | Leave out. Hive owns note identity/text and board state; only preserve the useful boundary of “editor emits text changes, app owns persistence and commands.” |

## 3. Many notes and mount strategy

There is no useful universal “KB per CodeMirror instance” number: cost depends on document size and installed state/view extensions. A mounted `EditorView` owns DOM, event/selection observation, measurement work and each installed view plugin; a Markdown live-preview view additionally parses/builds decorations. CodeMirror's guide requires `destroy()` to release view resources. One view per visible board note would multiply that machinery even when notes are idle.

Recommended: mount **one live `EditorView` only for the note being edited**; leave the rest as static note previews using one shared renderer. Lazy-mount on the first edit/focus, and destroy or detach when editing ends. Keep inactive note text and (if needed) cursor/selection in hive state, not a mounted CM view per node. A static Markdown renderer is not in the hive scaffold; choose/reuse one separately so preview and editor agree. For R1.3 it is acceptable to show unedited Markdown text until that renderer is chosen. MarkNote's one-view/multiple-state approach is precedent, but per-note `EditorState`s with `history()` would still retain independent histories and duplicate editor state.

## 4. CM6 in hive's CSS camera transform

Current CodeMirror styling docs explicitly say that parent 2D translation and scaling are supported; rotation, 3D transform and shear are not. `EditorView` exposes `scaleX`/`scaleY`, and `requestMeasure()` is the supported read/write measurement hook. If the camera transform changes, test the live view at the new scale and request measurement after the transform has been applied. Do not change the transform from inside a measurement write callback. MarkNote's own zoom does not test this case because it changes font size instead.

Test in the real Tauri WebView at zoom minimum, 1× and maximum: click-to-place caret, arrow navigation, mouse drag selection in both directions, keyboard selection, wrapped lines, wheel/scroll bounds, note resize, camera pan/zoom, and repeated focus/unfocus. Verify `coordsAtPos`/`posAtCoords`, cursor/selection alignment, and that the board does not steal pointer input. Test popovers/tooltips only if R1.3 adds them; transformed ancestors have had fixed-position tooltip edge cases (historical CM issue #324), so do not infer those work from plain typing. If measurement/selection still fails in the target WebView, isolate the active editor in a screen-space overlay positioned from hive camera math, rather than creating a CM view for every note.

## 5. One Undo/Redo across text and board

MarkNote installs `history({ minDepth: Infinity })` and `historyKeymap` into each editor state (`keymap.ts:822-826`). That is good local editor history, but it is **not** a history shared with another state or board commands. Keeping it as-is while adding a separate board stack cannot guarantee a single chronological stream across notes and moves.

**Recommendation: make hive's app-level command stack the source of truth, and do not install CM's `history()`/`historyKeymap` for hive note editors.** Convert each document-changing CM transaction into a `note.text.edit` command containing the note ID, forward/inverse CodeMirror `ChangeSet` (or equivalent text patches), before/after selection, and grouping metadata. Coalesce adjacent typing/backspace transactions into natural typing groups; keep formatting/paste as one action. Undo/redo applies the inverse/forward edit to the named note and restores selection; tag programmatic replay with `Transaction.addToHistory.of(false)` if the CM history extension is present during a transition. Board moves and text edits then enter the same stack in order, so move → type → Undo twice means text then move. This fits ROADMAP's 64-step early log and command-history boundary.

Pros: actual cross-domain ordering, one redo branch, and one source for the R1.6 log. Costs/risks: app must define text grouping, inverse/selection handling, note activation for undoing a background note, and stack eviction. Keeping CM history per note is simpler and preserves CM's mature grouping, but a local history cannot naturally interleave with board edits and separate notes; it does not meet the stated sequence unless hive still records and dispatches every undoable CM event through a shared adapter. Prototype this before importing advanced formatting. CodeMirror transactions expose document changes and `userEvent`; the official docs describe changes as suitable for app-level history ([System Guide](https://codemirror.net/docs/guide/), [Reference: history](https://codemirror.net/docs/ref/#commands.history)).

## 6. Focus and board shortcuts

The inspected hive scaffold has a command registry (`app/src/commands/registry.svelte.ts`) and a placeholder `attachCameraInput` (`app/src/board/cameraInput.ts`); I did not find a keyboard dispatcher in those files. Keep the stated dispatcher guard when it is integrated: ignore board shortcuts when the event target is editable (`target.isContentEditable`/closest `[contenteditable="true"]`, input, textarea, select), and during IME composition. CM's editable surface is contenteditable, so this lets Space/WASD/brackets reach text entry while the editor keymap owns formatting/Undo. Also keep note-body pointer events out of board drag/pan handlers; reserve board dragging for the note header. Confirm with focused and unfocused tests for Space, WASD, brackets, Ctrl+Z, typing, and IME composition.

## 7. External `.md` changes for R1.7

Reusable pattern: `src-tauri/src/watcher.rs` uses `notify-debouncer-full` (Cargo `notify = 8.2.0`, `notify-debouncer-full = 0.6`), 200 ms debounce, watches each open path's parent directory non-recursively with shared-root reference counts, and emits `file-changed-externally`/`file-deleted` to the owning Tauri window. Before `save_file`, `commands.rs` calls `watcher.suppress(path)`; watcher suppression is normalized-path plus a 1.5 s expiry (`watcher.rs:13, 32-106, 109-181; commands.rs:440-450`). Writes use a sibling temp file and atomic replacement (`atomic_write.rs`).

The frontend reloads a clean document after an external-change event, but marks a dirty document conflicted; after asynchronous open it rechecks that the buffer is still clean before replacing it (`src/state/autosave.ts:255-280`). Reuse the pattern for note paths and note IDs in R1.7. The time-window suppression can also hide a real external edit soon after an app save; consider comparing a post-save fingerprint/content generation instead of treating every event for that path during 1.5 s as self-generated. Never overwrite a dirty note silently, per roadmap A02.

## 8. R1.3 implementation sequence and risks

1. Keep note ID, name and Markdown body separate. Define which note owns focus/edit mode and which element owns drag gestures.
2. Agree and add only the minimal CM6 packages hive imports (`state`, `view`, `commands`, `lang-markdown`; direct `@lezer/markdown` only if hive imports it). No MarkNote window/Tauri format dependencies are needed for a plain `.md` body.
3. Build a small hive editor adapter: one lazy-mounted `EditorView`, Markdown syntax, hive theme, basic formatting transactions, note-text callback, and explicit focus/destroy. Other nodes stay preview-only.
4. Wire editor focus into the board dispatcher guard and verify shortcuts/pointer separation before broadening keymaps.
5. Prototype the app-owned text command and cross-domain stack immediately: type, move, Undo twice, Redo twice; test coalescing, selection restore, and undo after switching active notes.
6. Test camera transforms at the real WebView zoom limits. Decide on a screen-space overlay only if caret/selection measurements fail; defer live preview, KaTeX, spellcheck and file watching to their roadmap steps.

Main risks are transformed DOM measurement, accidental board shortcuts while typing, selection/history drift when undoing note edits, and preview/editor rendering divergence. The largest scope trap is copying MarkNote's full editor bundle (~224 KB of the inspected editor/theme/preview/spellcheck files before Rust dictionaries and shell state) when R1.3 asks for one focused, basic editor.

### References

- Local implementation: `C:\marknote\src\editor\createEditor.ts`, `markdownExtensions.ts`, `keymap.ts`, `livePreview\`, `spellcheck.ts`, `zoom.ts`; `C:\marknote\src\state\`; `C:\marknote\src-tauri\src\watcher.rs`, `atomic_write.rs`, `commands.rs`.
- Current CodeMirror docs: [Styling example](https://codemirror.net/examples/styling/), [Reference manual](https://codemirror.net/docs/ref/), [System Guide](https://codemirror.net/docs/guide/), [Split View example](https://codemirror.net/examples/split/).
- Historical transform edge case for testing, not a claim that current 2D scaling is unsupported: [CodeMirror issue #324](https://github.com/codemirror/dev/issues/324).
