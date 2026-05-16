import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getKeywordsForSite } from "./providers/dataforseo.js";
import { loadCredentials } from "./config.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const CACHE_DIR = path.resolve(process.cwd(), "cache");
const DISCOVERIES_FILE = path.join(RESULTS_DIR, "_discoveries.json");
const ADJACENCIES_FILE = path.join(RESULTS_DIR, "_adjacencies.json");
const OUT_FILE = path.join(RESULTS_DIR, "_competitor-gaps.json");
const OUT_CSV = path.join(CACHE_DIR, "competitor-gaps.csv");

// Hand-curated competitor list grouped by the niche clusters that emerged
// from the discovery scan. Each cluster's competitors are picked from briefs
// + standard category leaders. Edit freely — these are just URLs.
const COMPETITORS: Array<{ url: string; cluster: string }> = [
  // AI receptionist / answering service cluster
  { url: "smith.ai", cluster: "ai-receptionist" },
  { url: "ruby.com", cluster: "ai-receptionist" },
  { url: "answerconnect.com", cluster: "ai-receptionist" },
  { url: "abby.com", cluster: "ai-receptionist" },

  // Real estate CRM cluster
  { url: "followupboss.com", cluster: "real-estate-crm" },
  { url: "boomtownroi.com", cluster: "real-estate-crm" },
  { url: "kvcore.com", cluster: "real-estate-crm" },

  // Law firm software cluster
  { url: "clio.com", cluster: "law-firm-software" },
  { url: "mycase.com", cluster: "law-firm-software" },
  { url: "lawmatics.com", cluster: "law-firm-software" },

  // Trades operational software (Service Titan etc.)
  { url: "servicetitan.com", cluster: "trades-ops" },
  { url: "jobber.com", cluster: "trades-ops" },
  { url: "housecallpro.com", cluster: "trades-ops" },

  // SMB billing / accounting (the cluster vector 2 surfaced)
  { url: "freshbooks.com", cluster: "billing-accounting" },
  { url: "bill.com", cluster: "billing-accounting" },
  { url: "wave.com", cluster: "billing-accounting" },

  // Personal CRM
  { url: "dex.app", cluster: "personal-crm" },
  { url: "clay.earth", cluster: "personal-crm" },
];

interface DiscoveryFile {
  rows: Array<{ phrase: string }>;
}
interface AdjacencyFile {
  rows: Array<{ keyword: string }>;
}

interface CompetitorGapRow {
  keyword: string;
  cluster: string;
  competitor: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
}

const NONCOMMERCIAL_PATTERNS = [
  /\bjob description\b/i,
  /\bsalary\b/i,
  /\bresume\b/i,
  /\binterview\b/i,
  /\bcourse\b/i,
  /\bdefinition\b/i,
  /\bmeaning\b/i,
  /\bwiki\b/i,
  /\blogin\b/i,
  /\bsign in\b/i,
  /\bdownload\b/i,
];

// Consumer-side queries we want OUT. Competitor sites like Clio rank for huge
// consumer phrases ("personal injury lawyer near me") via content marketing
// — the searcher is hiring a lawyer, not buying law-firm software. Same for
// "best plumber near me", "find a real estate agent", etc. These pollute the
// gap leaderboard if we don't drop them.
const CONSUMER_PATTERNS = [
  /\bnear me\b/i,
  /\bnearby\b/i,
  /\b(in|near) my area\b/i,
  /\bfind a\b/i,
  /\bhow to find\b/i,
  /\bhire a\b/i,
  /\bhow much (do|does)\b/i,
  /\bhow to become\b/i,
  /\b(personal injury|car accident|slip and fall) (lawyer|attorney|law)/i,
  /\bbest (lawyer|attorney|plumber|electrician|realtor|real estate agent)\b/i,
  /\b(top|good) (lawyer|attorney|injury|personal injury)\b/i,
  /\binjury (lawyer|attorney|firm|law)/i,
  /\battorney near\b/i,
  /\blawyer near\b/i,
  /\b(my|the) (lawyer|attorney|realtor)\b/i,
];

// Drop result entries that are obviously the competitor's own brand or a
// direct trademark. Keeps the gap analysis to actual searchable niches.
function isBrandMatch(keyword: string, competitorUrls: string[]): boolean {
  const lower = keyword.toLowerCase();
  for (const url of competitorUrls) {
    const root = url
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(".")[0]!
      .toLowerCase();
    if (root.length >= 4 && lower.includes(root)) return true;
  }
  return false;
}

function isCommercial(keyword: string): boolean {
  return !NONCOMMERCIAL_PATTERNS.some((p) => p.test(keyword));
}

function isConsumerSide(keyword: string): boolean {
  return CONSUMER_PATTERNS.some((p) => p.test(keyword));
}

