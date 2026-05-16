import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { analyze, type PipelineResult } from "./pipeline.js";
import { loadCredentials } from "./config.js";
import { listGithubIdeas, type IngestedIdea } from "./ingest/github.js";
import { listVercelIdeas } from "./ingest/vercel.js";
import { listLocalIdeas } from "./ingest/local.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

export interface IngestProgress {
  phase:
    | "listing-github"
    | "listing-vercel"
    | "listing-local"
    | "discovered"
    | "triaging"
    | "done"
    | "error";
  current?: number;
  total?: number;
  slug?: string;
  source?: "github" | "vercel" | "local";
  verdict?: string;
  error?: string;
}

export interface IngestResult {
  ok: number;
  failed: number;
  total: number;
  failures: Array<{ slug: string; error: string }>;
}

export interface ResultMeta {
  source: "github" | "vercel" | "local" | "manual" | "discovery";
  sourceUrl: string;
}

export type AugmentedResult = PipelineResult & { meta?: ResultMeta };

export interface DiscoveryStats {
  local: number;
  github: number;
  vercel: number;
  duplicatesDropped: number;
  alreadyTriaged: number;
  toTriage: number;
}

export interface Discovery {
  ideas: IngestedIdea[];
  stats: DiscoveryStats;
}

/**
 * Listing logic only — no triaging. Applies source-priority dedup
 * (local > github > vercel), skip-existing filter, and INGEST_LIMIT cap.
 */
export async function discoverIdeas(opts?: {
  onProgress?: (event: IngestProgress) => void;
}): Promise<Discovery> {
  const onP = opts?.onProgress ?? ((): void => {});
  const creds = loadCredentials();

  // Order: local → github → vercel.
  // Local has the richest text (README + package.json + meta files), so it wins
  // the slug dedup. GitHub fills in repos that don't exist locally.
  // Vercel fills in projects whose GitHub link we haven't already captured.
  let localIdeas: IngestedIdea[] = [];
  if (creds.local_ingest_root) {
    onP({ phase: "listing-local" });
    const projectSelf = path.basename(process.cwd());
    localIdeas = listLocalIdeas({
      rootDir: creds.local_ingest_root,
      skipDirNames: new Set([projectSelf]),
    });
  }

  const seenSlugs = new Set<string>(localIdeas.map((i) => i.slug));

  let githubIdeas: IngestedIdea[] = [];
  let githubRaw = 0;
  if (creds.github_token) {
    onP({ phase: "listing-github" });
    const all = await listGithubIdeas();
    githubRaw = all.length;
    githubIdeas = all.filter((i) => !seenSlugs.has(i.slug));
    for (const i of githubIdeas) seenSlugs.add(i.slug);
  }

  const githubRepoSet = new Set<string>();
  for (const idea of githubIdeas) {
    const m = idea.sourceUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (m && m[1]) githubRepoSet.add(m[1]);
  }

  let vercelIdeas: IngestedIdea[] = [];
  let vercelRaw = 0;
  if (creds.vercel_token) {
    onP({ phase: "listing-vercel" });
    const all = await listVercelIdeas(githubRepoSet);
    vercelRaw = all.length;
    vercelIdeas = all.filter((i) => !seenSlugs.has(i.slug));
    for (const i of vercelIdeas) seenSlugs.add(i.slug);
  }

  let all: IngestedIdea[] = [...localIdeas, ...githubIdeas, ...vercelIdeas];
  const beforeSkip = all.length;

  // Skip ideas already triaged (results/{slug}.json exists) unless INGEST_FORCE=1.
  // This makes failed-only retry the default — re-running after a Trends throttle
  // re-attempts only the ideas that haven't succeeded yet, without burning OpenAI
  // on completed ones.
  const force = process.env.INGEST_FORCE === "1";
  if (!force) {
    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    all = all.filter(
      (idea) => !existsSync(path.join(RESULTS_DIR, `${idea.slug}.json`))
    );
  }
  const alreadyTriaged = beforeSkip - all.length;

  const limitEnv = process.env.INGEST_LIMIT;
  const limit = limitEnv ? parseInt(limitEnv, 10) : 0;
  if (limit > 0 && all.length > limit) {
    all = all.slice(0, limit);
  }

  const duplicatesDropped =
    githubRaw - githubIdeas.length + (vercelRaw - vercelIdeas.length);

  return {
    ideas: all,
    stats: {
      local: localIdeas.length,
      github: githubIdeas.length,
      vercel: vercelIdeas.length,
      duplicatesDropped,
      alreadyTriaged,
      toTriage: all.length,
    },
  };
}

export async function ingestAndTriage(opts?: {
  onProgress?: (event: IngestProgress) => void;
}): Promise<IngestResult> {
  const onP = opts?.onProgress ?? ((): void => {});
  const { ideas: all } = await discoverIdeas(opts);
  onP({ phase: "discovered", total: all.length });

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  const failures: Array<{ slug: string; error: string }> = [];
  let ok = 0;
  for (let i = 0; i < all.length; i++) {
    const idea = all[i]!;
    onP({
      phase: "triaging",
      current: i + 1,
      total: all.length,
      slug: idea.slug,
      source: idea.source,
    });
    try {
      const result = await analyze(idea.text);
      const augmented: AugmentedResult = {
        ...result,
        meta: { source: idea.source, sourceUrl: idea.sourceUrl },
      };
      writeFileSync(
        path.join(RESULTS_DIR, `${idea.slug}.json`),
        JSON.stringify(augmented, null, 2)
      );
      ok++;
      onP({
        phase: "done",
        current: i + 1,
        total: all.length,
        slug: idea.slug,
        verdict: result.verdict,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      failures.push({ slug: idea.slug, error });
      onP({
        phase: "error",
        current: i + 1,
        total: all.length,
        slug: idea.slug,
        error,
      });
    }
  }

  return { ok, failed: failures.length, total: all.length, failures };
}
