import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ConceptAndBuyersSchema,
  OffersAndVerdictSchema,
  VerticalSweepSchema,
  type ConceptAndBuyers,
  type OffersAndVerdict,
  type VerticalSweep,
} from "./schemas.js";
import { loadCredentials } from "./config.js";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const creds = loadCredentials();
  _client = new OpenAI({ apiKey: creds.openai_api_key });
  return _client;
}

const SYSTEM_PROMPT = `You are the analysis engine for Google Demand Radar, a tool that triages startup ideas by whether real Google demand exists for them.

Your job is to be honest, specific, and grounded in buyer language.

Rules:
- Use the actual phrases buyers Google. Not marketing copy. "personal crm app", not "AI-powered relationship intelligence platform."
- Distinguish people who already know what they want (product-aware searches) from people who only feel the pain (problem-aware searches).
- Be willing to give low scores. The whole point of this tool is to kill bad ideas early so the user does not waste months building things nobody searches for.
- Reverse-engineer offers from existing buyer language, never from product features.
- Different buyers Google different things. One idea can have multiple buyer personas with different phrases.
- When in doubt about whether a phrase is searched, lean toward simpler, more common wording (what a normal person would type at 11pm on their phone).

FUNNEL STAGES — tag every candidate phrase with one of:
- tofu (top of funnel, informational): "how does X work", "what is X", "examples of X". The searcher is learning, not buying.
- mofu (middle of funnel, comparison/research): "best X", "X review", "X vs Y", "X alternatives". The searcher is evaluating.
- bofu (bottom of funnel, purchase intent): "buy X", "X pricing", "X for [specific niche/role]", "best X under $N", "X for [industry]". The searcher is trying to buy NOW or is searching with high specificity that reveals real buying intent.
- For every persona, AT LEAST 40% of the candidate phrases must be bofu. BOFU phrases are how you reach buyers, not how you reach readers.
- Long-tail specificity ("ai receptionist for dental office") is usually bofu. Short generic terms ("ai receptionist") are usually mofu. Question phrases ("how to X") are usually tofu.`;

export async function extractConceptAndBuyers(
  ideaText: string
): Promise<ConceptAndBuyers> {
  const c = client();
  const completion = await c.beta.chat.completions.parse({
    model: loadCredentials().openai_model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze this idea. Extract the concept, identify 1-4 buyer personas with realistic Google search phrases for each, and judge the five scorable dimensions (buyer_urgency, mvp_ease, distribution_fit, retention_potential, advantage).

IDEA:
${ideaText}`,
      },
    ],
    response_format: zodResponseFormat(ConceptAndBuyersSchema, "concept_and_buyers"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message.refusal;
    throw new Error(
      refusal
        ? `OpenAI refused to produce structured output: ${refusal}`
        : "OpenAI failed to produce a structured concept + buyer extraction."
    );
  }
  return parsed;
}

export async function generateOffersAndVerdict(
  concept: ConceptAndBuyers,
  topPhrasesWithData: Array<{
    phrase: string;
    volume: number;
    cpc: number;
    competition: number;
    buyer: string;
  }>,
  scoreBreakdown: Record<string, number>,
  verdict: string
): Promise<OffersAndVerdict> {
  const phraseTable =
    topPhrasesWithData.length === 0
      ? "(no measured phrases — keyword data was unavailable)"
      : topPhrasesWithData
          .map(
            (p) =>
              `- "${p.phrase}" (buyer: ${p.buyer}, interest: ${p.volume.toFixed(1)}/100, CPC: $${p.cpc.toFixed(2)}, competition: ${p.competition.toFixed(2)})`
          )
          .join("\n");

  const scoreLines = Object.entries(scoreBreakdown)
    .map(([k, v]) => `- ${k}: ${v.toFixed(1)}/5`)
    .join("\n");

  const c = client();
  const completion = await c.beta.chat.completions.parse({
    model: loadCredentials().openai_model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `An idea has been analyzed. Use the keyword-anchored data below to reverse-engineer offers.

CONCEPT:
${concept.name} — ${concept.one_liner}
Domain: ${concept.domain}
Core promise: ${concept.core_promise}

BUYER PERSONAS:
${concept.buyers
  .map(
    (b) =>
      `- ${b.persona} (awareness: ${b.awareness_level}). Pain: ${b.pain}`
  )
  .join("\n")}

REAL KEYWORD DATA (top phrases by interest):
${phraseTable}

SCORE BREAKDOWN:
${scoreLines}

VERDICT: ${verdict}

Now produce:
1. One offer per buyer persona, anchored to the highest-interest phrase that matches that buyer. Use the buyer's language verbatim where you can.
2. A specific next action the founder should take this week.
3. 2-4 sentences on why this verdict was assigned and where the risk is.`,
      },
    ],
    response_format: zodResponseFormat(OffersAndVerdictSchema, "offers_and_verdict"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message.refusal;
    throw new Error(
      refusal
        ? `OpenAI refused to produce structured output: ${refusal}`
        : "OpenAI failed to produce offers + verdict output."
    );
  }
  return parsed;
}

export async function generateVerticalSweep(
  concept: ConceptAndBuyers,
  ideaText: string
): Promise<VerticalSweep> {
  const c = client();
  const completion = await c.beta.chat.completions.parse({
    model: loadCredentials().openai_model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Given this idea, generate 5-10 plausible verticals or niches that could buy it. For each vertical, give the ICP (size, role, context), rationale (why their pain matches), and 5-10 vertical-specific Google phrases (each funnel-tagged, ≥50% bofu).

The goal: help the founder pick which 2-3 verticals to attack first based on demand. So the verticals must be SPECIFIC and DIVERSE — not 'small businesses' but 'solo personal injury law firms, $500k-2M revenue'. Not 'healthcare' but '3-doctor private dental practices, $1-3M revenue, owner-operator'.

Don't repeat the original buyer personas verbatim from the concept extraction below; instead, generate vertical-specific extensions ("ai receptionist for dental office", "ai receptionist for hvac dispatch").

CONCEPT:
${concept.name} — ${concept.one_liner}
Core promise: ${concept.core_promise}
Domain: ${concept.domain}

ORIGINAL BUYER PERSONAS (for context, but generate NEW verticals):
${concept.buyers
  .map((b) => `- ${b.persona}. Pain: ${b.pain}`)
  .join("\n")}

ORIGINAL IDEA TEXT (for grounding):
${ideaText.slice(0, 2000)}`,
      },
    ],
    response_format: zodResponseFormat(VerticalSweepSchema, "vertical_sweep"),
  });

  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) {
    const refusal = completion.choices[0]?.message.refusal;
    throw new Error(
      refusal
        ? `OpenAI refused to produce structured output: ${refusal}`
        : "OpenAI failed to produce vertical sweep output."
    );
  }
  return parsed;
}
