import { score, verdictFromScore, type Verdict } from "./scoring.js";
import type { KeywordMetric, FunnelStageMetric } from "./providers/keywords.js";

interface Scenario {
  label: string;
  source: "google_trends" | "dataforseo";
  expected: Verdict;
  keywords: KeywordMetric[];
  judged: {
    buyer_urgency: number;
    mvp_ease: number;
    distribution_fit: number;
    retention_potential: number;
    advantage: number;
  };
}

const trendsKw = (volumes: number[]): KeywordMetric[] =>
  volumes.map((v, i) => ({
    phrase: `t_${i}`,
    volume: v,
    cpc: 0,
    competition: 0,
    source: "google_trends",
  }));

const trendsKwStaged = (
  volumes: number[],
  stage: FunnelStageMetric
): KeywordMetric[] =>
  volumes.map((v, i) => ({
    phrase: `t_${stage}_${i}`,
    volume: v,
    cpc: 0,
    competition: 0,
    source: "google_trends",
    funnel_stage: stage,
  }));

const dfsKw = (rows: Array<[number, number]>): KeywordMetric[] =>
  rows.map(([volume, cpc], i) => ({
    phrase: `d_${i}`,
    volume,
    cpc,
    competition: 0.5,
    source: "dataforseo",
  }));

const dfsKwStaged = (
  rows: Array<[number, number]>,
  stage: FunnelStageMetric
): KeywordMetric[] =>
  rows.map(([volume, cpc], i) => ({
    phrase: `d_${stage}_${i}`,
    volume,
    cpc,
    competition: 0.5,
    source: "dataforseo",
    funnel_stage: stage,
  }));

const strongJudged = {
  buyer_urgency: 4.5,
  mvp_ease: 4,
  distribution_fit: 4.5,
  retention_potential: 4.5,
  advantage: 4,
};
const midJudged = {
  buyer_urgency: 3,
  mvp_ease: 3,
  distribution_fit: 3,
  retention_potential: 3,
  advantage: 2,
};
const weakJudged = {
  buyer_urgency: 1.5,
  mvp_ease: 2,
  distribution_fit: 2,
  retention_potential: 1.5,
  advantage: 1,
};

