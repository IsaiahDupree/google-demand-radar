import { loadCredentials } from "../config.js";

export interface IngestedIdea {
  slug: string;
  source: "github" | "vercel" | "local";
  sourceUrl: string;
  text: string;
}

interface GithubRepo {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  language: string | null;
  topics?: string[];
  archived: boolean;
  fork: boolean;
  private: boolean;
  pushed_at: string;
  size: number;
  owner: { login: string; type: string };
}

const GITHUB_API = "https://api.github.com";
const README_MAX_BYTES = 4000;

async function ghFetch(token: string, pathSegment: string): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${pathSegment}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "demand-radar",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub ${res.status} on ${pathSegment}: ${text.slice(0, 200)}`
    );
  }
  return res.json();
}

async function fetchReadme(
  token: string,
  fullName: string
): Promise<string> {
  try {
    const data = (await ghFetch(token, `/repos/${fullName}/readme`)) as {
      content?: string;
      encoding?: string;
    };
    if (data.content && data.encoding === "base64") {
      const decoded = Buffer.from(data.content, "base64").toString("utf8");
      return decoded.slice(0, README_MAX_BYTES);
    }
  } catch {
    // no readme = not an error worth surfacing
  }
  return "";
}

export async function listGithubIdeas(): Promise<IngestedIdea[]> {
  const creds = loadCredentials();
  if (!creds.github_token) {
    throw new Error(
      "GitHub ingestion requested but github_token is empty in creds file."
    );
  }

  const repos: GithubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = (await ghFetch(
      creds.github_token,
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner`
    )) as GithubRepo[];
    if (batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const candidates = repos.filter(
    (r) => !r.archived && !r.fork && r.size > 0
  );

  const ideas: IngestedIdea[] = [];
  for (const repo of candidates) {
    const readme = await fetchReadme(creds.github_token, repo.full_name);
    const text = formatRepoAsIdea(repo, readme);
    if (text.trim().length < 40) continue;
    ideas.push({
      slug: slugify(repo.name),
      source: "github",
      sourceUrl: repo.html_url,
      text,
    });
  }
  return ideas;
}

function formatRepoAsIdea(repo: GithubRepo, readme: string): string {
  const parts: string[] = [repo.name];
  if (repo.description) parts.push("", repo.description);
  if (readme) parts.push("", "## README", "", readme);
  const tech: string[] = [];
  if (repo.language) tech.push(repo.language);
  if (repo.topics && repo.topics.length > 0) tech.push(...repo.topics);
  if (tech.length > 0) parts.push("", `Stack: ${tech.join(", ")}`);
  return parts.join("\n");
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || `idea-${Date.now()}`;
}
