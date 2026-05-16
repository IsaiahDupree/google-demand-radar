import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

const CACHE_DIR = path.resolve(process.cwd(), "cache");
const TRENDS_FILE = path.join(CACHE_DIR, "trends.json");
const TRENDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface TrendsCacheEntry {
  volume: number;
  fetchedAt: number;
}

type TrendsCache = Record<string, TrendsCacheEntry>;

let trendsCache: TrendsCache | null = null;

function normKey(phrase: string): string {
  return phrase.trim().toLowerCase();
}

function loadTrends(): TrendsCache {
  if (trendsCache) return trendsCache;
  if (!existsSync(TRENDS_FILE)) {
    trendsCache = {};
    return trendsCache;
  }
  try {
    trendsCache = JSON.parse(readFileSync(TRENDS_FILE, "utf8")) as TrendsCache;
  } catch {
    trendsCache = {};
  }
  return trendsCache;
}

function persistTrends(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(TRENDS_FILE, JSON.stringify(trendsCache ?? {}, null, 2));
}

export function getTrendsCache(phrase: string): number | null {
  const c = loadTrends();
  const e = c[normKey(phrase)];
  if (!e) return null;
  if (Date.now() - e.fetchedAt > TRENDS_TTL_MS) return null;
  return e.volume;
}

export function setTrendsCache(phrase: string, volume: number): void {
  const c = loadTrends();
  c[normKey(phrase)] = { volume, fetchedAt: Date.now() };
  persistTrends();
}

export interface TrendsCacheStats {
  entries: number;
  oldestDays: number;
  newestDays: number;
}

export function trendsCacheStats(): TrendsCacheStats {
  const c = loadTrends();
  const keys = Object.keys(c);
  if (keys.length === 0) return { entries: 0, oldestDays: 0, newestDays: 0 };
  const times = keys.map((k) => c[k]!.fetchedAt);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    entries: keys.length,
    oldestDays: Math.floor((now - Math.min(...times)) / day),
    newestDays: Math.floor((now - Math.max(...times)) / day),
  };
}
