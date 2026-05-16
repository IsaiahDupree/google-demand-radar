import { expandKeywords } from "./providers/dataforseo.js";

async function main(): Promise<void> {
  // Seeds chosen to span the high-promotion ideas surfaced by analyze-all:
  // real-estate CRM mega-theme + AI receptionist + content tooling.
  const seeds = [
    "real estate crm",
    "ai receptionist",
    "personal crm",
    "content marketing for ecommerce",
  ];
  console.error(`Probing keywords_for_keywords with ${seeds.length} seeds…\n`);
  const results = await expandKeywords(seeds, { topN: 10 });
  for (const r of results) {
    console.log(`\nseed: "${r.seed}"  (${r.keywords.length} keywords shown)`);
    for (const k of r.keywords) {
      const vol = k.volume.toLocaleString().padStart(8);
      const cpc = k.cpc > 0 ? `$${k.cpc.toFixed(2)}` : "$—";
      const comp = k.competition > 0 ? k.competition.toFixed(2) : "—";
      console.log(
        `  ${k.keyword.padEnd(50)} vol ${vol}  cpc ${cpc.padEnd(7)}  comp ${comp}`
      );
    }
  }
  console.error(`\n✓ Expansion probe returned ${results.length} seeded buckets.`);
}

main().catch((err) => {
  console.error("Probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
