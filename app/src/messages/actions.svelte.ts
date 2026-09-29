import { board, updateNote } from "../model/board.svelte";
import { execute, type HistoryCommand } from "../history/history.svelte";
import { defaultMessageData, parseMessageData } from "./data";
import type { MessageNodeData } from "../time/types";

export function setMessageSettings(noteId: string, patch: Partial<MessageNodeData>): boolean {
  const note = board.notes[noteId];
  if (note?.type !== "message") return false;
  const before = note.message ? { ...note.message } : undefined;
  const after = parseMessageData({ ...(before ?? defaultMessageData()), ...patch });
  const previous = before ?? defaultMessageData();
  if (!after || previous.sound === after.sound && previous.overhive === after.overhive) return false;
  execute({
    label: "Edit message settings", target: note.name,
    do: () => updateNote(noteId, { message: { ...after } }),
    undo: () => {
      const current = board.notes[noteId];
      if (!current) return;
      if (before) updateNote(noteId, { message: { ...before } });
      else delete current.message;
    },
  });
  return true;
}

const TEXT_EDIT = Symbol("message text edit");
interface TextEditCommand extends HistoryCommand {
  [TEXT_EDIT]: true; noteId: string; group: symbol; before: string; after: string;
}

/** A focus session is one edit; switching controls or Undo breaks the merge chain. */
export function setMessageText(noteId: string, text: string, group = Symbol()): boolean {
  const note = board.notes[noteId];
  if (note?.type !== "message" || note.text === text) return false;
  const apply = (value: string) => { if (board.notes[noteId]?.type === "message") updateNote(noteId, { text: value }); };
  const command: TextEditCommand = {
    [TEXT_EDIT]: true, noteId, group, before: note.text, after: text,
    label: "Edit message text", target: note.name,
    do() { apply(command.after); },
    undo() { apply(command.before); },
    merge(next) {
      if (!(TEXT_EDIT in next)) return false;
      const incoming = next as TextEditCommand;
      if (incoming.noteId !== noteId || incoming.group !== group || command.after !== incoming.before) return false;
      command.after = incoming.after;
      return true;
    },
  };
  execute(command);
  return true;
}
