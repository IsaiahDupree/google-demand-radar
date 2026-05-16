import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getKeywordIdeas } from "./providers/dataforseo.js";
import { loadCredentials } from "./config.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const CACHE_DIR = path.resolve(process.cwd(), "cache");
const DISCOVERIES_FILE = path.join(RESULTS_DIR, "_discoveries.json");
const OUT_FILE = path.join(RESULTS_DIR, "_adjacencies.json");
const OUT_CSV = path.join(CACHE_DIR, "adjacencies.csv");

interface DiscoveryRow {
  phrase: string;
  product: string;
  vertical: string;
  template: number;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
}

interface DiscoveryFile {
  rows: DiscoveryRow[];
}

interface AdjacencyRow {
  keyword: string;
  seed: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
}

// Patterns that signal non-commercial intent. Labs returns clickstream-like
// adjacency so seeded "ai receptionist" pulls in job-description and salary
// queries from people looking FOR work, not BUYING software. Filter those out
// before scoring; they're noise for our use case.
const NONCOMMERCIAL_PATTERNS = [
  /\bjob description\b/i,
  /\bjob duties\b/i,
  /\bduties\b/i,
  /\bsalary\b/i,
  /\bresume\b/i,
  /\bcover letter\b/i,
  /\bcareer\b/i,
  /\bhiring\b/i,
  /\binterview\b/i,
  /\bcertification\b/i,
  /\btraining\b/i,
  /\bcourse\b/i,
  /\bdefinition\b/i,
  /\bmeaning\b/i,
  /\bsynonym\b/i,
];

function isCommercial(keyword: string): boolean {
  return !NONCOMMERCIAL_PATTERNS.some((p) => p.test(keyword));
}

function discoveryScore(
  volume: number,
  cpc: number,
  competition: number
): number {
  if (volume <= 0 || cpc <= 0) return 0;
  const volScore = Math.log10(volume + 1);
  const cpcScore = Math.min(cpc, 100);
  const compFactor = Math.max(0.1, 1 - (competition || 0));
  return volScore * cpcScore * compFactor;
}

async function main(): Promise<void> {
  loadCredentials();

  if (!existsSync(DISCOVERIES_FILE)) {
    console.error("No _discoveries.json — run `npm run discover` first.");
    process.exit(1);
  }

  const data = JSON.parse(
    readFileSync(DISCOVERIES_FILE, "utf8")
  ) as DiscoveryFile;

  // Pick seeds: top N from the deduped discovery leaderboard. Same dedupe
  // logic as the briefs CLI — keep one canonical row per (product, vertical).
  const seedCount = Number(process.env.ADJACENCY_SEEDS) || 15;
  const bestByGroup = new Map<string, DiscoveryRow>();
  for (const r of data.rows) {
    if (r.score <= 0) continue;
    const key = `${r.product}::${r.vertical}`;
    const prev = bestByGroup.get(key);
    if (!prev || r.score > prev.score) bestByGroup.set(key, r);
  }
  const seedRows = Array.from(bestByGroup.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, seedCount);
  const seeds = seedRows.map((r) => r.phrase);

  console.error(
    `Labs adjacency scan: ${seeds.length} seeds (top discoveries), limit ${process.env.ADJACENCY_LIMIT || 200} ideas each.\n` +
      `Cost expectation: ~${seeds.length} × $0.0125 = $${(seeds.length * 0.0125).toFixed(2)}.\n`
  );
  console.error("Seeds:");
  for (const s of seeds) console.error(`  ${s}`);
  console.error("");

  const limit = Number(process.env.ADJACENCY_LIMIT) || 200;
  const buckets = await getKeywordIdeas(seeds, { limit });

  // Aggregate. Same idea may surface from multiple seeds — keep the seed
  // that produced the highest-volume result, but track all originating
  // seeds. Filter non-commercial patterns.
  const seenKeyword = new Map<string, AdjacencyRow>();
  let droppedNoncommercial = 0;
  for (const b of buckets) {
    const seed = b.seeds[0]!;
    for (const k of b.keywords) {
      const norm = k.keyword.trim().toLowerCase();
      if (!norm) continue;
      if (!isCommercial(norm)) {
        droppedNoncommercial++;
        continue;
      }
      const score = discoveryScore(k.volume, k.cpc, k.competition);
      const existing = seenKeyword.get(norm);
      if (!existing || score > existing.score) {
        seenKeyword.set(norm, {
          keyword: norm,
          seed,
          volume: k.volume,
          cpc: k.cpc,
          competition: k.competition,
          score,
        });
      }
    }
  }

  // Drop adjacencies already in the original discovery leaderboard — the
  // user has those. Surface only NEW phrases not in the pattern-combo scan.
  const existingPhrases = new Set(
    data.rows.map((r) => r.phrase.trim().toLowerCase())
  );
  let alreadyKnown = 0;
  for (const k of Array.from(seenKeyword.keys())) {
    if (existingPhrases.has(k)) {
      seenKeyword.delete(k);
      alreadyKnown++;
    }
  }

  const ranked = Array.from(seenKeyword.values())
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        seeds,
        stats: {
          ideas_returned_total: buckets.reduce(
            (s, b) => s + b.keywords.length,
            0
          ),
          dropped_noncommercial: droppedNoncommercial,
          dropped_already_in_discoveries: alreadyKnown,
          surviving: ranked.length,
        },
        rows: ranked,
      },
      null,
      2
    )
  );

  const csv =
    "rank,keyword,seed,volume,cpc,competition,score\n" +
    ranked
      .map(
        (r, i) =>
          `${i + 1},"${r.keyword}","${r.seed}",${r.volume},${r.cpc},${r.competition},${r.score.toFixed(2)}`
      )
      .join("\n");
  writeFileSync(OUT_CSV, csv);

  console.error(
    `\nLabs returned ${buckets.reduce((s, b) => s + b.keywords.length, 0)} ideas total.\n` +
      `  Dropped non-commercial (job desc / training / etc): ${droppedNoncommercial}\n` +
      `  Dropped already in _discoveries: ${alreadyKnown}\n` +
      `  Surviving NEW adjacencies with signal: ${ranked.length}\n`
  );
  console.error("Top 30 NEW adjacent niches:\n");
  for (let i = 0; i < Math.min(30, ranked.length); i++) {
    const r = ranked[i]!;
    console.error(
      `  ${(i + 1).toString().padStart(2)}  ${r.score.toFixed(1).padStart(6)}  ${r.volume.toString().padStart(8)}  $${r.cpc.toFixed(2).padStart(6)}  ${r.competition.toFixed(2)}  ${r.keyword}  ←from "${r.seed}"`
    );
  }
  console.error(`\nWrote ${OUT_FILE} and ${OUT_CSV}.`);
}

main().catch((err) => {
  console.error(
    "adjacency failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
