# Next Steps — 2026-05-16 (post-DataForSEO research pass)

Read-only audit pass. Builds on `AGENT_REPORT_20260516.md` but pushes deeper into
what the operator should actually do with the new capability.

---

## A. What changed today

- DataForSEO creds are live; `dataForSeoProvider` is wired into `src/pipeline.ts:22-28`
  and `src/sweep.ts:55-61` with a 30-day on-disk cache (`cache/dataforseo.json`).
- Silent-failure bug fixed (`src/providers/dataforseo.ts:111-121`) — body- and
  task-level `status_code != 20000` now throws, so a credit/auth fail can't masquerade
  as a zero-demand result.
- `npm run probe-dataforseo` confirms creds + cache work end-to-end. Cache currently
  holds 2 phrases (`claude code`, `next.js`).
- `keyword_provider` is still `"google_trends"` in `~/Downloads/demand-radar-creds.json`.
  Nothing in the data layer changes until that line flips.

---

## B. What's now possible (and what it would cost)

### B0. The real headline the prior agent buried

**Every existing sweep in `results/sweeps/` is currently worthless for ranking.**
I counted: 50 sweep files, 1,345 unique phrases across them, **0 phrases with
non-zero volume in any sweep**. The Trends provider got throttled during the
original sweep run, so every `demand_score`, `bofu_density`-weighted-by-volume,
`max_cpc`, and `pmf_score` in the dataset is driven solely by the judged
dimensions (`buyer_urgency`, `retention_potential`).

That means the entire `/portfolio` page — Top PMF leaderboard, mega-themes,
vertical frequency — is currently sorted on a 30% of nothing + 25% of nothing +
15% of nothing + judged scalars. The mega-themes that show up there aren't real
signal; they're LLM verbosity (a vertical the model named in many sweeps).

A DataForSEO re-sweep does not "improve" the leaderboard — it creates the
leaderboard for the first time.

For reference, idea-level results (`results/*.json`, not sweeps) are partially
populated: 79/83 have at least one phrase with volume from `cache/trends.json`
(989 phrases cached, 610 with non-zero values). Those are the only "real" demand
numbers on disk right now, and they're Trends 0-100 interest, not absolute
volume or CPC.

### B1. Free / already done

- `npm run probe-dataforseo` is idempotent and re-uses cache. Safe to run anytime
  to confirm creds.
- The `dataforseo` code path is fully exercised: `analyze` (pipeline), `runSweep`,
  `sweep-all`. All gated on `keyword_provider`.
- Provider cache is multi-run shared, so re-running the same idea or rerunning
  `sweep-all` doesn't double-bill.

### B2. One-command unlock

**Flip `keyword_provider: "google_trends"` → `"dataforseo"` in `~/Downloads/demand-radar-creds.json`.**

What changes the moment you flip:
- New `/` analyses use `dataForSeoProvider.fetch()` → real absolute volume,
  CPC in USD, `competition_index/100`.
- `src/scoring.ts:72-99`: the `isTrends` branch is skipped; demand uses
  `log10(top-5 funnel-weighted volume + 1) / log10(50001) × 5`. A modest 5-phrase
  bucket totalling 50k weighted volume → demand ≈ 4.0/5. Previously every result
  was scaled against Trends 0-25 → ~1-2/5 with throttling.
- `src/scoring.ts:101-108`: `computeWillingnessToPay` stops returning the 1.5
  fallback and uses `(max_cpc / 10) × 5`. Sample numbers from the prior probe
  alone: `claude code` $13.28 → 5.0 (capped), `next.js` $14.42 → 5.0. Most
  developer-tooling ideas will saturate the WTP dimension.
- Idea totals will jump: an idea that was scoring `21/35` with Trends + WTP=1.5
  could move to `25-29/35` with real WTP and real demand. **Verdict bands will
  shift** (`verdictFromScore` at `src/scoring.ts:110-115`). Several `Educate Later`
  ideas likely promote to `Test First`, and some `Pause` → `Educate Later`.
- Sweep PMF scores rerun get real `demand_n`, `bofu_n`, `cpc_n`. The leaderboard
  becomes meaningful.

Operator workflow after flip:
```
SWEEP_FORCE=1 npm run sweep-all     # rescore 50 existing sweeps with real data
npm run sweep -- <slug>              # for the 33 ideas that have no sweep yet
```

Followed by visiting `/` and `/portfolio` to see real rankings.

Cost estimate in §D.

### B3. One-hour build

