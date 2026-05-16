import { getKeywordIdeas } from "./providers/dataforseo.js";

async function main(): Promise<void> {
  const seeds = ["ai receptionist"];
  console.error(`Probing Labs keyword_ideas with seed: ${seeds.join(", ")}\n`);
  const results = await getKeywordIdeas(seeds, { limit: 25 });
  for (const r of results) {
    console.log(`\nseed: "${r.seeds.join(", ")}"  (${r.keywords.length} ideas)`);
    for (const k of r.keywords.slice(0, 25)) {
      const vol = k.volume.toLocaleString().padStart(8);
      const cpc = k.cpc > 0 ? `$${k.cpc.toFixed(2)}` : "$—";
      const comp = k.competition > 0 ? k.competition.toFixed(2) : "—";
      console.log(
        `  ${k.keyword.padEnd(50)} vol ${vol}  cpc ${cpc.padEnd(7)}  comp ${comp}`
      );
    }
  }
}

main().catch((err) => {
  console.error("Probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
