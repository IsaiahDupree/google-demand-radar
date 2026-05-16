import Link from "next/link";
import { notFound } from "next/navigation";
import { loadResultBySlug } from "../../lib/results";
import { VERDICT_STYLES } from "../../lib/verdict";
import { loadSweep } from "../../../src/sweep.js";
import { runSweepAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function IdeaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = loadResultBySlug(slug);
  if (!entry) notFound();
  const { data } = entry;
  const v = VERDICT_STYLES[data.verdict];
  const sweep = loadSweep(slug);

  const dims: ReadonlyArray<readonly [string, number]> = [
    ["search demand", data.score.search_demand],
    ["buyer urgency", data.score.buyer_urgency],
    ["willingness to pay", data.score.willingness_to_pay],
    ["mvp ease", data.score.mvp_ease],
    ["distribution fit", data.score.distribution_fit],
    ["advantage", data.score.advantage],
    ["retention potential", data.score.retention_potential],
  ];

  // Funnel mix: count phrases per stage. Old results without funnel_stage on
  // keyword_data get counted as "untagged" and the section is hidden if all
  // phrases are untagged.
  const funnelCounts = { tofu: 0, mofu: 0, bofu: 0, untagged: 0 };
  for (const k of data.keyword_data) {
    const stage = (k as { funnel_stage?: string }).funnel_stage;
    if (stage === "tofu" || stage === "mofu" || stage === "bofu") {
      funnelCounts[stage]++;
    } else {
      funnelCounts.untagged++;
    }
  }
  const taggedTotal =
    funnelCounts.tofu + funnelCounts.mofu + funnelCounts.bofu;
  const funnelPct = {
    bofu: taggedTotal > 0 ? (funnelCounts.bofu / taggedTotal) * 100 : 0,
    mofu: taggedTotal > 0 ? (funnelCounts.mofu / taggedTotal) * 100 : 0,
    tofu: taggedTotal > 0 ? (funnelCounts.tofu / taggedTotal) * 100 : 0,
  };

  const stageBadge = (stage?: string): { text: string; cls: string } | null => {
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
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-slate-500 transition hover:text-slate-300"
      >
        ← Portfolio
      </Link>

      <header className="mb-10 mt-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-100">
              {data.concept.name}
            </h1>
            <p className="mt-2 text-slate-400">{data.concept.one_liner}</p>
          </div>
          <span
            className={`whitespace-nowrap rounded-full border ${v.border} px-3 py-1 text-xs font-medium uppercase tracking-wider ${v.text}`}
          >
            {data.verdict}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
          <span>
            Score:{" "}
            <span className="font-mono text-slate-200">
              {data.score.total.toFixed(1)}/35
            </span>
          </span>
          <span>
            Domain:{" "}
            <span className="text-slate-300">{data.concept.domain}</span>
          </span>
          <span>
            Provider:{" "}
            <span className="font-mono text-slate-300">{data.provider}</span>
          </span>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Core promise
        </h2>
        <p className="text-slate-200">{data.concept.core_promise}</p>
      </section>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs uppercase tracking-widest text-slate-500">
              Vertical × ICP sweep
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {sweep && sweep.verticals[0]
                ? `${sweep.verticals.length} verticals scored · top: ${sweep.verticals[0].name} · PMF ${sweep.verticals[0].pmf_score.toFixed(1)}/10 · demand ${sweep.verticals[0].demand_score.toFixed(2)}/5`
                : "Discover which 5-10 verticals have the strongest demand for this idea."}
            </p>
          </div>
          {sweep ? (
            <Link
              href={`/idea/${slug}/sweep`}
              className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
            >
              View vertical sweep →
            </Link>
          ) : (
            <form action={runSweepAction}>
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
              >
                Run vertical sweep
              </button>
            </form>
          )}
        </div>
      </section>

      {taggedTotal > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Funnel mix
          </h2>
          <div className="flex h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className="bg-emerald-500/80"
              style={{ width: `${funnelPct.bofu}%` }}
              title={`BOFU ${funnelCounts.bofu}`}
            />
            <div
              className="bg-amber-500/70"
              style={{ width: `${funnelPct.mofu}%` }}
              title={`MOFU ${funnelCounts.mofu}`}
            />
            <div
              className="bg-slate-500/60"
              style={{ width: `${funnelPct.tofu}%` }}
              title={`TOFU ${funnelCounts.tofu}`}
            />
          </div>
          <div className="mt-2 flex gap-5 text-xs font-mono">
            <span className="text-emerald-400">
              BOFU {funnelPct.bofu.toFixed(0)}%
            </span>
            <span className="text-amber-400">
              MOFU {funnelPct.mofu.toFixed(0)}%
            </span>
            <span className="text-slate-500">
              TOFU {funnelPct.tofu.toFixed(0)}%
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            BOFU phrases (purchase intent) weight 2× in the demand score;
            TOFU (informational) weights 0.5×.
          </p>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Buyers
        </h2>
        <ul className="space-y-2">
          {data.concept.buyers.map((b, i) => (
            <li
              key={i}
              className="rounded-md border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <strong className="text-slate-100">{b.persona}</strong>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {b.awareness_level.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{b.pain}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10 grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Score breakdown
          </h2>
          <div className="space-y-2">
            {dims.map(([label, val]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-40 text-sm text-slate-400">{label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full bg-emerald-500/70"
                    style={{ width: `${(val / 5) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono text-sm text-slate-300">
                  {val.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
            Top phrases
          </h2>
          {data.top_phrases.length === 0 ? (
            <p className="text-sm text-slate-500">No phrase data available.</p>
          ) : (
            <ul className="space-y-2">
              {data.top_phrases.map((p, i) => {
                const badge = stageBadge(
                  (p as { funnel_stage?: string }).funnel_stage
                );
                return (
                  <li
                    key={i}
                    className="rounded-md border border-slate-800 bg-slate-900/40 p-2"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-xs">
                      <span className="text-slate-200">{p.phrase}</span>
                      <span className="whitespace-nowrap text-slate-500">
                        vol {p.volume.toFixed(1)}
                        {p.cpc > 0 ? ` · $${p.cpc.toFixed(2)}` : ""}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        {p.buyer}
                      </span>
                      {badge && (
                        <span
                          className={`rounded border px-1 py-0.5 font-mono text-[9px] ${badge.cls}`}
                        >
                          {badge.text}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Reverse-engineered offers
        </h2>
        <div className="space-y-4">
          {data.offers_and_verdict.offers.map((o, i) => (
            <div
              key={i}
              className="rounded-md border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-300">{o.buyer}</span>
                <span className="font-mono text-slate-500">
                  anchor: {o.anchor_phrase}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-emerald-400">
                {o.landing_page_headline}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {o.offer_copy}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-emerald-400">
          Next action this week
        </h2>
        <p className="text-slate-200">{data.offers_and_verdict.next_action}</p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-slate-500">
          Reasoning
        </h2>
        <p className="leading-relaxed text-slate-300">
          {data.offers_and_verdict.reasoning}
        </p>
      </section>
    </main>
  );
}
