import googleTrends from "google-trends-api";
import type { KeywordProvider, KeywordMetric } from "./keywords.js";
import { getTrendsCache, setTrendsCache } from "../cache.js";

// google-trends-api returns relative interest 0-100 over a date range.
// No CPC, no absolute volume — we map interest into the volume slot and leave
// cpc/competition at 0. Scoring weights this appropriately.

interface TrendsResponse {
  default?: {
    averages?: number[];
    timelineData?: Array<{ value?: number[] }>;
  };
}

type FetchResult =
  | { ok: true; volume: number }
  | { ok: false; reason: "rate_limited" | "no_data" | "parse_error" };

async function fetchInterest(phrase: string): Promise<FetchResult> {
  let raw: string;
  try {
    raw = await googleTrends.interestOverTime({
      keyword: phrase,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/429|too many requests|rate/i.test(msg)) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "no_data" };
  }
  if (raw.trim().startsWith("<")) return { ok: false, reason: "rate_limited" };
  let parsed: TrendsResponse;
  try {
    parsed = JSON.parse(raw) as TrendsResponse;
  } catch {
    return { ok: false, reason: "parse_error" };
  }
  const avg = parsed.default?.averages?.[0];
  if (typeof avg === "number") return { ok: true, volume: avg };
  const timeline = parsed.default?.timelineData ?? [];
  if (timeline.length === 0) return { ok: true, volume: 0 };
  const values = timeline.flatMap((t) => t.value ?? []);
  if (values.length === 0) return { ok: true, volume: 0 };
  return { ok: true, volume: values.reduce((a, b) => a + b, 0) / values.length };
}

export const googleTrendsProvider: KeywordProvider = {
  name: "google_trends",
  async fetch(phrases: string[]): Promise<KeywordMetric[]> {
    const out: KeywordMetric[] = new Array(phrases.length);
    const freshIdxs: number[] = [];

    for (let i = 0; i < phrases.length; i++) {
      const cached = getTrendsCache(phrases[i]!);
      if (cached !== null) {
        out[i] = {
          phrase: phrases[i]!,
          volume: cached,
          cpc: 0,
          competition: 0,
          source: "google_trends",
        };
      } else {
        freshIdxs.push(i);
      }
    }

    let rateLimitedCount = 0;
    for (const i of freshIdxs) {
      const phrase = phrases[i]!;
      const r = await fetchInterest(phrase);
      const volume = r.ok ? r.volume : 0;
      out[i] = {
        phrase,
        volume,
        cpc: 0,
        competition: 0,
        source: "google_trends",
      };
      if (r.ok) {
        setTrendsCache(phrase, r.volume);
      } else if (r.reason === "rate_limited") {
        rateLimitedCount++;
      }
      await new Promise((res) => setTimeout(res, 800));
    }

    // Hard fail only on majority-throttle of UNCACHED fetches in a sizable batch.
    // Cached phrases count as good data, so a partial-throttled run that hits cache
    // for most phrases can still finish.
    if (freshIdxs.length >= 4 && rateLimitedCount >= Math.ceil(freshIdxs.length / 2)) {
      throw new Error(
        `Google Trends rate-limited ${rateLimitedCount}/${freshIdxs.length} fresh requests. ` +
          `Wait 10-30 minutes and re-run — phrases that succeeded are now cached.`
      );
    }

    // Silent throttle: Trends returns valid JSON with empty timelineData instead
    // of 429. A genuine all-zero batch is implausible when the LLM picked
    // realistic buyer phrases. Only check fresh fetches, since cached zeros are
    // legitimate prior signal.
    if (freshIdxs.length >= 8 && freshIdxs.every((i) => out[i]!.volume === 0)) {
      throw new Error(
        `Google Trends returned zero data on all ${freshIdxs.length} fresh phrases — almost certainly silent throttling. ` +
          `Wait 10-30 minutes and re-run.`
      );
    }

    return out;
  },
};
