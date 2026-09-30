import type { Note } from "../model/note";
import { canInsertCombo } from "./logic";

export interface ComboDropPlan {
  sourceId: string;
  hostId: string;
  /** When a Message is dropped into a text host, highlight that host's text area. */
  highlightTextHostId: string | null;
  direction: "source-into-target" | "message-into-text-host";
}

/** Resolve which node survives a board drop, including dragging a text node onto Message. */
export function comboDropPlan(source: Note | undefined, target: Note | undefined): ComboDropPlan | null {
  if (!source || !target || source.id === target.id) return null;

  const targetIsMessage = target.type === "message";
  const sourceIsTextHost = source.type === "note" || source.type === "pro" || source.type === "con";
  if (targetIsMessage && sourceIsTextHost && canInsertCombo(target, source)) {
    return {
      sourceId: target.id,
      hostId: source.id,
      highlightTextHostId: source.id,
      direction: "message-into-text-host",
    };
  }

  return canInsertCombo(source, target)
    ? { sourceId: source.id, hostId: target.id, highlightTextHostId: null, direction: "source-into-target" }
    : null;
}

export function isComboDropPlan(value: unknown): value is ComboDropPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<ComboDropPlan>;
  return typeof plan.sourceId === "string" && typeof plan.hostId === "string" &&
    (plan.highlightTextHostId === null || typeof plan.highlightTextHostId === "string") &&
    (plan.direction === "source-into-target" || plan.direction === "message-into-text-host");
}
