/**
 * Parser for Google Ads Keyword Planner CSV exports. Handles the format
 * variations Google ships:
 *   - BOM / preamble lines before the actual header row
 *   - Volume buckets like "1K – 10K" or "100 – 1K" (em-dash or hyphen)
 *   - Exact volumes (when the account has Standard Access or paid ad spend)
 *   - K/M shorthand: "1K", "1.5M"
 *   - CPC ranges in USD: "$0.45" / "$4.21"
 *   - Competition as text (Low/Medium/High) or indexed (0-100)
 */

export interface ParsedKpRow {
  phrase: string;
  volume: number;
  cpc: number;
  competition: number;
}

/**
 * Parse a single CSV line, respecting double-quoted fields with embedded
 * commas and escaped quotes.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

/**
 * Convert a Keyword Planner volume cell (often a bucketed range like
 * "1K – 10K") into a numeric volume estimate (range midpoint).
 *
 *   "10"             → 10
 *   "1500"           → 1500
 *   "1K"             → 1000
 *   "1.5M"           → 1500000
 *   "100 – 1K"       → 550   (midpoint)
 *   "1K – 10K"       → 5500
 *   "10K – 100K"     → 55000
 *   "100K – 1M"      → 550000
 *   ""               → 0
 *   "<10"            → 5     (treat as bucket midpoint, generous read)
 */
export function parseVolumeBucket(s: string | undefined): number {
  if (!s) return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;

  // "<10" or "< 10" → treat as bucket 0-10, midpoint 5
  const ltMatch = trimmed.match(/^<\s*(\d+(?:\.\d+)?[KMkm]?)$/);
  if (ltMatch) {
    const high = parseVolumeBucket(ltMatch[1]);
    return high / 2;
  }

  // Strip commas, normalize em-dash to hyphen
  const norm = trimmed.replace(/[,]/g, "").replace(/–/g, "-");

  // Plain integer
  if (/^\d+$/.test(norm)) return Number(norm);

  // Decimal: "1500.0"
  if (/^\d+\.\d+$/.test(norm)) return Number(norm);

  // K/M shorthand: "1K", "10K", "1.5M"
  const shorthandMatch = norm.match(/^(\d+(?:\.\d+)?)([KM])$/i);
  if (shorthandMatch) {
    const num = Number(shorthandMatch[1]);
    const mult = shorthandMatch[2]!.toUpperCase() === "K" ? 1_000 : 1_000_000;
    return num * mult;
  }

  // Range: "1K - 10K" / "100 - 1K"
  const rangeMatch = norm.match(/^(.+?)\s*-\s*(.+)$/);
  if (rangeMatch) {
    const low = parseVolumeBucket(rangeMatch[1]);
    const high = parseVolumeBucket(rangeMatch[2]);
    if (low > 0 && high > 0) return (low + high) / 2;
    return high || low || 0;
  }

  return 0;
}

/** Parse a USD bid string like "$4.21" → 4.21. Returns 0 on failure. */
export function parseUsd(s: string | undefined): number {
  if (!s) return 0;
  const m = s.replace(/[,$]/g, "").trim();
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Competition text or indexed value → 0-1 scalar.
 * Prefers the indexed value when present (more precise).
 */
export function parseCompetition(
  text?: string,
  indexed?: string
): number {
  if (indexed) {
    const n = parseFloat(indexed);
    if (Number.isFinite(n)) return Math.max(0, Math.min(1, n / 100));
  }
  if (text) {
    const t = text.trim().toLowerCase();
    if (t === "low") return 0.25;
    if (t === "medium") return 0.5;
    if (t === "high") return 0.85;
  }
  return 0;
}

/**
 * Parse a full Keyword Planner CSV export. Throws on missing required
 * columns. Returns one ParsedKpRow per data row.
 */
export function parseKeywordPlannerCsv(content: string): ParsedKpRow[] {
  const lines = content
    .replace(/^﻿/, "") // strip BOM
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  // Find the header row — Google prepends a few preamble lines.
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!).map((c) => c.trim());
    if (cols[0] && /^keyword$/i.test(cols[0])) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      "Could not find header row starting with 'Keyword'. " +
        "Make sure the CSV is exported from Google Ads Keyword Planner."
    );
  }

  const colIndex = (re: RegExp): number =>
    headers.findIndex((h) => re.test(h));

  const iPhrase = colIndex(/^keyword$/i);
  const iVolume = colIndex(/avg.*monthly.*searches|search\s*volume/i);
  const iCpcHigh = colIndex(/top.*page.*bid.*high|high.*top.*page.*bid|high\s*bid/i);
  const iCpcLow = colIndex(/top.*page.*bid.*low|low.*top.*page.*bid|low\s*bid/i);
  const iCompText = colIndex(/^competition$/i);
  const iCompIdx = colIndex(/competition.*indexed|indexed.*competition/i);

  if (iPhrase < 0 || iVolume < 0) {
    throw new Error(
      `Required columns missing. Need at least 'Keyword' and an 'Avg. monthly searches' column.\nHeaders found: ${headers.join(" | ")}`
    );
  }

  const rows: ParsedKpRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const phrase = cols[iPhrase]?.trim().toLowerCase();
    if (!phrase) continue;
    const volume = parseVolumeBucket(cols[iVolume]);
    const cpc = parseUsd(
      iCpcHigh >= 0 ? cols[iCpcHigh] : iCpcLow >= 0 ? cols[iCpcLow] : ""
    );
    const competition = parseCompetition(
      iCompText >= 0 ? cols[iCompText] : undefined,
      iCompIdx >= 0 ? cols[iCompIdx] : undefined
    );
    rows.push({ phrase, volume, cpc, competition });
  }
  return rows;
}
