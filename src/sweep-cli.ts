import { runSweep } from "./sweep.js";

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npm run sweep -- <slug>");
    console.error("Example: npm run sweep -- vellopad");
    process.exit(1);
  }
  console.error(`Sweeping verticals for: ${slug}\n`);
  const result = await runSweep(slug, {
    onProgress: (e) => {
      if (e.phase === "loading") process.stderr.write("→ Loading idea result…\n");
      if (e.phase === "extracting-verticals")
        process.stderr.write("→ Extracting verticals (OpenAI)…\n");
      if (e.phase === "fetching-keywords")
        process.stderr.write(
          `→ Fetching ${e.total} phrases (one batched call)…\n`
        );
      if (e.phase === "scoring") process.stderr.write("→ Scoring verticals…\n");
    },
  });

  console.error(`\n✓ ${result.verticals.length} verticals scored\n`);
  console.log(
    "rank  PMF   demand  bofu%  cpc    vertical".padEnd(60) + "top phrase"
  );
  console.log("-".repeat(120));
  result.verticals.forEach((v, i) => {
    const rank = `${i + 1}.`.padEnd(4);
    const pmf = v.pmf_score.toFixed(1).padStart(4);
    const demand = v.demand_score.toFixed(2).padStart(5);
    const bofu = `${Math.round(v.bofu_density * 100)}%`.padStart(4);
    const cpc = v.max_cpc > 0 ? `$${v.max_cpc.toFixed(2)}`.padStart(6) : "  —  ";
    const name = v.name.padEnd(40);
    console.log(`${rank}  ${pmf}  ${demand}   ${bofu}   ${cpc} ${name}${v.top_phrase}`);
  });
  console.log("");
  console.log(`Cross-vertical insight: ${result.cross_vertical_insight}`);
  console.log(
    `\nSaved to: results/sweeps/${result.slug}.json`
  );
}

main().catch((err) => {
  console.error(
    "Sweep failed:",
    err instanceof Error ? err.message : String(err)
  );
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
