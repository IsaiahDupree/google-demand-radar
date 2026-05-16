import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { SweepResult } from "../../src/sweep.js";
import type { AugmentedResult } from "../../src/ingest.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const SWEEPS_DIR = path.join(RESULTS_DIR, "sweeps");

export function loadAllSweeps(): SweepResult[] {
  if (!existsSync(SWEEPS_DIR)) return [];
  const out: SweepResult[] = [];
  for (const file of readdirSync(SWEEPS_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(
        JSON.parse(readFileSync(path.join(SWEEPS_DIR, file), "utf8")) as SweepResult
      );
    } catch {
      // skip malformed
    }
  }
  return out;
}

function normalizeVerticalName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export interface VerticalAggregate {
  key: string;
  display: string;
  ideas: Array<{
    slug: string;
    idea_name: string;
    pmf_score: number;
    demand_score: number;
    bofu_density: number;
    top_phrase: string;
    top_volume: number;
  }>;
  bestPMF: number;
}

export function aggregateVerticals(sweeps: SweepResult[]): VerticalAggregate[] {
  const map = new Map<string, VerticalAggregate>();
  for (const sweep of sweeps) {
    for (const v of sweep.verticals) {
      const key = normalizeVerticalName(v.name);
      let agg = map.get(key);
      if (!agg) {
        agg = { key, display: v.name, ideas: [], bestPMF: 0 };
        map.set(key, agg);
      }
      agg.ideas.push({
        slug: sweep.slug,
        idea_name: sweep.source_concept,
        pmf_score: v.pmf_score,
        demand_score: v.demand_score,
        bofu_density: v.bofu_density,
        top_phrase: v.top_phrase,
        top_volume: v.top_volume,
      });
      agg.bestPMF = Math.max(agg.bestPMF, v.pmf_score);
    }
  }
  for (const agg of map.values()) {
    agg.ideas.sort((a, b) => b.pmf_score - a.pmf_score);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.ideas.length !== b.ideas.length) return b.ideas.length - a.ideas.length;
    return b.bestPMF - a.bestPMF;
  });
}

export interface PMFLeader {
  slug: string;
  idea_name: string;
  vertical: string;
  pmf_score: number;
  demand_score: number;
  bofu_density: number;
  top_phrase: string;
  max_cpc: number;
  avg_competition: number | null;
}

// Avg competition over phrases that actually carry signal. DFS reports
// competition=0 for sub-threshold-volume phrases — averaging those in would
// drag every vertical toward "easy to rank" regardless of reality.
export function avgCompetition(
  phrases: Array<{ volume: number; competition: number }>
): number | null {
  const signal = phrases.filter((p) => p.volume > 0 && p.competition > 0);
  if (signal.length === 0) return null;
  return signal.reduce((s, p) => s + p.competition, 0) / signal.length;
}

export function topPMFLeaders(sweeps: SweepResult[], n = 20): PMFLeader[] {
  const all: PMFLeader[] = [];
  for (const sweep of sweeps) {
    for (const v of sweep.verticals) {
      all.push({
        slug: sweep.slug,
        idea_name: sweep.source_concept,
        vertical: v.name,
        pmf_score: v.pmf_score,
        demand_score: v.demand_score,
        bofu_density: v.bofu_density,
        top_phrase: v.top_phrase,
        max_cpc: v.max_cpc,
        avg_competition: avgCompetition(v.phrases),
      });
    }
  }
  all.sort((a, b) => b.pmf_score - a.pmf_score);
  return all.slice(0, n);
}

export interface PortfolioFunnelMix {
  bofu: number;
  mofu: number;
  tofu: number;
  total: number;
}

export function portfolioFunnelMix(results: AugmentedResult[]): PortfolioFunnelMix {
  const c: PortfolioFunnelMix = { bofu: 0, mofu: 0, tofu: 0, total: 0 };
  for (const r of results) {
    for (const k of r.keyword_data) {
      const s = (k as { funnel_stage?: string }).funnel_stage;
      if (s === "bofu" || s === "mofu" || s === "tofu") {
        c[s]++;
        c.total++;
      }
    }
  }
  return c;
}
