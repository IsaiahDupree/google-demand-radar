import { loadCredentials } from "../config.js";
import type { KeywordProvider, KeywordMetric } from "./keywords.js";

// Docs: https://developers.google.com/google-ads/api/rest/reference/rest/v24/customers/generateKeywordIdeas
const API_VERSION = "v24";
const ENDPOINT_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

interface KeywordIdeaMetrics {
  avgMonthlySearches?: string;
  competition?: "UNSPECIFIED" | "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  competitionIndex?: string;
  lowTopOfPageBidMicros?: string;
  highTopOfPageBidMicros?: string;
}

interface KeywordIdeaResult {
  text?: string;
  keywordIdeaMetrics?: KeywordIdeaMetrics;
}

interface KeywordIdeaResponse {
  results?: KeywordIdeaResult[];
}

const COMPETITION_FALLBACK: Record<string, number> = {
  UNSPECIFIED: 0,
  UNKNOWN: 0,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.85,
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(
      `Google OAuth refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`
    );
  }
  const j = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!j.access_token) throw new Error("OAuth refresh returned no access_token");
  cachedAccessToken = {
    token: j.access_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
  };
  return j.access_token;
}

export const googleAdsProvider: KeywordProvider = {
  name: "google_ads",
  async fetch(phrases: string[]): Promise<KeywordMetric[]> {
    const creds = loadCredentials();
    const required: Array<keyof typeof creds> = [
      "google_ads_developer_token",
      "google_ads_customer_id",
      "google_ads_refresh_token",
      "google_ads_client_id",
      "google_ads_client_secret",
    ];
    for (const k of required) {
      if (!creds[k]) {
        throw new Error(
          `Google Ads provider requires '${k}' in creds. ` +
            `Run \`npm run oauth-helper -- <path-to-installed-client_secret.json>\` to mint a refresh token, ` +
            `and add developer_token + customer_id (no dashes) from ads.google.com.`
        );
      }
    }

    const accessToken = await getAccessToken(
      creds.google_ads_client_id,
      creds.google_ads_client_secret,
      creds.google_ads_refresh_token
    );

    const customerId = creds.google_ads_customer_id.replace(/[^0-9]/g, "");
    const url = `${ENDPOINT_BASE}/customers/${customerId}:generateKeywordIdeas`;

    const body = {
      language: "languageConstants/1000", // English
      geoTargetConstants: ["geoTargetConstants/2840"], // United States
      keywordSeed: { keywords: phrases.slice(0, 20) },
      includeAdultKeywords: false,
      pageSize: 1000,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": creds.google_ads_developer_token,
      "Content-Type": "application/json",
    };
    if (creds.google_ads_login_customer_id) {
      headers["login-customer-id"] = creds.google_ads_login_customer_id.replace(
        /[^0-9]/g,
        ""
      );
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Google Ads API ${res.status}: ${(await res.text()).slice(0, 400)}`
      );
    }
    const data = (await res.json()) as KeywordIdeaResponse;

    const byPhrase = new Map<string, KeywordMetric>();
    for (const r of data.results ?? []) {
      const phrase = r.text?.toLowerCase().trim();
      if (!phrase) continue;
      const m = r.keywordIdeaMetrics ?? {};
      const volume = Number(m.avgMonthlySearches ?? 0);
      const cpcMicros = Number(
        m.highTopOfPageBidMicros ?? m.lowTopOfPageBidMicros ?? 0
      );
      const cpc = cpcMicros / 1_000_000; // micros → USD
      const competition = m.competitionIndex
        ? Number(m.competitionIndex) / 100
        : m.competition
          ? (COMPETITION_FALLBACK[m.competition] ?? 0)
          : 0;
      byPhrase.set(phrase, {
        phrase: r.text ?? phrase,
        volume,
        cpc,
        competition,
        source: "google_ads",
      });
    }

    return phrases.map((p) => {
      const matched = byPhrase.get(p.toLowerCase().trim());
      return (
        matched ?? {
          phrase: p,
          volume: 0,
          cpc: 0,
          competition: 0,
          source: "google_ads",
        }
      );
    });
  },
};
