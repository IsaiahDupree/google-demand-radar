declare module "google-trends-api" {
  interface InterestOptions {
    keyword: string | string[];
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
    granularTimeResolution?: boolean;
  }

  const googleTrends: {
    interestOverTime(options: InterestOptions): Promise<string>;
    interestByRegion(options: InterestOptions): Promise<string>;
    relatedQueries(options: InterestOptions): Promise<string>;
    relatedTopics(options: InterestOptions): Promise<string>;
    dailyTrends(options: { trendDate: Date; geo: string }): Promise<string>;
    realTimeTrends(options: { geo: string; category?: string }): Promise<string>;
  };

  export default googleTrends;
}
