# Google Ads API Token Application — Design Document

**Tool name:** Google Demand Radar
**Company:** Dupree Ops, LLC
**Website:** https://isaiahdupree.com
**Manager Account (MCC) ID:** 542-254-4113
**Operating Account ID:** 788-933-5319
**API contact:** isaiahdupree33@gmail.com
**Date:** May 12, 2026
**Document version:** 1.0
**Intended access level:** Basic Access

---

## 1. Executive summary

Google Demand Radar is an internal product-research and idea-triage tool built by Dupree Ops, LLC. It evaluates new product and feature concepts against real Google search demand signals to inform which concepts the company should build, test, or pause. The tool calls the Google Ads API's `KeywordPlanIdeaService.generateKeywordIdeas` endpoint to retrieve average monthly search volumes, top-of-page bid ranges (a willingness-to-pay proxy), and competition metrics for keyword phrases derived from each idea description.

The tool is used **exclusively by Dupree Ops's founder and any direct employees or contractors of the company**. It is not exposed to third parties, end customers, or the general public. It is not sold, white-labeled, or redistributed in any form. It is a single-tenant internal decision-support tool.

This document accompanies the company's Basic Access application for the existing developer token tied to the company's MCC account.

---

## 2. Business model & motivation

**Dupree Ops, LLC** is a software product company that develops and operates a portfolio of consumer and B2B web applications. The company evaluates new product concepts continuously and requires quantitative demand evidence before committing engineering investment. Historically the team used a Google Trends-based prototype for demand validation, but Trends has two structural limitations:

1. **Rate-limited unreliability** — the public Trends endpoint silently throttles after ~30-50 requests, blocking bulk evaluation of multiple product concepts.
2. **No monetary signal** — Trends returns only a relative interest score (0-100), with no CPC, no absolute search volume, and no competition index, so it cannot support willingness-to-pay or buyer-intent scoring.

The Google Ads API's `generateKeywordIdeas` endpoint provides exactly the missing signals: absolute average monthly search volumes, top-of-page bid micros, and a competition index. Migrating to the Google Ads API allows Dupree Ops to make demand-validated build/test/pause decisions across its product portfolio.

The company does **not use the API for ad campaign management, automated bidding, audience targeting, or any customer-facing functionality.** The sole use case is keyword-volume and CPC lookup for internal product research.

---

## 3. Users & audience

| Audience | Access |
| --- | --- |
| Dupree Ops founder | Yes (sole primary user) |
| Dupree Ops employees | Yes (when hired; currently none) |
| Dupree Ops contractors | Yes, under written agreement |
| Third parties / clients | **No** |
| General public | **No** |

The tool is **internal-only**. There is no SaaS dashboard, no multi-tenant architecture, no third-party login. The Next.js UI binds to `localhost` and is only accessible from the operator's local machine. No data leaves the operator's machine except API calls to Google and to OpenAI (for natural-language concept extraction).

The tool is not productized. It will not be sold, licensed, white-labeled, or made available to external users at any future point. If business needs change, a new application will be submitted before any change in audience.

---

## 4. System architecture

Google Demand Radar is a Node.js + TypeScript application with a Next.js (App Router) web frontend and several CLI entry points. The flow is:

```
┌──────────────────┐         ┌────────────────────┐         ┌────────────────────┐
│  Idea ingestion  │         │ OpenAI GPT-4       │         │ Google Ads API     │
│  (local folder,  │────────▶│ Concept extraction │────────▶│ generateKeyword    │
│  GitHub repo,    │         │ Buyer personas     │         │ Ideas              │
│  paste-form)     │         │ Funnel-tagged      │         │                    │
│                  │         │ search phrases     │         │ (returns volume,   │
└──────────────────┘         └────────────────────┘         │  cpc, competition) │
                                                            └────────────────────┘
                                                                       │
                                                                       ▼
                                                            ┌────────────────────┐
                                                            │  Scoring engine    │
                                                            │  + verdict         │
                                                            └────────────────────┘
                                                                       │
                                                                       ▼
                                                            ┌────────────────────┐
                                                            │  Local JSON store  │
                                                            │  + Next.js UI      │
                                                            └────────────────────┘
```

**Tech stack:**
- Runtime: Node.js 22 LTS
- Language: TypeScript 5.6 (strict)
- Web framework: Next.js 15 (App Router, server actions)
- HTTP client: native `fetch`
- Auth: `oauth2.googleapis.com/token` with refresh token grant
- OpenAI SDK: `openai` 4.73 (concept extraction only; no Google Ads data touches OpenAI)
- Local storage: plain JSON files under `results/`

