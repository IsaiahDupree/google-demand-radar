import {
  parseVolumeBucket,
  parseUsd,
  parseCompetition,
  parseKeywordPlannerCsv,
} from "./keyword-planner-parser.js";

interface Case<I, O> {
  label: string;
  input: I;
  expected: O;
  actual?: O;
  ok?: boolean;
}

let pass = 0;
let fail = 0;

function assertEq<T>(label: string, actual: T, expected: T): void {
  const ok =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) < 0.001
      : actual === expected;
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

function group(name: string): void {
  console.log(`\n=== ${name} ===`);
}

// ─────────────────────────────────────────────────────────────
group("parseVolumeBucket");

const volCases: Array<Case<string, number>> = [
  { label: "empty string", input: "", expected: 0 },
  { label: "plain int", input: "1500", expected: 1500 },
  { label: "plain int with commas", input: "1,500", expected: 1500 },
  { label: "decimal", input: "1500.5", expected: 1500.5 },
  { label: "K shorthand", input: "1K", expected: 1000 },
  { label: "M shorthand", input: "1.5M", expected: 1_500_000 },
  { label: "range with em-dash", input: "1K – 10K", expected: 5500 },
  { label: "range with hyphen", input: "1K - 10K", expected: 5500 },
  { label: "range 100 – 1K", input: "100 – 1K", expected: 550 },
  { label: "range 10K – 100K", input: "10K – 100K", expected: 55000 },
  { label: "range 100K – 1M", input: "100K – 1M", expected: 550000 },
  { label: "less-than bucket", input: "<10", expected: 5 },
  { label: "dashes in non-range text", input: "n/a", expected: 0 },
];
for (const c of volCases) {
  assertEq(c.label, parseVolumeBucket(c.input), c.expected);
}

// ─────────────────────────────────────────────────────────────
group("parseUsd");
assertEq("$4.21", parseUsd("$4.21"), 4.21);
assertEq("4.21 (no dollar)", parseUsd("4.21"), 4.21);
assertEq("$1,234.56", parseUsd("$1,234.56"), 1234.56);
assertEq("empty", parseUsd(""), 0);
assertEq("undefined", parseUsd(undefined), 0);
assertEq("garbage", parseUsd("n/a"), 0);

// ─────────────────────────────────────────────────────────────
group("parseCompetition");
assertEq("Low text", parseCompetition("Low"), 0.25);
assertEq("Medium text", parseCompetition("Medium"), 0.5);
assertEq("High text", parseCompetition("High"), 0.85);
assertEq("Indexed 50", parseCompetition(undefined, "50"), 0.5);
assertEq("Indexed 100", parseCompetition(undefined, "100"), 1);
assertEq("Indexed wins over text", parseCompetition("Low", "85"), 0.85);
assertEq("Empty both", parseCompetition(), 0);

// ─────────────────────────────────────────────────────────────
group("parseKeywordPlannerCsv — typical export with preamble");

const TYPICAL_CSV = `"Keyword planner"
"Keyword list,Search volume and forecasts"
"Date range: Jan 2025 - Dec 2025"

Keyword,Currency,Avg. monthly searches,Three month change,YoY change,Competition,Competition (indexed value),Top of page bid (low range),Top of page bid (high range)
personal crm app,USD,1K – 10K,0%,5%,Medium,45,$1.20,$4.80
ai receptionist for dental office,USD,100 – 1K,0%,0%,Low,15,$0.85,$3.40
best running shoes,USD,100K – 1M,0%,0%,High,90,$0.45,$1.80
gibberish phrase no signal,USD,,,,,,,
`;
const typicalRows = parseKeywordPlannerCsv(TYPICAL_CSV);
assertEq("row count", typicalRows.length, 4);
assertEq("row[0].phrase", typicalRows[0]!.phrase, "personal crm app");
assertEq("row[0].volume (1K – 10K midpoint)", typicalRows[0]!.volume, 5500);
assertEq("row[0].cpc (high $4.80)", typicalRows[0]!.cpc, 4.8);
assertEq("row[0].competition (indexed 45)", typicalRows[0]!.competition, 0.45);
assertEq("row[1].volume (100 – 1K midpoint)", typicalRows[1]!.volume, 550);
assertEq("row[2].volume (100K – 1M midpoint)", typicalRows[2]!.volume, 550000);
assertEq("row[3].volume (empty)", typicalRows[3]!.volume, 0);
assertEq("row[3].cpc (empty)", typicalRows[3]!.cpc, 0);

// ─────────────────────────────────────────────────────────────
group("parseKeywordPlannerCsv — no preamble, exact volumes");

const EXACT_CSV = `Keyword,Avg. monthly searches,Competition,Top of page bid (high range)
exact match phrase,1234,Medium,$2.50
another exact,8800,High,$5.10
`;
const exactRows = parseKeywordPlannerCsv(EXACT_CSV);
assertEq("exact row count", exactRows.length, 2);
assertEq("exact row[0].volume", exactRows[0]!.volume, 1234);
assertEq("exact row[0].competition (Medium → 0.5)", exactRows[0]!.competition, 0.5);
assertEq("exact row[1].cpc", exactRows[1]!.cpc, 5.1);

// ─────────────────────────────────────────────────────────────
group("parseKeywordPlannerCsv — quoted commas inside phrase");

const QUOTED_CSV = `Keyword,Avg. monthly searches,Top of page bid (high range)
"crm, for solopreneurs",550,$3.20
`;
const quotedRows = parseKeywordPlannerCsv(QUOTED_CSV);
assertEq("quoted row count", quotedRows.length, 1);
assertEq("quoted phrase preserved", quotedRows[0]!.phrase, "crm, for solopreneurs");

// ─────────────────────────────────────────────────────────────
group("parseKeywordPlannerCsv — error on no header");

try {
  parseKeywordPlannerCsv("just,some,garbage\nwith,no,keyword\n");
  fail++;
  console.log("  FAIL  expected error on missing header, none thrown");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Keyword")) {
    pass++;
    console.log("  PASS  throws on missing 'Keyword' header");
  } else {
    fail++;
    console.log("  FAIL  wrong error: " + msg);
  }
}

// ─────────────────────────────────────────────────────────────
console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
