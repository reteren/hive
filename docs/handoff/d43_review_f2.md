# D43 wave regression review (f2)

Read-only review of `git diff 848349d..HEAD -- app/`, focused on behavior changes. Findings are ranked by user impact; no implementation files were changed. The review was static; I did not run the test suite or launch the app.

## Findings

### 1. [P1] An off-screen Dictaphone can keep recording without a stop control

- **Where:** `app/src/notes/NotesLayer.svelte:45-49,251-255`; `app/src/audio/AudioNodeBody.svelte:81-84`; `app/src/audio/recording.svelte.ts:86-95,125,141`.
- **Scenario:** Start recording, select another note, then pan until the Dictaphone leaves the visibility margin.
- **Why it breaks:** The audio recorder lives in the module-level `capture` session and continues after its body is destroyed. `AudioNodeBody` does not pin an active recording, so culling removes the only Stop button. The user cannot stop or save the recording until the note is mounted again, and recording continues meanwhile.
- **Suggested fix:** Pin the Dictaphone from the requesting/recording/saving phases and release it when capture ends; ensure the pin also keeps its full body mounted at reduced LOD (see finding 2).

### 2. [P1] Visibility pins do not protect active media from LOD unmounts

- **Where:** `app/src/board/visibility.svelte.ts:59-70,190`; `app/src/notes/NotesLayer.svelte:251-255`; `app/src/tierlist/audioPlayback.svelte.ts:47`; `app/src/tierlist/TierlistBody.svelte:147`.
- **Scenario:** Play audio from a Tierlist, deselect its note, then zoom from full LOD into simple/min LOD.
- **Why it breaks:** `pinNote` adds the note to `visible.ids`, which prevents viewport culling, but the NotesLayer LOD branch only keeps full bodies for full LOD, images, or selected/edited IDs. The Tierlist body is therefore replaced by a shell despite the playback pin; its destroy handler calls `stopTierlistAudioFor`, stopping playback. The same branch can destroy other pinned media bodies.
- **Suggested fix:** Make active visibility pins an explicit full-body exemption in NotesLayer, or provide separate “keep mounted” and “keep detailed” pin sets with media playback using the latter.

### 3. [P2] Low-LOD shells no longer support note editing or header rename by double-click

- **Where:** `app/src/notes/NotesLayer.svelte:251-255`; `app/src/notes/NoteShell.svelte:21-25`; `app/src/notes/NoteNode.svelte:148,193,204`.
- **Scenario:** At simple or min LOD, double-click an ordinary text note body to edit it or double-click its header to rename it.
- **Why it breaks:** The shell has no double-click handler. The board-level fallback only selects the hit note; the editing and rename actions were attached to `NoteNode`, which is unmounted at these LODs. Right-click menus and drag remain available through the shell’s note/header data attributes.
- **Suggested fix:** Preserve the existing editable-note and header-rename double-click behavior on shells, with the same kind and target exclusions as `NoteNode`.

### 4. [P2] Scrolling a PDF is lost when its body is culled or simplified

- **Where:** `app/src/formats/PdfNodeBody.svelte:25,50-51,262,288`; `app/src/notes/NotesLayer.svelte:45-49,251-255`.
- **Scenario:** Scroll several pages into a PDF, then pan far enough to cull it or zoom into simple/min LOD and later return.
- **Why it breaks:** PDF scroll position is held only in the body-local `scrollTop` state. Culling or LOD replacement destroys that component; the next instance initializes `scrollTop` to zero and never restores the scroller position.
- **Suggested fix:** Store and restore PDF scroll position by note ID outside the body component, including after document reload and size changes.

### 5. [P3] Inbox twin outline and tooltip disappear after a culled remount

- **Where:** `app/src/inbox/InboxTwinMarkerHost.svelte:6-19`; `app/src/notes/NoteShell.svelte:21-25`; `app/src/notes/NotesLayer.svelte:248-255`.
- **Scenario:** An Inbox twin is marked while mounted, then is culled while panning and later returns as a shell without any board mutation.
- **Why it breaks:** The marker host applies the dashed outline and `title` only in an effect driven by board state. A camera/visibility change does not rerun that effect, and the newly mounted shell does not declare the twin marker, so the outline and explanatory tooltip are absent after remount.
- **Suggested fix:** Render the twin marker/title from reactive note data on both `NoteNode` and `NoteShell`, or resync markers when visible note elements change.

## Review coverage

I also traced board/link/zone mutation notifications through undo/redo, board replacement and external board reload; the search/name indexes subscribe to board mutations, and the new cache revision paths are invalidated by their mutation helpers. I did not confirm a separate missed write or stale-cache regression in those paths during this static pass.
