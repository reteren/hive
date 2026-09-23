const INVALID_WINDOWS_CHARACTERS = /[<>:"\/\\|?*\u0000-\u001f]/g;
const WINDOWS_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i;
const MAX_BASE_NAME_UNITS = 120;

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
