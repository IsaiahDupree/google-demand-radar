import { loadCredentials } from "../config.js";
import type { IngestedIdea } from "./github.js";

interface VercelLink {
  type?: "github" | "gitlab" | "bitbucket";
  repo?: string;
  org?: string;
}

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link?: VercelLink;
  targets?: {
    production?: { alias?: string[]; readyState?: string };
  };
  updatedAt: number;
}

interface VercelProjectsResponse {
  projects: VercelProject[];
  pagination?: { count: number; next?: string | null; prev?: string | null };
}

const VERCEL_API = "https://api.vercel.com";

async function vercelFetch(
  token: string,
  pathSegment: string
): Promise<unknown> {
  const res = await fetch(`${VERCEL_API}${pathSegment}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Vercel ${res.status} on ${pathSegment}: ${text.slice(0, 200)}`
    );
  }
  return res.json();
}

async function getDefaultTeamId(token: string): Promise<string | null> {
  // Personal-account tokens issued by the Vercel CLI return zero projects
  // unless team-scoped. Discover the user's default team and scope to it.
  try {
    const data = (await vercelFetch(token, "/v2/user")) as {
      user?: { defaultTeamId?: string };
    };
    return data.user?.defaultTeamId ?? null;
  } catch {
    return null;
  }
}

export async function listVercelIdeas(
  githubReposToSkip: Set<string>
): Promise<IngestedIdea[]> {
  const creds = loadCredentials();
  if (!creds.vercel_token) {
    throw new Error(
      "Vercel ingestion requested but vercel_token is empty in creds file."
    );
  }

  const teamId = await getDefaultTeamId(creds.vercel_token);

  const ideas: IngestedIdea[] = [];
  let until: string | undefined;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (teamId) qs.set("teamId", teamId);
    if (until) qs.set("until", until);
    const data = (await vercelFetch(
      creds.vercel_token,
      `/v9/projects?${qs.toString()}`
    )) as VercelProjectsResponse;

    for (const p of data.projects) {
      if (
        p.link?.type === "github" &&
        p.link.repo &&
        githubReposToSkip.has(p.link.repo)
      ) {
        continue;
      }
      const text = formatProjectAsIdea(p);
      if (text.trim().length < 30) continue;
      const aliases = p.targets?.production?.alias ?? [];
      const sourceUrl =
        aliases.length > 0
          ? `https://${aliases[0]}`
          : `https://vercel.com/dashboard?project=${encodeURIComponent(p.name)}`;
      ideas.push({
        slug: slugify(p.name),
        source: "vercel",
        sourceUrl,
        text,
      });
    }

    if (!data.pagination?.next) break;
    until = String(data.pagination.next);
  }
  return ideas;
}

function formatProjectAsIdea(p: VercelProject): string {
  const parts: string[] = [p.name];
  if (p.framework) parts.push("", `Framework: ${p.framework}`);
  if (p.link?.repo) parts.push(`Linked repo: ${p.link.repo}`);
  const aliases = p.targets?.production?.alias ?? [];
  if (aliases.length > 0) {
    parts.push(`Production URLs: ${aliases.slice(0, 3).join(", ")}`);
  }
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
