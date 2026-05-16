import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { loadCredentials } from "./config.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

const SOURCE_FILES = {
  pattern: path.join(RESULTS_DIR, "_discoveries.json"),
  adjacency: path.join(RESULTS_DIR, "_adjacencies.json"),
  gap: path.join(RESULTS_DIR, "_competitor-gaps.json"),
} as const;

type Source = keyof typeof SOURCE_FILES;

const BriefSchema = z.object({
  product_in_plain_language: z
    .string()
    .describe(
      "What product or service is the buyer actually trying to buy? 1 sentence in their own words, not marketing speak."
    ),
  mvp_in_2_weeks: z
    .string()
    .describe(
      "What's the simplest version a solo founder could ship in 2 weeks? Concrete features only — not 'AI-powered platform', but 'web form + email + Stripe Checkout'."
    ),
  distribution: z
    .string()
    .describe(
      "How would a solo founder reach this buyer cheaply? Specific channels: Google ads on these phrases, /r/X subreddit, X industry FB group, X conference, etc."
    ),
  pricing_anchor: z
    .string()
    .describe(
      "What would the buyer expect to pay? Use real anchors when known ('$300/mo like competitor X', '$2k one-time setup + $100/mo retainer'). Be specific."
    ),
  biggest_risk: z
    .string()
    .describe(
      "What's the biggest risk that kills this idea even with high search demand? Be honest — high CPC alone doesn't make a market winnable."
    ),
});
type Brief = z.infer<typeof BriefSchema>;

// Loose shape that covers all three on-disk row formats.
interface AnyRow {
  // Pattern shape
  phrase?: string;
  product?: string;
  vertical?: string;
  template?: number;
  // Adjacency / gap shape
  keyword?: string;
  seed?: string;
  cluster?: string;
  competitor?: string;
  // Shared metrics
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: Brief;
}

interface AnyFile {
  rows: AnyRow[];
  [k: string]: unknown;
}

function rowPhrase(row: AnyRow): string {
  return (row.phrase ?? row.keyword ?? "").trim();
}

// Source-specific context blob for the LLM prompt.
function rowContext(source: Source, row: AnyRow): string {
  if (source === "pattern") {
    return `Product category: ${row.product}\nVertical: ${row.vertical}`;
  }
  if (source === "adjacency") {
    return `Surfaced from seed: "${row.seed}" (semantically adjacent niche, not a direct variation)`;
  }
  return `Cluster: ${row.cluster}\nCompetitor ranking for it: ${row.competitor}`;
}

const SYSTEM_PROMPT = `You are an analyst helping a solo founder decide which niche to ship into.

A "niche" here is a Google search phrase with measurable demand: real buyers Google this phrase at a known volume, with a known CPC (what advertisers pay per click), and a known competition_index.

For each niche, you produce a tight, action-oriented brief that answers: what would this buyer pay me to make?

Rules:
- High CPC means buyers are spending real money on this problem. Don't be skeptical of demand — be skeptical of fit.
- Be specific about MVPs. "AI-powered platform" is not a 2-week MVP; "web form + GPT email + Stripe Checkout" is.
- Don't invent features. If the buyer is searching "billing software for plumbers", they want billing software, not a "comprehensive operations suite."
- Pricing anchor should reference real market prices when possible (Service Titan ~$300/mo, FreshBooks ~$30/mo, etc).
- For biggest_risk, push past "saturated market." Real risks: integration burden, regulated industry, sales cycle longer than CAC tolerates, churn from one-off-need buyers.`;

