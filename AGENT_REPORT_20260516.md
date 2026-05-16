# Agent Report — 2026-05-16

## DataForSEO integration status

**Verified working live.** New credentials in `~/Downloads/demand-radar-creds.json`
(`dataforseo_login` + `dataforseo_password`) authenticate successfully against
`api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live`.

Note: `keyword_provider` in the creds file is still set to `"google_trends"`. To
route the pipeline through DataForSEO, flip it to `"dataforseo"` (or
`"google_ads"` once the Basic Access application clears). Not changed
automatically — that's a user-owned decision.

## Phase 1 smoke test

- Probe script added: `src/probe-dataforseo.ts` (and `npm run probe-dataforseo`).
- Sent: 2 phrases (`claude code`, `next.js`), location_code 2840, language_code "en".
- Response: HTTP 200, `status_code 20000`, both rows populated.
  - `claude code` → volume 368,000, cpc $13.28, competition 0.39
  - `next.js`     → volume 49,500,  cpc $14.42, competition 0.07
- Latency: ~1–2s.
- Cost note: the `search_volume/live` endpoint bills per request; phrase batching
  is free up to the documented per-request keyword cap.

## Audit findings

- `[now-unblocked]` `keyword_provider: "dataforseo"` path in `src/pipeline.ts`
  and `src/sweep.ts` is now usable end-to-end. Previously inert because creds
  were empty.
- `[bug]` (fixed) DataForSEO provider silently returned `[]` on body-level
  errors (auth failure, exhausted credits, bad payload all return HTTP 200 with
  `status_code != 20000`). Triaged ideas would have scored as zero-demand with
  no visible failure.
- `[dead-code]` None found. Repo is small and well-pruned; no TODO/FIXME
  comments in `src/` or `app/`.
- `[doc-out-of-sync]` `docs/google-ads-api-design.md` still describes the
  Google Ads API as the sole demand-data path. It doesn't mention DataForSEO
  as the interim provider while Basic Access is pending. Not changed (this
  doc is the Google Ads application; mentioning a competing provider could be
  off-message for that audience).
- `[test]` No DataForSEO-specific unit tests exist. Live API testing would
  cost money on each CI run, so a mock-based test would be the right move;
  intentionally skipped to avoid inventing test infrastructure not asked for.

## Fixed

- `src/providers/dataforseo.ts`:
  - Added body- and task-level `status_code` check (throws with the
    DataForSEO `status_message` instead of collapsing to an empty result).
  - Added on-disk cache at `cache/dataforseo.json` mirroring the
    `keyword-planner.json` pattern. Phrases hit during a run are persisted
    `{volume, cpc, competition, fetchedAt}`. Subsequent runs only re-hit the
    paid API for phrases that are missing or older than the TTL.
  - TTL defaults to 30 days; override with `DATAFORSEO_TTL_MS=…`.
  - Force refresh with `DATAFORSEO_FORCE=1` (parallels `SWEEP_FORCE=1`).
  - Zero-volume responses are also cached, so dead phrases stop re-billing.
- `package.json`: added `npm run probe-dataforseo` script.
- `src/probe-dataforseo.ts`: new minimal smoke-test entry point (matches the
  shape of `probe-ads.ts`).

## Skipped (with reason)

- **Did not flip `keyword_provider` in the creds file.** That's a config choice
  the user owns; the pipeline silently switching from Trends to a paid provider
  could surprise them on the next `sweep-all` run.
- **Did not delete/replace `keyword-planner` provider or the manual CSV import
  flow.** They're still useful as a free fallback if DataForSEO billing runs
  out, and removing them is out of scope.
- **No DataForSEO unit tests added.** Would need a fetch mock layer that
  doesn't exist in the repo yet — not a "smallest correct change."
- **Did not update `docs/google-ads-api-design.md`.** That document is the
  external Google Ads application; cross-mentioning DataForSEO there is
  off-purpose.

## Continued work

The most recent in-progress thread before today's session (by file mtime) was
the Keyword Planner CSV import path (`import-phrases.ts`,
`keyword-planner-parser.ts`, `providers/keyword-planner.ts`) — a workaround
the user built while Google Ads API access was pending. The newly arrived
DataForSEO credentials replace that workaround for the immediate term.

Continued the DataForSEO thread by:
1. Adding the probe entry point so the user can sanity-check creds at any time
   with `npm run probe-dataforseo`.
2. Making the provider production-grade for actual sweeps:
   - Caches results across runs (DataForSEO is paid per request; the
     sweep-all CLI runs across ~100 ideas with heavy phrase overlap).
   - Surfaces API errors instead of swallowing them.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run spec` — 42/42 pass.
- `npm run build` — clean Next.js production build (5 routes).
- `npm run probe-dataforseo` — live API call returns expected metrics; second
  run reads from `cache/dataforseo.json` (no API call).

## Follow-ups

- Switch `keyword_provider` in the creds file from `"google_trends"` to
  `"dataforseo"` when ready to run real sweeps. Then:
  `SWEEP_FORCE=1 npm run sweep-all` to rescore all 100+ triaged ideas with
  real volume + CPC.
- Consider chunking very large phrase lists (DataForSEO's `search_volume/live`
  caps at 1,000 keywords per request — current sweeps stay well under, but
  worth checking before any bulk operation).
- A mock-based unit test for the DataForSEO body-level error paths would be
  worth adding the next time a similar provider is touched.
- When Google Ads Basic Access is approved, decide whether DataForSEO stays
  on as a cross-check or is retired. The cache file makes A/B comparison
  cheap.
