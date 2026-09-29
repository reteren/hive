import type { MessageNodeData } from "../time/types";

export function defaultMessageData(): MessageNodeData {
  return { sound: false, overhive: false };
}

/** Missing/invalid settings use defaults; never discard the Message's text. */
export function parseMessageData(value: unknown): MessageNodeData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.sound !== "boolean" || data.overhive !== undefined && typeof data.overhive !== "boolean") return undefined;
  // Legacy expiration is deliberately discarded, even if its value was invalid.
  return { sound: data.sound, overhive: data.overhive === true };
}
