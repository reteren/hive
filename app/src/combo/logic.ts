import { defaultMessageData } from "../messages/data";
import type { Note, NoteKind } from "../model/note";
import { copyTimeForHost, type EmbedSectionState } from "./data";

export type ComboSection = "message" | "time";

export interface ComboInsertion {
  type: NoteKind;
  name: string;
  text: string;
  hostFields?: Partial<Note>;
  time?: Note["time"];
  message?: Note["message"];
  embedSections?: EmbedSectionState;
}

const TEXT_HOSTS = new Set<NoteKind>(["note", "pro", "con"]);

export function comboSectionsFor(note: Note): ComboSection[] {
  if (note.type === "message") return note.time ? ["time"] : [];
  if (!TEXT_HOSTS.has(note.type)) return [];
  return [
    ...(note.message ? ["message" as const] : []),
    ...(note.time ? ["time" as const] : []),
  ];
}

export function canInsertCombo(source: Note | undefined, host: Note | undefined): boolean {
  if (!source || !host || source.id === host.id) return false;
  if (!TEXT_HOSTS.has(host.type) && host.type !== "time" && host.type !== "message") return false;

  const sourceIsTextHost = TEXT_HOSTS.has(source.type);
  const sourceHasMessage = source.type === "message" || source.message !== undefined;
  const sourceHasTime = source.type === "time" || source.time !== undefined;
  if (!sourceHasMessage && !sourceHasTime) return false;
  if (sourceIsTextHost && !source.message && !source.time) return false;
  const addsMessage = sourceHasMessage;
  const addsTime = sourceHasTime;
  const hasMessage = host.type === "message" || host.message !== undefined;
  const hasTime = host.type === "time" || host.time !== undefined;
  return (!addsMessage || !hasMessage) && (!addsTime || !hasTime) && (addsMessage || addsTime);
}

/** Plan the final host value for any insertion order; callers own mutation and history. */
export function planComboInsertion(host: Note, source: Note): ComboInsertion | null {
  if (!canInsertCombo(source, host)) return null;
  const sourceIsTextHost = TEXT_HOSTS.has(source.type);
  const adoptsSourceHost = sourceIsTextHost && !TEXT_HOSTS.has(host.type);
  const addsMessage = source.type === "message" || source.message !== undefined;
  const sourceHasTime = source.type === "time" || source.time !== undefined;
  const type = adoptsSourceHost
    ? source.type
    : host.type === "time" && addsMessage ? "message" : host.type;
  const becomesMessage = !adoptsSourceHost && host.type === "time" && addsMessage;
  const contentHost = adoptsSourceHost || becomesMessage ? source : host;
  const time = host.time ?? (sourceHasTime ? source.time : undefined);
  const message = host.message ?? (host.type === "message" ? defaultMessageData() : undefined) ??
    (addsMessage ? source.message ?? defaultMessageData() : undefined);
  const embeddedTime = copyTimeForHost(type, time);
  const embedSections = {
    ...(host.embedSections?.message === undefined ? {} : { message: host.embedSections.message }),
    ...(host.embedSections?.time === undefined ? {} : { time: host.embedSections.time }),
  };
  return {
    type,
    name: adoptsSourceHost || becomesMessage ? source.name : host.name,
    text: contentHost.text,
    ...(adoptsSourceHost ? { hostFields: {
      task: source.task,
      taskMemory: source.taskMemory,
      createdAt: source.createdAt,
      headerHidden: source.headerHidden,
      importance: source.importance,
      purposes: source.purposes ? [...source.purposes] : undefined,
      moods: source.moods ? [...source.moods] : undefined,
      color: source.color,
      zoneId: source.zoneId,
      customMarks: source.customMarks?.map((mark) => ({ ...mark })),
      customMarkFrame: source.customMarkFrame,
      smoothLines: source.smoothLines,
      smoothLineAnchors: source.smoothLineAnchors ? { ...source.smoothLineAnchors } : undefined,
    } } : {}),
    ...(embeddedTime ? { time: embeddedTime } : {}),
    ...(message ? { message: { ...message } } : {}),
    ...(Object.keys(embedSections).length > 0 ? { embedSections } : {}),
  };
}

export function sectionExpanded(state: EmbedSectionState | undefined, section: ComboSection): boolean {
  return state?.[section] !== false;
}

export function nextSectionState(
  state: EmbedSectionState | undefined,
  section: ComboSection,
): EmbedSectionState {
  return { ...state, [section]: !sectionExpanded(state, section) };
}
