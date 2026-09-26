import { describe, expect, it } from "vitest";
import { estimateJsonSize, formatStorageSize } from "../src/export/storage";

describe("storage size helpers", () => {
  it("formats bytes with readable binary units", () => {
    expect(formatStorageSize(0)).toBe("0 B");
    expect(formatStorageSize(-10)).toBe("0 B");
    expect(formatStorageSize(Number.NaN)).toBe("0 B");
    expect(formatStorageSize(1023)).toBe("1,023 B");
    expect(formatStorageSize(1024)).toBe("1 KiB");
    expect(formatStorageSize(1536)).toBe("1.5 KiB");
    expect(formatStorageSize(1024 ** 2)).toBe("1 MiB");
  });

  it("estimates JSON storage in UTF-8 bytes", () => {
    expect(estimateJsonSize({ title: "hello" })).toBe(new TextEncoder().encode('{"title":"hello"}').length);
    expect(estimateJsonSize("🦊")).toBe(new TextEncoder().encode('"🦊"').length);
    expect(estimateJsonSize(undefined)).toBe(0);
  });
});
