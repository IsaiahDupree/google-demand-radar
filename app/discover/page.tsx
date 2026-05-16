import { Fragment } from "react";
import Link from "next/link";
import {
  loadDiscoverData,
  type Niche,
  type NicheKind,
} from "../lib/discoveries";

export const dynamic = "force-dynamic";

type SortKey = "score" | "volume" | "cpc" | "competition";
type SortDir = "asc" | "desc";

interface SearchParams {
  source?: string; // "pattern" | "adjacency" | "gap" | "pattern,adjacency" etc
  product?: string;
  vertical?: string;
  cluster?: string;
  minCpc?: string;
  minVol?: string;
  maxComp?: string;
  limit?: string;
  q?: string; // free-text search across phrase
  sort?: SortKey;
  dir?: SortDir;
}

function compColor(c: number): string {
  if (c < 0.33) return "text-emerald-400";
  if (c < 0.66) return "text-amber-400";
  return "text-rose-400";
}

function cpcColor(c: number): string {
  if (c >= 100) return "text-emerald-400";
  if (c >= 30) return "text-amber-400";
  return "text-slate-400";
}

const SOURCE_LABELS: Record<NicheKind, string> = {
  pattern: "Pattern",
  adjacency: "Adjacency",
  gap: "Comp gap",
};

const SOURCE_BADGE: Record<NicheKind, string> = {
  pattern: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  adjacency: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  gap: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};

