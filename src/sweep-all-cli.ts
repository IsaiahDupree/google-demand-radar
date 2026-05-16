import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { runSweep, loadSweep } from "./sweep.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const SWEEPS_DIR = path.join(RESULTS_DIR, "sweeps");

async function main(): Promise<void> {
  if (!existsSync(RESULTS_DIR)) {
    console.error("No results/ dir. Run `npm run ingest` first.");
    process.exit(1);
  }
  const slugs = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => f.replace(/\.json$/, ""));

  const force = process.env.SWEEP_FORCE === "1";
  const dryRun = process.env.SWEEP_DRY_RUN === "1";

  const toRun = force
    ? slugs
    : slugs.filter((s) => !loadSweep(s));
  const skipped = slugs.length - toRun.length;

  console.error(
    `${slugs.length} triaged ideas · ${toRun.length} to sweep · ${skipped} skipped (existing sweep)${dryRun ? " · DRY RUN" : ""}\n`
  );
  if (toRun.length === 0) {
    console.error("Nothing to sweep. Set SWEEP_FORCE=1 to redo existing.");
    return;
  }

  let ok = 0;
  const failed: Array<{ slug: string; error: string }> = [];
  for (let i = 0; i < toRun.length; i++) {
    const slug = toRun[i]!;
    process.stderr.write(
      `[${i + 1}/${toRun.length}] ${slug.padEnd(40)} `
    );
    try {
      const r = await runSweep(slug);
      const top = r.verticals[0];
      const pmf = top ? top.pmf_score.toFixed(1) : "—";
      const topName = top ? top.name : "(no verticals)";
      process.stderr.write(`PMF ${pmf} → ${topName}\n`);
      ok++;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ slug, error });
      process.stderr.write(`FAILED — ${error.slice(0, 80)}\n`);
    }
  }

  console.error(
    `\n${ok}/${toRun.length} ok, ${failed.length} failed. Sweeps in: ${path.relative(process.cwd(), SWEEPS_DIR)}`
  );
  if (failed.length > 0 && failed.length <= 10) {
    console.error("\nFailures:");
    for (const f of failed) {
      console.error(`  ${f.slug}: ${f.error.slice(0, 120)}`);
    }
  }
}

main().catch((err) => {
  console.error(
    "sweep-all failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