function discoveryScore(v: number, c: number, comp: number): number {
  if (v <= 0 || c <= 0) return 0;
  const volScore = Math.log10(v + 1);
  const cpcScore = Math.min(c, 100);
  const compFactor = Math.max(0.1, 1 - (comp || 0));
  return volScore * cpcScore * compFactor;
}

async function main(): Promise<void> {
  loadCredentials();

  // Build the universe of phrases we already know about so we can find the
  // GAPS — keywords competitors rank for that aren't in our discoveries or
  // adjacencies.
  const known = new Set<string>();
  if (existsSync(DISCOVERIES_FILE)) {
    const d = JSON.parse(readFileSync(DISCOVERIES_FILE, "utf8")) as DiscoveryFile;
    for (const r of d.rows) known.add(r.phrase.trim().toLowerCase());
  }
  if (existsSync(ADJACENCIES_FILE)) {
    const a = JSON.parse(readFileSync(ADJACENCIES_FILE, "utf8")) as AdjacencyFile;
    for (const r of a.rows) known.add(r.keyword.trim().toLowerCase());
  }
  console.error(
    `Known phrase universe: ${known.size} (discoveries + adjacencies).\n` +
      `Competitors to mine: ${COMPETITORS.length} across ${new Set(COMPETITORS.map((c) => c.cluster)).size} clusters.\n` +
      `Cost expectation: ~${COMPETITORS.length} × $0.075 = $${(COMPETITORS.length * 0.075).toFixed(2)}\n`
  );

  const urls = COMPETITORS.map((c) => c.url);
  const competitorMap = new Map<string, string>();
  for (const c of COMPETITORS) competitorMap.set(c.url, c.cluster);

  const buckets = await getKeywordsForSite(urls);

  // Aggregate. Same keyword may show up across multiple competitors — keep
  // the bucket with the highest score, but note all originating competitors.
  const best = new Map<string, CompetitorGapRow>();
  let droppedKnown = 0;
  let droppedNoncommercial = 0;
  let droppedBrand = 0;
  let droppedConsumer = 0;
  let totalReturned = 0;
  for (const b of buckets) {
    const cluster = competitorMap.get(b.target) ?? "unknown";
    totalReturned += b.keywords.length;
    for (const k of b.keywords) {
      const norm = k.keyword.trim().toLowerCase();
      if (!norm) continue;
      if (known.has(norm)) {
        droppedKnown++;
        continue;
      }
      if (!isCommercial(norm)) {
        droppedNoncommercial++;
        continue;
      }
      if (isConsumerSide(norm)) {
        droppedConsumer++;
        continue;
      }
      if (isBrandMatch(norm, urls)) {
        droppedBrand++;
        continue;
      }
      const score = discoveryScore(k.volume, k.cpc, k.competition);
      const prev = best.get(norm);
      if (!prev || score > prev.score) {
        best.set(norm, {
          keyword: norm,
          cluster,
          competitor: b.target,
          volume: k.volume,
          cpc: k.cpc,
          competition: k.competition,
          score,
        });
      }
    }
  }

  const ranked = Array.from(best.values())
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        competitors: COMPETITORS,
        stats: {
          ideas_returned_total: totalReturned,
          dropped_already_known: droppedKnown,
          dropped_noncommercial: droppedNoncommercial,
          dropped_consumer_side: droppedConsumer,
          dropped_brand_match: droppedBrand,
          surviving: ranked.length,
        },
        rows: ranked,
      },
      null,
      2
    )
  );

  const csv =
    "rank,keyword,cluster,competitor,volume,cpc,competition,score\n" +
    ranked
      .map(
        (r, i) =>
          `${i + 1},"${r.keyword}","${r.cluster}","${r.competitor}",${r.volume},${r.cpc},${r.competition},${r.score.toFixed(2)}`
      )
      .join("\n");
  writeFileSync(OUT_CSV, csv);

  console.error(
    `\nCompetitors mined: ${COMPETITORS.length}\n` +
      `  Total keywords returned: ${totalReturned}\n` +
      `  Dropped (already in discoveries/adjacencies): ${droppedKnown}\n` +
      `  Dropped (non-commercial): ${droppedNoncommercial}\n` +
      `  Dropped (consumer-side / "near me" etc): ${droppedConsumer}\n` +
      `  Dropped (competitor brand): ${droppedBrand}\n` +
      `  Surviving NEW competitor gaps with signal: ${ranked.length}\n`
  );
  console.error("Top 30 gaps:\n");
  for (let i = 0; i < Math.min(30, ranked.length); i++) {
    const r = ranked[i]!;
    console.error(
      `  ${(i + 1).toString().padStart(2)}  ${r.score.toFixed(1).padStart(6)}  ${r.volume.toString().padStart(8)}  $${r.cpc.toFixed(2).padStart(6)}  ${r.competition.toFixed(2)}  ${r.keyword}  [${r.cluster}]`
    );
  }
  console.error(`\nWrote ${OUT_FILE} and ${OUT_CSV}.`);
}

main().catch((err) => {
  console.error(
    "competitor-gap failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
