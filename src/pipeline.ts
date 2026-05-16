import { extractConceptAndBuyers, generateOffersAndVerdict } from "./openai.js";
import { score, verdictFromScore, type ScoreBreakdown, type Verdict } from "./scoring.js";
import { googleTrendsProvider } from "./providers/trends.js";
import { dataForSeoProvider, expandKeywords } from "./providers/dataforseo.js";
import { googleAdsProvider } from "./providers/google-ads.js";
import { keywordPlannerProvider } from "./providers/keyword-planner.js";
import type { KeywordProvider, KeywordMetric } from "./providers/keywords.js";
import type { ConceptAndBuyers, OffersAndVerdict } from "./schemas.js";
import { loadCredentials } from "./config.js";

export interface PipelineResult {
  source_text: string;
  provider: string;
  concept: ConceptAndBuyers;
  keyword_data: Array<KeywordMetric & { buyer: string }>;
  top_phrases: Array<KeywordMetric & { buyer: string }>;
  score: ScoreBreakdown;
  verdict: Verdict;
  offers_and_verdict: OffersAndVerdict;
}

function pickProvider(): KeywordProvider {
  const choice = loadCredentials().keyword_provider;
  if (choice === "keyword_planner") return keywordPlannerProvider;
  if (choice === "google_ads") return googleAdsProvider;
  if (choice === "dataforseo") return dataForSeoProvider;
  return googleTrendsProvider;
}

export async function analyze(ideaText: string): Promise<PipelineResult> {
  const concept = await extractConceptAndBuyers(ideaText);
  return rescoreFromConcept(concept, ideaText);
}

