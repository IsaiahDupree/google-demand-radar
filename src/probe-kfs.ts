import { getKeywordsForSite } from "./providers/dataforseo.js";

const target = process.argv[2] ?? "smith.ai";
console.error(`Probing keywords_for_site target: ${target}\n`);
const results = await getKeywordsForSite([target]);
const r = results[0]!;
console.error(`Returned ${r.keywords.length} keywords.\n`);
const top = [...r.keywords]
  .filter((k) => k.volume > 0 && k.cpc > 0)
  .sort((a, b) => b.volume * b.cpc - a.volume * a.cpc)
  .slice(0, 25);
console.error(`Top 25 by volume × CPC:\n`);
for (const k of top) {
  console.log(
    `  ${k.keyword.padEnd(60)} vol ${k.volume.toString().padStart(8)}  cpc $${k.cpc.toFixed(2).padStart(6)}  comp ${k.competition.toFixed(2)}`
  );
}
