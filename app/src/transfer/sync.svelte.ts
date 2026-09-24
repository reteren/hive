import { EditorSelection, Transaction } from "@codemirror/state";
import { board, updateNote } from "../model/board.svelte";
import { links, updateLink } from "../model/links.svelte";
import type { Link } from "../model/link";
import type { Note } from "../model/note";
import { execute } from "../history/history.svelte";
import { editing } from "../notes/editing.svelte";
import { editorForNote } from "../editor/editorSession";
import { project } from "../project/project.svelte";
import {
  acceptedSourcesToDeactivate,
  classifyTransfer,
  selectActiveTransfers,
  stabilizeActiveTransfers,
  type TransferLinkState,
} from "./logic";
import { registerTextEditParticipant } from "./textEditHooks";

/**
 * A04 choices: the last accepted connection (link insertion order) owns a task's live copy;
 * older sources remain linked and get an inactive notice. Breaking the link or changing either
 * endpoint's task status stops syncing without reverting the last copied text. External Markdown
 * reloads propagate directly without a separate Undo entry; edits in the source editor carry task
 * text through the same text history command. Local task edits are allowed, warned once, then
 * replaced at the next source edit.
 */
export interface TransferPrompt {
  linkId: string;
  sourceId: string;
  targetId: string;
  sourceName: string;
  targetName: string;
}

export interface TransferNotice {
  id: string;
  targetId: string;
  message: string;
}

export const transferUi = $state({
  prompts: [] as TransferPrompt[],
  warnings: [] as TransferNotice[],
  inactive: [] as TransferNotice[],
});

const lastSourceText = new Map<string, string>();
const lastTaskText = new Map<string, string>();
const activeLinkByTarget = new Map<string, string>();
const warnedTaskIds = new Set<string>();

let started = false;
let firstSnapshot = true;
let lastProjectPath = "";
let lastNotesRecord: Record<string, Note> | undefined;
let lastLinksRecord: Record<string, Link> | undefined;

function setTaskText(noteId: string, text: string): void {
  const note = board.notes[noteId];
  if (!note || note.text === text) return;
  updateNote(noteId, { text });
  lastTaskText.set(noteId, text);

  const view = editorForNote(noteId);
  if (!view || view.state.doc.toString() === text) return;

  const selection = view.state.selection;
  const ranges = selection.ranges.map((range) =>
    EditorSelection.range(Math.min(range.anchor, text.length), Math.min(range.head, text.length)),
  );
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.create(ranges, selection.mainIndex),
    annotations: Transaction.addToHistory.of(false),
  });
}

function warningFor(note: Note, source: Note): TransferNotice {
  return {
    id: note.id,
    targetId: note.id,
    message: `This task receives live text from ${source.name}; edits here are replaced on the next source edit.`,
  };
}

function showWarning(note: Note, source: Note): void {
  if (warnedTaskIds.has(note.id)) return;
  warnedTaskIds.add(note.id);
  transferUi.warnings = [...transferUi.warnings, warningFor(note, source)];
}

function promptFor(state: TransferLinkState): TransferPrompt | null {
  const { link, source, target } = state;
  if (!source || !target) return null;
  return {
    linkId: link.id,
    sourceId: source.id,
    targetId: target.id,
    sourceName: source.name,
    targetName: target.name,
  };
}

function updatePromptState(states: readonly TransferLinkState[]): void {
  const prompts = states.flatMap((state) => {
    if (state.relation !== "transfer" || !state.source || !state.target) return [];
    if (state.status !== "awaiting-confirmation") return [];
    return [promptFor(state)].filter((prompt): prompt is TransferPrompt => prompt !== null);
  });
  transferUi.prompts = prompts;
}

function acceptEmptyTarget(state: TransferLinkState): void {
  const { link, source, target } = state;
  if (!source || !target) return;

  const sourceText = source.text;
  updateLink(link.id, { transferDeclined: false });
  setTaskText(target.id, sourceText);
  lastSourceText.set(link.id, sourceText);
  activeLinkByTarget.set(target.id, link.id);
}

