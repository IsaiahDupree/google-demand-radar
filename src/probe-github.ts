import { listGithubIdeas } from "./ingest/github.js";

async function main(): Promise<void> {
  console.error("Listing GitHub repos…\n");
  try {
    const ideas = await listGithubIdeas();
    console.error(`✓ ${ideas.length} ideas materialized from GitHub.\n`);
    for (const i of ideas.slice(0, 10)) {
      const preview = i.text.split("\n").slice(0, 2).join(" · ").slice(0, 70);
      console.log(`  ${i.slug.padEnd(36)} ${preview}`);
    }
    if (ideas.length > 10) {
      console.log(`  … and ${ideas.length - 10} more`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("✗ Probe failed:\n  " + msg);
    process.exit(1);
  }
}

main();
