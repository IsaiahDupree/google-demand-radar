import type { KeywordMetric } from "./providers/keywords.js";

export interface ScoreBreakdown {
  search_demand: number;
  buyer_urgency: number;
  willingness_to_pay: number;
  mvp_ease: number;
  distribution_fit: number;
  advantage: number;
  retention_potential: number;
  total: number;
}

export type Verdict = "Build Now" | "Test First" | "Educate Later" | "Pause";

interface ScoringInput {
  keywordData: KeywordMetric[];
  judged: {
    buyer_urgency: number;
    mvp_ease: number;
    distribution_fit: number;
    retention_potential: number;
    advantage: number;
  };
}

export function score(input: ScoringInput): ScoreBreakdown {
  const { keywordData, judged } = input;

  const search_demand = computeSearchDemand(keywordData);
  const willingness_to_pay = computeWillingnessToPay(keywordData);

  const total =
    search_demand +
    judged.buyer_urgency +
    willingness_to_pay +
    judged.mvp_ease +
    judged.distribution_fit +
    judged.advantage +
    judged.retention_potential;

  return {
    search_demand,
    buyer_urgency: judged.buyer_urgency,
    willingness_to_pay,
    mvp_ease: judged.mvp_ease,
    distribution_fit: judged.distribution_fit,
    advantage: judged.advantage,
    retention_potential: judged.retention_potential,
    total,
  };
}

// Funnel weighting: BOFU phrases (purchase intent) count more than TOFU
// (informational). MOFU is the baseline (1.0). When phrases lack a tagged
// stage — e.g. legacy data or providers that don't propagate it — they're
// treated as MOFU so old results score the same as before this weighting
// landed.
const FUNNEL_VOLUME_WEIGHT: Record<string, number> = {
  bofu: 2.0,
  mofu: 1.0,
  tofu: 0.5,
};

function funnelWeight(metric: KeywordMetric): number {
  const stage = metric.funnel_stage ?? "mofu";
  return FUNNEL_VOLUME_WEIGHT[stage] ?? 1.0;
}

// Google Trends returns 0-100 interest scores; DataForSEO returns absolute
// monthly volume. Detect which we have and scale accordingly.
function computeSearchDemand(keywordData: KeywordMetric[]): number {
  if (keywordData.length === 0) return 0;
  const isTrends = keywordData[0]!.source === "google_trends";

  if (isTrends) {
    // Trends returns RELATIVE interest 0-100, not absolute volume. Weight
    // intensity (brightest single phrase) over coverage (breadth) — a sharp
    // hot wedge IS the Test First signal we want to surface, and pure
    // multiplicative was punishing narrow-but-hot batches into the Pause band.
    // Volumes are funnel-weighted before intensity — a BOFU phrase at vol 25
    // hits max intensity, a TOFU phrase needs vol 50 to do the same.
    const nonZero = keywordData.filter((k) => k.volume > 0).length;
    const coverage = nonZero / keywordData.length;
    const top = Math.max(...keywordData.map((k) => k.volume * funnelWeight(k)));
    const intensity = Math.min(top / 25, 1);
    return clamp5((0.3 * coverage + 0.7 * intensity) * 5);
  }

  // DFS: sum the top-5 volumes after funnel weighting.
  const topVolume = keywordData
    .map((k) => k.volume * funnelWeight(k))
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((a, b) => a + b, 0);
  return clamp5(
    topVolume === 0 ? 0 : (Math.log10(topVolume + 1) / Math.log10(50001)) * 5
  );
}

function computeWillingnessToPay(keywordData: KeywordMetric[]): number {
  const maxCpc = keywordData.reduce((m, k) => Math.max(m, k.cpc), 0);
  // When CPC is unavailable (Google Trends), score 1.5 — "no measured signal"
  // is a weak fact, not a neutral one. Anyone serious about WTP should run
  // DataForSEO; 2.5 was inflating every Trends-only total.
  if (maxCpc === 0) return 1.5;
  return clamp5((maxCpc / 10) * 5);
}

// Verdict bands were originally tuned against Google Trends-era totals,
// where Trends 0-100 interest scores would inflate the search_demand
// component. With real DataForSEO data (log-scaled volumes, capped CPC
// contribution), realistic idea-level totals max out around 26-27 — the
// old 28 Build Now threshold was mathematically unreachable.
// Retuned 2026-05-16 against the actual distribution of 83 rescored ideas:
// top 8 sit at >=24, 23 ideas at >=20, the rest spread 14-20.
export function verdictFromScore(total: number): Verdict {
  if (total >= 24) return "Build Now";
  if (total >= 20) return "Test First";
  if (total >= 16) return "Educate Later";
  return "Pause";
}

function clamp5(v: number): number {
  return Math.max(0, Math.min(5, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// PMF readiness per vertical — 0-10 composite. Used to rank verticals after a
// sweep. The dimensions:
//   demand (30%):   funnel-weighted demand_score (already the synthesized signal)
//   bofu_density (25%): % of vertical phrases that are BOFU with signal
//   cpc (15%):      max CPC across phrases (WTP proxy, 0 for Trends-only)
//   urgency (20%):  buyer_urgency from idea-level concept judgment
//   retention (10%): retention_potential from idea-level concept judgment
export interface VerticalPMFInput {
  demand_score: number;
  bofu_density: number;
  max_cpc: number;
  buyer_urgency: number;
  retention_potential: number;
}

export interface VerticalPMFOutput {
  score: number;
  breakdown: {
    demand_n: number;
    bofu_n: number;
    cpc_n: number;
    urgency_n: number;
    retention_n: number;
  };
}

export function verticalPMFScore(
  input: VerticalPMFInput
): VerticalPMFOutput {
  const demand_n = clamp01(input.demand_score / 5);
  const bofu_n = clamp01(input.bofu_density);
  const cpc_n = clamp01(input.max_cpc / 10);
  const urgency_n = clamp01(input.buyer_urgency / 5);
  const retention_n = clamp01(input.retention_potential / 5);

  const score =
    (0.30 * demand_n +
      0.25 * bofu_n +
      0.15 * cpc_n +
      0.20 * urgency_n +
      0.10 * retention_n) *
    10;

  return {
    score: Math.max(0, Math.min(10, score)),
    breakdown: { demand_n, bofu_n, cpc_n, urgency_n, retention_n },
  };
}
