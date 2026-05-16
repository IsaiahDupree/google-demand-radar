import { readFileSync, writeFileSync } from "node:fs";
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

const RESULTS_DIR = path.resolve(process.cwd(), "results");
const INPUT_FILE = path.join(RESULTS_DIR, "_mobile-discoveries.json");
const OUTPUT_FILE = path.join(RESULTS_DIR, "mobile-pmf-report.docx");

interface MobileBrief {
  product_in_plain_language: string;
  mvp_in_2_weeks: string;
  distribution: string;
  pricing_anchor: string;
  biggest_risk: string;
}

interface MobileRow {
  phrase: string;
  volume: number;
  cpc: number;
  competition: number;
  score: number;
  brief?: MobileBrief;
}

interface MobileFile {
  generated_at: string;
  phrases_total: number;
  phrases_with_signal: number;
  rows: MobileRow[];
}

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

function bullet(text: string): Paragraph {
  return new Paragraph({ text, bullet: { level: 0 } });
}

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

async function main(): Promise<void> {
  const data = JSON.parse(readFileSync(INPUT_FILE, "utf8")) as MobileFile;
  const ranked = data.rows
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const sections: Array<Paragraph | Table> = [];

  // Title
  sections.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({ text: "Mobile App PMF Report", bold: true }),
      ],
    })
  );
  sections.push(
    p(
      `Generated ${new Date(data.generated_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} · DataForSEO-backed signals.`,
      { size: 20, color: "475569" }
    )
  );
  sections.push(
    p(
      `${data.phrases_total} consumer-mobile phrases scanned · ${data.phrases_with_signal} with non-zero signal (${Math.round((data.phrases_with_signal / data.phrases_total) * 100)}%) · ${ranked.length} ranked niches below.`,
      { size: 20, color: "475569" }
    )
  );
  sections.push(p(""));

  // Methodology note
  sections.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      text: "How to read this report",
    })
  );
  sections.push(
    p(
      "Each row is a Google search phrase consumers type when looking for a mobile app. Three numbers ground the demand:",
      { size: 22 }
    )
  );
  sections.push(
    bullet(
      "Volume = average monthly Google searches. Higher = bigger market."
    )
  );
  sections.push(
    bullet(
      "CPC = what advertisers pay per click in Google Ads. Higher = buyers are spending real money on this problem."
    )
  );
  sections.push(
    bullet(
      "Competition = 0-1, the Google Ads competition_index. Lower = wider open commercially."
    )
  );
  sections.push(
    bullet(
      "Score = log10(volume+1) × min(CPC,100) × max(0.1, 1-competition). Captures all three in one number."
    )
  );
  sections.push(p(""));

  // Top 25 summary table
  sections.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      text: "Top 25 mobile-app niches (ranked)",
    })
  );
  sections.push(
    makeTable([
      {
        cells: ["#", "Phrase", "Vol/mo", "CPC", "Comp", "Score"],
        bold: true,
      },
      ...ranked.slice(0, 25).map((r, i) => ({
        cells: [
          `${i + 1}`,
          r.phrase,
          r.volume.toLocaleString(),
          `$${r.cpc.toFixed(2)}`,
          r.competition.toFixed(2),
          r.score.toFixed(1),
        ],
      })),
    ])
  );
  sections.push(p(""));

  // Page break before deep-dive briefs
  sections.push(new Paragraph({ children: [new PageBreak()] }));

  // Per-niche detail
  sections.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      text: "Per-niche briefs",
    })
  );
  sections.push(
    p(
      "For each top niche we asked GPT-4o-mini: what is the buyer actually trying to buy, what would a solo founder ship in 2 weeks, how to reach them, what to charge, and what kills the idea.",
      { size: 22, color: "475569" }
    )
  );

  const detailed = ranked.filter((r) => r.brief);
  for (let i = 0; i < detailed.length; i++) {
    const r = detailed[i]!;
    sections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: `${i + 1}. ${r.phrase}` }),
        ],
      })
    );
    sections.push(
      p(
        `Volume ${r.volume.toLocaleString()}/mo · CPC $${r.cpc.toFixed(2)} · Competition ${r.competition.toFixed(2)} · Score ${r.score.toFixed(1)}`,
        { size: 20, color: "475569" }
      )
    );
    sections.push(p(""));
    sections.push(p("What the buyer wants", { bold: true }));
    sections.push(p(r.brief!.product_in_plain_language));
    sections.push(p(""));
    sections.push(p("2-week MVP", { bold: true }));
    sections.push(p(r.brief!.mvp_in_2_weeks));
    sections.push(p(""));
    sections.push(p("How to reach them", { bold: true }));
    sections.push(p(r.brief!.distribution));
    sections.push(p(""));
    sections.push(p("Pricing anchor", { bold: true }));
    sections.push(p(r.brief!.pricing_anchor));
    sections.push(p(""));
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Biggest risk", bold: true, color: "9F1239" }),
        ],
      })
    );
    sections.push(p(r.brief!.biggest_risk));
    sections.push(p(""));
  }

  const doc = new Document({
    creator: "Google Demand Radar",
    title: "Mobile App PMF Report",
    description: "DataForSEO-backed mobile-app niche analysis",
    sections: [{ children: sections }],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(OUTPUT_FILE, buf);
  console.error(
    `Wrote ${path.relative(process.cwd(), OUTPUT_FILE)} (${(buf.length / 1024).toFixed(0)} KB)\n` +
      `${ranked.length} ranked niches · ${detailed.length} with full briefs.`
  );
}

main().catch((err) => {
  console.error(
    "mobile-report failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
