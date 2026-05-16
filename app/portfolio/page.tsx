import Link from "next/link";
import { loadResults } from "../lib/results";
import {
  loadAllSweeps,
  aggregateVerticals,
  topPMFLeaders,
  portfolioFunnelMix,
} from "../lib/portfolio";

export const dynamic = "force-dynamic";

export default function PortfolioPage() {
  const results = loadResults().map((e) => e.data);
  const sweeps = loadAllSweeps();
  const funnel = portfolioFunnelMix(results);
  const verticals = aggregateVerticals(sweeps);
  const leaders = topPMFLeaders(sweeps, 20);
  const megaThemes = verticals.filter((v) => v.ideas.length >= 3);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-slate-500 transition hover:text-slate-300"
      >
        ← Portfolio
      </Link>

      <header className="mb-10 mt-6">
        <h1 className="text-4xl font-bold tracking-tight text-slate-100">
          Portfolio Cartography
        </h1>
        <p className="mt-2 text-slate-400">
          Aggregate demand patterns across {results.length} triaged ideas and{" "}
          {sweeps.length} vertical sweeps.
        </p>
      </header>

      {/* PORTFOLIO FUNNEL MIX */}
      {funnel.total > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Portfolio funnel mix · {funnel.total} phrases
          </h2>
          <div className="flex h-4 overflow-hidden rounded-full bg-slate-800">
            <div
              className="bg-emerald-500/80"
              style={{ width: `${(funnel.bofu / funnel.total) * 100}%` }}
            />
            <div
              className="bg-amber-500/70"
              style={{ width: `${(funnel.mofu / funnel.total) * 100}%` }}
            />
            <div
              className="bg-slate-500/60"
              style={{ width: `${(funnel.tofu / funnel.total) * 100}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="font-mono text-2xl font-bold text-emerald-400">
                {Math.round((funnel.bofu / funnel.total) * 100)}%
              </p>
              <p className="text-xs text-slate-500">
                BOFU · {funnel.bofu} purchase-intent phrases
              </p>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="font-mono text-2xl font-bold text-amber-400">
                {Math.round((funnel.mofu / funnel.total) * 100)}%
              </p>
              <p className="text-xs text-slate-500">
                MOFU · {funnel.mofu} comparison phrases
              </p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-800/30 p-3">
              <p className="font-mono text-2xl font-bold text-slate-300">
                {Math.round((funnel.tofu / funnel.total) * 100)}%
              </p>
              <p className="text-xs text-slate-500">
                TOFU · {funnel.tofu} informational phrases
              </p>
            </div>
          </div>
        </section>
      )}

      {sweeps.length === 0 && (
        <section className="mb-12 rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center">
          <p className="text-slate-300">No vertical sweeps yet.</p>
          <p className="mt-2 text-sm text-slate-500">
            Run{" "}
            <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              npm run sweep-all
            </code>{" "}
            to score verticals across every triaged idea. Or sweep individual
            ideas from their detail page.
          </p>
        </section>
      )}

      {/* TOP PMF LEADERBOARD */}
      {leaders.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Top PMF (idea × vertical) · attack list
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">PMF</th>
                  <th className="px-3 py-2 text-left">Idea</th>
                  <th className="px-3 py-2 text-left">Vertical</th>
                  <th className="px-3 py-2 text-left">BOFU %</th>
                  <th
                    className="px-3 py-2 text-left"
                    title="Avg competition_index across phrases with signal. Lower = easier to rank organically."
                  >
                    Comp
                  </th>
                  <th className="px-3 py-2 text-left">Top phrase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {leaders.map((l, i) => {
                  const comp = l.avg_competition;
                  const compCls =
                    comp == null
                      ? "text-slate-600"
                      : comp < 0.33
                        ? "text-emerald-400"
                        : comp < 0.66
                          ? "text-amber-400"
                          : "text-rose-400";
                  return (
                    <tr
                      key={`${l.slug}-${l.vertical}-${i}`}
                      className="bg-slate-900/30 hover:bg-slate-900/60"
                    >
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`font-mono font-bold ${l.pmf_score >= 5 ? "text-emerald-400" : l.pmf_score >= 3 ? "text-amber-400" : "text-slate-500"}`}
                        >
                          {l.pmf_score.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/idea/${l.slug}/sweep`}
                          className="text-slate-200 hover:text-emerald-400"
                        >
                          {l.idea_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-300">{l.vertical}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">
                        {Math.round(l.bofu_density * 100)}%
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs ${compCls}`}>
                        {comp == null ? "—" : comp.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {l.top_phrase || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* MEGA-THEMES */}
      {megaThemes.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Mega-themes · verticals showing up in 3+ ideas
          </h2>
          <p className="mb-4 text-sm text-slate-400">
            These verticals appear repeatedly across your portfolio — strong
            signal that a horizontal play (one product, many verticals) could
            work, or that you&apos;re already pattern-matching toward this
            customer.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {megaThemes.map((v) => (
              <div
                key={v.key}
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">
                      {v.display}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {v.ideas.length} ideas · best PMF{" "}
                      <span className="font-mono text-emerald-400">
                        {v.bestPMF.toFixed(1)}
                      </span>
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                  {v.ideas.slice(0, 5).map((i, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-2 text-xs">
                      <Link
                        href={`/idea/${i.slug}/sweep`}
                        className="truncate text-slate-300 hover:text-emerald-400"
                      >
                        {i.idea_name}
                      </Link>
                      <span className="font-mono text-slate-500">
                        {i.pmf_score.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* VERTICAL FREQUENCY */}
      {verticals.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            All verticals across portfolio · {verticals.length} unique
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Vertical</th>
                  <th className="px-3 py-2 text-left">Ideas</th>
                  <th className="px-3 py-2 text-left">Best PMF</th>
                  <th className="px-3 py-2 text-left">Top idea</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {verticals.slice(0, 30).map((v) => {
                  const top = v.ideas[0];
                  return (
                    <tr key={v.key} className="bg-slate-900/30">
                      <td className="px-3 py-2 text-slate-200">{v.display}</td>
                      <td className="px-3 py-2 font-mono text-slate-400">
                        {v.ideas.length}
                      </td>
                      <td className="px-3 py-2 font-mono text-emerald-400">
                        {v.bestPMF.toFixed(1)}
                      </td>
                      <td className="px-3 py-2">
                        {top ? (
                          <Link
                            href={`/idea/${top.slug}/sweep`}
                            className="text-xs text-slate-400 hover:text-emerald-400"
                          >
                            {top.idea_name}
                          </Link>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {verticals.length > 30 && (
            <p className="mt-2 text-xs text-slate-500">
              Showing 30 of {verticals.length} verticals.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
