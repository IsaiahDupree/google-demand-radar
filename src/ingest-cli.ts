import { ingestAndTriage } from "./ingest.js";

async function main(): Promise<void> {
  const r = await ingestAndTriage({
    onProgress: (e) => {
      switch (e.phase) {
        case "listing-github":
          process.stderr.write("→ Listing GitHub repos…\n");
          break;
        case "listing-vercel":
          process.stderr.write("→ Listing Vercel projects…\n");
          break;
        case "listing-local":
          process.stderr.write("→ Scanning local Coding folder…\n");
          break;
        case "discovered":
          process.stderr.write(`→ Discovered ${e.total} ideas. Triaging…\n\n`);
          break;
        case "triaging":
          if (e.slug) {
            const label = `[${e.current}/${e.total}] (${e.source}) ${e.slug}`;
            process.stderr.write(label.padEnd(56) + " ");
          }
          break;
        case "done":
          process.stderr.write(`${e.verdict}\n`);
          break;
        case "error":
          process.stderr.write(`FAILED — ${e.error}\n`);
          break;
      }
    },
  });
  console.error(
    `\n${r.ok}/${r.total} ok, ${r.failed} failed. Open http://localhost:3000 to view.`
  );
}

main().catch((err) => {
  console.error("Ingest error:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