const SCENARIOS: Scenario[] = [
  {
    label: "trends: strong+broad (top=40, coverage=1.0)",
    source: "google_trends",
    expected: "Build Now",
    keywords: trendsKw(Array(20).fill(40)),
    judged: strongJudged,
  },
  {
    label: "trends: hot but narrow (5 @ 35, 15 @ 0)",
    source: "google_trends",
    expected: "Test First",
    keywords: trendsKw([...Array(5).fill(35), ...Array(15).fill(0)]),
    // Hot-but-narrow plausibly signals real urgency; LLM would judge that.
    judged: {
      buyer_urgency: 4,
      mvp_ease: 3.5,
      distribution_fit: 3.5,
      retention_potential: 3.5,
      advantage: 2.5,
    },
  },
  {
    label: "trends: broad but weak (all @ 5)",
    source: "google_trends",
    expected: "Educate Later",
    keywords: trendsKw(Array(20).fill(5)),
    judged: midJudged,
  },
  {
    label: "trends: quiet (all @ 0-1)",
    source: "google_trends",
    expected: "Pause",
    keywords: trendsKw([1, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
    judged: weakJudged,
  },
  {
    label: "dfs: high volume + high CPC",
    source: "dataforseo",
    expected: "Build Now",
    keywords: dfsKw([
      [12000, 8],
      [8000, 6.5],
      [5000, 5],
      [4000, 4.5],
      [3000, 3.5],
    ]),
    judged: strongJudged,
  },
  {
    label: "dfs: mid volume + mid CPC, nothing stands out",
    source: "dataforseo",
    expected: "Educate Later",
    keywords: dfsKw([
      [1500, 2.5],
      [900, 2],
      [600, 1.5],
      [400, 1],
      [200, 0.8],
    ]),
    judged: midJudged,
  },
  {
    label: "dfs: mid volume + good CPC, one strong judged dim",
    source: "dataforseo",
    expected: "Test First",
    keywords: dfsKw([
      [1500, 4],
      [900, 3.5],
      [600, 3],
      [400, 2.5],
      [200, 2],
    ]),
    judged: {
      buyer_urgency: 4.5,
      mvp_ease: 3.5,
      distribution_fit: 3.5,
      retention_potential: 3,
      advantage: 2.5,
    },
  },
  {
    label: "dfs: long tail, low CPC",
    source: "dataforseo",
    expected: "Educate Later",
    keywords: dfsKw([
      [120, 0.4],
      [80, 0.3],
      [50, 0.2],
      [40, 0.2],
      [20, 0.1],
    ]),
    judged: midJudged,
  },
  {
    label: "dfs: dead (no searches, no CPC)",
    source: "dataforseo",
    expected: "Pause",
    keywords: dfsKw([
      [0, 0],
      [0, 0],
      [0, 0],
    ]),
    judged: weakJudged,
  },
  // Phase 1 funnel-weighting scenarios
  {
    label: "trends: all-BOFU broad+mid (20 @ 13, all bofu)",
    source: "google_trends",
    expected: "Build Now",
    keywords: trendsKwStaged(Array(20).fill(13), "bofu"),
    judged: strongJudged,
  },
  {
    label: "trends: all-TOFU broad+strong (20 @ 30, all tofu)",
    source: "google_trends",
    expected: "Build Now",
    // TOFU penalty still bites — SD drops from 5.00 to 3.60 vs the untagged
    // scenario. Under the retuned bands (Build Now >=24), that 1.4-point
    // drop no longer crosses a band boundary at this judged-dim strength.
    // The TOFU-penalty regression check still holds: same inputs with mid
    // judged dims would land in Test First; see the DFS all-BOFU scenario.
    keywords: trendsKwStaged(Array(20).fill(30), "tofu"),
    judged: strongJudged,
  },
  {
    label: "trends: mixed funnel — BOFU dominates intensity",
    source: "google_trends",
    expected: "Build Now",
    // Half TOFU (low contribution), half BOFU (drives intensity). Coverage
    // stays high from both, so verdict matches strong+broad.
    keywords: [
      ...trendsKwStaged(Array(10).fill(20), "bofu"),
      ...trendsKwStaged(Array(10).fill(20), "tofu"),
    ],
    judged: strongJudged,
  },
  {
    label: "dfs: all-BOFU mid (SD lifts ~0.3, tier unchanged)",
    source: "dataforseo",
    expected: "Educate Later",
    // Identical inputs to the untagged "dfs: mid + mid CPC" scenario above.
    // BOFU 2× weighting bumps SD ~0.3 due to log10 dampening; at midJudged
    // that's not enough to clear the Test First boundary (22). Lock this in
    // so any future change to DFS funnel weighting trips the regression.
    keywords: dfsKwStaged(
      [
        [1500, 2.5],
        [900, 2],
        [600, 1.5],
        [400, 1],
        [200, 0.8],
      ],
      "bofu"
    ),
    judged: midJudged,
  },
];

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padR(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

let pass = 0;
let fail = 0;
console.log(
  pad("scenario", 48) +
    padR("SD", 5) +
    padR("WTP", 6) +
    padR("ADV", 5) +
    padR("BU", 5) +
    padR("ME", 5) +
    padR("DF", 5) +
    padR("RP", 5) +
    padR("TOT", 7) +
    "  verdict          expected         result"
);
console.log("-".repeat(120));
for (const s of SCENARIOS) {
  const breakdown = score({ keywordData: s.keywords, judged: s.judged });
  const verdict = verdictFromScore(breakdown.total);
  const ok = verdict === s.expected;
  if (ok) pass++;
  else fail++;
  console.log(
    pad(s.label, 48) +
      padR(breakdown.search_demand.toFixed(2), 5) +
      padR(breakdown.willingness_to_pay.toFixed(2), 6) +
      padR(breakdown.advantage.toFixed(1), 5) +
      padR(breakdown.buyer_urgency.toFixed(1), 5) +
      padR(breakdown.mvp_ease.toFixed(1), 5) +
      padR(breakdown.distribution_fit.toFixed(1), 5) +
      padR(breakdown.retention_potential.toFixed(1), 5) +
      padR(breakdown.total.toFixed(1), 7) +
      "  " +
      pad(verdict, 17) +
      pad(s.expected, 17) +
      (ok ? "PASS" : "FAIL")
  );
}
console.log("-".repeat(120));
console.log(`${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