**No external database. No cloud hosting. No customer-facing surface.**

---

## 5. Google Ads API usage patterns

### 5.1 Endpoints used

| Endpoint | Verb | Purpose |
| --- | --- | --- |
| `/v24/customers/{customerId}:generateKeywordIdeas` | POST | Retrieve keyword metrics (avgMonthlySearches, lowTopOfPageBidMicros, highTopOfPageBidMicros, competitionIndex) for 5-20 seed phrases per call |

**No other endpoints are used.** The tool does not create, update, or delete any Ads resources. It does not read campaigns, ad groups, ads, or audiences. It is a read-only keyword-research tool.

### 5.2 Authentication

- OAuth 2.0 authorization code flow with offline access.
- Scope: `https://www.googleapis.com/auth/adwords`.
- Refresh token persisted in a local credentials file (`~/Downloads/demand-radar-creds.json`), accessible only to the operator's OS user account.
- Access tokens are refreshed via `oauth2.googleapis.com/token` on demand and cached in process memory for ~50 minutes (10 minutes before the 1-hour expiry).
- Authentication targets the MCC account `542-254-4113`. The `login-customer-id` header is set to the MCC, and the path `{customerId}` is set to the operating account `788-933-5319`.

### 5.3 Request volume estimate

| Scenario | Requests |
| --- | --- |
| Single idea triage (1 batch of 5-20 phrases) | 1 request |
| Per-idea vertical sweep (5-10 verticals, 5-10 phrases each, batched) | 1 request |
| Typical week (10-20 manual idea triages) | 10-30 requests |
| Bulk portfolio refresh (~50 ideas, run quarterly) | 50-100 requests |
| Estimated monthly cap under normal use | **200-300 requests** |

Requests are well within Google Ads API quotas. Bursts above 300/month would be rare and tied to one-time portfolio expansions, not continuous load.

### 5.4 Request structure

Each call submits a fixed structure with the phrases gathered from one idea (or one vertical sweep) as `keywordSeed.keywords`:

```json
POST https://googleads.googleapis.com/v24/customers/7889335319:generateKeywordIdeas
Headers:
  Authorization: Bearer <access_token>
  developer-token: <developer_token>
  login-customer-id: 5422544113
  Content-Type: application/json

Body:
{
  "language": "languageConstants/1000",
  "geoTargetConstants": ["geoTargetConstants/2840"],
  "keywordSeed": {
    "keywords": ["personal crm app", "ai receptionist for dental office"]
  },
  "includeAdultKeywords": false,
  "pageSize": 1000
}
```

The geo target is fixed to United States (geo constant 2840) and language to English (language constant 1000). Future versions may parameterize these per-idea if international markets become relevant; this design document will be updated before such a change.

### 5.5 Response handling

The tool consumes only these fields from each `KeywordIdeaMetrics` object:
- `avgMonthlySearches` — used as the volume signal in the scoring engine.
- `highTopOfPageBidMicros` / `lowTopOfPageBidMicros` — converted from micros to USD and used as a buyer-willingness-to-pay proxy.
- `competitionIndex` / `competition` — used to weight scoring against saturated markets.

All other fields are ignored. No keyword expansion suggestions are stored or acted upon outside of the operator's review.

---

## 6. Rate limiting & quota management

The tool implements several defensive layers to minimize unnecessary API load:

### 6.1 Local result cache (7-day TTL)
Every successful keyword lookup is persisted to `cache/trends.json` (the cache name predates the Ads migration; it stores all keyword sources). Lookups within the TTL window are served from the cache and never hit the API. Cache contents:
```json
{
  "personal crm app": { "volume": 5400, "cpc": 4.21, "fetchedAt": 1778627007841 }
}
```

### 6.2 Phrase deduplication
When multiple ideas reference the same phrase, the tool collects all phrases into a single set before calling the API. A phrase used by ten ideas results in one API call, not ten.

### 6.3 Skip-already-triaged
The bulk ingest (`npm run ingest`) skips any idea whose result JSON already exists, unless the operator passes `INGEST_FORCE=1`. This makes re-runs after partial failures incremental, not wasteful.

### 6.4 Exponential backoff on errors
HTTP 429 and 5xx responses trigger exponential backoff (1s, 2s, 4s, 8s, 16s) with a maximum of 3 retries. After the third failure the request fails loudly to the operator's console.

