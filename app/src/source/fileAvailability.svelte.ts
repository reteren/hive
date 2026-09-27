import { invoke } from "@tauri-apps/api/core";
import { SourceFileAvailabilityCache, type FileAvailability } from "./logic";

const availabilityCache = new SourceFileAvailabilityCache(5_000);

export function checkSourceFileAvailability(filePath: string): Promise<FileAvailability> {
  return availabilityCache.check(filePath, async () => {
    try {
      const exists = await invoke<boolean>("source_path_exists", { filePath });
      return exists ? "available" : "missing";
    } catch {
      return "unknown";
    }
  });
}

export function invalidateSourceFileAvailability(filePath: string): void {
  availabilityCache.invalidate(filePath);
}
