import { describe, expect, it } from "vitest";
import { normalizeLocale } from "../src/i18n/locales";
import { translatePluralWith, translateWith } from "../src/i18n/translate";

describe("interface translation", () => {
  const ru = {
    "Settings": "Настройки",
    "Delete “{name}”?": "Удалить «{name}»?",
    "{count} notes": { one: "{count} заметка", few: "{count} заметки", many: "{count} заметок", other: "{count} заметки" },
  };

  it("falls back to the English source text when a translation is missing", () => {
    expect(translateWith("ru", ru, "Settings")).toBe("Настройки");
    expect(translateWith("ru", ru, "Close")).toBe("Close");
    expect(translateWith("ru", ru, "Open {name}", { name: "Main" })).toBe("Open Main");
  });

  it("fills placeholders in the translated text", () => {
    expect(translateWith("ru", ru, "Delete “{name}”?", { name: "Профиль" })).toBe("Удалить «Профиль»?");
  });

  it("picks the language's plural form and keeps English one/other without a catalog", () => {
    expect(translatePluralWith("ru", ru, 1, "{count} note", "{count} notes")).toBe("1 заметка");
    expect(translatePluralWith("ru", ru, 3, "{count} note", "{count} notes")).toBe("3 заметки");
    expect(translatePluralWith("ru", ru, 11, "{count} note", "{count} notes")).toBe("11 заметок");
    expect(translatePluralWith("en", {}, 1, "{count} note", "{count} notes")).toBe("1 note");
    expect(translatePluralWith("en", {}, 2, "{count} note", "{count} notes")).toBe("2 notes");
  });

  it("shows a formatted count while choosing the form from the number", () => {
    expect(translatePluralWith("en", {}, 1494, "{count} word", "{count} words", { count: "1,494" })).toBe("1,494 words");
  });

  it("normalizes language tags to the supported set", () => {
    expect(normalizeLocale("ru-RU")).toBe("ru");
    expect(normalizeLocale("zh_CN")).toBe("zh");
    expect(normalizeLocale("ko")).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });
});