// Re-runs the pipeline against an existing concept. Used by analyze-all to
// refresh keyword data + scoring + offers under a new provider without
// re-extracting the concept (which would reshuffle idea names and buyer
// personas across runs and burn OpenAI tokens for no signal gain).
//
// Pass `existingOffers` when callers want to skip the LLM offer regeneration
// (cheaper, faster, and survives OpenAI quota exhaustion). Set via env var
// SKIP_OFFERS=1 from the CLI.
export async function rescoreFromConcept(
  concept: ConceptAndBuyers,
  source_text: string,
  opts?: { existingOffers?: OffersAndVerdict }
): Promise<PipelineResult> {
  const provider = pickProvider();

  interface PhraseInfo {
    persona: string;
    funnel_stage: "tofu" | "mofu" | "bofu";
  }
  const phraseToInfo = new Map<string, PhraseInfo>();
  for (const b of concept.buyers) {
    for (const cp of b.candidate_phrases) {
      // Legacy result files (pre-funnel_stage schema) stored candidate_phrases
      // as bare strings, not {phrase, funnel_stage} objects. Treat unknown
      // stages as mofu so old data still rescore-able.
      const phrase = typeof cp === "string" ? cp : cp.phrase;
      const funnel_stage =
        typeof cp === "string" ? "mofu" : (cp.funnel_stage ?? "mofu");
      if (!phrase) continue;
      const normalized = phrase.trim().toLowerCase();
      if (normalized && !phraseToInfo.has(normalized)) {
        phraseToInfo.set(normalized, {
          persona: b.persona,
          funnel_stage,
        });
      }
    }
  }
  // Optional seed expansion via DataForSEO keywords_for_keywords.
  // Each seed costs ~$0.075 and returns hundreds of real-query-log phrases
  // with volume/CPC/competition attached. Off by default because the cost
  // adds up fast on a full-portfolio re-analyze.
  //
  //   ANALYZE_EXPAND=1       opt in
  //   EXPAND_SEEDS_PER_BUYER number of LLM phrases per buyer to use as seeds
  //                         (default 1; pick BOFU phrases first)
  //   EXPAND_TOP_N           expansion phrases to keep per seed (default 10)
  //
  // Only triggered when the active provider is dataforseo, since that's the
  // only one that exposes the expansion endpoint.
  const expandEnabled =
    process.env.ANALYZE_EXPAND === "1" && provider.name === "dataforseo";
  const expandSeedsPerBuyer = Math.max(
    1,
    Number(process.env.EXPAND_SEEDS_PER_BUYER) || 1
  );
  const expandTopN = Math.max(1, Number(process.env.EXPAND_TOP_N) || 10);

  if (expandEnabled) {
    // For each buyer, pick up to N seeds — BOFU first (highest commercial
    // intent), then MOFU, then TOFU. Drop seeds that look like questions or
    // generic 1-2 word fragments — expansion of those returns noise.
    const stageRank: Record<string, number> = { bofu: 0, mofu: 1, tofu: 2 };
    const seeds = new Set<string>();
    for (const b of concept.buyers) {
      const candidates: Array<{ phrase: string; stage: string }> = [];
      for (const cp of b.candidate_phrases) {
        const phrase = typeof cp === "string" ? cp : cp.phrase;
        const stage =
          typeof cp === "string" ? "mofu" : (cp.funnel_stage ?? "mofu");
        if (!phrase) continue;
        const cleaned = phrase.trim().toLowerCase();
        if (cleaned.split(/\s+/).length < 2) continue;
        candidates.push({ phrase: cleaned, stage });
      }
      candidates.sort(
        (a, b) => (stageRank[a.stage] ?? 9) - (stageRank[b.stage] ?? 9)
      );
      for (const c of candidates.slice(0, expandSeedsPerBuyer)) {
        seeds.add(c.phrase);
      }
    }

    if (seeds.size > 0) {
      const expansion = await expandKeywords(Array.from(seeds), {
        topN: expandTopN,
      });
      // Attribute each expanded phrase back to the persona + stage of its
      // originating seed. If the same expanded phrase shows up from multiple
      // seeds, the first one wins (Map insertion order).
      for (const bucket of expansion) {
        const seedInfo = phraseToInfo.get(bucket.seed);
        if (!seedInfo) continue;
        for (const kw of bucket.keywords) {
          const cleaned = kw.keyword.trim().toLowerCase();
          if (!cleaned || phraseToInfo.has(cleaned)) continue;
          phraseToInfo.set(cleaned, seedInfo);
        }
      }
    }
  }

  const phrases = Array.from(phraseToInfo.keys());
  const metrics = await provider.fetch(phrases);
  const keyword_data = metrics.map((m) => {
    const info = phraseToInfo.get(m.phrase.toLowerCase());
    return {
      ...m,
      buyer: info?.persona ?? "unknown",
      funnel_stage: m.funnel_stage ?? info?.funnel_stage ?? "mofu",
    };
  });

  const scoreBreakdown = score({
    keywordData: keyword_data,
    judged: {
      buyer_urgency: concept.judged.buyer_urgency,
      mvp_ease: concept.judged.mvp_ease,
      distribution_fit: concept.judged.distribution_fit,
      retention_potential: concept.judged.retention_potential,
      advantage: concept.judged.advantage,
    },
  });
  const verdict = verdictFromScore(scoreBreakdown.total);

  const top_phrases = [...keyword_data]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 8);

  const skipOffers = process.env.SKIP_OFFERS === "1" && opts?.existingOffers;
  const offers = skipOffers
    ? opts!.existingOffers!
    : await generateOffersAndVerdict(
        concept,
        top_phrases,
        {
          search_demand: scoreBreakdown.search_demand,
          buyer_urgency: scoreBreakdown.buyer_urgency,
          willingness_to_pay: scoreBreakdown.willingness_to_pay,
          mvp_ease: scoreBreakdown.mvp_ease,
          distribution_fit: scoreBreakdown.distribution_fit,
          advantage: scoreBreakdown.advantage,
          retention_potential: scoreBreakdown.retention_potential,
        },
        verdict
      );

  return {
    source_text,
    provider: provider.name,
    concept,
    keyword_data,
    top_phrases,
    score: scoreBreakdown,
    verdict,
    offers_and_verdict: offers,
  };
}
