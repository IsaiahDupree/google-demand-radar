import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dataForSeoProvider } from "./providers/dataforseo.js";
import { loadCredentials } from "./config.js";
import type { KeywordMetric } from "./providers/keywords.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const CACHE_DIR = path.resolve(process.cwd(), "cache");

// ---------------------------------------------------------------------------
// Seed lists. Grounded in patterns the portfolio has already proven convert:
// "[product] for [vertical]" hits when both halves are buyer-language-grade.
// Hand-curated for v0 (OpenAI quota was exhausted at build time). Expand or
// regenerate via LLM later — these are just lists of strings.
// ---------------------------------------------------------------------------

const PRODUCTS = [
  // Sales / CRM / outreach
  "crm",
  "personal crm",
  "lead management software",
  "sales pipeline software",
  "outreach automation",
  "cold email tool",
  "follow-up automation",

  // Communications / receptionist / answering
  "ai receptionist",
  "answering service",
  "virtual receptionist",
  "after-hours answering service",
  "phone answering service",
  "ai voice agent",
  "sms automation",

  // Scheduling / intake
  "scheduling software",
  "appointment booking software",
  "online booking system",
  "intake form software",
  "client onboarding software",
  "client portal",

  // Operations / billing
  "billing software",
  "invoicing software",
  "payment processing",
  "estimate software",
  "quoting software",
  "dispatch software",

  // Marketing / content
  "review management software",
  "reputation management software",
  "local seo software",
  "content marketing software",
  "social media scheduler",
  "email marketing software",

  // AI / chat
  "ai chatbot",
  "ai assistant",
  "ai email assistant",
  "ai content generator",

  // Reporting / analytics
  "reporting dashboard",
  "kpi dashboard",
  "client reporting software",
];

const VERTICALS = [
  // Local services with high CPC track record
  "plumbers",
  "hvac contractors",
  "electricians",
  "roofers",
  "landscapers",
  "pest control",
  "cleaning companies",
  "moving companies",
  "garage door companies",
  "locksmiths",

  // Medical / wellness
  "dental practices",
  "chiropractors",
  "med spas",
  "veterinary practices",
  "physical therapists",
  "mental health practices",
  "fertility clinics",

  // Legal / financial
  "law firms",
  "personal injury lawyers",
  "estate planning attorneys",
  "immigration lawyers",
  "financial advisors",
  "accountants",
  "tax preparers",
  "insurance agents",

  // Real estate
  "real estate agents",
  "property managers",
  "real estate brokerages",
  "commercial real estate",
  "mortgage brokers",

  // Specialty / niche services
  "wedding photographers",
  "personal trainers",
  "yoga studios",
  "pet groomers",
  "dog trainers",
  "tutors",
  "music teachers",

  // B2B / SaaS adjacent
  "marketing agencies",
  "consultants",
  "freelancers",
  "saas startups",
];

// Combo templates. For each (product, vertical) pair we emit these. Variety
// helps catch buyer dialects: some search "X for Y", some "best X for Y",
// some flip to "Y X". Don't go past ~3 variants — phrase universe explodes
// faster than DFS budget.
const TEMPLATES: Array<(p: string, v: string) => string> = [
  (p, v) => `${p} for ${v}`,
  (p, v) => `best ${p} for ${v}`,
  (p, v) => `${v} ${p}`,
];

function generateCombos(): Array<{
  phrase: string;
  product: string;
  vertical: string;
  template: number;
}> {
  const out: Array<{
    phrase: string;
    product: string;
    vertical: string;
    template: number;
  }> = [];
  const seen = new Set<string>();
  for (const p of PRODUCTS) {
    for (const v of VERTICALS) {
      for (let ti = 0; ti < TEMPLATES.length; ti++) {
        const phrase = TEMPLATES[ti]!(p, v).toLowerCase().trim();
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        out.push({ phrase, product: p, vertical: v, template: ti });
      }
    }
  }
  return out;
}

// "Discovery score" — log10 of volume gives shape, CPC scales by buying
// power, (1 - competition) rewards rankable niches. Multiplicative so any
// dimension at 0 zeroes the score.
function discoveryScore(m: KeywordMetric): number {
  if (m.volume <= 0 || m.cpc <= 0) return 0;
  const volScore = Math.log10(m.volume + 1);
  const cpcScore = Math.min(m.cpc, 100);
  const compFactor = Math.max(0.1, 1 - (m.competition || 0));
  return volScore * cpcScore * compFactor;
}

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

async function main(): Promise<void> {
  loadCredentials();

  const limit = Number(process.env.DISCOVER_LIMIT) || 0;
  const combos = generateCombos();
  const phrases =
    limit > 0
      ? combos.slice(0, limit).map((c) => c.phrase)
      : combos.map((c) => c.phrase);

  console.error(
    `Discovery scan: ${PRODUCTS.length} products × ${VERTICALS.length} verticals × ${TEMPLATES.length} templates = ${combos.length} unique combos${limit ? ` (limited to ${limit})` : ""}.\n`
  );
  console.error(`Fetching metrics via DataForSEO (batched)…`);

  const metrics = await dataForSeoProvider.fetch(phrases);
  const metricByPhrase = new Map<string, KeywordMetric>();
  for (const m of metrics) metricByPhrase.set(m.phrase.toLowerCase(), m);

  const rows: DiscoveryRow[] = combos
    .filter((c) => phrases.includes(c.phrase))
    .map((c) => {
      const m = metricByPhrase.get(c.phrase);
      if (!m)
        return {
          ...c,
          volume: 0,
          cpc: 0,
          competition: 0,
          score: 0,
        };
      return {
        phrase: c.phrase,
        product: c.product,
        vertical: c.vertical,
        template: c.template,
        volume: m.volume,
        cpc: m.cpc,
        competition: m.competition,
        score: discoveryScore(m),
      };
    });

  const ranked = rows.sort((a, b) => b.score - a.score);
  const withSignal = ranked.filter((r) => r.score > 0);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const jsonPath = path.join(RESULTS_DIR, "_discoveries.json");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        products: PRODUCTS,
        verticals: VERTICALS,
        templates: TEMPLATES.length,
        combos_total: combos.length,
        combos_with_signal: withSignal.length,
        rows: ranked,
      },
      null,
      2
    )
  );

  const csvPath = path.join(CACHE_DIR, "discoveries.csv");
  const csv =
    "rank,phrase,product,vertical,volume,cpc,competition,score\n" +
    ranked
      .map(
        (r, i) =>
          `${i + 1},"${r.phrase}","${r.product}","${r.vertical}",${r.volume},${r.cpc},${r.competition},${r.score.toFixed(2)}`
      )
      .join("\n");
  writeFileSync(csvPath, csv);

  // Summary to console: top 30 by score.
  console.error(
    `\n${combos.length} combos scanned · ${withSignal.length} with non-zero signal (${Math.round((withSignal.length / combos.length) * 100)}%)\n`
  );
  console.error("Top 30 discovered niches by discovery score:\n");
  console.error(
    "  #  score   vol      cpc      comp  phrase".padEnd(60)
  );
  for (let i = 0; i < Math.min(30, ranked.length); i++) {
    const r = ranked[i]!;
    if (r.score === 0) break;
    console.error(
      `  ${(i + 1).toString().padStart(2)}  ${r.score.toFixed(1).padStart(5)}   ${r.volume.toString().padStart(7)}  $${r.cpc.toFixed(2).padStart(6)}  ${r.competition.toFixed(2)}  ${r.phrase}`
    );
  }
  console.error(`\nWrote ${jsonPath} and ${csvPath}.`);
}

main().catch((err) => {
  console.error(
    "discover failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
