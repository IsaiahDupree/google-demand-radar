import Link from "next/link";
import { loadResults } from "./lib/results";
import { VERDICT_ORDER, VERDICT_STYLES } from "./lib/verdict";
import { loadAllSweeps } from "./lib/portfolio";
import { analyzeIdeaAction, triageAllProjectsAction } from "./actions";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const entries = loadResults();
  entries.sort((a, b) => {
    const va = VERDICT_ORDER[a.data.verdict];
    const vb = VERDICT_ORDER[b.data.verdict];
    if (va !== vb) return va - vb;
    return b.data.score.total - a.data.score.total;
  });

  const sweepBySlug = new Map<string, ReturnType<typeof loadAllSweeps>[number]>();
  for (const s of loadAllSweeps()) sweepBySlug.set(s.slug, s);

  const buildNowCount = entries.filter((e) => e.data.verdict === "Build Now").length;
  const championCount = [...sweepBySlug.values()].filter(
    (s) => (s.verticals[0]?.pmf_score ?? 0) >= 5
  ).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-12 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-100">
            Demand Radar
          </h1>
          <p className="mt-2 text-slate-400">
            Idea triage backed by real Google demand signals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/portfolio"
            className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500/50 hover:text-emerald-400"
          >
            Portfolio cartography →
          </Link>
          <Link
            href="/discover"
            className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500/50 hover:text-emerald-400"
          >
            Discovery →
          </Link>
          <form action={triageAllProjectsAction}>
            <button
              type="submit"
              className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500/50 hover:text-emerald-400"
            >
              Triage all GitHub + Vercel projects
            </button>
          </form>
        </div>
      </header>

      {entries.length > 0 && (
        <section className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="font-mono text-2xl font-bold text-slate-100">
              {entries.length}
            </p>
            <p className="text-xs text-slate-500">Ideas triaged</p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
            <p className="font-mono text-2xl font-bold text-slate-100">
              {sweepBySlug.size}
            </p>
            <p className="text-xs text-slate-500">Vertical sweeps</p>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="font-mono text-2xl font-bold text-emerald-400">
              {buildNowCount}
            </p>
            <p className="text-xs text-slate-500">Build Now verdicts</p>
          </div>
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="font-mono text-2xl font-bold text-emerald-400">
              {championCount}
            </p>
            <p className="text-xs text-slate-500">PMF ≥ 5.0 verticals</p>
          </div>
        </section>
      )}

      {entries.length === 0 ? (
        <p className="mb-16 text-slate-500">
          No ideas analyzed yet. Paste one below to begin.
        </p>
      ) : (
        <section className="mb-16">
          <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
            Portfolio · {entries.length} ideas
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entries.map((e) => {
              const v = VERDICT_STYLES[e.data.verdict];
              const fc = { tofu: 0, mofu: 0, bofu: 0 };
              for (const k of e.data.keyword_data) {
                const s = (k as { funnel_stage?: string }).funnel_stage;
                if (s === "tofu" || s === "mofu" || s === "bofu") fc[s]++;
              }
              const fTotal = fc.tofu + fc.mofu + fc.bofu;
              return (
                <Link
                  key={e.slug}
                  href={`/idea/${e.slug}`}
                  className={`block rounded-lg border ${v.border} ${v.bg} p-5 transition hover:scale-[1.015] hover:bg-opacity-30`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-100">
                      {e.data.concept.name}
                    </h3>
                    <span
                      className={`whitespace-nowrap rounded-full border ${v.border} px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${v.text}`}
                    >
                      {e.data.verdict}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span>{e.data.concept.domain}</span>
                    {e.data.meta?.source && (
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        {e.data.meta.source}
                      </span>
                    )}
                  </p>
                  {fTotal > 0 && (
                    <div
                      className="mt-2 flex h-1 overflow-hidden rounded-full bg-slate-800"
                      title={`BOFU ${fc.bofu} · MOFU ${fc.mofu} · TOFU ${fc.tofu}`}
                    >
                      <div
                        className="bg-emerald-500/80"
                        style={{ width: `${(fc.bofu / fTotal) * 100}%` }}
                      />
                      <div
                        className="bg-amber-500/70"
                        style={{ width: `${(fc.mofu / fTotal) * 100}%` }}
                      />
                      <div
                        className="bg-slate-500/60"
                        style={{ width: `${(fc.tofu / fTotal) * 100}%` }}
                      />
                    </div>
                  )}
                  <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-300">
                    {e.data.concept.one_liner}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono">
                      {e.data.score.total.toFixed(1)}/35
                    </span>
                    <span className="font-mono">{e.data.provider}</span>
                  </div>
                  {(() => {
                    const sweep = sweepBySlug.get(e.slug);
                    const top = sweep?.verticals[0];
                    if (!top) return null;
                    return (
                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800/70 pt-3 text-xs">
                        <span className="truncate text-slate-400">
                          ↳ {top.name}
                        </span>
                        <span
                          className={`font-mono font-bold ${top.pmf_score >= 5 ? "text-emerald-400" : top.pmf_score >= 3 ? "text-amber-400" : "text-slate-500"}`}
                        >
                          PMF {top.pmf_score.toFixed(1)}
                        </span>
                      </div>
                    );
                  })()}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="mb-4 text-xs uppercase tracking-widest text-slate-500">
          Analyze new idea
        </h2>
        <form action={analyzeIdeaAction} className="space-y-4">
          <textarea
            name="idea"
            required
            rows={6}
            placeholder="Paste an idea, a product brief, a brain-dump, anything in plain English…"
            className="block w-full resize-y rounded-md border border-slate-800 bg-slate-950 p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Runs the full pipeline. ~30-90 seconds.
            </p>
            <button
              type="submit"
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Analyze
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
