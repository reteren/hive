import { TEXT_FORMAT_LANGUAGES } from "../attachments/types";

/** Human-readable text wraps; structured/code formats keep their horizontal viewport. */
export function formatWrapsLines(language: string): boolean {
  return language === "plain" || language === "markdown" || language === "csv" || language === "ini";
}

export function formatWrapsExtension(extension: string): boolean {
  const normalized = extension.toLowerCase().replace(/^\./, "");
  const language = TEXT_FORMAT_LANGUAGES[normalized as keyof typeof TEXT_FORMAT_LANGUAGES] ?? "plain";
  return formatWrapsLines(language);
}
