import { discoverIdeas } from "./ingest.js";

async function main(): Promise<void> {
  console.error("Discovering ideas (no triaging, no API calls beyond listing)…\n");
  const { ideas, stats } = await discoverIdeas({
    onProgress: (e) => {
      if (e.phase === "listing-local") console.error("  scanning local…");
      if (e.phase === "listing-github") console.error("  listing github…");
      if (e.phase === "listing-vercel") console.error("  listing vercel…");
    },
  });
  console.error("");
  console.log(`local:               ${stats.local}`);
  console.log(`github (deduped):    ${stats.github}`);
  console.log(`vercel (deduped):    ${stats.vercel}`);
  console.log(`duplicates dropped:  ${stats.duplicatesDropped}`);
  console.log(`already triaged:     ${stats.alreadyTriaged}`);
  console.log(`---`);
  console.log(`to triage:           ${stats.toTriage}`);

  if (ideas.length === 0) return;

  console.error("\nFirst 15 to-triage:");
  for (const i of ideas.slice(0, 15)) {
    const head = i.text.split("\n")[0]?.slice(0, 50) ?? "";
    console.log(`  [${i.source.padEnd(6)}] ${i.slug.padEnd(38)} ${head}`);
  }
  if (ideas.length > 15) console.log(`  … and ${ideas.length - 15} more`);
}

main().catch((err) => {
  console.error("probe-ingest failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
