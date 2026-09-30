import type { Link } from "../model/link";
import type { Note } from "../model/note";
import type { TimeNodeData } from "../time/types";

export interface CalendarDay {
  date: Date;
  key: string;
  inCurrentMonth: boolean;
  isToday: boolean;
}

export interface CalendarOccurrence {
  timeId: string;
  dueAt: number;
  summary: string;
  targetId: string;
}

export type OccurrenceQuery = (data: TimeNodeData, fromMs: number, toMs: number, limit?: number) => readonly number[];

/** A Monday-first month grid, with the neighbouring days needed to complete each week. */
export function monthGrid(year: number, month: number, today = new Date()): CalendarDay[] {
  const firstOfMonth = localDate(year, month, 1);
  const leadingDays = (firstOfMonth.getDay() + 6) % 7;
  const dayCount = localDate(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leadingDays + dayCount) / 7) * 7;
  const firstVisible = localDate(year, month, 1 - leadingDays);
  const todayKey = localDateKey(today);

  return Array.from({ length: cellCount }, (_, index) => {
    const date = localDate(firstVisible.getFullYear(), firstVisible.getMonth(), firstVisible.getDate() + index);
    return {
      date,
      key: localDateKey(date),
      inCurrentMonth: date.getMonth() === firstOfMonth.getMonth() && date.getFullYear() === firstOfMonth.getFullYear(),
      isToday: localDateKey(date) === todayKey,
    };
  });
}

/** Project every enabled standalone or embedded Time schedule across the visible grid. */
export function calendarOccurrences(
  notes: readonly Note[],
  edges: readonly Link[],
  order: readonly string[],
  fromMs: number,
  toMs: number,
  query: OccurrenceQuery,
  selectedDay?: string,
): CalendarOccurrence[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const timedNotes = notes.filter((note) => note.time?.enabled);
  const occurrences: CalendarOccurrence[] = [];

  for (const timedNote of timedNotes) {
    const time = timedNote.time;
    if (!time) continue;
    const destination = reminderDestination(timedNote, notesById, edges, orderIndex);
    // A repeating reminder without a start date begins on the day its node was created, not in the past.
    const firstDayMs = time.schedule.kind === "at" && time.schedule.date === null && Number.isFinite(timedNote.createdAt)
      ? localMidnight(new Date(timedNote.createdAt as number)).getTime()
      : -Infinity;
    if (time.schedule.kind === "interval" && time.schedule.mode === "calendar") {
      for (let dayStart = localMidnight(new Date(fromMs)); dayStart.getTime() < toMs;) {
        const dayEnd = localMidnight(new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1));
        const limit = localDateKey(dayStart) === selectedDay ? 1_501 : 10;
        addOccurrences(query(time, dayStart.getTime(), dayEnd.getTime(), limit), dayStart.getTime(), dayEnd.getTime());
        dayStart = dayEnd;
      }
    } else {
      addOccurrences(query(time, fromMs, toMs, 500), fromMs, toMs);
    }

    function addOccurrences(dueTimes: readonly number[], start: number, end: number): void {
      for (const dueAt of dueTimes) {
        if (!Number.isFinite(dueAt) || dueAt < start || dueAt >= end || dueAt < firstDayMs) continue;
        occurrences.push({ timeId: timedNote.id, dueAt, summary: destination.summary, targetId: destination.targetId });
      }
    }
  }

  return occurrences.sort((a, b) => a.dueAt - b.dueAt || a.timeId.localeCompare(b.timeId));
}

export function occurrencesOnDay(
  occurrences: readonly CalendarOccurrence[],
  dayKey: string,
): CalendarOccurrence[] {
  return occurrences.filter((item) => localDateKey(new Date(item.dueAt)) === dayKey)
    .sort((a, b) => a.dueAt - b.dueAt || a.timeId.localeCompare(b.timeId));
}

export function visibleGridRange(days: readonly CalendarDay[]): { fromMs: number; toMs: number } {
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  if (!first || !last) return { fromMs: 0, toMs: 0 };
  return { fromMs: localMidnight(first).getTime(),
    toMs: localMidnight(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)).getTime() };
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatOccurrenceTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function firstTextLine(note: Note): string {
  const line = note.text.split(/\r?\n/, 1)[0]?.trim();
  return line || note.name;
}

function reminderDestination(
  timedNote: Note,
  notesById: ReadonlyMap<string, Note>,
  edges: readonly Link[],
  orderIndex: ReadonlyMap<string, number>,
): { summary: string; targetId: string } {
  const neighbours = edges.flatMap((edge) => {
    if (edge.kind !== "strong") return [];
    if (edge.from === timedNote.id) return [edge.to];
    if (edge.to === timedNote.id) return [edge.from];
    return [];
  }).filter((id) => notesById.has(id))
    .sort((a, b) => (orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER));

  const messages = [
    ...(timedNote.message || timedNote.type === "message" ? [timedNote] : []),
    ...neighbours.map((id) => notesById.get(id)!).filter((note) => note.message || note.type === "message"),
  ];
  for (const message of messages) {
    const task = firstLinkedTextNote(message, notesById, edges, orderIndex);
    const source = task ?? message;
    return { summary: firstTextLine(source), targetId: source.id };
  }

  const linkedTask = neighbours.map((id) => notesById.get(id)!)
    .find((note) => note.type === "note" && note.task);
  if (linkedTask) return { summary: firstTextLine(linkedTask), targetId: linkedTask.id };

  if (timedNote.task) return { summary: firstTextLine(timedNote), targetId: timedNote.id };
  return { summary: timedNote.name, targetId: timedNote.id };
}

function firstLinkedTextNote(
  message: Note,
  notesById: ReadonlyMap<string, Note>,
  edges: readonly Link[],
  orderIndex: ReadonlyMap<string, number>,
): Note | null {
  const adjacentIds = edges.flatMap((edge) => edge.from === message.id ? [edge.to] : edge.to === message.id ? [edge.from] : []);
  return adjacentIds.map((id) => notesById.get(id)).filter((note): note is Note => note?.type === "note")
    .sort((a, b) => (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
}

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12, 0, 0, 0);
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
