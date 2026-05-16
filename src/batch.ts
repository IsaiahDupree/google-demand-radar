import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { analyze, type PipelineResult } from "./pipeline.js";
import { loadCredentials } from "./config.js";
import type { Verdict } from "./scoring.js";

interface BatchEntry {
  file: string;
  slug: string;
  ok: boolean;
  result?: PipelineResult;
  error?: string;
}

const VERDICT_ORDER: Record<Verdict, number> = {
  "Build Now": 0,
  "Test First": 1,
  "Educate Later": 2,
  Pause: 3,
};

async function main(): Promise<void> {
  const ideasDir = process.argv[2] ?? "ideas";
  const files = readdirSync(ideasDir)
    .filter((f) => extname(f).toLowerCase() === ".txt")
    .sort();

  if (files.length === 0) {
    console.error(`No .txt files in ${ideasDir}/`);
    process.exit(2);
  }

  loadCredentials();

  const entries: BatchEntry[] = [];
  for (const file of files) {
    const slug = basename(file, extname(file));
    const path = join(ideasDir, file);
    const text = readFileSync(path, "utf8");
    process.stderr.write(`→ ${slug.padEnd(28)} `);
    try {
      const result = await analyze(text);
      entries.push({ file, slug, ok: true, result });
      writeFileSync(
        join("results", `${slug}.json`),
        JSON.stringify(result, null, 2)
      );
      process.stderr.write(
        `${result.verdict.padEnd(15)} ${result.score.total.toFixed(1).padStart(5)}/35\n`
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      entries.push({ file, slug, ok: false, error });
      process.stderr.write(`FAILED — ${error}\n`);
    }
  }

  const md = renderReport(entries);
  const reportPath = join("results", "_portfolio.md");
  writeFileSync(reportPath, md);
  const okCount = entries.filter((e) => e.ok).length;
  const failCount = entries.length - okCount;
  console.error(
    `\n${okCount} ok, ${failCount} failed. Report: ${reportPath}`
  );
}

function renderReport(entries: BatchEntry[]): string {
  const successful = entries.filter(
    (e): e is BatchEntry & { ok: true; result: PipelineResult } =>
      e.ok && !!e.result
  );
  successful.sort((a, b) => {
    const va = VERDICT_ORDER[a.result.verdict] ?? 99;
    const vb = VERDICT_ORDER[b.result.verdict] ?? 99;
    if (va !== vb) return va - vb;
    return b.result.score.total - a.result.score.total;
  });

  const out: string[] = [];
  out.push(`# Portfolio Demand Report`);
  out.push(``);
  out.push(`_Generated ${new Date().toISOString()}_`);
  if (successful.length > 0) {
    out.push(`_Provider: \`${successful[0]!.result.provider}\`_`);
  }
  out.push(``);

  out.push(`## Summary`);
  out.push(``);
  out.push(`| Idea | Verdict | Score |`);
  out.push(`|---|---|---|`);
  for (const e of successful) {
    out.push(
      `| ${e.result.concept.name} | **${e.result.verdict}** | ${e.result.score.total.toFixed(1)}/35 |`
    );
  }
  out.push(``);

  for (const e of successful) {
    const r = e.result;
    out.push(`---`);
    out.push(``);
    out.push(
      `## ${r.concept.name} — ${r.verdict} (${r.score.total.toFixed(1)}/35)`
    );
    out.push(``);
    out.push(`- **Domain:** ${r.concept.domain}`);
    out.push(`- **One-liner:** ${r.concept.one_liner}`);
    out.push(`- **Core promise:** ${r.concept.core_promise}`);
    out.push(``);

    out.push(`### Buyers`);
    for (const b of r.concept.buyers) {
      out.push(
        `- **${b.persona}** _(${b.awareness_level})_ — ${b.pain}`
      );
    }
    out.push(``);

    out.push(`### Score breakdown`);
    out.push(`| Dimension | Score |`);
    out.push(`|---|---|`);
    out.push(`| search demand | ${r.score.search_demand.toFixed(2)} |`);
    out.push(`| buyer urgency | ${r.score.buyer_urgency.toFixed(1)} |`);
    out.push(`| willingness to pay | ${r.score.willingness_to_pay.toFixed(2)} |`);
    out.push(`| mvp ease | ${r.score.mvp_ease.toFixed(1)} |`);
    out.push(`| distribution fit | ${r.score.distribution_fit.toFixed(1)} |`);
    out.push(`| advantage | ${r.score.advantage.toFixed(1)} |`);
    out.push(`| retention potential | ${r.score.retention_potential.toFixed(1)} |`);
    out.push(`| **total** | **${r.score.total.toFixed(1)}/35** |`);
    out.push(``);

    if (r.top_phrases.length > 0) {
      out.push(`### Top phrases (real demand signals)`);
      for (const p of r.top_phrases) {
        const cpc = p.cpc > 0 ? ` · CPC $${p.cpc.toFixed(2)}` : "";
        const comp = p.competition > 0 ? ` · comp ${p.competition.toFixed(2)}` : "";
        out.push(
          `- \`${p.phrase}\` — vol ${p.volume.toFixed(1)}${cpc}${comp} _(${p.buyer})_`
        );
      }
      out.push(``);
    }

    out.push(`### Reverse-engineered offers`);
    for (const o of r.offers_and_verdict.offers) {
      out.push(`**${o.buyer}** · anchor: \`${o.anchor_phrase}\``);
      out.push(``);
      out.push(`> ${o.landing_page_headline}`);
      out.push(``);
      out.push(o.offer_copy);
      out.push(``);
    }

    out.push(`### Next action this week`);
    out.push(`> ${r.offers_and_verdict.next_action}`);
    out.push(``);

    out.push(`### Reasoning`);
    out.push(r.offers_and_verdict.reasoning);
    out.push(``);
  }

  const failed = entries.filter((e) => !e.ok);
  if (failed.length > 0) {
    out.push(`---`);
    out.push(``);
    out.push(`## Failed`);
    for (const f of failed) {
      out.push(`- **${f.slug}** — ${f.error}`);
    }
    out.push(``);
  }

  return out.join("\n");
}

main().catch((err) => {
  console.error("Batch error:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
