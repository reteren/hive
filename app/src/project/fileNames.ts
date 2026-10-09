const INVALID_WINDOWS_CHARACTERS = /[<>:"\/\\|?*\u0000-\u001f]/g;
const WINDOWS_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i;
const MAX_BASE_NAME_UNITS = 120;

export interface ProjectNoteIdentity {
  id: string;
  name: string;
  type: string;
}

/** Return a safe, stable display name suitable for a Windows .md file basename. */
export function sanitizeNoteName(name: string): string {
  const normalized = name.normalize("NFC");
  let safe = normalized.replace(INVALID_WINDOWS_CHARACTERS, "_").replace(/[. ]+$/g, "");
  safe = truncateUtf16(safe, MAX_BASE_NAME_UNITS).replace(/[. ]+$/g, "");
  if (!safe || safe === "." || safe === "..") return "Note";
  if (WINDOWS_DEVICE_NAME.test(safe)) {
    const extensionStart = safe.indexOf(".");
    const stem = extensionStart < 0 ? safe : safe.slice(0, extensionStart);
    const extension = extensionStart < 0 ? "" : safe.slice(extensionStart);
    safe = truncateUtf16(`${stem}_${extension}`, MAX_BASE_NAME_UNITS).replace(/[. ]+$/g, "");
  }
  return safe;
}

/** Stable case-insensitive key used to reject names that collide on Windows. */
export function noteFileKey(name: string): string {
  return sanitizeNoteName(name).normalize("NFC").toLowerCase();
}

/** Calculator bodies are unused and mirrors need separate, stable filesystem paths. */
export function calculatorNoteFileName(id: string): string {
  return `${sanitizeNoteName(`Calculator-${id}`)}.md`;
}

/** Markdown file assigned to a note in board.json. */
export function noteMarkdownFileName(note: ProjectNoteIdentity): string {
  return note.type === "calculator"
    ? calculatorNoteFileName(note.id)
    : `${sanitizeNoteName(note.name)}.md`;
}

/** Shortest id prefix used in a file name; longer prefixes only when two notes share a name and a prefix. */
const ID_SUFFIX_LENGTH = 4;

function compactId(id: string): string {
  return id.replace(/[^0-9a-z]/gi, "").toLowerCase() || "0";
}

/**
 * File for a new or renamed text note: its name plus a short id piece ("Note 7 3f2a.md"), so two
 * people who each create "Note 7" in their copy of a Git project write different files.
 */
export function noteMarkdownFileNameWithId(note: ProjectNoteIdentity, length = ID_SUFFIX_LENGTH): string {
  const suffix = compactId(note.id).slice(0, length);
  const base = sanitizeNoteName(note.name);
  return `${truncateUtf16(base, MAX_BASE_NAME_UNITS - suffix.length - 1).replace(/[. ]+$/g, "") || "Note"} ${suffix}.md`;
}

/**
 * True when `file` still belongs to the note's current name: "<name>.md" from older versions or
 * "<name> <id piece>.md". A note keeps such a file, so existing projects are not renamed.
 */
export function noteFileMatchesName(note: ProjectNoteIdentity, file: string): boolean {
  if (!file.toLowerCase().endsWith(".md")) return false;
  const base = noteFileKey(file.slice(0, -3));
  const name = noteFileKey(note.name);
  if (base === name) return true;
  const id = compactId(note.id);
  for (let length = ID_SUFFIX_LENGTH; length <= id.length; length += 1) {
    if (base === noteFileKey(noteMarkdownFileNameWithId(note, length).slice(0, -3))) return true;
  }
  return false;
}

function truncateUtf16(value: string, maxUnits: number): string {
  let result = "";
  let usedUnits = 0;
  for (const character of value) {
    const units = character.length;
    if (usedUnits + units > maxUnits) break;
    result += character;
    usedUnits += units;
  }
  return result;
}
