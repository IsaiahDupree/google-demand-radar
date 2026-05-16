import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { analyze } from "./pipeline.js";
import { loadCredentials } from "./config.js";
import type { AugmentedResult } from "./ingest.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

// Files where discovery output lives. Order matters — we prefer richer
// provenance (pattern has product+vertical; gap has cluster+competitor) over
// thinner (adjacency just has a seed; mobile has nothing).
const DISCOVERY_FILES = [
  { kind: "pattern", file: path.join(RESULTS_DIR, "_discoveries.json") },
  { kind: "gap", file: path.join(RESULTS_DIR, "_competitor-gaps.json") },
  { kind: "adjacency", file: path.join(RESULTS_DIR, "_adjacencies.json") },
  { kind: "mobile", file: path.join(RESULTS_DIR, "_mobile-discoveries.json") },
] as const;

interface Brief {
  product_in_plain_language: string;
  mvp_in_2_weeks: string;
  distribution: string;
  pricing_anchor: string;
  biggest_risk: string;
}

interface AnyRow {
  phrase?: string;
  keyword?: string;
  product?: string;
  vertical?: string;
  seed?: string;
  cluster?: string;
  competitor?: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: Brief;
}

interface AnyFile {
  rows: AnyRow[];
}

interface NicheMatch {
  kind: (typeof DISCOVERY_FILES)[number]["kind"];
  row: AnyRow;
  phrase: string;
}

function rowPhrase(r: AnyRow): string {
  return (r.phrase ?? r.keyword ?? "").trim().toLowerCase();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

// Find a niche across all discovery files. First exact-match wins.
function findNiche(query: string): NicheMatch | null {
  const q = query.trim().toLowerCase();
  for (const { kind, file } of DISCOVERY_FILES) {
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8")) as AnyFile;
    for (const r of data.rows) {
      if (rowPhrase(r) === q) {
        return { kind, row: r, phrase: q };
      }
    }
  }
  return null;
}

// Build a source_text the analyze pipeline can chew on. The brief, when
// present, gives the most actionable scaffolding; we frame it as a project
// description so extractConceptAndBuyers produces sensible buyer personas.
function synthesizeSourceText(m: NicheMatch): string {
  const { row, phrase } = m;
  const lines: string[] = [];

  if (row.brief) {
    lines.push(`${row.brief.product_in_plain_language}`);
    lines.push("");
    lines.push(
      `Buyers search Google for "${phrase}" — currently ~${row.volume.toLocaleString()} monthly searches at $${row.cpc.toFixed(2)} CPC, competition_index ${row.competition.toFixed(2)} (DataForSEO). That CPC means advertisers are spending real money to win these buyers.`
    );
    lines.push("");
    lines.push(`MVP scope (2 weeks): ${row.brief.mvp_in_2_weeks}`);
    lines.push("");
    lines.push(`Distribution: ${row.brief.distribution}`);
    lines.push("");
    lines.push(`Pricing anchor: ${row.brief.pricing_anchor}`);
    lines.push("");
    lines.push(`Biggest risk: ${row.brief.biggest_risk}`);
  } else {
    lines.push(
      `A product targeting buyers who search "${phrase}". Monthly search volume ~${row.volume.toLocaleString()}, CPC $${row.cpc.toFixed(2)}, competition_index ${row.competition.toFixed(2)} per DataForSEO.`
    );
  }

  // Add provenance hints so the LLM can use them in concept extraction.
  if (row.product || row.vertical) {
    lines.push("");
    lines.push(
      `Category: ${row.product ?? "(unspecified)"}. Target vertical: ${row.vertical ?? "(unspecified)"}.`
    );
  }
  if (row.cluster) {
    lines.push("");
    lines.push(
      `Sits in the "${row.cluster}" cluster. Adjacent to existing players like ${row.competitor ?? "(unspecified)"}.`
    );
  }
  if (row.seed) {
    lines.push("");
    lines.push(
      `Surfaced from seed phrase "${row.seed}" via DataForSEO Labs adjacency analysis.`
    );
  }

  return lines.join("\n");
}

async function adoptOne(query: string): Promise<{ slug: string; verdict: string; score: number }> {
  const match = findNiche(query);
  if (!match) {
    throw new Error(
      `No discovery row matches "${query}". Check spelling — phrases must match exactly as listed in /discover.`
    );
  }
  const sourceText = synthesizeSourceText(match);
  const slug = slugify(match.phrase);
  if (slug.length === 0) throw new Error(`Could not derive slug from "${query}".`);

  process.stderr.write(
    `Adopting "${match.phrase}" (${match.kind}) -> results/${slug}.json\n`
  );
  process.stderr.write(`Running analyze pipeline...\n`);

  const result = await analyze(sourceText);
  const augmented: AugmentedResult = {
    ...result,
    meta: {
      source: "discovery",
      sourceUrl: `discovery://${match.kind}/${slug}`,
    },
  };

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = path.join(RESULTS_DIR, `${slug}.json`);
  writeFileSync(outFile, JSON.stringify(augmented, null, 2));

  return {
    slug,
    verdict: result.verdict,
    score: result.score.total,
  };
}

async function main(): Promise<void> {
  loadCredentials();
  const queries = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (queries.length === 0) {
    console.error(
      "Usage: npm run adopt-niche -- \"<phrase>\" [\"<phrase 2>\" ...]\n" +
        "Example: npm run adopt-niche -- \"answering service for plumbers\"\n" +
        "         npm run adopt-niche -- \"personal finance app\" \"period tracker app\"\n"
    );
    process.exit(2);
  }

  const results: Array<{ query: string; slug?: string; verdict?: string; score?: number; error?: string }> = [];
  for (const q of queries) {
    try {
      const r = await adoptOne(q);
      process.stderr.write(
        `  -> ${r.verdict.padEnd(13)} ${r.score.toFixed(1)}/35  (${r.slug})\n\n`
      );
      results.push({ query: q, slug: r.slug, verdict: r.verdict, score: r.score });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      process.stderr.write(`  FAILED: ${error.slice(0, 120)}\n\n`);
      results.push({ query: q, error });
    }
  }

  const ok = results.filter((r) => !r.error).length;
  console.error(`${ok}/${results.length} adopted.`);
  for (const r of results) {
    if (r.error) {
      console.error(`  ${r.query}: ${r.error.slice(0, 100)}`);
    } else {
      console.error(
        `  ${r.slug!.padEnd(40)} ${r.verdict!.padEnd(13)} ${r.score!.toFixed(1)}/35`
      );
    }
  }
}

main().catch((err) => {
  console.error(
    "adopt-niche failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
