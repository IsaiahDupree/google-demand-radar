export type FunnelStageMetric = "tofu" | "mofu" | "bofu";

export interface KeywordMetric {
  phrase: string;
  volume: number;
  cpc: number;
  competition: number;
  source: "google_trends" | "dataforseo" | "google_ads";
  funnel_stage?: FunnelStageMetric;
}

export interface KeywordProvider {
  name: string;
  fetch(phrases: string[]): Promise<KeywordMetric[]>;
}
