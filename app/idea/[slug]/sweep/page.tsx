import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSweep } from "../../../../src/sweep.js";
import { loadResultBySlug } from "../../../lib/results";
import { avgCompetition } from "../../../lib/portfolio";

function compColor(c: number): string {
  if (c < 0.33) return "text-emerald-400";
  if (c < 0.66) return "text-amber-400";
  return "text-rose-400";
}

export const dynamic = "force-dynamic";

function stageBadge(stage?: string): { text: string; cls: string } | null {
  if (stage === "bofu")
    return {
      text: "BOFU",
      cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
    };
  if (stage === "mofu")
    return {
      text: "MOFU",
      cls: "border-amber-500/40 text-amber-400 bg-amber-500/10",
    };
  if (stage === "tofu")
    return {
      text: "TOFU",
      cls: "border-slate-700 text-slate-500 bg-slate-800/40",
    };
  return null;
}

export default async function SweepPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sweep = loadSweep(slug);
  if (!sweep) notFound();
  const entry = loadResultBySlug(slug);

  const [hero, ...rest] = sweep.verticals;
  // Detect dry-run sweeps (no keyword data fetched yet): every vertical has
  // demand_score 0 AND no positive volume on any phrase.
  const isDryRun =
    sweep.verticals.every((v) => v.demand_score === 0) &&
    sweep.verticals.every((v) => v.phrases.every((p) => p.volume === 0));

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link
        href={`/idea/${slug}`}
        className="text-sm text-slate-500 transition hover:text-slate-300"
      >
        ← {entry?.data.concept.name ?? slug}
      </Link>

      <header className="mt-6 mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-100">
          Vertical × ICP Sweep
        </h1>
        <p className="mt-2 text-slate-400">
          {sweep.verticals.length} verticals scored for{" "}
          <span className="text-slate-200">{sweep.source_concept}</span>. Ranked
          by <span className="text-emerald-400">PMF readiness</span> — composite
          of weighted demand (30%), BOFU density (25%), buyer urgency (20%),
          CPC (15%), retention (10%).
        </p>
        <p className="mt-4 rounded-md border border-slate-800 bg-slate-900/40 p-3 text-sm leading-relaxed text-slate-300">
          <span className="mr-2 font-mono text-xs uppercase text-slate-500">
            Cross-vertical insight:
          </span>
          {sweep.cross_vertical_insight}
        </p>
        {isDryRun && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
            <span className="mr-2 font-mono text-xs uppercase">
              Dry-run sweep:
            </span>
            Verticals + ICPs + funnel-tagged phrases generated, but keyword
            demand wasn&apos;t fetched (likely throttled). Re-run{" "}
            <code className="font-mono text-xs">npm run sweep -- {slug}</code>{" "}
            (no <code className="font-mono text-xs">SWEEP_DRY_RUN</code>) to
            fill in real demand metrics.
          </div>
        )}
      </header>

      {hero && (
        <section className="mb-8 rounded-lg border-2 border-emerald-500/40 bg-emerald-500/5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                PMF Champion · Rank 1
              </p>
              <h2 className="mt-1 text-2xl font-bold text-slate-100">
                {hero.name}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
                PMF readiness
              </p>
              <p className="font-mono text-4xl font-bold text-emerald-400">
                {hero.pmf_score.toFixed(1)}
                <span className="text-base font-normal text-slate-500">
                  /10
                </span>
              </p>
              <div className="mt-1 flex justify-end gap-3 text-[10px] font-mono text-slate-500">
                <span>demand {hero.demand_score.toFixed(1)}/5</span>
                <span>bofu {Math.round(hero.bofu_density * 100)}%</span>
                {hero.max_cpc > 0 && (
                  <span>cpc ${hero.max_cpc.toFixed(2)}</span>
                )}
                {(() => {
                  const c = avgCompetition(hero.phrases);
                  if (c == null) return null;
                  return (
                    <span
                      className={compColor(c)}
                      title="Avg competition_index of phrases with signal — lower is easier to rank"
                    >
                      comp {c.toFixed(2)}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            <span className="font-semibold text-slate-400">ICP:</span>{" "}
            {hero.icp}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            <span className="font-semibold text-slate-500">Rationale:</span>{" "}
            {hero.rationale}
          </p>
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
              Top phrases
            </p>
            <ul className="space-y-1.5">
              {hero.phrases.slice(0, 5).map((p, i) => {
                const badge = stageBadge(p.funnel_stage);
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/40 p-2 font-mono text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-200">{p.phrase}</span>
                      {badge && (
                        <span
                          className={`rounded border px-1 py-0.5 font-mono text-[9px] ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                      )}
                    </div>
                    <span className="text-slate-500">
                      vol {p.volume.toFixed(1)}
                      {p.cpc > 0 ? ` · $${p.cpc.toFixed(2)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Other verticals ({rest.length})
        </h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rest.map((v, idx) => {
            const rank = idx + 2;
            const greyed = v.pmf_score < 3;
            return (
              <div
                key={idx}
                className={`rounded-lg border p-4 ${
                  greyed
                    ? "border-slate-800/60 bg-slate-900/20 opacity-60"
                    : "border-slate-800 bg-slate-900/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                      Rank {rank}
                    </p>
                    <h3 className="mt-0.5 text-base font-semibold text-slate-100">
                      {v.name}
                    </h3>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xl font-bold text-slate-200">
                      {v.pmf_score.toFixed(1)}
                      <span className="text-[10px] font-normal text-slate-500">
                        /10
                      </span>
                    </p>
                    <p className="text-[10px] font-mono uppercase text-slate-500">
                      demand {v.demand_score.toFixed(1)} · bofu{" "}
                      {Math.round(v.bofu_density * 100)}%
                      {(() => {
                        const c = avgCompetition(v.phrases);
                        if (c == null) return null;
                        return (
                          <>
                            {" · "}
                            <span className={compColor(c)}>
                              comp {c.toFixed(2)}
                            </span>
                          </>
                        );
                      })()}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {v.icp}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  {v.rationale}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {v.phrases.slice(0, 3).map((p, i) => {
                    const badge = stageBadge(p.funnel_stage);
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-950/40 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {p.phrase}
                        {badge && (
                          <span
                            className={`rounded border px-1 font-mono text-[8px] ${badge.cls}`}
                          >
                            {badge.text}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-10 text-center text-xs text-slate-600">
        Generated{" "}
        {new Date(sweep.generated_at).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </main>
  );
}
