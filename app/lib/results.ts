import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import type { PipelineResult } from "../../src/pipeline.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

export interface ResultMeta {
  source: "github" | "vercel" | "local" | "manual";
  sourceUrl: string;
}

export type AugmentedResult = PipelineResult & { meta?: ResultMeta };

export interface ResultEntry {
  slug: string;
  mtime: number;
  data: AugmentedResult;
}

export function loadResults(): ResultEntry[] {
  if (!existsSync(RESULTS_DIR)) return [];
  const files = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  );
  const entries: ResultEntry[] = [];
  for (const file of files) {
    const fullPath = path.join(RESULTS_DIR, file);
    try {
      const data = JSON.parse(readFileSync(fullPath, "utf8")) as AugmentedResult;
      const mtime = statSync(fullPath).mtimeMs;
      entries.push({
        slug: file.replace(/\.json$/, ""),
        mtime,
        data,
      });
    } catch {
      // skip malformed JSON
    }
  }
  return entries;
}

export function loadResultBySlug(slug: string): ResultEntry | null {
  const file = path.join(RESULTS_DIR, `${slug}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as AugmentedResult;
    const mtime = statSync(file).mtimeMs;
    return { slug, mtime, data };
  } catch {
    return null;
  }
}
