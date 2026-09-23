import { parseKey } from "./keys";

export type KeyBindingOverrides = Record<string, string[]>;

export interface KeymapCommand {
  id: string;
  label: string;
  defaultKeys: readonly string[];
  keys: readonly string[];
}

export interface KeyBindingConflict {
  commandId: string;
  label: string;
  bindingIndex: number;
}

export interface KeyBindingEditResult {
  conflicts: KeyBindingConflict[];
  overrides: KeyBindingOverrides | null;
  error?: string;
}

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

/** User bindings use DOM KeyboardEvent.code and never include Tab or a modifier by itself. */
export function isValidUserBinding(binding: string): boolean {
  try {
    const parsed = parseKey(binding);
    return parsed.code !== "Tab" && parsed.code !== "Unidentified" && !MODIFIER_CODES.has(parsed.code);
  } catch {
    return false;
  }
}

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Convert a captured keydown to the registry's stable modifier order. */
export function bindingFromEvent(event: KeyEventLike): string | null {
  if (event.metaKey || !event.code || MODIFIER_CODES.has(event.code)) return null;
  const notation = [
    ...(event.ctrlKey ? ["Ctrl"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.altKey ? ["Alt"] : []),
    event.code,
  ].join("+");
  return isValidUserBinding(notation) ? notation : null;
}

/** Keep only safe, structurally valid keymap data from an untrusted settings file. */
export function sanitizeKeyOverrides(value: unknown): KeyBindingOverrides {
  if (!isRecord(value)) return {};

  const result: KeyBindingOverrides = {};
  for (const [commandId, candidate] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(commandId) || !Array.isArray(candidate)) continue;
    const bindings = uniqueValidBindings(candidate.filter((item): item is string => typeof item === "string"));
    if (candidate.length === 0 || bindings.length > 0) result[commandId] = bindings;
  }
  return result;
}

export function filterKnownKeyOverrides(
  overrides: KeyBindingOverrides,
  commandIds: Iterable<string>,
): KeyBindingOverrides {
  const known = new Set(commandIds);
  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([commandId]) => known.has(commandId))
      .map(([commandId, bindings]) => [commandId, [...bindings]]),
  );
}

export function findBindingConflicts(
  commands: readonly KeymapCommand[],
  targetCommandId: string,
  targetBindingIndex: number | null,
  binding: string,
): KeyBindingConflict[] {
  const conflicts: KeyBindingConflict[] = [];
  for (const command of commands) {
    command.keys.forEach((current, bindingIndex) => {
      if (current === binding && !(command.id === targetCommandId && bindingIndex === targetBindingIndex)) {
        conflicts.push({ commandId: command.id, label: command.label, bindingIndex });
      }
    });
  }
  return conflicts;
}

/**
 * Apply one binding edit. Unresolved conflicts leave all overrides untouched;
 * replacing a conflict removes that chord from its previous owner.
 */
export function editKeyBinding(
  commands: readonly KeymapCommand[],
  currentOverrides: KeyBindingOverrides,
  commandId: string,
  bindingIndex: number | null,
  binding: string,
  replaceConflicts = false,
): KeyBindingEditResult {
  if (!isValidUserBinding(binding)) return { conflicts: [], overrides: null, error: "That key cannot be used as a binding." };

  const target = commands.find((command) => command.id === commandId);
  if (!target) return { conflicts: [], overrides: null, error: "This command is no longer registered." };
  const conflicts = findBindingConflicts(commands, commandId, bindingIndex, binding);
  if (conflicts.length > 0 && !replaceConflicts) return { conflicts, overrides: null };

  const effective = new Map(commands.map((command) => [command.id, [...command.keys]]));
  for (const conflict of [...conflicts].sort((left, right) => right.bindingIndex - left.bindingIndex)) {
    if (conflict.commandId === commandId) continue;
    const keys = effective.get(conflict.commandId);
    keys?.splice(conflict.bindingIndex, 1);
  }

  const targetKeys = effective.get(commandId);
  if (!targetKeys || (bindingIndex !== null && (bindingIndex < 0 || bindingIndex >= targetKeys.length))) {
    return { conflicts: [], overrides: null, error: "The selected binding slot no longer exists." };
  }
  if (bindingIndex === null) targetKeys.push(binding);
  else targetKeys[bindingIndex] = binding;

  const assignedIndex = bindingIndex ?? targetKeys.length - 1;
  for (let index = targetKeys.length - 1; index >= 0; index -= 1) {
    if (index !== assignedIndex && targetKeys[index] === binding) {
      targetKeys.splice(index, 1);
    }
  }

  const overrides: KeyBindingOverrides = {};
  for (const command of commands) {
    const nextKeys = effective.get(command.id) ?? [];
    const uniqueKeys = nextKeys.filter((key, index) => nextKeys.indexOf(key) === index);
    if (!sameBindings(uniqueKeys, command.defaultKeys)) overrides[command.id] = uniqueKeys;
  }
  return { conflicts, overrides };
}

export function sameBindings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((binding, index) => binding === right[index]);
}

function uniqueValidBindings(bindings: readonly string[]): string[] {
  return bindings.filter((binding, index) => isValidUserBinding(binding) && bindings.indexOf(binding) === index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
