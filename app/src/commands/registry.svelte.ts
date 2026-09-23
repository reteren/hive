import {
  filterKnownKeyOverrides,
  sanitizeKeyOverrides,
  sameBindings,
  type KeyBindingOverrides,
} from "./keymap";

/** A command exposes both factory bindings and the user's effective bindings. */
export interface Command {
  /** Stable id, e.g. "view.home". */
  id: string;
  /** Short English label used in buttons and search. */
  label: string;
  /** Current key bindings in KeyboardEvent.code-based notation. */
  keys: string[];
  /** Factory defaults, unaffected by keymap edits. */
  defaultKeys: string[];
  run: () => void;
  /** For toggles: whether the command is currently on. */
  isActive?: () => boolean;
}

export type CommandRegistration = Omit<Command, "defaultKeys">;

export const commands: Map<string, Command> = new Map();
const registryState = $state({ revision: 0 });
let keyOverrides: KeyBindingOverrides = {};

export function registerCommand(definition: CommandRegistration): void {
  const defaultKeys = [...definition.keys];
  if (defaultKeys.some((binding) => binding.split("+").at(-1)?.trim().toLowerCase() === "tab")) {
    throw new Error("Tab is reserved for native focus navigation.");
  }

  const command = $state<Command>({
    ...definition,
    defaultKeys,
    keys: [...(keyOverrides[definition.id] ?? defaultKeys)],
  });
  commands.set(command.id, command);
  registryState.revision += 1;
}

export function getCommand(id: string): Command | undefined {
  registryState.revision;
  return commands.get(id);
}

export function getCommands(): Command[] {
  registryState.revision;
  return [...commands.values()];
}

export function getCommandKeyOverrides(): KeyBindingOverrides {
  registryState.revision;
  return Object.fromEntries(Object.entries(keyOverrides).map(([id, keys]) => [id, [...keys]]));
}

/** Apply validated overrides for known commands and refresh reactive consumers. */
export function setCommandKeyOverrides(value: unknown): void {
  const candidates = filterKnownKeyOverrides(sanitizeKeyOverrides(value), commands.keys());
  const nextOverrides: KeyBindingOverrides = {};
  const occupiedBindings = new Set<string>();

  for (const command of commands.values()) {
    const desired = candidates[command.id] ?? command.defaultKeys;
    const effective = desired.filter((binding) => {
      if (occupiedBindings.has(binding)) return false;
      occupiedBindings.add(binding);
      return true;
    });

    command.keys = [...effective];
    if (!sameBindings(effective, command.defaultKeys)) nextOverrides[command.id] = [...effective];
  }

  keyOverrides = nextOverrides;
  registryState.revision += 1;
}

export function resetCommandKeyOverride(id: string): void {
  if (!commands.has(id)) return;
  const next = getCommandKeyOverrides();
  delete next[id];
  setCommandKeyOverrides(next);
}

export function resetAllCommandKeyOverrides(): void {
  setCommandKeyOverrides({});
}

export function runCommand(id: string): void {
  getCommand(id)?.run();
}
