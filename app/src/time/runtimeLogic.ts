import type { Link } from "../model/link";
import type { Note } from "../model/note";

export interface TimeCountersSnapshot {
  appMs: number;
  activeMs: number;
}

/** Count the elapsed wall-clock gap once; only a continuously focused window earns active time. */
export function advanceTimeCounters(
  counters: TimeCountersSnapshot,
  lastAt: number,
  now: number,
  wasFocused: boolean,
): { counters: TimeCountersSnapshot; elapsedMs: number; lastAt: number } {
  const elapsedMs = Math.max(0, now - lastAt);
  return {
    counters: {
      appMs: counters.appMs + elapsedMs,
      activeMs: counters.activeMs + (wasFocused ? elapsedMs : 0),
    },
    elapsedMs,
    lastAt: now,
  };
}

/** Strong links are directional: Time → Message recipients receive a due card. */
export function linkedMessagesForTime(
  timeId: string,
  notes: Readonly<Record<string, Note>>,
  links: readonly Link[],
): Note[] {
  return links.flatMap((link) => {
    if (link.from !== timeId || link.kind !== "strong") return [];
    const target = notes[link.to];
    return target?.type === "message" || target?.message ? [target] : [];
  });
}

/** A Task+Message host may keep its timer as a separate Time node: Task → Time still owns the card. */
export function taskMessageHostsForTime(
  timeId: string,
  notes: Readonly<Record<string, Note>>,
  links: readonly Link[],
): Note[] {
  return links.flatMap((link) => {
    if (link.to !== timeId || link.kind !== "strong") return [];
    const source = notes[link.from];
    return source?.task && source.message ? [source] : [];
  });
}
