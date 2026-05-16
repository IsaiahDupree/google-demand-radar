import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { generateVerticalSweep } from "./openai.js";
import { googleTrendsProvider } from "./providers/trends.js";
import { dataForSeoProvider } from "./providers/dataforseo.js";
import { googleAdsProvider } from "./providers/google-ads.js";
import { keywordPlannerProvider } from "./providers/keyword-planner.js";
import type {
  KeywordProvider,
  KeywordMetric,
  FunnelStageMetric,
} from "./providers/keywords.js";
import type { Vertical } from "./schemas.js";
import { loadCredentials } from "./config.js";
import type { AugmentedResult } from "./ingest.js";
import { verticalPMFScore, type VerticalPMFOutput } from "./scoring.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const SWEEPS_DIR = path.join(RESULTS_DIR, "sweeps");

export interface VerticalResult {
  name: string;
  icp: string;
  rationale: string;
  phrases: Array<KeywordMetric & { funnel_stage: FunnelStageMetric }>;
  demand_score: number;
  bofu_density: number;
  max_cpc: number;
  top_phrase: string;
  top_volume: number;
  pmf_score: number;
  pmf_breakdown: VerticalPMFOutput["breakdown"];
}

export interface SweepResult {
  slug: string;
  source_concept: string;
  generated_at: string;
  cross_vertical_insight: string;
  verticals: VerticalResult[];
}

export interface SweepProgress {
  phase: "loading" | "extracting-verticals" | "fetching-keywords" | "scoring" | "done";
  current?: number;
  total?: number;
  verticalName?: string;
}

function pickProvider(): KeywordProvider {
  const choice = loadCredentials().keyword_provider;
  if (choice === "keyword_planner") return keywordPlannerProvider;
  if (choice === "google_ads") return googleAdsProvider;
  if (choice === "dataforseo") return dataForSeoProvider;
  return googleTrendsProvider;
}

