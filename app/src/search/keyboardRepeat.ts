/**
 * Optional command metadata; commands are single-shot unless they opt into held-key repeats.
 * Current zoom/grid steps stay single-shot; continuous camera movement has its own input loop.
 */
declare module "../commands/registry.svelte" {
  interface Command {
    repeat?: boolean;
  }
}

export function shouldRunOnKeydown(command: { repeat?: boolean }, isRepeat: boolean): boolean {
  return !isRepeat || command.repeat === true;
}