1. **Surface `competition_index` somewhere.** DataForSEO returns it for every
   phrase (`src/providers/dataforseo.ts:154`), it's cached, it's threaded through
   `KeywordMetric`, but **scoring.ts never reads it**. Easy add: a "rank-ability"
   indicator on the idea page and an `easy_to_rank` filter on `/portfolio` (low
   competition × decent volume × decent CPC). The data is already free — this is
   a UI-only change with maybe one helper function.

2. **Surface volume + CPC in the idea card on `/`.** `app/page.tsx:148-152`
   currently shows score + provider name in the bottom row of each card. After
   DFS rollout, an idea's "anchor metric" (top phrase volume + CPC) is far more
   informative than `35.0/35` for ranking by gut. Pulling top phrase's volume +
   CPC into the card needs no new compute — already in `data.top_phrases[0]`.

3. **`ANALYZE_FORCE=1` or a "re-analyze with current provider" button.**
   `analyzeIdeaAction` (`app/actions.ts:13-31`) overwrites the result file. Add
   a button on the idea detail page that POSTs the original `source_text` back
   through `analyze()`. Currently the only way to re-score the 83 idea-level
   results is to paste the text back into the box on `/`.

4. **Show "Estimated monthly traffic value" per vertical.** `volume × CPC ×
   (some CTR estimate, say 0.03 for org SEO)` gives a dollar number. With real
   DFS data this becomes the most legible single number for ranking ideas —
   far better than `PMF 5.4/10`.

### B4. One-day build

1. **Funnel-stage drill-down on `/portfolio`.** Currently there's one global
   funnel-mix bar. With real DFS data, an operator wants to filter the leaderboard
   to "BOFU-heavy verticals only" (commercial-intent traffic). Add a stage filter
   and a "BOFU $-value column" (sum of CPC × volume for BOFU phrases only).

2. **DataForSEO ↔ Trends comparison report.** Both caches exist (`cache/trends.json`,
   `cache/dataforseo.json`). Build an `npm run compare-providers` that lists
   phrases where Trends said hot but DFS says zero (signal that Trends saw seasonal
   spikes / news events, not buyer intent), and vice versa. Useful to audit the
   tool's old verdicts.

3. **Sweep diffing.** After the rescore, save the prior `sweeps/*.json` to
   `sweeps/_pre-dataforseo/*.json` and add a `/portfolio/changes` page showing
   which ideas had the biggest verdict shifts. This is the highest-leverage
   read of the rescore — the operator wants to know "what did I miss" not
   "what's the new ranking from scratch".

4. **Expand `dataForSeoProvider` request shape.** The current call uses
   `location_code: 2840, language_code: "en"` hard-coded (`src/providers/dataforseo.ts:99`).
   DFS supports per-request locale (e.g., `2826` = UK, `2124` = Canada, `2036` =
   Australia). For ideas in a clearly UK-skewing market this would matter; today
   it's US-only.

5. **Bulk re-analyze of all 83 ideas at the idea level.** Right now
   `npm run sweep-all` re-runs sweeps but there's no equivalent for the
   idea-level pipeline (`analyze`). The `keyword_data` field in
   `results/*.json` is still Trends-based (or zero) for everything. Adding
   an `analyze-all-cli.ts` lets the operator re-score the *idea-level* numbers
   that drive the home page cards and verdict bands — not just the sweep
   leaderboard.

### B5. One-week project

1. **DFS endpoint expansion.** `keywords_data/google_ads/search_volume/live`
   is the cheapest call but the *narrowest* signal. DFS exposes:
   - `keywords_data/google_ads/keywords_for_keywords/live` — keyword expansion
     (give it a seed, get related phrases). This would replace OpenAI as the
     source of "candidate_phrases" entirely, or augment it. Cheaper than LLM
     calls and grounded in real query logs.
   - `keywords_data/google_ads/keywords_for_site/live` — feed it a competitor
     URL, get the keywords that site ranks for. This is huge for the "reverse-
     engineer offers" feature; today's offers are LLM-imagined, not data-grounded.
   - `dataforseo_labs/google/keyword_ideas/live` — clickstream-based, includes
     monthly trend, SERP features, traffic estimates. More expensive but more
     useful.
   - `serp/google/organic/live/regular` — actual SERP for a phrase. Could power
     a "who's already ranking" panel per phrase — far more informative than a
     competition_index scalar.

2. **Trend-over-time signal.** DFS search_volume returns 12-month trailing
   averages. The `_keywords_for_keywords` endpoint returns monthly history.
   With that you can score "rising vs falling demand" — currently the tool has
   no temporal signal at all once Trends is dropped.