function loadResult(slug: string): AugmentedResult {
  const file = path.join(RESULTS_DIR, `${slug}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `No result for slug '${slug}'. Run \`npm run analyze\` or triage it first.`
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as AugmentedResult;
}

function funnelWeight(stage: FunnelStageMetric): number {
  return { bofu: 2.0, mofu: 1.0, tofu: 0.5 }[stage] ?? 1.0;
}

function scoreVertical(
  phrases: Array<KeywordMetric & { funnel_stage: FunnelStageMetric }>
): { demand: number; bofuDensity: number; topPhrase: string; topVolume: number } {
  if (phrases.length === 0) {
    return { demand: 0, bofuDensity: 0, topPhrase: "", topVolume: 0 };
  }
  const isTrends = phrases[0]!.source === "google_trends";

  const weighted = phrases.map((p) => ({
    phrase: p.phrase,
    raw: p.volume,
    weighted: p.volume * funnelWeight(p.funnel_stage),
  }));
  const topEntry = weighted.reduce((m, w) => (w.weighted > m.weighted ? w : m), weighted[0]!);

  let demand: number;
  if (isTrends) {
    const nonZero = phrases.filter((p) => p.volume > 0).length;
    const coverage = nonZero / phrases.length;
    const intensity = Math.min(topEntry.weighted / 25, 1);
    demand = (0.3 * coverage + 0.7 * intensity) * 5;
  } else {
    const top5Sum = weighted
      .map((w) => w.weighted)
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((a, b) => a + b, 0);
    demand =
      top5Sum === 0 ? 0 : (Math.log10(top5Sum + 1) / Math.log10(50001)) * 5;
  }
  demand = Math.max(0, Math.min(5, demand));

  const bofuWithSignal = phrases.filter(
    (p) => p.funnel_stage === "bofu" && p.volume > 0
  ).length;
  const bofuDensity = bofuWithSignal / phrases.length;

  return {
    demand,
    bofuDensity,
    topPhrase: topEntry.phrase,
    topVolume: topEntry.raw,
  };
}

export async function runSweep(
  slug: string,
  opts?: { onProgress?: (e: SweepProgress) => void }
): Promise<SweepResult> {
  const onP = opts?.onProgress ?? ((): void => {});

  onP({ phase: "loading" });
  const result = loadResult(slug);

  onP({ phase: "extracting-verticals" });
  const sweep = await generateVerticalSweep(result.concept, result.source_text);

  // Collect all phrases across verticals into a single batched fetch.
  // Track phrase → list of {verticalIdx, funnel_stage} for re-assembly.
  interface PhraseSource {
    verticalIdx: number;
    funnel_stage: FunnelStageMetric;
  }
  const phraseSources = new Map<string, PhraseSource[]>();
  for (let i = 0; i < sweep.verticals.length; i++) {
    const v = sweep.verticals[i]!;
    for (const cp of v.buyer_phrases) {
      const key = cp.phrase.trim().toLowerCase();
      if (!key) continue;
      const list = phraseSources.get(key) ?? [];
      list.push({ verticalIdx: i, funnel_stage: cp.funnel_stage });
      phraseSources.set(key, list);
    }
  }
  const allPhrases = Array.from(phraseSources.keys());

  onP({
    phase: "fetching-keywords",
    total: allPhrases.length,
  });
  const dryRun = process.env.SWEEP_DRY_RUN === "1";
  let metrics: KeywordMetric[];
  if (dryRun) {
    // Skip keyword fetch — useful when Trends is throttled. Stores verticals
    // + ICPs + phrases with zero volume/cpc so the UI scaffolding renders.
    // Re-run without SWEEP_DRY_RUN once data sources are healthy to fill in
    // real demand metrics.
    const provider = pickProvider();
    metrics = allPhrases.map((p) => ({
      phrase: p,
      volume: 0,
      cpc: 0,
      competition: 0,
      source:
        provider.name === "google_ads"
          ? "google_ads"
          : provider.name === "dataforseo"
            ? "dataforseo"
            : "google_trends",
    }));
  } else {
    const provider = pickProvider();
    metrics = await provider.fetch(allPhrases);
  }
  const metricByPhrase = new Map<string, KeywordMetric>();
  for (const m of metrics) {
    metricByPhrase.set(m.phrase.trim().toLowerCase(), m);
  }

  // Re-assemble per-vertical phrase arrays with funnel stages.
  onP({ phase: "scoring" });
  const buyer_urgency = result.score.buyer_urgency;
  const retention_potential = result.score.retention_potential;

  const verticalResults: VerticalResult[] = sweep.verticals.map(
    (v: Vertical, _verticalIdx) => {
      const phrases: Array<
        KeywordMetric & { funnel_stage: FunnelStageMetric }
      > = [];
      for (const cp of v.buyer_phrases) {
        const key = cp.phrase.trim().toLowerCase();
        const m = metricByPhrase.get(key);
        if (!m) continue;
        phrases.push({
          ...m,
          funnel_stage: cp.funnel_stage,
        });
      }
      const { demand, bofuDensity, topPhrase, topVolume } = scoreVertical(phrases);
      const max_cpc = phrases.reduce((m, p) => Math.max(m, p.cpc), 0);
      const pmf = verticalPMFScore({
        demand_score: demand,
        bofu_density: bofuDensity,
        max_cpc,
        buyer_urgency,
        retention_potential,
      });
      return {
        name: v.name,
        icp: v.icp,
        rationale: v.rationale,
        phrases,
        demand_score: demand,
        bofu_density: bofuDensity,
        max_cpc,
        top_phrase: topPhrase,
        top_volume: topVolume,
        pmf_score: pmf.score,
        pmf_breakdown: pmf.breakdown,
      };
    }
  );

  // Rank by PMF — the composite score that captures demand + bofu intent +
  // CPC + buyer urgency + retention. demand_score alone misses willingness-
  // to-pay signal.
  verticalResults.sort((a, b) => b.pmf_score - a.pmf_score);

  if (!existsSync(SWEEPS_DIR)) mkdirSync(SWEEPS_DIR, { recursive: true });
  const out: SweepResult = {
    slug,
    source_concept: result.concept.name,
    generated_at: new Date().toISOString(),
    cross_vertical_insight: sweep.cross_vertical_insight,
    verticals: verticalResults,
  };
  writeFileSync(
    path.join(SWEEPS_DIR, `${slug}.json`),
    JSON.stringify(out, null, 2)
  );

  onP({ phase: "done" });
  return out;
}

export function loadSweep(slug: string): SweepResult | null {
  const file = path.join(SWEEPS_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SweepResult;
  } catch {
    return null;
  }
}
