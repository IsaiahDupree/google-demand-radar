import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { rescoreFromConcept } from "./pipeline.js";
import { loadCredentials } from "./config.js";
import type { AugmentedResult } from "./ingest.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

async function main(): Promise<void> {
  if (!existsSync(RESULTS_DIR)) {
    console.error("No results/ dir. Run `npm run ingest` first.");
    process.exit(1);
  }

  loadCredentials();

  const argSlugs = process.argv.slice(2).filter((s) => !s.startsWith("-"));
  const allSlugs = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.replace(/\.json$/, ""));
  const slugs = argSlugs.length > 0 ? argSlugs : allSlugs;

  // If specific slugs were requested, validate they exist before we start.
  if (argSlugs.length > 0) {
    const missing = argSlugs.filter((s) => !allSlugs.includes(s));
    if (missing.length > 0) {
      console.error(`Unknown slugs: ${missing.join(", ")}`);
      process.exit(2);
    }
  }

  const expandInfo =
    process.env.ANALYZE_EXPAND === "1"
      ? ` · seed expansion ON (top ${process.env.EXPAND_SEEDS_PER_BUYER || 1}/buyer × ${process.env.EXPAND_TOP_N || 10} per seed)`
      : "";
  console.error(
    `Re-analyzing ${slugs.length} ${argSlugs.length > 0 ? "selected" : "ideas"} against the current keyword provider${expandInfo}.\n` +
      `(Concept extraction is skipped — idea names and personas stay stable.)\n`
  );

  let ok = 0;
  const failed: Array<{ slug: string; error: string }> = [];
  const shifts: Array<{ slug: string; before: string; after: string; deltaScore: number }> = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]!;
    process.stderr.write(`[${i + 1}/${slugs.length}] ${slug.padEnd(40)} `);
    try {
      const file = path.join(RESULTS_DIR, `${slug}.json`);
      const existing = JSON.parse(readFileSync(file, "utf8")) as AugmentedResult;
      const beforeVerdict = existing.verdict;
      const beforeScore = existing.score.total;

      const result = await rescoreFromConcept(existing.concept, existing.source_text, {
        existingOffers: existing.offers_and_verdict,
      });
      const augmented: AugmentedResult = { ...result, meta: existing.meta };
      writeFileSync(file, JSON.stringify(augmented, null, 2));

      const arrow =
        beforeVerdict !== result.verdict
          ? ` (${beforeVerdict} → ${result.verdict})`
          : "";
      process.stderr.write(
        `${result.verdict.padEnd(13)} ${result.score.total.toFixed(1)}/35${arrow}\n`
      );
      if (beforeVerdict !== result.verdict) {
        shifts.push({
          slug,
          before: beforeVerdict,
          after: result.verdict,
          deltaScore: result.score.total - beforeScore,
        });
      }
      ok++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ slug, error });
      process.stderr.write(`FAILED — ${error.slice(0, 80)}\n`);
    }
  }

  console.error(
    `\n${ok}/${slugs.length} ok, ${failed.length} failed, ${shifts.length} verdict shifts.`
  );
  if (shifts.length > 0) {
    console.error("\nVerdict shifts:");
    for (const s of shifts) {
      const sign = s.deltaScore >= 0 ? "+" : "";
      console.error(
        `  ${s.slug.padEnd(40)} ${s.before.padEnd(13)} → ${s.after.padEnd(13)} (${sign}${s.deltaScore.toFixed(1)})`
      );
    }
  }
  if (failed.length > 0 && failed.length <= 10) {
    console.error("\nFailures:");
    for (const f of failed) {
      console.error(`  ${f.slug}: ${f.error.slice(0, 120)}`);
    }
  }
}

main().catch((err) => {
  console.error(
    "analyze-all failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
