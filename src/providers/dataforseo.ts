import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { KeywordProvider, KeywordMetric } from "./keywords.js";
import { loadCredentials } from "../config.js";

// Docs: https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
const ENDPOINT =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
const EXPANSION_ENDPOINT =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live";
const LABS_KEYWORD_IDEAS_ENDPOINT =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live";
const KEYWORDS_FOR_SITE_ENDPOINT =
  "https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_site/live";

const CACHE_DIR = path.resolve(process.cwd(), "cache");
const CACHE_FILE = path.join(CACHE_DIR, "dataforseo.json");
const EXPANSION_CACHE_FILE = path.join(CACHE_DIR, "dataforseo-kfk.json");
const LABS_IDEAS_CACHE_FILE = path.join(CACHE_DIR, "dataforseo-labs-ideas.json");
const KEYWORDS_FOR_SITE_CACHE_FILE = path.join(
  CACHE_DIR,
  "dataforseo-kfs.json"
);

// Default cache TTL: 30 days. Search volume is a 12-month trailing average
// and shifts slowly; refetching weekly would waste credits.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface DataForSeoResultItem {
  keyword: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition_index?: number | null;
}

interface DataForSeoTask {
  status_code?: number;
  status_message?: string;
  result?: DataForSeoResultItem[] | null;
}

interface DataForSeoResponse {
  status_code?: number;
  status_message?: string;
  tasks?: DataForSeoTask[];
}

interface CacheEntry {
  volume: number;
  cpc: number;
  competition: number;
  fetchedAt: number;
}

type Cache = Record<string, CacheEntry>;

let cached: Cache | null = null;

function normKey(phrase: string): string {
  return phrase.trim().toLowerCase();
}

function loadCache(): Cache {
  if (cached) return cached;
  if (!existsSync(CACHE_FILE)) {
    cached = {};
    return cached;
  }
  try {
    cached = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Cache;
  } catch {
    cached = {};
  }
  return cached;
}

function saveCache(c: Cache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  cached = c;
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2));
}

function entryToMetric(phrase: string, e: CacheEntry): KeywordMetric {
  return {
    phrase,
    volume: e.volume,
    cpc: e.cpc,
    competition: e.competition,
    source: "dataforseo",
  };
}

// DFS search_volume caps tasks at 1000 keywords. Discovery-style runs blow
// past that; chunk into batches.
const SEARCH_VOLUME_MAX_PER_TASK = 1000;

