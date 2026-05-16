import googleTrends from "google-trends-api";
import { getTrendsCache, setTrendsCache, trendsCacheStats } from "./cache.js";

interface ProbeResult {
  phrase: string;
  cached: boolean;
  volume: number;
  status: "ok" | "rate_limited" | "no_data" | "parse_error";
}

async function probeOne(phrase: string): Promise<ProbeResult> {
  const cached = getTrendsCache(phrase);
  if (cached !== null) {
    return { phrase, cached: true, volume: cached, status: "ok" };
  }
  let raw: string;
  try {
    raw = await googleTrends.interestOverTime({
      keyword: phrase,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/429|too many requests|rate/i.test(msg))
      return { phrase, cached: false, volume: 0, status: "rate_limited" };
    return { phrase, cached: false, volume: 0, status: "no_data" };
  }
  if (raw.trim().startsWith("<"))
    return { phrase, cached: false, volume: 0, status: "rate_limited" };
  try {
    const parsed = JSON.parse(raw) as {
      default?: {
        averages?: number[];
        timelineData?: Array<{ value?: number[] }>;
      };
    };
    const avg = parsed.default?.averages?.[0];
    if (typeof avg === "number") {
      setTrendsCache(phrase, avg);
      return { phrase, cached: false, volume: avg, status: "ok" };
    }
    const timeline = parsed.default?.timelineData ?? [];
    const values = timeline.flatMap((t) => t.value ?? []);
    const vol =
      values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    setTrendsCache(phrase, vol);
    return { phrase, cached: false, volume: vol, status: "ok" };
  } catch {
    return { phrase, cached: false, volume: 0, status: "parse_error" };
  }
}

async function main(): Promise<void> {
  // Defaults are popular phrases that produce reliable signal. If all are cached,
  // a freshness sentinel is added so the probe still tests live API behavior.
  const phrases = [
    "personal crm app",
    "budget tracker",
    "meal planner",
    "habit tracker",
  ];
  // If all defaults are cached, add two popular phrases as live-probe sentinels.
  // These must be common real searches so a healthy API returns real data —
  // a gibberish sentinel returns 0 even when Trends is fine.
  const allCached = phrases.every((p) => getTrendsCache(p) !== null);
  if (allCached) {
    const liveProbes = ["best running shoes", "tax filing software"].filter(
      (p) => getTrendsCache(p) === null
    );
    phrases.push(...liveProbes);
  }
  const stats = trendsCacheStats();
  console.error(
    `Cache: ${stats.entries} entries` +
      (stats.entries > 0 ? ` (${stats.newestDays}-${stats.oldestDays}d old)` : "")
  );
  console.error(`Probing Google Trends with ${phrases.length} phrases…\n`);

  const results: ProbeResult[] = [];
  for (const phrase of phrases) {
    const r = await probeOne(phrase);
    const flag = r.cached ? "[cache]" : "[fresh]";
    const v = r.volume.toFixed(1).padStart(6);
    const s = r.status === "ok" ? "" : `  status: ${r.status}`;
    console.log(`  ${flag} ${phrase.padEnd(28)} interest ${v}${s}`);
    results.push(r);
    if (!r.cached) await new Promise((res) => setTimeout(res, 800));
  }

  const fresh = results.filter((r) => !r.cached);
  const freshThrottled = fresh.filter((r) => r.status === "rate_limited").length;
  const freshOk = fresh.filter((r) => r.status === "ok").length;
  const freshAllZero = fresh.length > 0 && fresh.every((r) => r.volume === 0);

  console.error("");
  if (fresh.length === 0) {
    console.error(`✓ All phrases served from cache.`);
    return;
  }
  if (freshThrottled >= Math.ceil(fresh.length / 2)) {
    console.error(
      `✗ Trends throttled (${freshThrottled}/${fresh.length} fresh requests rate-limited). Wait 20-60 min.`
    );
    process.exit(1);
  }
  if (freshAllZero) {
    console.error(
      `⚠ Trends returned zero data on all ${fresh.length} fresh phrases. Likely silent throttling — try again in 20-30 min.`
    );
    process.exit(1);
  }
  console.error(
    `✓ Trends responsive (${freshOk}/${fresh.length} fresh phrases returned data, ${results.length - fresh.length} cached).`
  );
}

main();
