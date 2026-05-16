import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const DISCOVERIES_FILE = path.join(RESULTS_DIR, "_discoveries.json");
const ADJACENCIES_FILE = path.join(RESULTS_DIR, "_adjacencies.json");
const COMPETITOR_GAPS_FILE = path.join(RESULTS_DIR, "_competitor-gaps.json");

// ---------------------------------------------------------------------------
// Raw on-disk shapes (one per CLI output file)
// ---------------------------------------------------------------------------

export interface DiscoveryBrief {
  product_in_plain_language: string;
  mvp_in_2_weeks: string;
  distribution: string;
  pricing_anchor: string;
  biggest_risk: string;
}

export interface DiscoveryRow {
  phrase: string;
  product: string;
  vertical: string;
  template: number;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: DiscoveryBrief;
}

export interface DiscoveryFile {
  generated_at: string;
  products: string[];
  verticals: string[];
  templates: number;
  combos_total: number;
  combos_with_signal: number;
  rows: DiscoveryRow[];
}

export interface AdjacencyRow {
  keyword: string;
  seed: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: DiscoveryBrief;
}

export interface AdjacencyFile {
  generated_at: string;
  seeds: string[];
  stats: {
    ideas_returned_total: number;
    dropped_noncommercial: number;
    dropped_already_in_discoveries: number;
    surviving: number;
  };
  rows: AdjacencyRow[];
}

export interface CompetitorGapRow {
  keyword: string;
  cluster: string;
  competitor: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: DiscoveryBrief;
}

export interface CompetitorGapFile {
  generated_at: string;
  competitors: Array<{ url: string; cluster: string }>;
  stats: {
    ideas_returned_total: number;
    dropped_already_known: number;
    dropped_noncommercial: number;
    dropped_consumer_side?: number;
    dropped_brand_match: number;
    surviving: number;
  };
  rows: CompetitorGapRow[];
}

// ---------------------------------------------------------------------------
// Unified shape consumed by the /discover page
// ---------------------------------------------------------------------------

export type NicheKind = "pattern" | "adjacency" | "gap";

export interface Niche {
  kind: NicheKind;
  phrase: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: DiscoveryBrief;
  // Provenance — only the field matching `kind` is populated
  product?: string;
  vertical?: string;
  seed?: string;
  cluster?: string;
  competitor?: string;
}

export interface DiscoverData {
  patterns: DiscoveryFile | null;
  adjacencies: AdjacencyFile | null;
  competitorGaps: CompetitorGapFile | null;
  niches: Niche[];
}

function loadJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// Collapse template variants. The pattern-combo generator emits 3 phrasings
// per (product, vertical) pair — "X for Y", "best X for Y", "Y X". For ~95%
// of niches, "X for Y" and "Y X" return identical DFS metrics; "best X for
// Y" has its own metrics. Keep the single highest-score row per
// (product, vertical). Rows with a generated brief win ties.
export function dedupedRows(rows: DiscoveryRow[]): DiscoveryRow[] {
  const best = new Map<string, DiscoveryRow>();
  for (const r of rows) {
    const key = `${r.product}::${r.vertical}`;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, r);
      continue;
    }
    const prevHasBrief = !!prev.brief;
    const curHasBrief = !!r.brief;
    if (curHasBrief && !prevHasBrief) {
      best.set(key, r);
    } else if (curHasBrief === prevHasBrief && r.score > prev.score) {
      best.set(key, r);
    }
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

export function loadDiscoverData(): DiscoverData {
  const patterns = loadJson<DiscoveryFile>(DISCOVERIES_FILE);
  const adjacencies = loadJson<AdjacencyFile>(ADJACENCIES_FILE);
  const competitorGaps = loadJson<CompetitorGapFile>(COMPETITOR_GAPS_FILE);

  const niches: Niche[] = [];
  if (patterns) {
    for (const r of dedupedRows(patterns.rows)) {
      if (r.score <= 0) continue;
      niches.push({
        kind: "pattern",
        phrase: r.phrase,
        volume: r.volume,
        cpc: r.cpc,
        competition: r.competition,
        score: r.score,
        brief: r.brief,
        product: r.product,
        vertical: r.vertical,
      });
    }
  }
  if (adjacencies) {
    // Dedupe against patterns by phrase. Adjacency files already drop overlap
    // at generation time, but new pattern runs may have added phrases that
    // adjacency didn't know about, so collapse again here.
    const known = new Set(niches.map((n) => n.phrase));
    for (const r of adjacencies.rows) {
      if (r.score <= 0) continue;
      if (known.has(r.keyword)) continue;
      niches.push({
        kind: "adjacency",
        phrase: r.keyword,
        volume: r.volume,
        cpc: r.cpc,
        competition: r.competition,
        score: r.score,
        brief: r.brief,
        seed: r.seed,
      });
      known.add(r.keyword);
    }
  }
  if (competitorGaps) {
    const known = new Set(niches.map((n) => n.phrase));
    for (const r of competitorGaps.rows) {
      if (r.score <= 0) continue;
      if (known.has(r.keyword)) continue;
      niches.push({
        kind: "gap",
        phrase: r.keyword,
        volume: r.volume,
        cpc: r.cpc,
        competition: r.competition,
        score: r.score,
        brief: r.brief,
        cluster: r.cluster,
        competitor: r.competitor,
      });
      known.add(r.keyword);
    }
  }

  niches.sort((a, b) => b.score - a.score);
  return { patterns, adjacencies, competitorGaps, niches };
}

// Legacy export retained so other consumers (briefs CLI imports same lib in
// some build configs) keep working.
export function loadDiscoveries(): DiscoveryFile | null {
  return loadJson<DiscoveryFile>(DISCOVERIES_FILE);
}
