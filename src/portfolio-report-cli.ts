import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageBreak,
} from "docx";
import type { AugmentedResult } from "./ingest.js";
import type { SweepResult } from "./sweep.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const SWEEPS_DIR = path.join(RESULTS_DIR, "sweeps");
const DEFAULT_OUTPUT_FILE = path.join(RESULTS_DIR, "portfolio-report.docx");
const GITHUB_VERCEL_OUTPUT_FILE = path.join(
  RESULTS_DIR,
  "portfolio-report-github-vercel.docx"
);

// ---------------------------------------------------------------------------
// Style helpers — small wrappers so per-section code reads cleanly
// ---------------------------------------------------------------------------

const VERDICT_COLORS: Record<string, string> = {
  "Build Now": "059669",
  "Test First": "D97706",
  "Educate Later": "64748B",
  Pause: "9F1239",
};

function p(text: string, opts?: { bold?: boolean; size?: number; color?: string }): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        size: opts?.size,
        color: opts?.color,
      }),
    ],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    text,
    bullet: { level: 0 },
  });
}

// Helper to build a row of [key, value] paragraphs — used in score breakdown
// and offer tables. Borders are subtle so the doc reads as text + tables, not
// a spreadsheet.
function makeTable(rows: Array<{ cells: string[]; bold?: boolean }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r) =>
        new TableRow({
          children: r.cells.map(
            (c) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: c, bold: r.bold })],
                  }),
                ],
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                  left: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                  right: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
                },
              })
          ),
        })
    ),
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadResults(): Array<{ slug: string; data: AugmentedResult }> {
  const files = readdirSync(RESULTS_DIR).filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  );
  const out: Array<{ slug: string; data: AugmentedResult }> = [];
  for (const f of files) {
    try {
      const data = JSON.parse(
        readFileSync(path.join(RESULTS_DIR, f), "utf8")
      ) as AugmentedResult;
      out.push({ slug: f.replace(/\.json$/, ""), data });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function loadSweep(slug: string): SweepResult | null {
  const f = path.join(SWEEPS_DIR, `${slug}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as SweepResult;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function summarySection(
  entries: Array<{ slug: string; data: AugmentedResult }>
): Paragraph[] {
  const verdictCounts: Record<string, number> = {
    "Build Now": 0,
    "Test First": 0,
    "Educate Later": 0,
    Pause: 0,
  };
  const sourceCounts: Record<string, number> = {};
  for (const e of entries) {
    verdictCounts[e.data.verdict] = (verdictCounts[e.data.verdict] ?? 0) + 1;
    const src = e.data.meta?.source ?? "manual";
    sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
  }

  const buildNow = entries
    .filter((e) => e.data.verdict === "Build Now")
    .sort((a, b) => b.data.score.total - a.data.score.total);
  const testFirst = entries
    .filter((e) => e.data.verdict === "Test First")
    .sort((a, b) => b.data.score.total - a.data.score.total)
    .slice(0, 10);

  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: "Google Demand Radar", bold: true }),
        new TextRun({ text: " — Portfolio Demand Report", bold: false }),
      ],
    })
  );
  out.push(
    p(
      `Generated ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} · ${entries.length} apps · DataForSEO-backed signals.`,
      { size: 20, color: "475569" }
    )
  );

  out.push(heading("Portfolio at a glance", HeadingLevel.HEADING_1));

  out.push(p("Sources tracked:", { bold: true }));
  for (const [src, n] of Object.entries(sourceCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    out.push(bullet(`${src}: ${n} apps`));
  }

  out.push(p(""));
  out.push(p("Verdict distribution:", { bold: true }));
  for (const v of ["Build Now", "Test First", "Educate Later", "Pause"]) {
    out.push(bullet(`${v}: ${verdictCounts[v]} apps`));
  }

  if (buildNow.length > 0) {
    out.push(p(""));
    out.push(p("Build Now apps (ranked by score):", { bold: true }));
    for (const e of buildNow) {
      out.push(
        bullet(
          `${e.data.concept.name} — ${e.data.score.total.toFixed(1)}/35 (${e.slug})`
        )
      );
    }
  }
  if (testFirst.length > 0) {
    out.push(p(""));
    out.push(p("Top 10 Test First apps:", { bold: true }));
    for (const e of testFirst) {
      out.push(
        bullet(
          `${e.data.concept.name} — ${e.data.score.total.toFixed(1)}/35 (${e.slug})`
        )
      );
    }
  }

  return out;
}

function appSection(
  entry: { slug: string; data: AugmentedResult },
  sweep: SweepResult | null
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const { data, slug } = entry;
  const c = data.concept;
  const verdictColor = VERDICT_COLORS[data.verdict] ?? "475569";

  out.push(heading(c.name, HeadingLevel.HEADING_1));

  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: data.verdict, bold: true, color: verdictColor }),
        new TextRun({
          text: ` · ${data.score.total.toFixed(1)}/35 · ${c.domain}`,
          color: "475569",
        }),
      ],
    })
  );

  // Source + URL line
  const meta = data.meta;
  const sourceLine = meta
    ? `${meta.source.toUpperCase()} · ${meta.sourceUrl}`
    : "Manual (no source URL)";
  out.push(p(sourceLine, { size: 18, color: "64748B" }));
  out.push(p(""));

  // One-liner + core promise
  out.push(p(c.one_liner));
  out.push(p(`Core promise: ${c.core_promise}`, { size: 20, color: "475569" }));
  out.push(p(""));

  // Score breakdown table
  out.push(p("Score breakdown", { bold: true }));
  out.push(
    makeTable([
      { cells: ["Dimension", "Score (0-5)"], bold: true },
      {
        cells: [
          "Search demand",
          data.score.search_demand.toFixed(2),
        ],
      },
      {
        cells: [
          "Willingness to pay (CPC)",
          data.score.willingness_to_pay.toFixed(2),
        ],
      },
      {
        cells: ["Buyer urgency", data.score.buyer_urgency.toFixed(1)],
      },
      { cells: ["MVP ease", data.score.mvp_ease.toFixed(1)] },
      {
        cells: ["Distribution fit", data.score.distribution_fit.toFixed(1)],
      },
      { cells: ["Advantage", data.score.advantage.toFixed(1)] },
      {
        cells: [
          "Retention potential",
          data.score.retention_potential.toFixed(1),
        ],
      },
      { cells: ["TOTAL", `${data.score.total.toFixed(1)} / 35`], bold: true },
    ])
  );
  out.push(p(""));

  // Top phrases (top 5 by volume)
  const sortedPhrases = [...data.keyword_data]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 5);
  if (sortedPhrases.length > 0) {
    out.push(p("Top buyer phrases (by search volume)", { bold: true }));
    out.push(
      makeTable([
        { cells: ["Phrase", "Volume", "CPC", "Competition", "Stage"], bold: true },
        ...sortedPhrases.map((kp) => ({
          cells: [
            kp.phrase,
            kp.volume.toLocaleString(),
            kp.cpc > 0 ? `$${kp.cpc.toFixed(2)}` : "—",
            kp.competition > 0 ? kp.competition.toFixed(2) : "—",
            (kp.funnel_stage ?? "—").toString().toUpperCase(),
          ],
        })),
      ])
    );
    out.push(p(""));
  }

  // Buyer personas
  out.push(p("Buyer personas", { bold: true }));
  for (const b of c.buyers) {
    out.push(
      bullet(
        `${b.persona} (${b.awareness_level}) — ${b.pain}`
      )
    );
  }
  out.push(p(""));

  // Sweep section (if a vertical sweep exists)
  if (sweep && sweep.verticals.length > 0) {
    out.push(p("Vertical sweep — PMF per ICP", { bold: true }));
    out.push(
      p(`Cross-vertical insight: ${sweep.cross_vertical_insight}`, {
        size: 20,
        color: "475569",
      })
    );
    const top3 = sweep.verticals.slice(0, 3);
    out.push(
      makeTable([
        {
          cells: ["Rank", "Vertical", "PMF", "Top phrase", "Vol", "CPC"],
          bold: true,
        },
        ...top3.map((v, i) => ({
          cells: [
            `${i + 1}`,
            v.name,
            v.pmf_score.toFixed(1),
            v.top_phrase || "—",
            v.top_volume.toLocaleString(),
            v.max_cpc > 0 ? `$${v.max_cpc.toFixed(2)}` : "—",
          ],
        })),
      ])
    );
    out.push(p(""));
  }

  // Offers + next action
  const ov = data.offers_and_verdict;
  if (ov) {
    out.push(p("Reverse-engineered offers", { bold: true }));
    for (const o of ov.offers) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: `→ ${o.buyer}: `, bold: true }),
            new TextRun({ text: o.offer_copy }),
          ],
        })
      );
      out.push(
        p(`   Anchor phrase: "${o.anchor_phrase}"`, {
          size: 18,
          color: "475569",
        })
      );
      out.push(
        p(`   Landing headline: ${o.landing_page_headline}`, {
          size: 18,
          color: "475569",
        })
      );
    }
    out.push(p(""));
    out.push(p("Recommended next action", { bold: true }));
    out.push(p(ov.next_action));
    out.push(p(""));
    out.push(p("Verdict reasoning", { bold: true }));
    out.push(p(ov.reasoning, { size: 20, color: "475569" }));
  }

  // Slug footer
  out.push(p(""));
  out.push(p(`Internal slug: ${slug}`, { size: 16, color: "94A3B8" }));

  // Page break between apps
  out.push(new Paragraph({ children: [new PageBreak()] }));

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const onlyGithubVercel = process.env.PORTFOLIO_REPORT_FILTER === "github-vercel";

  const allEntries = loadResults();
  let entries = allEntries;
  if (onlyGithubVercel) {
    entries = entries.filter((e) => {
      const src = e.data.meta?.source;
      return src === "github" || src === "vercel";
    });
  }

  // Verdict-then-score ranking so the doc reads top-down high-priority first.
  const verdictOrder: Record<string, number> = {
    "Build Now": 0,
    "Test First": 1,
    "Educate Later": 2,
    Pause: 3,
  };
  entries.sort((a, b) => {
    const va = verdictOrder[a.data.verdict] ?? 4;
    const vb = verdictOrder[b.data.verdict] ?? 4;
    if (va !== vb) return va - vb;
    return b.data.score.total - a.data.score.total;
  });

  console.error(
    `Generating Word report for ${entries.length} apps (filter: ${onlyGithubVercel ? "github+vercel only" : "all"}).\n`
  );

  const sections: Array<Paragraph | Table> = [];
  sections.push(...summarySection(entries));
  sections.push(new Paragraph({ children: [new PageBreak()] }));

  for (const e of entries) {
    const sweep = loadSweep(e.slug);
    sections.push(...appSection(e, sweep));
  }

  const doc = new Document({
    creator: "Google Demand Radar",
    title: "Portfolio Demand Report",
    description: `DataForSEO-backed demand triage for ${entries.length} apps`,
    sections: [
      {
        children: sections,
      },
    ],
  });

  const outFile = onlyGithubVercel ? GITHUB_VERCEL_OUTPUT_FILE : DEFAULT_OUTPUT_FILE;
  const buf = await Packer.toBuffer(doc);
  writeFileSync(outFile, buf);
  console.error(
    `Wrote ${path.relative(process.cwd(), outFile)} (${(buf.length / 1024).toFixed(0)} KB)\n` +
      `${entries.length} apps in the report.`
  );
}

main().catch((err) => {
  console.error(
    "portfolio-report failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