async function liveFetch(phrases: string[]): Promise<DataForSeoResultItem[]> {
  const creds = loadCredentials();
  if (!creds.dataforseo_login || !creds.dataforseo_password) {
    throw new Error(
      "DataForSEO selected but dataforseo_login / dataforseo_password are empty in the creds file."
    );
  }

  const auth = Buffer.from(
    `${creds.dataforseo_login}:${creds.dataforseo_password}`
  ).toString("base64");

  const out: DataForSeoResultItem[] = [];
  for (let i = 0; i < phrases.length; i += SEARCH_VOLUME_MAX_PER_TASK) {
    const chunk = phrases.slice(i, i + SEARCH_VOLUME_MAX_PER_TASK);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { keywords: chunk, location_code: 2840, language_code: "en" },
      ]),
    });

    if (!res.ok) {
      throw new Error(`DataForSEO HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as DataForSeoResponse;

    // DataForSEO returns 200 OK even when the request is logically rejected
    // (invalid auth, exhausted credits, bad payload). Surface those as errors
    // rather than letting them collapse to an empty result.
    if (body.status_code != null && body.status_code !== 20000) {
      throw new Error(
        `DataForSEO API error ${body.status_code}: ${body.status_message ?? "(no message)"}`
      );
    }
    const task = body.tasks?.[0];
    if (task?.status_code != null && task.status_code !== 20000) {
      throw new Error(
        `DataForSEO task error ${task.status_code}: ${task.status_message ?? "(no message)"}`
      );
    }
    if (task?.result) out.push(...task.result);
  }
  return out;
}

// ---------------------------------------------------------------------------
// keywords_for_keywords: seed expansion.
//
// Each call accepts up to 20 seeds at a fixed cost (~$0.075/call regardless
// of seed count) and returns hundreds of related keywords per seed, each
// with volume, CPC, competition_index, and 12 months of search history.
// Cached per-seed so individual seeds can be re-used across pipeline runs.
// ---------------------------------------------------------------------------

export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

export interface ExpansionKeyword {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number; // 0-1 scale (competition_index / 100)
  monthly_searches: MonthlySearch[];
}

export interface ExpansionEntry {
  seed: string;
  keywords: ExpansionKeyword[];
  fetchedAt: number;
}

type ExpansionCache = Record<string, ExpansionEntry>;

interface DfsExpansionResultItem {
  keyword: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition_index?: number | null;
  monthly_searches?: MonthlySearch[] | null;
}

let cachedExpansion: ExpansionCache | null = null;

function loadExpansionCache(): ExpansionCache {
  if (cachedExpansion) return cachedExpansion;
  if (!existsSync(EXPANSION_CACHE_FILE)) {
    cachedExpansion = {};
    return cachedExpansion;
  }
  try {
    cachedExpansion = JSON.parse(
      readFileSync(EXPANSION_CACHE_FILE, "utf8")
    ) as ExpansionCache;
  } catch {
    cachedExpansion = {};
  }
  return cachedExpansion;
}

function saveExpansionCache(c: ExpansionCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  cachedExpansion = c;
  writeFileSync(EXPANSION_CACHE_FILE, JSON.stringify(c, null, 2));
}

// DFS keywords_for_keywords has a hard 12-calls-per-minute rate limit.
// We serialize all calls and pace them with a 5.5s minimum gap (slight
// safety margin over the 5s threshold) so back-to-back invocations from
// pipeline / analyze-all loops don't trip 40202 errors.
let lastExpansionCallAt = 0;
const EXPANSION_MIN_GAP_MS = 5500;
async function paceExpansion(): Promise<void> {
  const now = Date.now();
  const wait = lastExpansionCallAt + EXPANSION_MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastExpansionCallAt = Date.now();
}

async function expandSeedsBatch(
  seeds: string[]
): Promise<Map<string, ExpansionKeyword[]>> {
  const creds = loadCredentials();
  if (!creds.dataforseo_login || !creds.dataforseo_password) {
    throw new Error(
      "DataForSEO expansion requested but dataforseo_login / dataforseo_password are empty."
    );
  }

  const auth = Buffer.from(
    `${creds.dataforseo_login}:${creds.dataforseo_password}`
  ).toString("base64");

  // DFS accepts up to 20 seeds per call. Each call has a fixed cost; pack
  // seeds tightly to amortize.
  const BATCH = 20;
  const out = new Map<string, ExpansionKeyword[]>();

  for (let i = 0; i < seeds.length; i += BATCH) {
    const batch = seeds.slice(i, i + BATCH);
    await paceExpansion();
    const res = await fetch(EXPANSION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { keywords: batch, location_code: 2840, language_code: "en" },
      ]),
    });
    if (!res.ok) {
      throw new Error(
        `DataForSEO expansion HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    interface DfsExpansionTask {
      status_code?: number;
      status_message?: string;
      result?: DfsExpansionResultItem[] | null;
    }
    interface DfsExpansionResponse {
      status_code?: number;
      status_message?: string;
      tasks?: DfsExpansionTask[];
    }
    const body = (await res.json()) as DfsExpansionResponse;
    if (body.status_code != null && body.status_code !== 20000) {
      throw new Error(
        `DataForSEO expansion error ${body.status_code}: ${body.status_message ?? "(no message)"}`
      );
    }
    const task = body.tasks?.[0];
    if (task?.status_code != null && task.status_code !== 20000) {
      throw new Error(
        `DataForSEO expansion task error ${task.status_code}: ${task.status_message ?? "(no message)"}`
      );
    }
    const items = task?.result ?? [];

    // DFS doesn't tag each result with the originating seed; it returns one
    // flat list per call. We can't split a multi-seed response back into
    // per-seed buckets reliably, so use one seed per call. Slightly more
    // expensive but unambiguous. (For a 5-seed idea, that's $0.375 vs the
    // $0.075 of a single shared call, but we get correct attribution.)
    if (batch.length > 1) {
      throw new Error(
        "expandSeedsBatch internal: multi-seed batches not supported (DFS doesn't tag results with originating seed)."
      );
    }
    const seed = batch[0]!;
    const expansionList: ExpansionKeyword[] = items.map((it) => ({
      keyword: it.keyword,
      volume: it.search_volume ?? 0,
      cpc: it.cpc ?? 0,
      competition:
        it.competition_index != null ? it.competition_index / 100 : 0,
      monthly_searches: it.monthly_searches ?? [],
    }));
    out.set(seed, expansionList);
  }
  return out;
}

