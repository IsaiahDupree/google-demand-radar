import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  openai_api_key: string;
  openai_model: string;
  keyword_provider: "google_trends" | "dataforseo" | "google_ads" | "keyword_planner";
  dataforseo_login: string;
  dataforseo_password: string;
  github_token: string;
  vercel_token: string;
  google_ads_developer_token: string;
  google_ads_customer_id: string;
  google_ads_client_id: string;
  google_ads_client_secret: string;
  google_ads_refresh_token: string;
  google_ads_login_customer_id: string;
  local_ingest_root: string;
}

const DEFAULT_PATH = join(homedir(), "Downloads", "demand-radar-creds.json");

let cached: Credentials | null = null;

export function loadCredentials(): Credentials {
  if (cached) return cached;

  const path = process.env.DEMAND_RADAR_CREDS ?? DEFAULT_PATH;

  if (!existsSync(path)) {
    throw new Error(
      `Credentials file not found at: ${path}\n` +
        `Create it with this structure:\n` +
        `{\n` +
        `  "openai_api_key": "sk-proj-...",\n` +
        `  "openai_model": "gpt-4o",\n` +
        `  "keyword_provider": "google_trends",\n` +
        `  "dataforseo_login": "",\n` +
        `  "dataforseo_password": "",\n` +
        `  "github_token": "",\n` +
        `  "vercel_token": ""\n` +
        `}\n` +
        `Or set DEMAND_RADAR_CREDS to a different path.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
  }

  const r = raw as Partial<Credentials>;
  if (!r.openai_api_key) {
    throw new Error(`${path} is missing "openai_api_key".`);
  }

  cached = {
    openai_api_key: r.openai_api_key,
    openai_model: r.openai_model || "gpt-4o",
    keyword_provider: r.keyword_provider || "google_trends",
    dataforseo_login: r.dataforseo_login ?? "",
    dataforseo_password: r.dataforseo_password ?? "",
    github_token: r.github_token ?? "",
    vercel_token: r.vercel_token ?? "",
    google_ads_developer_token: r.google_ads_developer_token ?? "",
    google_ads_customer_id: r.google_ads_customer_id ?? "",
    google_ads_client_id: r.google_ads_client_id ?? "",
    google_ads_client_secret: r.google_ads_client_secret ?? "",
    google_ads_refresh_token: r.google_ads_refresh_token ?? "",
    google_ads_login_customer_id: r.google_ads_login_customer_id ?? "",
    local_ingest_root: r.local_ingest_root ?? "",
  };
  return cached;
}
