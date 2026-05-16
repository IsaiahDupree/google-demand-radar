import { z } from "zod";

export const AwarenessLevel = z.enum([
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
]);
export type AwarenessLevel = z.infer<typeof AwarenessLevel>;

export const FunnelStage = z.enum(["tofu", "mofu", "bofu"]);
export type FunnelStage = z.infer<typeof FunnelStage>;

export const CandidatePhraseSchema = z.object({
  phrase: z
    .string()
    .describe(
      "Natural buyer-language Google search phrase, lowercase, no marketing speak."
    ),
  funnel_stage: FunnelStage.describe(
    "tofu = informational ('how does X work', 'what is X'). " +
      "mofu = comparison/research ('X review', 'best X', 'X vs Y'). " +
      "bofu = purchase/specific-fit intent ('buy X', 'X pricing', 'X for [niche buyer]', 'best X under $N')."
  ),
});
export type CandidatePhrase = z.infer<typeof CandidatePhraseSchema>;

export const ConceptAndBuyersSchema = z.object({
  name: z.string().describe("Short product name in title case."),
  one_liner: z.string().describe("One sentence describing the product."),
  core_promise: z.string().describe("The result a buyer gets if this actually works."),
  domain: z
    .string()
    .describe("Industry/category in plain language (e.g., 'personal CRM', 'creator tooling')."),
  buyers: z
    .array(
      z.object({
        persona: z.string().describe("Specific buyer (e.g., 'busy founders raising a seed round')."),
        awareness_level: AwarenessLevel,
        pain: z.string().describe("The painful, concrete thing this buyer experiences."),
        candidate_phrases: z
          .array(CandidatePhraseSchema)
          .min(3)
          .max(12)
          .describe(
            "5-10 Google search phrases this buyer would realistically type. " +
              "AT LEAST 40% must be bofu (high purchase intent). " +
              "Natural buyer language, lowercase, no marketing speak."
          ),
      })
    )
    .min(1)
    .max(4)
    .describe("1-4 distinct buyer personas, each with realistic search phrases."),
  judged: z.object({
    buyer_urgency: z
      .number()
      .min(0)
      .max(5)
      .describe("0 = mild curiosity, 5 = bleeding right now."),
    mvp_ease: z
      .number()
      .min(0)
      .max(5)
      .describe("5 = single weekend, 0 = months of platform work."),
    distribution_fit: z
      .number()
      .min(0)
      .max(5)
      .describe("Can this buyer be reached cheaply via Google/Meta/SEO/outreach? 5 = obviously yes."),
    retention_potential: z
      .number()
      .min(0)
      .max(5)
      .describe("Once a buyer pays once, how likely is repeat use? 5 = sticky subscription, 0 = one-shot."),
    advantage: z
      .number()
      .min(0)
      .max(5)
      .describe(
        "Does the founder have an unfair edge — existing audience, domain expertise, prior assets, proprietary data, distribution, or a defensible mechanism? Score the EVIDENCE in the idea description; if no edge is mentioned, score low (1-2) rather than defaulting to a middle value. 5 = clear, named edge. 0 = competing from behind with nothing."
      ),
    rationale: z
      .string()
      .describe("2-3 sentences explaining the judged scores so a human can sanity-check the reasoning."),
  }),
});
export type ConceptAndBuyers = z.infer<typeof ConceptAndBuyersSchema>;

export const VerticalSchema = z.object({
  name: z
    .string()
    .describe(
      "Vertical/niche name in plain language. Be specific: 'Solo personal injury law firms' not 'lawyers'."
    ),
  icp: z
    .string()
    .describe(
      "Ideal customer profile in 1-2 sentences. Include size, role, and operating context. " +
        "Example: '3-doctor private dental practice, $1-3M revenue, owner-operator who handles admin themselves.'"
    ),
  rationale: z
    .string()
    .describe("Why this vertical's pain matches this idea. 1-2 sentences."),
  buyer_phrases: z
    .array(CandidatePhraseSchema)
    .min(5)
    .max(10)
    .describe(
      "5-10 vertical-specific Google search phrases this ICP would type. " +
        "AT LEAST 50% must be bofu (purchase intent or specific-niche). " +
        "Lowercase, natural buyer language. Long-tail and specific is good."
    ),
});
export type Vertical = z.infer<typeof VerticalSchema>;

export const VerticalSweepSchema = z.object({
  verticals: z
    .array(VerticalSchema)
    .min(3)
    .max(10)
    .describe(
      "5-10 distinct verticals or niches that could plausibly buy this idea. " +
        "DIVERSE — different industries, scales, roles. " +
        "Each must be specific enough that a real buyer could be named (not 'small businesses')."
    ),
  cross_vertical_insight: z
    .string()
    .describe(
      "1-2 sentences on patterns across the verticals: shared pain, common buying triggers, anti-patterns."
    ),
});
export type VerticalSweep = z.infer<typeof VerticalSweepSchema>;

export const OffersAndVerdictSchema = z.object({
  offers: z
    .array(
      z.object({
        buyer: z.string().describe("Which buyer persona this offer targets."),
        anchor_phrase: z
          .string()
          .describe("The single highest-signal real search phrase this offer aligns to."),
        offer_copy: z
          .string()
          .describe(
            "1-2 sentence offer in the buyer's language. Structure: For [buyer] who [outcome] but [pain], we [mechanism] so they [result] without [objection]."
          ),
        landing_page_headline: z
          .string()
          .describe("8-12 word landing-page headline targeting this phrase."),
      })
    )
    .min(1)
    .max(4)
    .describe("One reverse-engineered offer per buyer persona."),
  next_action: z
    .string()
    .describe(
      "A specific, concrete action the founder should take this week (e.g., 'Ship 3 landing pages for the top phrases and burn $50 on Google Search ads')."
    ),
  reasoning: z
    .string()
    .describe("2-4 sentences on why this verdict — what the demand signals say, where the risk is."),
});
export type OffersAndVerdict = z.infer<typeof OffersAndVerdictSchema>;
