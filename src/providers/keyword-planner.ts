import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { KeywordProvider, KeywordMetric } from "./keywords.js";

const CACHE_DIR = path.resolve(process.cwd(), "cache");
const CACHE_FILE = path.join(CACHE_DIR, "keyword-planner.json");

export interface KeywordPlannerEntry {
  volume: number;
  cpc: number;
  competition: number;
  fetchedAt: number;
}

export type KeywordPlannerCache = Record<string, KeywordPlannerEntry>;

let cached: KeywordPlannerCache | null = null;

function normKey(phrase: string): string {
  return phrase.trim().toLowerCase();
}

function loadCache(): KeywordPlannerCache {
  if (cached) return cached;
  if (!existsSync(CACHE_FILE)) {
    cached = {};
    return cached;
  }
  try {
    cached = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as KeywordPlannerCache;
  } catch {
    cached = {};
  }
  return cached;
}

export function getKeywordPlannerEntry(phrase: string): KeywordPlannerEntry | null {
  const c = loadCache();
  return c[normKey(phrase)] ?? null;
}

export function persistKeywordPlannerCache(updated: KeywordPlannerCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  cached = updated;
  writeFileSync(CACHE_FILE, JSON.stringify(updated, null, 2));
}

export function loadKeywordPlannerCache(): KeywordPlannerCache {
  return loadCache();
}

export interface KeywordPlannerCacheStats {
  entries: number;
  withVolume: number;
  withCpc: number;
}

export function keywordPlannerCacheStats(): KeywordPlannerCacheStats {
  const c = loadCache();
  const entries = Object.values(c);
  return {
    entries: entries.length,
    withVolume: entries.filter((e) => e.volume > 0).length,
    withCpc: entries.filter((e) => e.cpc > 0).length,
  };
}

export const keywordPlannerProvider: KeywordProvider = {
  name: "keyword_planner",
  async fetch(phrases: string[]): Promise<KeywordMetric[]> {
    const c = loadCache();
    return phrases.map((phrase) => {
      const entry = c[normKey(phrase)];
      if (!entry) {
        return {
          phrase,
          volume: 0,
          cpc: 0,
          competition: 0,
          source: "google_ads",
        };
      }
      return {
        phrase,
        volume: entry.volume,
        cpc: entry.cpc,
        competition: entry.competition,
        source: "google_ads",
      };
    });
  },
};
