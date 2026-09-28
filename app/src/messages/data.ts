import type { MessageNodeData } from "../time/types";

export function defaultMessageData(): MessageNodeData {
  return { sound: false, autoHideSeconds: null };
}

/** Missing/invalid settings use defaults; never discard the Message's text. */
export function parseMessageData(value: unknown): MessageNodeData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.sound !== "boolean" ||
    !(data.autoHideSeconds === null || typeof data.autoHideSeconds === "number" && Number.isFinite(data.autoHideSeconds) && data.autoHideSeconds > 0)) return undefined;
  return { sound: data.sound, autoHideSeconds: data.autoHideSeconds };
}

export function parseAutoHideInput(value: string): { seconds: number | null; error: string | null } {
  if (!value.trim()) return { seconds: null, error: null };
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? { seconds, error: null }
    : { seconds: null, error: "Enter a number of seconds greater than zero, or leave it empty." };
}
