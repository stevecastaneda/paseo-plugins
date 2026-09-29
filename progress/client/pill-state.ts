import type { AttentionResult } from "../shared/rpc";

// What an agent's Progress pill shows, decided in one place so its label, its
// icon and what pressing it does can't disagree.
// - "attention": questions waiting or something stuck; opens a popover.
// - "started": a run whose panel has never been opened; a one-time nudge.
// - "open": on a phone, the way into the panel while a run is open, since
//   phones have no Explorer to open it from.
export type Pill =
  | { mode: "attention"; label: string; icon: "stuck" | "questions" }
  | { mode: "started"; label: "Progress"; icon: "started" }
  | { mode: "open"; label: "Progress"; icon: "open" };

// What needs the user first, else the nudge, else (on a phone) the way in.
// Null when there's no pill.
export function pillFor(report: AttentionResult | undefined, where: { phone: boolean }): Pill | null {
  if (!report?.configured) return null;
  const { questions, stuck } = report;
  if (questions || stuck) {
    const parts = [];
    if (questions) parts.push(`${questions} ${questions === 1 ? "question" : "questions"}`);
    if (stuck) parts.push(`${stuck} stuck`);
    return { mode: "attention", label: parts.join(" · "), icon: stuck ? "stuck" : "questions" };
  }
  if (report.runOpen && !report.panelOpened) return { mode: "started", label: "Progress", icon: "started" };
  if (report.runOpen && where.phone) return { mode: "open", label: "Progress", icon: "open" };
  return null;
}

// A worktree with nothing going on (no file, or a closed run with nothing
// waiting), which the pill checks less often.
export function isIdle(report: AttentionResult): boolean {
  return !report.runOpen && !report.questions && !report.stuck;
}
