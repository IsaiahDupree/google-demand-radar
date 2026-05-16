import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { verdictFromScore } from "./scoring.js";
import type { AugmentedResult } from "./ingest.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

if (!existsSync(RESULTS_DIR)) {
  console.error("No results/ dir.");
  process.exit(1);
}

const slugs = readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => f.replace(/\.json$/, ""));

let changed = 0;
const shifts: Array<{ slug: string; before: string; after: string; total: number }> = [];

for (const slug of slugs) {
  const file = path.join(RESULTS_DIR, `${slug}.json`);
  const data = JSON.parse(readFileSync(file, "utf8")) as AugmentedResult;
  const newVerdict = verdictFromScore(data.score.total);
  if (newVerdict !== data.verdict) {
    shifts.push({
      slug,
      before: data.verdict,
      after: newVerdict,
      total: data.score.total,
    });
    data.verdict = newVerdict;
    writeFileSync(file, JSON.stringify(data, null, 2));
    changed++;
  }
}

console.error(`Re-derived verdicts for ${slugs.length} ideas. ${changed} shifted.\n`);
if (shifts.length > 0) {
  shifts.sort((a, b) => b.total - a.total);
  for (const s of shifts) {
    console.error(
      `  ${s.slug.padEnd(40)} ${s.total.toFixed(1).padStart(5)}  ${s.before.padEnd(13)} → ${s.after}`
    );
  }
}
