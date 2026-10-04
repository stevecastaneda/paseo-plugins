// What the panel derives from a run snapshot. Pure, so it's tested without a UI.
import type { PulseTest, RunSnapshot, RunStatus } from "./run.ts";

export type Counts = { passed: number; failed: number; flaky: number; skipped: number; stopped: number; running: number; done: number; total: number };

// How a test came out, by Playwright's own verdict, so test.fail(), retries
// and skips read the way the terminal reports them.
export type Verdict = "running" | "failed" | "stopped" | "flaky" | "skipped" | "passed";

export function verdict(test: PulseTest): Verdict {
  if (test.status === "running") return "running";
  if (test.outcome === "unexpected") return "failed";
  // Snapshots without a verdict fall back to how the last try ended.
  if (!test.outcome && (test.status === "failed" || test.status === "timedOut")) return "failed";
  if (test.status === "interrupted") return "stopped";
  if (test.outcome === "flaky") return "flaky";
  if (test.outcome === "skipped" || test.status === "skipped") return "skipped";
  return "passed";
}

export function isFailure(test: PulseTest): boolean {
  return verdict(test) === "failed";
}

// What a finished test's row says under its title, if anything.
export function verdictNote(test: PulseTest): string | undefined {
  switch (verdict(test)) {
    case "failed": return "Failed, details above";
    case "flaky": return `Flaky: passed on retry ${test.retry}`;
    case "stopped": return "Stopped before it finished";
    case "skipped": return "Skipped";
    case "passed": return test.status === "passed" ? undefined : "Failed, as expected";
    default: return undefined;
  }
}

// The message a failure leads with when Playwright gave no error.
export function failureMessage(test: PulseTest, formatTimeout: (ms: number) => string): string {
  if (test.error?.message) return test.error.message;
  if (test.status === "timedOut") return `Test timed out after ${formatTimeout(test.timeout)}.`;
  if (test.status === "passed") return "Marked as expected to fail, but it passed.";
  return "The test failed.";
}

export function counts(run: RunSnapshot): Counts {
  const tally: Counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, stopped: 0, running: 0, done: 0, total: run.total };
  for (const test of run.tests) {
    const result = verdict(test);
    if (result === "flaky") {
      // Flaky tests passed in the end; they're counted with the passes.
      tally.passed++;
      tally.flaky++;
    } else tally[result]++;
  }
  tally.done = tally.passed + tally.failed + tally.skipped + tally.stopped;
  // Repeats and retries can outnumber what onBegin counted.
  tally.total = Math.max(tally.total, tally.done + tally.running);
  return tally;
}

export const STATUS_TITLE: Record<RunStatus, string> = {
  starting: "Starting up",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  timedout: "Timed out",
  interrupted: "Interrupted",
};

export function isLive(run: RunSnapshot): boolean {
  return run.status === "starting" || run.status === "running";
}

// "0.4s", "12s", "1m 05s", "1h 02m". Seconds keep one decimal under ten.
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `${(Math.floor(safe / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

// A running clock: "0:07", "4:12", "1:02:09".
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function formatAgo(iso: string, nowMs: number): string {
  const seconds = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// How long the run has gone on, or went on.
export function runElapsed(run: RunSnapshot, nowMs: number): number {
  const end = run.endedAt ? Date.parse(run.endedAt) : isLive(run) ? nowMs : Date.parse(run.updatedAt);
  return end - Date.parse(run.startedAt);
}

// The command as typed, quoting arguments with spaces:
// `playwright test e2e/leads -g "User edits a lead"`.
export function commandLine(args: string[]): string {
  const quoted = args.map((arg) => (/[\s"']/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg));
  return ["playwright test", ...quoted].join(" ");
}

// The first lines of an error, and whether there's more.
export function errorPreview(message: string, lines = 4): { text: string; more: boolean } {
  const all = message.replace(/\s+$/, "").split("\n");
  return { text: all.slice(0, lines).join("\n"), more: all.length > lines };
}

export type AttachmentKind = "screenshot" | "video" | "trace" | "other";

export function attachmentKind(attachment: { name: string; contentType: string; path: string }): AttachmentKind {
  if (attachment.name === "trace" || attachment.path.endsWith(".zip")) return "trace";
  if (attachment.contentType.startsWith("image/")) return "screenshot";
  if (attachment.contentType.startsWith("video/")) return "video";
  return "other";
}

// Where a test sits: its describe blocks, then file and line.
export function testWhere(test: PulseTest): string {
  return [...test.titlePath, `${test.file}:${test.line}`].join(" › ");
}

// A running test's share of its timeout, 0 to 1, or null without one.
export function timeoutShare(test: PulseTest, nowMs: number): number | null {
  if (!test.timeout || !test.startedAt) return null;
  return Math.min(1, Math.max(0, (nowMs - Date.parse(test.startedAt)) / test.timeout));
}
