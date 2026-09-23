/**
 * Every user-visible command lives here (R0.4). A command has a button or menu entry,
 * a current key binding and a tooltip; nothing is reachable only by memorised keys.
 */
export interface Command {
  /** Stable id, e.g. "view.home". */
  id: string;
  /** Short English label for buttons and tooltips. */
  label: string;
  /** Default key bindings in KeyboardEvent.code-based notation, e.g. "Space", "Ctrl+KeyG". */
  keys: string[];
  run: () => void;
  /** For toggles: whether the command is currently on. */
  isActive?: () => boolean;
}

export const commands: Map<string, Command> = new Map();

export function registerCommand(command: Command): void {
  commands.set(command.id, command);
}

export function runCommand(id: string): void {
  commands.get(id)?.run();
}