function runTransferChoice(linkId: string, choice: "replace" | "keep"): void {
  const link = links.byId[linkId];
  if (!link || classifyTransfer(link, board.notes) !== "transfer") return;
  const source = board.notes[link.from];
  const target = board.notes[link.to];
  if (!source || !target) return;

  transferUi.prompts = transferUi.prompts.filter((prompt) => prompt.linkId !== linkId);
  const previousChoice = link.transferDeclined;

  if (choice === "keep") {
    execute({
      label: "Keep task text",
      target: target.name,
      do: () => updateLink(linkId, { transferDeclined: true }),
      undo: () => updateLink(linkId, { transferDeclined: previousChoice }),
    });
    lastSourceText.delete(linkId);
    return;
  }

  const previousText = target.text;
  const nextText = source.text;
  const previousActiveLinkId = activeLinkByTarget.get(target.id);
  const supersededChoices = acceptedSourcesToDeactivate(link, Object.values(links.byId), board.notes)
    .map((superseded) => ({ id: superseded.id, transferDeclined: superseded.transferDeclined }));
  execute({
    label: "Transfer text",
    target: target.name,
    do: () => {
      for (const superseded of supersededChoices) updateLink(superseded.id, { transferDeclined: true });
      updateLink(linkId, { transferDeclined: false });
      setTaskText(target.id, nextText);
      lastSourceText.set(linkId, nextText);
      activeLinkByTarget.set(target.id, linkId);
    },
    undo: () => {
      updateLink(linkId, { transferDeclined: previousChoice });
      for (const superseded of supersededChoices) {
        updateLink(superseded.id, { transferDeclined: superseded.transferDeclined });
      }
      setTaskText(target.id, previousText);
      lastSourceText.delete(linkId);
      if (previousActiveLinkId) activeLinkByTarget.set(target.id, previousActiveLinkId);
      else activeLinkByTarget.delete(target.id);
    },
  });
}

export function replaceTransferText(linkId: string): void {
  runTransferChoice(linkId, "replace");
}

export function keepTaskText(linkId: string): void {
  runTransferChoice(linkId, "keep");
}

export function dismissTransferWarning(targetId: string): void {
  transferUi.warnings = transferUi.warnings.filter((warning) => warning.targetId !== targetId);
}

function resetTransferSession(): void {
  lastSourceText.clear();
  lastTaskText.clear();
  activeLinkByTarget.clear();
  warnedTaskIds.clear();
  transferUi.prompts = [];
  transferUi.warnings = [];
  transferUi.inactive = [];
  firstSnapshot = true;
}

/** Clear transfer notices and source memory when the project-scoped UI is reset. */
export function resetTransferNotices(): void {
  resetTransferSession();
}

function rememberSessionIdentity(): void {
  lastProjectPath = project.path;
  lastNotesRecord = board.notes;
  lastLinksRecord = links.byId;
}

function ensureInitialChoices(states: readonly TransferLinkState[]): boolean {
  const emptyUnchosen = states.find(
    (state) => state.relation === "transfer" &&
      state.link.transferDeclined === undefined &&
      state.status !== "awaiting-confirmation" &&
      state.target?.text.length === 0,
  );
  if (emptyUnchosen) {
    acceptEmptyTarget(emptyUnchosen);
    return true;
  }
  return false;
}

function inactiveNotices(
  states: readonly TransferLinkState[],
  activeByTarget: ReadonlyMap<string, Link>,
): TransferNotice[] {
  return states.flatMap((state) => {
    if (state.status === "declined" && state.source && state.target) {
      return [{
        id: state.link.id,
        targetId: state.target.id,
        message: `Transfer from ${state.source.name} is inactive; unlink and draw a new strong line to choose it again.`,
      }];
    }
    if (state.status === "inactive-superseded" && state.source && state.target) {
      const active = activeByTarget.get(state.target.id);
      const activeSource = active ? board.notes[active.from] : undefined;
      if (!activeSource) return [];
      return [{
        id: state.link.id,
        targetId: state.target.id,
        message: `${state.source.name} is inactive; ${activeSource.name} is the latest connected source.`,
      }];
    }
    return [];
  });
}