### 6.5 Single-process concurrency
All requests are issued sequentially from a single Node.js process. There is no fan-out, no parallelism, no worker pool. The tool will never exceed one in-flight API request at a time.

### 6.6 Manual operation
The tool is invoked manually by the operator (CLI or web UI). There is no scheduler, no cron, no event-driven trigger. No background process initiates API calls.

---

## 7. Data handling & privacy

- **No PII is collected, stored, or transmitted by this tool.**
- No end-user data flows through the tool. All input is either Dupree Ops's own internal product concepts or descriptions of public products.
- The Google Ads API responses (volumes, CPCs, competition indices) are aggregate metrics tied to keyword phrases, not to individuals.
- All results are stored as plain JSON files on the operator's local machine. There is no remote database, no cloud bucket, no analytics pipeline.
- The Next.js UI binds to `localhost` only; the tool is not internet-accessible.
- No data is shared with third parties beyond the two API providers we explicitly call (Google Ads API and OpenAI).
- The Google Ads keyword data is not redistributed, syndicated, or sold.
- Credentials are stored in a single local JSON file with OS-level filesystem permissions limiting access to the operator's user account.

---

## 8. Policy compliance

We affirm the tool will comply with the Google Ads API policies. Specifically:

| Policy | How we comply |
| --- | --- |
| Required Minimum Functionality (RMF) | The tool ingests free-text idea descriptions, extracts buyer personas and search phrases, calls the Ads API for keyword metrics, and presents a structured demand-score UI for operator review. It is a substantive decision-support tool, not a thin API wrapper. |
| No automated bidding manipulation | The tool never reads, writes, or interacts with campaigns, ad groups, ads, audiences, or bidding strategies. |
| No mass account creation | Single-tenant; one MCC, one operating account, no account creation logic. |
| No scraping of Google properties | All Google interactions use the documented Ads REST API with proper OAuth. |
| No resale or transfer of API data | Data is consumed only by the operator within the local UI. |
| Honest representation | This document and any future API token applications accurately describe the tool's purpose and audience. |

---

## 9. Sample code

The actual TypeScript implementation of the API call (lightly trimmed):

```typescript
const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

const response = await fetch(
  `https://googleads.googleapis.com/v24/customers/${customerId}:generateKeywordIdeas`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "login-customer-id": loginCustomerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      language: "languageConstants/1000",
      geoTargetConstants: ["geoTargetConstants/2840"],
      keywordSeed: { keywords: phrases.slice(0, 20) },
      includeAdultKeywords: false,
      pageSize: 1000,
    }),
  }
);

if (!response.ok) {
  throw new Error(`Google Ads API ${response.status}: ${await response.text()}`);
}

const { results } = await response.json();
for (const r of results ?? []) {
  const phrase = r.text;
  const volume = Number(r.keywordIdeaMetrics?.avgMonthlySearches ?? 0);
  const cpcMicros = Number(r.keywordIdeaMetrics?.highTopOfPageBidMicros ?? 0);
  const cpc = cpcMicros / 1_000_000;
  // ... feed into scoring engine
}
```

---

## 10. Operator workflow

1. The operator drops a new product concept into the tool (paste a description, point at a local repo, or ingest the company's GitHub portfolio).
2. The tool runs OpenAI concept extraction → produces 5-12 funnel-tagged search phrases per buyer persona.
3. The tool calls `generateKeywordIdeas` once per idea with the deduplicated phrase list.
4. The scoring engine combines API-returned volume, CPC, and competition with LLM-judged urgency/retention/ease into a 0-35 composite.
5. The operator reviews the verdict (Build Now / Test First / Educate Later / Pause) in the Next.js UI.
6. Optionally, the operator triggers a "vertical sweep" that asks the LLM to propose 5-10 plausible industry verticals and re-queries the Ads API for vertical-specific BOFU phrases.

The operator is the only consumer of the API data. The Ads API is not the user interface; it is the data backbone for the operator's internal decisions.

---

## 11. Change log

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-05-12 | Initial design document for Basic Access application |

---

## 12. Contact

For questions about this application:
- **Operator:** Isaiah Dupree
- **Email:** isaiahdupree33@gmail.com
- **Company:** Dupree Ops, LLC
- **Website:** https://isaiahdupree.com
- **MCC ID:** 542-254-4113

End of document.
