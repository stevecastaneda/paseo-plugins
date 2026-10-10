// What the panel derives from a run snapshot. Pure, so it's tested without a UI.
import type { RunBrief } from "./rpc.ts";
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

export function runBrief(run: RunSnapshot): RunBrief {
  const tally = counts(run);
  const brief: RunBrief = { runId: run.id, status: run.status, done: tally.done, total: tally.total, failed: tally.failed };
  if (run.endedAt ?? (!isLive(run) ? run.updatedAt : undefined)) brief.endedAt = run.endedAt ?? run.updatedAt;
  return brief;
}

// How long the header pill stays after a run ends, so its result can still be
// opened from there.
export const PILL_LINGER_MS = 2 * 60_000;

export type PillTone = "running" | "failing" | "passed" | "failed" | "stopped";
export type PillView = { label: string; tone: PillTone };

// What the header pill says, or null when it shouldn't show. The spinner
// turns red once a test fails.
export function pillView(brief: RunBrief | null, nowMs: number): PillView | null {
  if (!brief) return null;
  if (brief.status === "starting") return { label: "Tests starting", tone: "running" };
  if (brief.status === "running") {
    // Paseo caps a header button at 160px, so failures lead and "Tests" goes:
    // if the label is cut short, it's the count that's lost.
    return brief.failed
      ? { label: `${brief.failed} failed · ${brief.done}/${brief.total}`, tone: "failing" }
      : { label: `Tests ${brief.done}/${brief.total}`, tone: "running" };
  }
  if (!brief.endedAt || nowMs - Date.parse(brief.endedAt) > PILL_LINGER_MS) return null;
  if (brief.status === "passed") return { label: "Tests passed", tone: "passed" };
  if (brief.status === "interrupted") return { label: "Tests stopped", tone: "stopped" };
  return { label: brief.failed ? `${brief.failed} failed` : "Tests failed", tone: "failed" };
}

// The failure on show: the one picked, while it's still a failure, else the
// first. New failures arriving don't move it.
export function shownFailure(ids: readonly string[], picked: string | null): number {
  const index = picked === null ? -1 : ids.indexOf(picked);
  return index >= 0 ? index : 0;
}

// The next or previous failure, wrapping around at either end.
export function stepFailure(ids: readonly string[], picked: string | null, delta: 1 | -1): string | null {
  if (!ids.length) return null;
  return ids[(shownFailure(ids, picked) + delta + ids.length) % ids.length];
}

// A part of the suite: a folder of spec files, or a file when they share one.
// `kind` is "file" for a spec file that sits beside the folders, or when
// every spec file shares one folder.
export type Folder = { name: string; kind: "folder" | "file"; total: number; done: number; passed: number; failed: number; flaky: number; skipped: number; stopped: number; running: number; duration: number; tests: PulseTest[] };

const SPEC_SUFFIX = /\.(spec|test)\.[cm]?[jt]sx?$/;

// Names each file's folder: the first folder below the folder all spec files
// share, or the file's own name when they all sit in one folder.
function folderNamer(files: readonly string[]): (file: string) => { name: string; kind: Folder["kind"] } {
  const parts = files.map((file) => file.split(/[\\/]/));
  let shared = 0;
  while (parts.length && parts.every((segments) => segments.length - 1 > shared && segments[shared] === parts[0][shared])) shared++;
  return (file) => {
    const segments = file.split(/[\\/]/);
    const rest = segments.slice(shared);
    return rest.length > 1 ? { name: rest[0], kind: "folder" } : { name: rest[0].replace(SPEC_SUFFIX, ""), kind: "file" };
  };
}

// The suite by folder, in the order it runs. Folders that haven't started yet
// still show, from the plan the run made when it began.
export function folders(run: RunSnapshot): Folder[] {
  const plan = run.plan ?? [];
  const nameOf = folderNamer([...plan.map((entry) => entry.file), ...run.tests.map((test) => test.file)]);
  const byName = new Map<string, Folder>();
  const folder = (file: string) => {
    const { name, kind } = nameOf(file);
    let found = byName.get(`${kind}:${name}`);
    if (!found) {
      found = { name, kind, total: 0, done: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, stopped: 0, running: 0, duration: 0, tests: [] };
      byName.set(`${kind}:${name}`, found);
    }
    return found;
  };
  for (const entry of plan) folder(entry.file).total += entry.count;
  for (const test of run.tests) {
    const found = folder(test.file);
    found.tests.push(test);
    const result = verdict(test);
    if (result === "flaky") {
      found.passed++;
      found.flaky++;
    } else found[result]++;
    if (result !== "running") found.duration += test.duration ?? 0;
  }
  for (const found of byName.values()) {
    found.done = found.passed + found.failed + found.skipped + found.stopped;
    found.total = Math.max(found.total, found.done + found.running);
  }
  return [...byName.values()];
}

// What to call the list: "Folders", or "Files" when the specs share one folder.
export function folderLabel(list: readonly Folder[]): "Folders" | "Files" {
  return list.length && list.every((entry) => entry.kind === "file") ? "Files" : "Folders";
}

// The longest finished tests, longest first.
export function slowest(run: RunSnapshot, limit = 5): PulseTest[] {
  return run.tests
    .filter((test) => test.status !== "running" && test.status !== "skipped" && test.duration !== undefined)
    .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    .slice(0, limit);
}

// About how long a live run has left, from its pace so far, or null until
// enough tests have finished to tell.
export function timeLeft(run: RunSnapshot, nowMs: number, minDone = 5): number | null {
  if (!isLive(run) || !run.testsStartedAt) return null;
  const tally = counts(run);
  if (tally.done < minDone) return null;
  const spent = nowMs - Date.parse(run.testsStartedAt);
  const left = tally.total - tally.done;
  return left > 0 ? (spent / tally.done) * left : 0;
}

// "about 4 min left", "under a minute left".
export function formatTimeLeft(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute left";
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${String(minutes % 60).padStart(2, "0")} min left`;
}

// How many rows the running card keeps for the whole run: one per worker
// that has a test to run, so the card holds its height between tests.
export function runningSlotCount(run: RunSnapshot, running: number): number {
  return Math.max(running, Math.min(run.workers || 1, run.total || 1), 1);
}

// Which test each row shows. A test keeps its row while it runs, and a new one
// takes the first free row, so rows don't trade places as tests come and go.
export function assignSlots(previous: readonly (string | null)[], running: readonly string[], count: number): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: count }, (_, index) => {
    const id = previous[index] ?? null;
    return id !== null && running.includes(id) ? id : null;
  });
  for (const id of running) {
    if (slots.includes(id)) continue;
    const free = slots.indexOf(null);
    if (free >= 0) slots[free] = id;
    else slots.push(id);
  }
  return slots;
}

// A running test's share of its timeout, 0 to 1, or null without one.
export function timeoutShare(test: PulseTest, nowMs: number): number | null {
  if (!test.timeout || !test.startedAt) return null;
  return Math.min(1, Math.max(0, (nowMs - Date.parse(test.startedAt)) / test.timeout));
}