function applyActiveTransfers(
  activeByTarget: ReadonlyMap<string, Link>,
  initializing: boolean,
): void {
  const currentTargets = new Set<string>();
  for (const [targetId, link] of activeByTarget) {
    const source = board.notes[link.from];
    const target = board.notes[targetId];
    if (!source || !target) continue;

    currentTargets.add(targetId);
    const previousLinkId = activeLinkByTarget.get(targetId);
    const previousSourceText = lastSourceText.get(link.id);
    if (initializing) {
      lastSourceText.set(link.id, source.text);
    } else if (previousLinkId !== link.id) {
      lastSourceText.set(link.id, source.text);
    } else if (previousSourceText === undefined) {
      // An Undo may restore a removed link after its per-link baseline was discarded.
      // Seed the baseline without reapplying text or creating history.
      lastSourceText.set(link.id, source.text);
    } else if (previousSourceText !== undefined && previousSourceText !== source.text) {
      if (editing.noteId === targetId) showWarning(target, source);
      // Persistence can reload external Markdown here; it follows the source without recording
      // a second history command. Editor changes already applied their task effect in the edit.
      setTaskText(targetId, source.text);
      lastSourceText.set(link.id, source.text);
    } else if (
      editing.noteId === targetId &&
      target.text !== source.text &&
      lastTaskText.get(targetId) !== target.text
    ) {
      showWarning(target, source);
    }
    lastTaskText.set(targetId, target.text);
    activeLinkByTarget.set(targetId, link.id);
  }

  for (const targetId of [...activeLinkByTarget.keys()]) {
    if (!currentTargets.has(targetId)) {
      lastTaskText.delete(targetId);
    }
  }
}

function syncTransfers(): void {
  if (!project.ready) return;

  const identityChanged =
    (lastNotesRecord !== undefined && lastNotesRecord !== board.notes) ||
    (lastLinksRecord !== undefined && lastLinksRecord !== links.byId) ||
    (lastProjectPath !== "" && lastProjectPath !== project.path);
  if (identityChanged) resetTransferSession();
  rememberSessionIdentity();

  const linkList = Object.values(links.byId);
  const initialSelection = selectActiveTransfers(linkList, board.notes);
  if (ensureInitialChoices(initialSelection.states)) return;

  const stabilization = stabilizeActiveTransfers(
    initialSelection,
    linkList,
    board.notes,
    activeLinkByTarget,
  );
  for (const inactive of stabilization.linksToDeactivate) {
    updateLink(inactive.id, { transferDeclined: true });
  }
  const stabilized = stabilization.linksToDeactivate.length > 0
    ? selectActiveTransfers(Object.values(links.byId), board.notes)
    : { ...initialSelection, activeByTarget: stabilization.activeByTarget };
  const { activeByTarget, states } = stabilized;
  updatePromptState(states);
  transferUi.inactive = inactiveNotices(states, activeByTarget);
  applyActiveTransfers(activeByTarget, firstSnapshot);
  firstSnapshot = false;

  // Accepted inactive sources keep a fresh baseline but do not change their task until promoted.
  for (const state of states) {
    if (state.relation === "transfer" && state.link.transferDeclined === false && state.source) {
      if (activeByTarget.get(state.link.to)?.id !== state.link.id) lastSourceText.set(state.link.id, state.source.text);
    }
  }

  const currentLinkIds = new Set(linkList.map((link) => link.id));
  for (const linkId of [...lastSourceText.keys()]) {
    if (!currentLinkIds.has(linkId)) lastSourceText.delete(linkId);
  }
}

registerTextEditParticipant({
  id: "text-to-task",
  capture(noteId, _before, after) {
    const { activeByTarget } = selectActiveTransfers(Object.values(links.byId), board.notes);
    return [...activeByTarget.values()].flatMap((link) => {
      if (link.from !== noteId) return [];
      const target = board.notes[link.to];
      if (!target || target.text === after) return [];
      return [{
        key: link.id,
        before: target.text,
        after,
        apply: (text: string) => {
          setTaskText(target.id, text);
          // Undo/Redo also moves the source. Advance the observer baseline so the reactive
          // fallback does not immediately overwrite the task with the source's old text.
          lastSourceText.set(link.id, board.notes[link.from]?.text ?? "");
        },
      }];
    });
  },
});

/** Start the reactive link/task/text observer once; it follows later project replacements. */
export function startTransferSync(): void {
  if (started) return;
  started = true;
  rememberSessionIdentity();
  $effect.root(() => {
    $effect(() => {
      const ready = project.ready;
      const path = project.path;
      const notesRecord = board.notes;
      const linksRecord = links.byId;
      if (!ready) {
        resetTransferSession();
        lastProjectPath = path;
        lastNotesRecord = notesRecord;
        lastLinksRecord = linksRecord;
        return;
      }
      if (path !== lastProjectPath || notesRecord !== lastNotesRecord || linksRecord !== lastLinksRecord) {
        if (!firstSnapshot) resetTransferSession();
        lastProjectPath = path;
        lastNotesRecord = notesRecord;
        lastLinksRecord = linksRecord;
      }
      syncTransfers();
    });
  });
}
