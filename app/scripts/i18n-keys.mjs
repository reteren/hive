// node scripts/i18n-keys.mjs [--missing <locale>] — lists every English source text the interface can show.
// Keys come from t("…"), tp(n, "one", "other"), msg("…"), command labels and history labels that are
// translated where they are shown. With --missing, prints the keys a catalog does not translate yet.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(appDir, "src");
const string = String.raw`"((?:[^"\\]|\\.)*)"`;
const patterns = [
  new RegExp(String.raw`\b(?:t|msg)\(\s*${string}`, "g"),
  new RegExp(String.raw`\btp\([^,]+,\s*${string},\s*${string}`, "g"),
  // Labels kept in English and translated where they are shown (commands, history entries).
  new RegExp(String.raw`\blabel:\s*${string}`, "g"),
  new RegExp(String.raw`\b(?:pushDrawingHistory|recordGeometryChange|geometryCommand|commitFinishedStroke|deleteSelectionItems)\(\s*${string}`, "g"),
];

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "mcp" ? [] : files(full);
    return /\.(ts|svelte)$/.test(entry) && !entry.endsWith(".d.ts") ? [full] : [];
  });
}

export function collectKeys() {
  const keys = new Map();
  for (const file of files(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        for (const raw of match.slice(1)) {
          if (raw === undefined) continue;
          const text = JSON.parse(`"${raw}"`);
          if (!/[A-Za-z]/.test(text)) continue;
          if (pattern === patterns[2] && !/^[A-Z]/.test(text)) continue;
          if (pattern === patterns[3] && text === "text") continue;
          if (!keys.has(text)) keys.set(text, file.slice(srcDir.length + 1).replaceAll("\\", "/"));
        }
      }
    }
  }
  return keys;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keys = collectKeys();
  const missingArg = process.argv.indexOf("--missing");
  if (missingArg > 0) {
    const locale = process.argv[missingArg + 1];
    const catalogPath = join(srcDir, "i18n", "catalogs", `${locale}.json`);
    const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : {};
    const missing = [...keys.keys()].filter((key) => !(key in catalog));
    process.stdout.write(JSON.stringify(missing, null, 1) + "\n");
    console.error(`${locale}: ${missing.length} of ${keys.size} missing`);
  } else {
    process.stdout.write(JSON.stringify([...keys.keys()].sort(), null, 1) + "\n");
    console.error(`${keys.size} keys`);
  }
}
