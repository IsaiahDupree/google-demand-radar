import { readFileSync } from "node:fs";
import { analyze } from "./pipeline.js";
import { loadCredentials } from "./config.js";

async function main() {
  const args = process.argv.slice(2);
  const [arg] = args;
  if (!arg) {
    console.error("Usage:");
    console.error("  npm run analyze -- <path-to-idea-file>");
    console.error("  npm run analyze -- -          # read from stdin");
    process.exit(2);
  }

  const text = arg === "-" ? await readStdin() : readFileSync(arg, "utf8");
  if (!text.trim()) {
    console.error("Empty input.");
    process.exit(2);
  }

  // Validate creds early so we fail before any API calls.
  loadCredentials();

  const result = await analyze(text);
  console.log(JSON.stringify(result, null, 2));
  console.error(
    `\n→ ${result.concept.name}: ${result.verdict} (${result.score.total.toFixed(1)}/35, provider: ${result.provider})`
  );
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

main().catch((err) => {
  console.error("Pipeline error:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
