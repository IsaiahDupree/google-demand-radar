import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { IngestedIdea } from "./github.js";

const README_NAMES = [
  "README.md",
  "README.MD",
  "readme.md",
  "Readme.md",
  "README.txt",
  "README",
  "readme",
];
const META_FILES = ["CLAUDE.md", "AGENTS.md", "ROADMAP.md", "VISION.md", "ABOUT.md"];
const README_MAX_BYTES = 4000;
const META_MAX_BYTES = 2000;

const SKIP_PREFIXES = [".", "_"];
const SKIP_EXACT = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "tmp",
  "temp",
  "venv",
  "__pycache__",
]);

export interface ListLocalOpts {
  rootDir: string;
  skipDirNames?: Set<string>;
}

export function listLocalIdeas(opts: ListLocalOpts): IngestedIdea[] {
  if (!existsSync(opts.rootDir)) {
    throw new Error(`Local ingest root not found: ${opts.rootDir}`);
  }
  const skipExtra = opts.skipDirNames ?? new Set<string>();

  const entries = readdirSync(opts.rootDir, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => {
      if (SKIP_PREFIXES.some((p) => name.startsWith(p))) return false;
      if (SKIP_EXACT.has(name.toLowerCase())) return false;
      if (skipExtra.has(name)) return false;
      return true;
    });

  const ideas: IngestedIdea[] = [];
  for (const dirname of dirs) {
    const fullPath = path.join(opts.rootDir, dirname);
    const text = formatLocalAsIdea(dirname, fullPath);
    if (!text) continue;
    ideas.push({
      slug: slugify(dirname),
      source: "local",
      sourceUrl: `file:///${fullPath.replace(/\\/g, "/")}`,
      text,
    });
  }
  return ideas;
}

function formatLocalAsIdea(name: string, fullPath: string): string | null {
  const parts: string[] = [name];
  let signalCount = 0;

  for (const candidate of README_NAMES) {
    const p = path.join(fullPath, candidate);
    if (existsSync(p)) {
      try {
        const readme = readFileSync(p, "utf8").slice(0, README_MAX_BYTES).trim();
        if (readme.length > 0) {
          parts.push("", "## README", "", readme);
          signalCount++;
        }
        break;
      } catch {
        // unreadable; skip
      }
    }
  }

  const pkgPath = path.join(fullPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        description?: string;
        keywords?: string[];
      };
      if (pkg.description && pkg.description.trim().length > 0) {
        parts.push("", `Description: ${pkg.description.trim()}`);
        signalCount++;
      }
      if (pkg.keywords && pkg.keywords.length > 0) {
        parts.push(`Keywords: ${pkg.keywords.join(", ")}`);
      }
    } catch {
      // malformed package.json; skip
    }
  }

  for (const meta of META_FILES) {
    const p = path.join(fullPath, meta);
    if (existsSync(p)) {
      try {
        const c = readFileSync(p, "utf8").slice(0, META_MAX_BYTES).trim();
        if (c.length > 0) {
          parts.push("", `## ${meta}`, "", c);
          signalCount++;
        }
      } catch {
        // skip
      }
    }
  }

  return signalCount > 0 ? parts.join("\n") : null;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || `idea-${Date.now()}`;
}
