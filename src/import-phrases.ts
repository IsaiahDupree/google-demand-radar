import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  loadKeywordPlannerCache,
  persistKeywordPlannerCache,
  keywordPlannerCacheStats,
  type KeywordPlannerCache,
} from "./providers/keyword-planner.js";
import { parseKeywordPlannerCsv } from "./keyword-planner-parser.js";

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run import-phrases -- <path-to-keyword-planner-export.csv>");
    process.exit(1);
  }
  const abs = path.resolve(inputPath);
  if (!existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const content = readFileSync(abs, "utf8");
  const rows = parseKeywordPlannerCsv(content);

  if (rows.length === 0) {
    console.error("No data rows parsed. Is this a Keyword Planner CSV?");
    process.exit(1);
  }

  const existing = loadKeywordPlannerCache();
  const merged: KeywordPlannerCache = { ...existing };
  const now = Date.now();
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    if (merged[row.phrase]) updated++;
    else added++;
    merged[row.phrase] = {
      volume: row.volume,
      cpc: row.cpc,
      competition: row.competition,
      fetchedAt: now,
    };
  }
  persistKeywordPlannerCache(merged);

  const stats = keywordPlannerCacheStats();
  console.error(
    `Imported ${rows.length} rows (${added} new, ${updated} updated). Cache totals:`
  );
  console.error(`  entries:      ${stats.entries}`);
  console.error(`  with volume:  ${stats.withVolume}`);
  console.error(`  with cpc:     ${stats.withCpc}`);

  // Show a few high-volume entries as a sanity check
  const topByVolume = rows
    .filter((r) => r.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);
  if (topByVolume.length > 0) {
    console.error("\nTop 10 phrases by imported volume:");
    for (const r of topByVolume) {
      const v = r.volume.toLocaleString().padStart(10);
      const cpc = r.cpc > 0 ? `$${r.cpc.toFixed(2)}` : "$—";
      console.error(`  ${v}  ${cpc.padStart(7)}  ${r.phrase}`);
    }
  }
  console.error("\nNext:");
  console.error("  1. Set keyword_provider: \"keyword_planner\" in creds.json");
  console.error("  2. SWEEP_FORCE=1 npm run sweep-all   # rescore with real data");
}

main();