export async function expandKeywords(
  seeds: string[],
  opts?: { force?: boolean; topN?: number }
): Promise<ExpansionEntry[]> {
  const force = opts?.force || process.env.DATAFORSEO_FORCE === "1";
  const ttl = Number(process.env.DATAFORSEO_TTL_MS) || DEFAULT_TTL_MS;
  const topN = opts?.topN ?? Infinity;
  const now = Date.now();
  const cache = loadExpansionCache();

  const normalized = seeds.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const s of normalized) {
    if (seen.has(s)) continue;
    seen.add(s);
    const entry = cache[s];
    if (force || !entry || now - entry.fetchedAt > ttl) missing.push(s);
  }

  if (missing.length > 0) {
    // Issue one call per seed to preserve seed→result attribution.
    // Also opportunistically prime the search_volume cache with each
    // expanded keyword's metrics — the expansion call already returned
    // volume/CPC/competition, so re-fetching via search_volume would be
    // wasted spend.
    const svCache = loadCache();
    for (const seed of missing) {
      const result = await expandSeedsBatch([seed]);
      const keywords = result.get(seed) ?? [];
      cache[seed] = { seed, keywords, fetchedAt: now };
      for (const kw of keywords) {
        const svKey = kw.keyword.trim().toLowerCase();
        if (!svKey) continue;
        // Don't clobber a fresher search_volume entry. If one exists and is
        // newer than this expansion call, leave it alone.
        const existing = svCache[svKey];
        if (existing && existing.fetchedAt > now - 60_000) continue;
        svCache[svKey] = {
          volume: kw.volume,
          cpc: kw.cpc,
          competition: kw.competition,
          fetchedAt: now,
        };
      }
    }
    saveExpansionCache(cache);
    saveCache(svCache);
  }

  const out: ExpansionEntry[] = [];
  const emitted = new Set<string>();
  for (const s of normalized) {
    if (emitted.has(s)) continue;
    emitted.add(s);
    const entry = cache[s];
    if (!entry) continue;
    if (topN === Infinity) {
      out.push(entry);
    } else {
      const sorted = [...entry.keywords]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, topN);
      out.push({ ...entry, keywords: sorted });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// dataforseo_labs/google/keyword_ideas — semantic adjacency.
//
// Different from keywords_for_keywords: that endpoint returns phrases sharing
// tokens with the seed. keyword_ideas returns semantically RELATED phrases
// based on clickstream + Google co-occurrence — gives you adjacent niches, not
// just variations. Critical for discovering markets your portfolio doesn't
// touch but that share buying patterns with the niches you've validated.
// ---------------------------------------------------------------------------

export interface IdeaKeyword {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number;
  monthly_searches: MonthlySearch[];
}

export interface LabsIdeasEntry {
  seeds: string[]; // the seed(s) used to derive this bucket
  keywords: IdeaKeyword[];
  fetchedAt: number;
}

type LabsIdeasCache = Record<string, LabsIdeasEntry>;

interface DfsLabsIdeasResultItem {
  keyword: string;
  keyword_info?: {
    search_volume?: number | null;
    cpc?: number | null;
    competition?: number | null;
    competition_level?: string | null;
    monthly_searches?: MonthlySearch[] | null;
  };
}

interface DfsLabsIdeasTask {
  status_code?: number;
  status_message?: string;
  result?: Array<{
    items?: DfsLabsIdeasResultItem[] | null;
  }> | null;
}

interface DfsLabsIdeasResponse {
  status_code?: number;
  status_message?: string;
  tasks?: DfsLabsIdeasTask[];
}

let cachedLabsIdeas: LabsIdeasCache | null = null;

function loadLabsIdeasCache(): LabsIdeasCache {
  if (cachedLabsIdeas) return cachedLabsIdeas;
  if (!existsSync(LABS_IDEAS_CACHE_FILE)) {
    cachedLabsIdeas = {};
    return cachedLabsIdeas;
  }
  try {
    cachedLabsIdeas = JSON.parse(
      readFileSync(LABS_IDEAS_CACHE_FILE, "utf8")
    ) as LabsIdeasCache;
  } catch {
    cachedLabsIdeas = {};
  }
  return cachedLabsIdeas;
}

function saveLabsIdeasCache(c: LabsIdeasCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  cachedLabsIdeas = c;
  writeFileSync(LABS_IDEAS_CACHE_FILE, JSON.stringify(c, null, 2));
}

// Same rate-limit pattern as expansion — Labs endpoints have their own
// rate limits and we don't want to hammer either. 5.5s gap is conservative
// across both buckets.
let lastLabsCallAt = 0;
async function paceLabs(): Promise<void> {
  const now = Date.now();
  const wait = lastLabsCallAt + EXPANSION_MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLabsCallAt = Date.now();
}

export async function getKeywordIdeas(
  seeds: string[],
  opts?: { force?: boolean; limit?: number }
): Promise<LabsIdeasEntry[]> {
  const force = opts?.force || process.env.DATAFORSEO_FORCE === "1";
  const ttl = Number(process.env.DATAFORSEO_TTL_MS) || DEFAULT_TTL_MS;
  const limit = opts?.limit ?? 100;
  const now = Date.now();
  const cache = loadLabsIdeasCache();

  const creds = loadCredentials();
  if (!creds.dataforseo_login || !creds.dataforseo_password) {
    throw new Error(
      "DataForSEO Labs requested but dataforseo_login / dataforseo_password are empty."
    );
  }

  const normalized = seeds.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: LabsIdeasEntry[] = [];
  const auth = Buffer.from(
    `${creds.dataforseo_login}:${creds.dataforseo_password}`
  ).toString("base64");

  for (const seed of normalized) {
    const cached = cache[seed];
    if (!force && cached && now - cached.fetchedAt <= ttl) {
      out.push(cached);
      continue;
    }
    await paceLabs();
    const res = await fetch(LABS_KEYWORD_IDEAS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keywords: [seed],
          location_code: 2840,
          language_code: "en",
          limit,
          include_seed_keyword: true,
        },
      ]),
    });
    if (!res.ok) {
      throw new Error(
        `Labs keyword_ideas HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    const body = (await res.json()) as DfsLabsIdeasResponse;
    if (body.status_code != null && body.status_code !== 20000) {
      throw new Error(
        `Labs ideas API error ${body.status_code}: ${body.status_message ?? "(no message)"}`
      );
    }
    const task = body.tasks?.[0];
    if (task?.status_code != null && task.status_code !== 20000) {
      throw new Error(
        `Labs ideas task error ${task.status_code}: ${task.status_message ?? "(no message)"}`
      );
    }
    const items = task?.result?.[0]?.items ?? [];
    const keywords: IdeaKeyword[] = items.map((it) => ({
      keyword: it.keyword,
      volume: it.keyword_info?.search_volume ?? 0,
      cpc: it.keyword_info?.cpc ?? 0,
      competition: it.keyword_info?.competition ?? 0,
      monthly_searches: it.keyword_info?.monthly_searches ?? [],
    }));
    const entry: LabsIdeasEntry = { seeds: [seed], keywords, fetchedAt: now };
    cache[seed] = entry;
    out.push(entry);

    // Same priming optimization as expansion: write each idea's metrics
    // into the search_volume cache so downstream provider.fetch() doesn't
    // pay again.
    const svCache = loadCache();
    for (const kw of keywords) {
      const svKey = kw.keyword.trim().toLowerCase();
      if (!svKey) continue;
      const existing = svCache[svKey];
      if (existing && existing.fetchedAt > now - 60_000) continue;
      svCache[svKey] = {
        volume: kw.volume,
        cpc: kw.cpc,
        competition: kw.competition,
        fetchedAt: now,
      };
    }
    saveCache(svCache);
  }
  saveLabsIdeasCache(cache);
  return out;
}

// ---------------------------------------------------------------------------
// keywords_for_site — competitor gap analysis.
//
// Given a competitor URL, returns keywords that drive traffic to them. The
// gap mining is: for each keyword they rank for, is it a niche our portfolio
// doesn't address? Each call costs ~$0.075 + per-keyword overhead and returns
// up to ~700 keywords per target.
// ---------------------------------------------------------------------------

export interface SiteKeyword {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number;
}

export interface SiteKeywordsEntry {
  target: string;
  keywords: SiteKeyword[];
  fetchedAt: number;
}

type SiteKeywordsCache = Record<string, SiteKeywordsEntry>;

interface DfsSiteKwResultItem {
  keyword: string;
  search_volume?: number | null;
  cpc?: number | null;
  competition_index?: number | null;
}

interface DfsSiteKwTask {
  status_code?: number;
  status_message?: string;
  result?: DfsSiteKwResultItem[] | null;
}

interface DfsSiteKwResponse {
  status_code?: number;
  status_message?: string;
  tasks?: DfsSiteKwTask[];
}

let cachedSiteKw: SiteKeywordsCache | null = null;

function loadSiteKwCache(): SiteKeywordsCache {
  if (cachedSiteKw) return cachedSiteKw;
  if (!existsSync(KEYWORDS_FOR_SITE_CACHE_FILE)) {
    cachedSiteKw = {};
    return cachedSiteKw;
  }
  try {
    cachedSiteKw = JSON.parse(
      readFileSync(KEYWORDS_FOR_SITE_CACHE_FILE, "utf8")
    ) as SiteKeywordsCache;
  } catch {
    cachedSiteKw = {};
  }
  return cachedSiteKw;
}

function saveSiteKwCache(c: SiteKeywordsCache): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  cachedSiteKw = c;
  writeFileSync(KEYWORDS_FOR_SITE_CACHE_FILE, JSON.stringify(c, null, 2));
}

// keywords_for_site shares the same 12-call/min rate-limit bucket as
// keywords_for_keywords (both are keywords_data/google_ads).
export async function getKeywordsForSite(
  targets: string[],
  opts?: { force?: boolean }
): Promise<SiteKeywordsEntry[]> {
  const force = opts?.force || process.env.DATAFORSEO_FORCE === "1";
  const ttl = Number(process.env.DATAFORSEO_TTL_MS) || DEFAULT_TTL_MS;
  const now = Date.now();
  const cache = loadSiteKwCache();

  const creds = loadCredentials();
  if (!creds.dataforseo_login || !creds.dataforseo_password) {
    throw new Error(
      "DataForSEO keywords_for_site requested but credentials are empty."
    );
  }
  const auth = Buffer.from(
    `${creds.dataforseo_login}:${creds.dataforseo_password}`
  ).toString("base64");

  const out: SiteKeywordsEntry[] = [];
  for (const raw of targets) {
    const target = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const cached = cache[target];
    if (!force && cached && now - cached.fetchedAt <= ttl) {
      out.push(cached);
      continue;
    }
    await paceExpansion();
    const res = await fetch(KEYWORDS_FOR_SITE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          target,
          location_code: 2840,
          language_code: "en",
        },
      ]),
    });
    if (!res.ok) {
      throw new Error(
        `keywords_for_site HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    const body = (await res.json()) as DfsSiteKwResponse;
    if (body.status_code != null && body.status_code !== 20000) {
      throw new Error(
        `keywords_for_site API error ${body.status_code}: ${body.status_message ?? "(no message)"}`
      );
    }
    const task = body.tasks?.[0];
    if (task?.status_code != null && task.status_code !== 20000) {
      throw new Error(
        `keywords_for_site task error ${task.status_code}: ${task.status_message ?? "(no message)"}`
      );
    }
    const items = task?.result ?? [];
    const keywords: SiteKeyword[] = items.map((it) => ({
      keyword: it.keyword,
      volume: it.search_volume ?? 0,
      cpc: it.cpc ?? 0,
      competition:
        it.competition_index != null ? it.competition_index / 100 : 0,
    }));
    const entry: SiteKeywordsEntry = { target, keywords, fetchedAt: now };
    cache[target] = entry;
    out.push(entry);

    // Prime search_volume cache as before.
    const svCache = loadCache();
    for (const kw of keywords) {
      const svKey = kw.keyword.trim().toLowerCase();
      if (!svKey) continue;
      const existing = svCache[svKey];
      if (existing && existing.fetchedAt > now - 60_000) continue;
      svCache[svKey] = {
        volume: kw.volume,
        cpc: kw.cpc,
        competition: kw.competition,
        fetchedAt: now,
      };
    }
    saveCache(svCache);
  }
  saveSiteKwCache(cache);
  return out;
}