function sourceDetail(n: Niche): string {
  if (n.kind === "pattern") return `${n.product} × ${n.vertical}`;
  if (n.kind === "adjacency") return `from "${n.seed}"`;
  return `${n.cluster} · ${n.competitor}`;
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const data = loadDiscoverData();

  if (data.niches.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Link
          href="/"
          className="text-sm text-slate-500 transition hover:text-slate-300"
        >
          ← Home
        </Link>
        <header className="mt-6 mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-slate-100">
            Discovery
          </h1>
          <p className="mt-2 text-slate-400">No discovery output on disk.</p>
          <p className="mt-4 text-sm text-slate-500">
            Run any of:{" "}
            <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              npm run discover
            </code>{" "}
            ·{" "}
            <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              npm run adjacency
            </code>{" "}
            ·{" "}
            <code className="rounded bg-slate-950 px-1.5 py-0.5 font-mono text-xs text-emerald-400">
              npm run competitor-gap
            </code>
          </p>
        </header>
      </main>
    );
  }

  const minCpc = params.minCpc ? Number(params.minCpc) : 0;
  const minVol = params.minVol ? Number(params.minVol) : 0;
  const maxComp = params.maxComp ? Number(params.maxComp) : 1;
  const limit = params.limit ? Number(params.limit) : 100;
  const productFilter = params.product?.toLowerCase().trim() || "";
  const verticalFilter = params.vertical?.toLowerCase().trim() || "";
  const clusterFilter = params.cluster?.toLowerCase().trim() || "";
  const q = params.q?.toLowerCase().trim() || "";
  const sourceFilter = new Set(
    (params.source || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as NicheKind[]
  );

  const sortKey: SortKey = (
    ["score", "volume", "cpc", "competition"] as SortKey[]
  ).includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : "score";
  const sortDir: SortDir = params.dir === "asc" ? "asc" : "desc";

  const filtered = data.niches.filter((n) => {
    if (sourceFilter.size > 0 && !sourceFilter.has(n.kind)) return false;
    if (n.cpc < minCpc) return false;
    if (n.volume < minVol) return false;
    if (n.competition > maxComp) return false;
    if (productFilter && n.product?.toLowerCase() !== productFilter) return false;
    if (verticalFilter && n.vertical?.toLowerCase() !== verticalFilter)
      return false;
    if (clusterFilter && n.cluster?.toLowerCase() !== clusterFilter)
      return false;
    if (q && !n.phrase.includes(q)) return false;
    return true;
  });

  // Sort the already-filtered set. Data is pre-sorted by score desc in the
  // loader; re-sort only when the user asked for something else, or for an
  // explicit asc.
  if (sortKey !== "score" || sortDir !== "desc") {
    filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }
  const rows = filtered.slice(0, limit);

  // Counts per source over filtered set (excluding the source-filter itself,
  // so chips show "what would happen if you picked just this source").
  const countByKind: Record<NicheKind, number> = {
    pattern: 0,
    adjacency: 0,
    gap: 0,
  };
  for (const n of data.niches) {
    if (n.cpc < minCpc) continue;
    if (n.volume < minVol) continue;
    if (n.competition > maxComp) continue;
    if (q && !n.phrase.includes(q)) continue;
    countByKind[n.kind]++;
  }

  // Top clusters across the filtered competitor gaps + verticals across
  // filtered patterns. Useful chips when those sources are in scope.
  const clusterCounts = new Map<string, number>();
  const verticalCounts = new Map<string, number>();
  for (const n of filtered) {
    if (n.cluster)
      clusterCounts.set(n.cluster, (clusterCounts.get(n.cluster) ?? 0) + 1);
    if (n.vertical)
      verticalCounts.set(n.vertical, (verticalCounts.get(n.vertical) ?? 0) + 1);
  }
  const topClusters = [...clusterCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topVerticals = [...verticalCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  function chipHref(key: keyof SearchParams, value: string): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    if (next.get(key) === value) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    return qs ? `/discover?${qs}` : "/discover";
  }

  function sortHref(key: SortKey): string {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    // Clicking the current sort column flips direction; clicking a new one
    // jumps to desc (the more useful default for "rank by this column").
    if (sortKey === key) {
      next.set("sort", key);
      next.set("dir", sortDir === "desc" ? "asc" : "desc");
    } else {
      next.set("sort", key);
      next.set("dir", "desc");
    }
    return `/discover?${next.toString()}`;
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " ↓" : " ↑";
  }

  function toggleSource(kind: NicheKind): string {
    const active = sourceFilter.has(kind);
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    const cur = new Set(sourceFilter);
    if (active) cur.delete(kind);
    else cur.add(kind);
    if (cur.size === 0) next.delete("source");
    else next.set("source", Array.from(cur).join(","));
    const qs = next.toString();
    return qs ? `/discover?${qs}` : "/discover";
  }

  // For UI badges
  const totalSurvivingByKind: Record<NicheKind, number> = {
    pattern: data.niches.filter((n) => n.kind === "pattern").length,
    adjacency: data.niches.filter((n) => n.kind === "adjacency").length,
    gap: data.niches.filter((n) => n.kind === "gap").length,
  };
  const lastGeneratedAt =
    data.competitorGaps?.generated_at ??
    data.adjacencies?.generated_at ??
    data.patterns?.generated_at ??
    null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link
        href="/"
        className="text-sm text-slate-500 transition hover:text-slate-300"
      >
        ← Home
      </Link>

      <header className="mt-6 mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-slate-100">
          Discovery
        </h1>
        <p className="mt-2 text-slate-400">
          {data.niches.length.toLocaleString()} ranked niches across three
          discovery vectors — surfacing the markets your portfolio doesn&apos;t
          touch yet.
        </p>
        {lastGeneratedAt && (
          <p className="mt-3 text-xs text-slate-500">
            Last scan{" "}
            {new Date(lastGeneratedAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}
      </header>

      {/* SOURCE TOGGLES */}
      <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["pattern", "adjacency", "gap"] as NicheKind[]).map((kind) => {
          const active = sourceFilter.has(kind);
          const total = totalSurvivingByKind[kind];
          const filteredCount = countByKind[kind];
          return (
            <Link
              key={kind}
              href={toggleSource(kind)}
              className={`rounded-lg border p-4 transition ${
                active
                  ? "border-emerald-500/60 bg-emerald-500/10"
                  : "border-slate-800 bg-slate-900/40 hover:border-emerald-500/40"
              }`}
            >
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                {SOURCE_LABELS[kind]}
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-slate-100">
                {filteredCount.toLocaleString()}
                {filteredCount !== total && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    / {total.toLocaleString()}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {kind === "pattern"
                  ? "[product] × [vertical] combos"
                  : kind === "adjacency"
                    ? "Labs semantic neighborhood"
                    : "competitor keyword gaps"}
              </p>
            </Link>
          );
        })}
      </section>

      {/* FILTER CHIPS (cluster / vertical) */}
      {(topClusters.length > 0 || topVerticals.length > 0) && (
        <section className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {topVerticals.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                Top verticals
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topVerticals.map(([v, n]) => {
                  const active = verticalFilter === v.toLowerCase();
                  return (
                    <Link
                      key={v}
                      href={chipHref("vertical", v)}
                      className={`rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                        active
                          ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400"
                      }`}
                    >
                      {v} <span className="text-slate-500">·{n}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {topClusters.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                Top clusters
              </p>
              <div className="flex flex-wrap gap-1.5">
                {topClusters.map(([c, n]) => {
                  const active = clusterFilter === c.toLowerCase();
                  return (
                    <Link
                      key={c}
                      href={chipHref("cluster", c)}
                      className={`rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                        active
                          ? "border-violet-500/60 bg-violet-500/10 text-violet-300"
                          : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-violet-500/40 hover:text-violet-400"
                      }`}
                    >
                      {c} <span className="text-slate-500">·{n}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* QUICK NUMERIC FILTERS */}
      <section className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <span className="text-slate-500">Quick filters:</span>
        <Link
          href={chipHref("minCpc", "100")}
          className={`rounded border px-2 py-0.5 font-mono transition ${
            params.minCpc === "100"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-emerald-400"
          }`}
        >
          CPC ≥ $100
        </Link>
        <Link
          href={chipHref("maxComp", "0.2")}
          className={`rounded border px-2 py-0.5 font-mono transition ${
            params.maxComp === "0.2"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-emerald-400"
          }`}
        >
          Comp ≤ 0.2
        </Link>
        <Link
          href={chipHref("minVol", "300")}
          className={`rounded border px-2 py-0.5 font-mono transition ${
            params.minVol === "300"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-emerald-400"
          }`}
        >
          Vol ≥ 300
        </Link>
        <Link
          href={chipHref("minVol", "1000")}
          className={`rounded border px-2 py-0.5 font-mono transition ${
            params.minVol === "1000"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-slate-800 bg-slate-950/40 text-slate-400 hover:text-emerald-400"
          }`}
        >
          Vol ≥ 1k
        </Link>
        {(sourceFilter.size > 0 ||
          productFilter ||
          verticalFilter ||
          clusterFilter ||
          params.minCpc ||
          params.maxComp ||
          params.minVol ||
          q) && (
          <Link
            href="/discover"
            className="rounded border border-slate-800 bg-slate-950/40 px-2 py-0.5 font-mono text-slate-500 transition hover:text-slate-300"
          >
            clear all
          </Link>
        )}
        <span className="ml-auto text-slate-500">
          {filtered.length.toLocaleString()} matching · showing top{" "}
          {Math.min(limit, rows.length)}
        </span>
      </section>

      {/* TABLE */}
      <section>
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">
                  <Link
                    href={sortHref("score")}
                    className={`transition hover:text-emerald-400 ${sortKey === "score" ? "text-emerald-400" : ""}`}
                  >
                    Score{sortIndicator("score")}
                  </Link>
                </th>
                <th className="px-3 py-2 text-left">Phrase</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Detail</th>
                <th className="px-3 py-2 text-right">
                  <Link
                    href={sortHref("volume")}
                    className={`transition hover:text-emerald-400 ${sortKey === "volume" ? "text-emerald-400" : ""}`}
                  >
                    Vol{sortIndicator("volume")}
                  </Link>
                </th>
                <th className="px-3 py-2 text-right">
                  <Link
                    href={sortHref("cpc")}
                    className={`transition hover:text-emerald-400 ${sortKey === "cpc" ? "text-emerald-400" : ""}`}
                  >
                    CPC{sortIndicator("cpc")}
                  </Link>
                </th>
                <th className="px-3 py-2 text-right">
                  <Link
                    href={sortHref("competition")}
                    className={`transition hover:text-emerald-400 ${sortKey === "competition" ? "text-emerald-400" : ""}`}
                  >
                    Comp{sortIndicator("competition")}
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r, i) => (
                <Fragment key={`${r.kind}-${r.phrase}`}>
                  <tr className="bg-slate-900/30 hover:bg-slate-900/60">
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300">
                      {r.score.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-slate-100">
                      {r.brief && (
                        <span
                          className="mr-1.5 inline-block rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0 font-mono text-[9px] text-emerald-300"
                          title="Has a generated brief — see row below"
                        >
                          BRIEF
                        </span>
                      )}
                      {r.phrase}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${SOURCE_BADGE[r.kind]}`}
                      >
                        {SOURCE_LABELS[r.kind]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {sourceDetail(r)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                      {r.volume.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${cpcColor(r.cpc)}`}
                    >
                      ${r.cpc.toFixed(2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono text-xs ${compColor(r.competition)}`}
                    >
                      {r.competition.toFixed(2)}
                    </td>
                  </tr>
                  {r.brief && (
                    <tr className="bg-slate-950/60">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">
                              What they want
                            </p>
                            <p className="mt-0.5 text-slate-200">
                              {r.brief.product_in_plain_language}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">
                              2-week MVP
                            </p>
                            <p className="mt-0.5 text-slate-200">
                              {r.brief.mvp_in_2_weeks}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">
                              How to reach them
                            </p>
                            <p className="mt-0.5 text-slate-300">
                              {r.brief.distribution}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-widest text-emerald-400">
                              Pricing anchor
                            </p>
                            <p className="mt-0.5 text-slate-300">
                              {r.brief.pricing_anchor}
                            </p>
                          </div>
                          <div className="md:col-span-2">
                            <p className="font-mono text-[9px] uppercase tracking-widest text-rose-400">
                              Biggest risk
                            </p>
                            <p className="mt-0.5 text-slate-300">
                              {r.brief.biggest_risk}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > rows.length && (
          <p className="mt-2 text-xs text-slate-500">
            Showing {rows.length.toLocaleString()} of{" "}
            {filtered.length.toLocaleString()}. Add{" "}
            <code className="font-mono">?limit=500</code> to the URL for more,
            or apply more filters above.
          </p>
        )}
      </section>
    </main>
  );
}