3. **Retire `keyword-planner` CSV path or make it the rescue valve.** Now that
   DFS is live and cheap, the manual `phrases-export.csv` → Keyword Planner →
   `import-phrases` loop is friction with no upside. Recommend keeping the
   parser code but removing it from the main path. Or use it inverted: DFS as
   primary, KP-CSV as a calibration check (since KP is the source-of-truth for
   ad auction data).

4. **A "rejected ideas" lane.** With real volume data, the prior `Pause` and
   `Educate Later` verdicts will partially be revealed as false negatives.
   The portfolio page should have a "previously dismissed, now interesting"
   bucket — ideas where rescore promoted them by ≥1 verdict band. This is the
   business value of the rescore; surface it.

---

## C. Highest-ROI single next move

**Flip `keyword_provider` to `"dataforseo"`, then `SWEEP_FORCE=1 npm run sweep-all`,
then `npm run sweep -- <slug>` for the 33 unswept idea slugs.**

Why over the alternatives:

- The dashboard you're shipping today (`/` and `/portfolio`) is a data-empty
  shell. Every UI feature in §B3/B4 is downstream of having real numbers in
  `sweeps/*.json`. Building a "competition_index filter" or a "$ traffic
  value" column over the existing all-zero dataset adds polish to a mirage.
- The 1,345-phrase sweep universe + ~1,000-phrase idea universe (≈2,400 union)
  all hit the same cache, so this single command pays the API bill once and
  unlocks every downstream feature for free.
- The 33 ideas without a sweep are the riskiest unknown: those are ideas you
  triaged but never deepened. The new provider makes that cheap.

**Effort:** ~5 minutes config edit + ~15-30 minutes of CLI runtime (mostly
OpenAI verticals-generation, not DFS latency).

**Cost:** see §D. Sub-$1 USD on the rescore. Anchor: the prior probe of 2
phrases produced a 200 OK in 1-2s — DFS is bulk-friendly.

**Payoff:** every existing card, every PMF score, every leaderboard ranking,
every mega-theme on `/portfolio` becomes load-bearing for the first time.
Verdict shifts will identify both falsely-promoted and falsely-dismissed
ideas, which is the actual decision-support value the tool exists for.

Risk to know about: verdict bands (`src/scoring.ts:110-115`) were tuned against
Trends-era totals. Real DFS data will produce systematically higher WTP scores
(CPC saturates at $10). Don't be surprised when half the portfolio jumps a band.
Resist the urge to "fix" verdicts immediately — let the rescore land, look at the
distribution, then decide if the cutoffs need retuning. Likely yes; it's a 30-min
tuning pass after the data lands.

---

## D. Sweep cost estimate

**Endpoint:** `keywords_data/google_ads/search_volume/live`.
**Pricing (Dec 2025 DFS rate card):** ~$0.05 per request, batched up to 1,000
keywords per request. Practical pricing is $0.05–$0.075 per 1,000 keywords on
this endpoint depending on credits package.

**Phrase universe on disk:**
- 1,063 unique idea-level phrases (from `results/*.json:keyword_data`)
- 1,345 unique sweep phrases (from `results/sweeps/*.json:verticals[].phrases`)
- Union: **2,405 unique phrases**
- DFS cache currently has: 2 entries (`claude code`, `next.js`)
- Missing from cache: **~2,403 phrases**

**Existing sweep rescore (`SWEEP_FORCE=1 npm run sweep-all`):**
- 50 sweeps × ~5 verticals × ~5 phrases = ~1,345 unique (already counted).
- Note: `runSweep` calls `generateVerticalSweep` (OpenAI) first, which produces
  *new* verticals and phrases each call — so a forced rerun doesn't strictly
  re-use the prior sweep's phrase set. Expect 1,000–1,500 *new* phrases just
  from the sweep-all rerun even if the slug list is the same. (This also means
  the cache hit rate for the rescore is lower than naive math suggests.)
- 1 batched DFS call per sweep run (the sweep code already batches with
  `provider.fetch(allPhrases)` in `src/sweep.ts:179`). So: 50 sweeps × 1 batch
  call = **50 API requests = ~$2.50** on the worst case, **~$0.50** if the
  cache hits 60% of phrases.

**33 unswept ideas (`npm run sweep -- <slug>` × 33):**
- 33 × 1 batch call = 33 requests = ~$1.65 worst case.

**Idea-level re-analyze (if added per §B4):**
- 83 ideas × 1 batch call = 83 requests = ~$4.15 worst case.