async function generateBrief(
  client: OpenAI,
  source: Source,
  row: AnyRow,
  model: string
): Promise<Brief> {
  const completion = await client.beta.chat.completions.parse({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Niche:
  Phrase: "${rowPhrase(row)}"
${rowContext(source, row)
  .split("\n")
  .map((l) => "  " + l)
  .join("\n")}
  Monthly search volume: ${row.volume}
  Cost per click (Google Ads): $${row.cpc.toFixed(2)}
  Competition index: ${row.competition.toFixed(2)} (0 = wide open, 1 = saturated)

Produce the brief.`,
      },
    ],
    response_format: zodResponseFormat(BriefSchema, "discovery_brief"),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message.refusal;
    throw new Error(
      refusal ? `OpenAI refused: ${refusal}` : "OpenAI returned empty brief."
    );
  }
  return parsed;
}

function parseSource(): Source {
  const args = process.argv.slice(2);
  for (const a of args) {
    const m = a.match(/^--source=(.+)$/);
    if (m && m[1] && m[1] in SOURCE_FILES) return m[1] as Source;
  }
  // Backward compat: bare `--adjacency` / `--gap` shorthand.
  if (args.includes("--adjacency")) return "adjacency";
  if (args.includes("--gap")) return "gap";
  return "pattern";
}

async function main(): Promise<void> {
  const source = parseSource();
  const file = SOURCE_FILES[source];
  if (!existsSync(file)) {
    console.error(
      `No ${file}. Run the matching discovery CLI first (discover / adjacency / competitor-gap).`
    );
    process.exit(1);
  }
  const creds = loadCredentials();
  if (!creds.openai_api_key) {
    console.error("openai_api_key is empty in creds.");
    process.exit(1);
  }

  const model = process.env.DISCOVER_BRIEF_MODEL || "gpt-4o-mini";
  const topN = Number(process.env.DISCOVER_BRIEF_N) || 30;
  const force = process.env.BRIEF_FORCE === "1";

  const data = JSON.parse(readFileSync(file, "utf8")) as AnyFile;
  const candidates = data.rows.filter((r) => r.score > 0);

  // Two-pass dedupe so we don't waste briefs:
  // (a) For pattern source, dedupe template variants by (product, vertical).
  // (b) For all sources, dedupe identical (vol, cpc, comp) tuples — those are
  //     the same DFS query under different surface phrasings.
  // Rows that already have a brief win ties (no point re-briefing them).
  function preferBriefed(prev: AnyRow, cur: AnyRow): AnyRow {
    const prevHasBrief = !!prev.brief;
    const curHasBrief = !!cur.brief;
    if (curHasBrief && !prevHasBrief) return cur;
    if (curHasBrief === prevHasBrief && cur.score > prev.score) return cur;
    return prev;
  }

  const groupBy = new Map<string, AnyRow>();
  for (const r of candidates) {
    const phrase = rowPhrase(r);
    if (!phrase) continue;
    let key: string;
    if (source === "pattern") {
      key = `pv::${r.product}::${r.vertical}`;
    } else {
      // Metric-tuple key: identical metrics = same query bucket.
      key = `m::${r.volume}::${r.cpc}::${r.competition}`;
    }
    const prev = groupBy.get(key);
    groupBy.set(key, prev ? preferBriefed(prev, r) : r);
  }

  const ranked = Array.from(groupBy.values()).sort((a, b) => b.score - a.score);
  const targets = ranked.slice(0, topN);

  console.error(
    `Generating briefs for top ${targets.length} ${source} niches (model: ${model}).\n` +
      `Skipping rows that already have a brief unless BRIEF_FORCE=1.\n` +
      `Source file: ${path.relative(process.cwd(), file)}\n`
  );

  const client = new OpenAI({ apiKey: creds.openai_api_key });
  let ok = 0;
  let skipped = 0;
  const failed: Array<{ phrase: string; error: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    if (target.brief && !force) {
      skipped++;
      continue;
    }
    const phrase = rowPhrase(target);
    process.stderr.write(`[${i + 1}/${targets.length}] ${phrase.padEnd(55)} `);
    try {
      const brief = await generateBrief(client, source, target, model);
      // Find the original row in data.rows and mutate (targets is a sorted
      // dedup view; multiple rows can share metrics).
      const phraseKey = phrase.trim().toLowerCase();
      const original = data.rows.find(
        (r) => rowPhrase(r).trim().toLowerCase() === phraseKey
      );
      if (original) original.brief = brief;
      ok++;
      process.stderr.write(`ok\n`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failed.push({ phrase, error });
      process.stderr.write(`FAILED — ${error.slice(0, 80)}\n`);
    }
  }

  writeFileSync(file, JSON.stringify(data, null, 2));

  console.error(
    `\n${ok} briefs generated, ${skipped} skipped (already had briefs), ${failed.length} failed.`
  );
  if (failed.length > 0 && failed.length <= 10) {
    console.error("\nFailures:");
    for (const f of failed) {
      console.error(`  ${f.phrase}: ${f.error.slice(0, 120)}`);
    }
  }
}

main().catch((err) => {
  console.error(
    "discover-briefs failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
