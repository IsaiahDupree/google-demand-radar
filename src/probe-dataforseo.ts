import { dataForSeoProvider } from "./providers/dataforseo.js";

async function main(): Promise<void> {
  const phrases = ["claude code", "next.js"];
  console.error(`Probing DataForSEO with ${phrases.length} phrases…\n`);
  try {
    const results = await dataForSeoProvider.fetch(phrases);
    for (const r of results) {
      const vol = r.volume.toLocaleString().padStart(8);
      const cpc = r.cpc > 0 ? `$${r.cpc.toFixed(2)}` : "$—";
      const comp = r.competition > 0 ? r.competition.toFixed(2) : "—";
      console.log(`  ${r.phrase.padEnd(28)} vol ${vol}  cpc ${cpc.padEnd(7)}  comp ${comp}`);
    }
    console.error(`\n✓ DataForSEO provider returned ${results.length} rows.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("✗ Probe failed:\n  " + msg);
    process.exit(1);
  }
}

main();