export const dataForSeoProvider: KeywordProvider = {
  name: "dataforseo",
  async fetch(phrases: string[]): Promise<KeywordMetric[]> {
    const force = process.env.DATAFORSEO_FORCE === "1";
    const ttl = Number(process.env.DATAFORSEO_TTL_MS) || DEFAULT_TTL_MS;
    const now = Date.now();
    const cache = loadCache();

    const normalized = phrases.map((p) => ({ raw: p, key: normKey(p) }));
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const { key } of normalized) {
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = cache[key];
      if (force || !entry || now - entry.fetchedAt > ttl) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      const items = await liveFetch(missing);
      const fetchedKeys = new Set<string>();
      for (const it of items) {
        const key = normKey(it.keyword);
        cache[key] = {
          volume: it.search_volume ?? 0,
          cpc: it.cpc ?? 0,
          competition:
            it.competition_index != null ? it.competition_index / 100 : 0,
          fetchedAt: now,
        };
        fetchedKeys.add(key);
      }
      // Cache zero-result phrases too so we don't refetch them every run
      // until TTL expires.
      for (const key of missing) {
        if (!fetchedKeys.has(key)) {
          cache[key] = { volume: 0, cpc: 0, competition: 0, fetchedAt: now };
        }
      }
      saveCache(cache);
    }

    return normalized.map(({ raw, key }) => {
      const entry = cache[key];
      if (!entry) {
        return {
          phrase: raw,
          volume: 0,
          cpc: 0,
          competition: 0,
          source: "dataforseo",
        };
      }
      return entryToMetric(raw, entry);
    });
  },
};