**Total ballpark for full rescore: $2–$10.** Realistically $3–$5 on first run,
near-zero thereafter due to cache (only new sweep phrases / new ideas hit the
API).

If the operator wants a hard cap: set `DATAFORSEO_TTL_MS=999999999999` (effectively
infinite) to make the cache permanent for the run, and run sweep-all once.
Subsequent reruns of `sweep-all` will only bill for OpenAI-generated phrases that
weren't in the cache.

**Sanity check before any of this:** I recommend running `npm run sweep -- <slug>`
on ONE idea first (e.g. `ai-receptionist`, since you already have visibility into
its existing sweep), confirm the cache fills and the resulting JSON has non-zero
volumes, then run `sweep-all`. Total cost of this single-slug sanity check:
~$0.05–$0.10.

---

## E. Risks / questions

1. **`generateVerticalSweep` is non-deterministic.** Each `runSweep` call asks
   OpenAI to extract verticals + phrases from scratch (`src/sweep.ts:132`). The
   rescore won't reproduce the same vertical names or phrases — meaning the
   `/portfolio` mega-themes table will reshuffle entirely, not just get new
   numbers. Operator should know they're getting a *fresh* sweep, not a *rescored*
   sweep. If you want comparability, you'd need to refactor `runSweep` to accept
   a cached sweep skeleton and only refresh metrics. (Recommend: don't bother
   — let it shake out.)

2. **Locale lock.** `src/providers/dataforseo.ts:99` hard-codes US English.
   For ideas where the buyer is non-US (a few in your portfolio look UK/AU-ish),
   the DFS volumes will under-report. Verify which ideas this affects before
   trusting their new scores.

3. **Verdict band drift.** As called out in §C — DFS will systematically inflate
   WTP scores because CPC saturates the dimension at $10. Real B2B SaaS phrases
   hit $20-30 CPC routinely. Half the portfolio might gradient-shift up a band.
   Decide upfront: do you want to retune `verdictFromScore` thresholds, or live
   with the shift? My recommendation: live with it for one cycle, then look at
   the distribution histogram before retuning.

4. **`runSweep` writes per-sweep on completion (`src/sweep.ts:243`).** If
   `sweep-all` is interrupted, you get partial progress saved (good). But there
   is no idempotent "skip phrases already cached" at the sweep level — each
   slug calls OpenAI fresh. Re-running after Ctrl-C wastes OpenAI calls. Worth
   knowing.

5. **Competition_index is collected but unused (`src/scoring.ts` has zero
   references to `.competition`).** Once DFS runs, you'll have a competition
   score for every phrase but no UI consuming it. Easy win post-rescore.

6. **`docs/google-ads-api-design.md` is unchanged.** Still describes Google Ads
   API as the demand source for the Basic Access application. Prior agent
   correctly skipped editing this. It's worth knowing — when Google Ads access
   approves, the operator needs to decide: keep DFS or migrate.

---

## F. What I did NOT investigate (and why)

- **Did not run a live DFS sweep on real ideas.** The cost guardrail in my
  brief said one ≤20-phrase probe at most, and I didn't think a targeted probe
  would change my recommendations — the prior 2-phrase probe + the architectural
  reading are enough to ground the math. Holding off here was the right call;
  spending real $ on an exploratory probe before the operator decides to flip
  the provider is wrong order of operations.
- **Did not benchmark DFS latency for a 1,000-phrase batch.** Worth confirming
  before `sweep-all` runs — if latency × 50 slugs is >30 min, the operator wants
  to know.
- **Did not look at `src/batch.ts` or `src/ingest.ts` in depth.** Both have
  files mentioned but I didn't trace whether `ingest` re-fetches keywords. If
  it does, the GitHub/Vercel triage button on `/` would hit DFS on every triage
  run, which would matter for cost.
- **Did not validate Mega-themes table content.** Given everything's zero-volume,
  the table is currently meaningless and a code-level audit of `aggregateVerticals`
  / `topPMFLeaders` is wasted effort until real data lands.
- **Did not audit OpenAI prompt quality** (`src/openai.ts`). The phrases
  feeding DFS are LLM-generated; if they're junk, DFS gives back honest zeros.
  Worth a future pass to look at phrase quality after rescore lands.
- **No unit tests reviewed for scoring math.** Prior agent noted no DFS-specific
  tests; `scoring.spec.ts` was not opened by me. Worth checking before
  retuning verdict bands.
- **No security / secrets handling review.** Out of scope for "what's now
  possible".
