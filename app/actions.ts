"use server";

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { analyze } from "../src/pipeline.js";
import { ingestAndTriage } from "../src/ingest.js";
import { runSweep } from "../src/sweep.js";

const RESULTS_DIR = path.resolve(process.cwd(), "results");

export async function analyzeIdeaAction(formData: FormData): Promise<void> {
  const ideaText = (formData.get("idea") as string | null)?.trim();
  if (!ideaText) return;

  const result = await analyze(ideaText);
  const baseSlug =
    result.concept.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `idea-${Date.now()}`;

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, `${baseSlug}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));

  revalidatePath("/");
  redirect(`/idea/${baseSlug}`);
}

export async function triageAllProjectsAction(): Promise<void> {
  await ingestAndTriage();
  revalidatePath("/");
  redirect("/");
}

export async function runSweepAction(formData: FormData): Promise<void> {
  const slug = (formData.get("slug") as string | null)?.trim();
  if (!slug) return;
  await runSweep(slug);
  revalidatePath(`/idea/${slug}`);
  redirect(`/idea/${slug}/sweep`);
}
