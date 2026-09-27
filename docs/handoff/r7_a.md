TASK A — R7.1 system side: tray, global shortcut, quick-input window

Read C:\hive\docs\handoff\r7common.md first.
Your files: app/src-tauri/** (tray, global shortcut plugin, second window "quick-input" definition in tauri.conf.json + capabilities, close-to-tray behaviour), new app/quick-input.html + src/quickInput/** (the small window UI: multiline text box, Enter = send, Shift+Enter = new line, Esc = hide), the Settings entry for the shortcut (src/settings/** — only the new "Quick input shortcut" key and its control), tests.
Worker B builds the board side (creating notes near Inbox nodes) — agree the event contract via the coordinator; proposed: the quick window emits a Tauri event "hive://quick-input" with {text: string, requestId: string} to the main window; main replies "hive://quick-input-result" {requestId, ok: boolean, error?: "no-inbox" | string}. On error the quick window keeps the text and shows the message ("No Inbox node in the open project — create one with Q → Inbox"). On ok it clears and hides.

1. Tray icon (hive icon) with menu: Open hive, Quick input, Quit. Closing the main window hides it to tray (first time: a small notification/toast "hive is still running in the tray"); Quit exits for real (flushing saves via the existing close-flush).
2. Global shortcut Ctrl+Alt+Space (rebindable in Settings; show a clear error if registration fails because another app owns it) toggles the quick-input window: small, centred, always-on-top, frameless dark style consistent with hive, focused text box.
3. The quick window works while the main window is hidden/minimised; the board side receives the event even when hidden.
4. Tests: Rust where practical; TS for the key handling / state machine of the quick window.
worker_done: exact manual steps (the coordinator can't test OS-level shortcuts in the browser, so describe precisely).
