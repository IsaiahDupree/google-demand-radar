import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AugmentedResult } from "./ingest.js";
import type { SweepResult } from "./sweep.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const SWEEPS_DIR = path.join(RESULTS_DIR, "sweeps");
const CACHE_DIR = path.resolve(process.cwd(), "cache");

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main(): void {
  if (!existsSync(RESULTS_DIR)) {
    console.error("No results/ dir. Run `npm run ingest` first.");
    process.exit(1);
  }

  const phrases = new Set<string>();

  // Phrases from triaged-idea keyword_data
  for (const file of readdirSync(RESULTS_DIR)) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    try {
      const result = JSON.parse(
        readFileSync(path.join(RESULTS_DIR, file), "utf8")
      ) as AugmentedResult;
      for (const k of result.keyword_data ?? []) {
        const p = k.phrase?.trim().toLowerCase();
        if (p) phrases.add(p);
      }
    } catch {
      // skip malformed
    }
  }

  // Phrases from vertical sweeps
  if (existsSync(SWEEPS_DIR)) {
    for (const file of readdirSync(SWEEPS_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const sweep = JSON.parse(
          readFileSync(path.join(SWEEPS_DIR, file), "utf8")
        ) as SweepResult;
        for (const v of sweep.verticals) {
          for (const p of v.phrases) {
            const t = p.phrase?.trim().toLowerCase();
            if (t) phrases.add(t);
          }
        }
      } catch {
        // skip
      }
    }
  }

  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = path.join(CACHE_DIR, "phrases-export.csv");
  const sorted = [...phrases].sort();
  const csv = "Keyword\n" + sorted.map(csvEscape).join("\n") + "\n";
  writeFileSync(outPath, csv);

  console.error(`Wrote ${sorted.length} unique phrases to:`);
  console.log(outPath);
  console.error("");
  console.error("Next steps:");
  console.error("  1. Go to https://ads.google.com → Tools & Settings → Keyword Planner");
  console.error("  2. Click 'Get search volume and forecasts'");
  console.error("  3. Click 'Enter or upload keywords' → upload this CSV");
  console.error("  4. Select 'United States' + English");
  console.error("  5. Click 'Get started'");
  console.error("  6. In the historical metrics tab, click 'Download' → 'Historical plan metrics' → 'CSV'");
  console.error("  7. Run: npm run import-phrases -- <path-to-downloaded.csv>");
}

main();
