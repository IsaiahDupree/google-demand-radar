import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dataForSeoProvider } from "./providers/dataforseo.js";
import { loadCredentials } from "./config.js";
import type { KeywordMetric } from "./providers/keywords.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const CACHE_DIR = path.resolve(process.cwd(), "cache");
const OUT_FILE = path.join(RESULTS_DIR, "_mobile-discoveries.json");
const OUT_CSV = path.join(CACHE_DIR, "mobile-discoveries.csv");

// Hand-curated phrase list. Mobile-app demand searches don't fit the
// "[product] for [vertical]" template — people search "best meditation app",
// "ai therapy app", "couples app", etc. So instead of templated combos we
// just pick a focused set of plausible mobile-app niches in consumer-buyer
// language and bulk-check them.
const PHRASES = [
  // Habit + journaling + wellness
  "habit tracker app",
  "best habit tracker",
  "ai journaling app",
  "ai journal app",
  "ai meditation app",
  "ai therapy app",
  "mental health app",
  "anxiety tracker app",
  "mood tracker app",
  "sleep tracker app",
  "ai sleep coach",

  // Fitness + nutrition
  "ai fitness coach",
  "workout planner app",
  "running tracker app",
  "calorie counter app",
  "macro tracker app",
  "meal planner app",
  "ai nutritionist app",
  "ai personal trainer app",

  // Finance + money
  "personal finance app",
  "budgeting app",
  "expense tracker app",
  "investment tracker app",
  "stock tracker app",
  "crypto tracker app",
  "net worth tracker app",
  "subscription tracker app",
  "ai accountant app",

  // Learning + study
  "language learning app",
  "duolingo alternative",
  "ai language tutor",
  "ai tutor app",
  "study app",
  "flashcard app",
  "kids learning app",
  "ai homework helper",

  // Parenting + family
  "parental control app",
  "screen time app for kids",
  "couples app",
  "relationship app",
  "fertility tracker",
  "period tracker app",
  "pregnancy app",
  "baby tracker app",

  // Productivity + planning
  "ai note taker",
  "second brain app",
  "personal crm app",
  "contacts manager app",
  "task manager app",
  "to do list app",
  "pomodoro timer app",
  "focus app",
  "screen time app",

  // Creator + media
  "ai photo editor",
  "ai video editor app",
  "ai background remover",
  "watermark remover app",
  "social media scheduler app",
  "instagram scheduler app",
  "tiktok scheduler",
  "youtube shorts editor",
  "voice changer app",

  // AI assistant + writing
  "ai art generator app",
  "ai chat app",
  "ai assistant app",
  "ai writing app",
  "speech to text app",
  "transcription app",
  "ai email assistant app",

  // Utilities
  "scanner app",
  "receipt scanner app",
  "barcode scanner app",
  "vpn app",
  "password manager app",
  "ai recipe generator",
  "grocery list app",
];

// Same scoring formula as discover-cli.ts so the leaderboards are comparable.
function discoveryScore(m: KeywordMetric): number {
  if (m.volume <= 0 || m.cpc <= 0) return 0;
  const volScore = Math.log10(m.volume + 1);
  const cpcScore = Math.min(m.cpc, 100);
  const compFactor = Math.max(0.1, 1 - (m.competition || 0));
  return volScore * cpcScore * compFactor;
}

interface MobileRow {
  phrase: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
}

async function main(): Promise<void> {
  loadCredentials();

  console.error(
    `Mobile-app PMF scan: ${PHRASES.length} curated consumer-mobile phrases.\n` +
      `Single batched DFS call (~$0.075).\n`
  );

  const metrics = await dataForSeoProvider.fetch(PHRASES);
  const metricByPhrase = new Map<string, KeywordMetric>();
  for (const m of metrics) metricByPhrase.set(m.phrase.toLowerCase(), m);

  const rows: MobileRow[] = PHRASES.map((p) => {
    const m = metricByPhrase.get(p.toLowerCase());
    if (!m)
      return { phrase: p, volume: 0, cpc: 0, competition: 0, score: 0 };
    return {
      phrase: p,
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

  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        phrases_total: PHRASES.length,
        phrases_with_signal: withSignal.length,
        rows: ranked,
      },
      null,
      2
    )
  );

  const csv =
    "rank,phrase,volume,cpc,competition,score\n" +
    ranked
      .map(
        (r, i) =>
          `${i + 1},"${r.phrase}",${r.volume},${r.cpc},${r.competition},${r.score.toFixed(2)}`
      )
      .join("\n");
  writeFileSync(OUT_CSV, csv);

  console.error(
    `${PHRASES.length} phrases scanned · ${withSignal.length} with non-zero signal (${Math.round((withSignal.length / PHRASES.length) * 100)}%)\n`
  );
  console.error("Top 25 mobile-app niches by score:\n");
  console.error("  #   score    vol      cpc      comp  phrase");
  for (let i = 0; i < Math.min(25, ranked.length); i++) {
    const r = ranked[i]!;
    if (r.score === 0) break;
    console.error(
      `  ${(i + 1).toString().padStart(2)}  ${r.score.toFixed(1).padStart(5)}  ${r.volume.toString().padStart(8)}  $${r.cpc.toFixed(2).padStart(6)}  ${r.competition.toFixed(2)}  ${r.phrase}`
    );
  }
  console.error(`\nWrote ${OUT_FILE} and ${OUT_CSV}.`);
}

main().catch((err) => {
  console.error(
    "discover-mobile failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
