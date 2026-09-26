import type { Component } from "svelte";
import type { Note, NoteKind } from "../model/note";

/**
 * R5 body registry: a node kind can provide its own body component instead of the text editor.
 * NoteNode renders the registered body for that kind; kinds without a registration keep the
 * default behaviour. Each R5 module registers its body from its own init file.
 */
const bodies = new Map<NoteKind, Component<{ note: Note }>>();

export function registerNodeBody(kind: NoteKind, component: Component<{ note: Note }>): void {
  bodies.set(kind, component);
}

export function nodeBodyFor(kind: NoteKind): Component<{ note: Note }> | undefined {
  return bodies.get(kind);
}
