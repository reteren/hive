import type { Link } from "../model/link";
import type { Note } from "../model/note";

export type TransferRelation = "transfer" | "dependency" | "none" | "weak" | "missing-endpoint";

export type TransferLinkStatus =
  | "active"
  | "inactive-superseded"
  | "declined"
  | "awaiting-confirmation"
  | "dependency"
  | "weak"
  | "none"
  | "missing-endpoint";

export interface TransferLinkState {
  link: Link;
  source?: Note;
  target?: Note;
  relation: TransferRelation;
  status: TransferLinkStatus;
}

function isTask(note: Note): boolean {
  return note.task !== undefined && note.task !== null;
}

function isTextNote(note: Note): boolean {
  return note.type === "note" || note.type === "pro" || note.type === "con";
}

/** Classify the A → B pair according to the R3.7/A04 rules. */
export function classifyTransfer(link: Link, notes: Readonly<Record<string, Note>>): TransferRelation {
  if (link.kind === "weak") return "weak";

  const source = notes[link.from];
  const target = notes[link.to];
  if (!source || !target) return "missing-endpoint";
  if (!isTextNote(source) || !isTextNote(target)) return "none";
  if (isTask(source) && isTask(target)) return "dependency";
  if (!isTask(source) && isTask(target)) return "transfer";
  return "none";
}

/** A non-empty B requires a decision until the link has an explicit choice. */
export function needsTransferConfirmation(link: Link, target: Note): boolean {
  return link.transferDeclined === undefined && target.text.length > 0;
}

/**
 * Pick the latest connected, accepted source per task. Links are read in stored insertion order;
 * declined and unconfirmed links do not displace a source that is already active.
 */
export function selectActiveTransfers(
  links: readonly Link[],
  notes: Readonly<Record<string, Note>>,
): { activeByTarget: Map<string, Link>; states: TransferLinkState[] } {
  const states: TransferLinkState[] = [];
  const candidatesByTarget = new Map<string, TransferLinkState[]>();

  for (const link of links) {
    const source = notes[link.from];
    const target = notes[link.to];
    const relation = classifyTransfer(link, notes);
    if (!source || !target) {
      states.push({ link, source, target, relation, status: "missing-endpoint" });
      continue;
    }

    let status: TransferLinkStatus;
    if (relation === "weak") status = "weak";
    else if (relation === "dependency") status = "dependency";
    else if (relation !== "transfer") status = "none";
    else if (link.transferDeclined === true) status = "declined";
    else if (link.transferDeclined !== false && needsTransferConfirmation(link, target)) status = "awaiting-confirmation";
    else status = "inactive-superseded";

    const state = { link, source, target, relation, status };
    states.push(state);
    if (relation === "transfer" && link.transferDeclined === false) {
      const candidates = candidatesByTarget.get(target.id) ?? [];
      candidates.push(state);
      candidatesByTarget.set(target.id, candidates);
    }
  }

  const activeByTarget = new Map<string, Link>();
  for (const [targetId, candidates] of candidatesByTarget) {
    const winner = candidates.at(-1);
    if (!winner) continue;
    winner.status = "active";
    activeByTarget.set(targetId, winner.link);
  }

  return { activeByTarget, states };
}
