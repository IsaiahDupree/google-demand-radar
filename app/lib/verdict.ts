import type { Verdict } from "../../src/scoring.js";

export const VERDICT_ORDER: Record<Verdict, number> = {
  "Build Now": 0,
  "Test First": 1,
  "Educate Later": 2,
  Pause: 3,
};

export const VERDICT_STYLES: Record<
  Verdict,
  { bg: string; text: string; border: string }
> = {
  "Build Now": {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
  },
  "Test First": {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/40",
  },
  "Educate Later": {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/40",
  },
  Pause: {
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/40",
  },
};
