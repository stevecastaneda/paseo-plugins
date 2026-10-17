import { LIMITS } from "./limits.ts";
import { basename } from "./text.ts";
import { lineText, type Line, type LiveView, type Phase, type RunRow } from "./row.ts";

export type Tone = "muted" | "active" | "success" | "danger" | "warning";
export type Badge = "play" | "spinner" | "check" | "x" | "square" | "unplug";
export type ActionId = "run" | "dismiss" | "stop" | "force-stop" | "copy" | "rerun" | "send";
export type NoteIcon = "eye-off" | "eye" | "scissors" | "clock" | "info" | "folder";

// A row after merging its data with the freshest live reply (see client/live.ts).
export type ResolvedRun = Pick<RunRow, "runId" | "origin" | "command" | "cwd"> &
  Pick<LiveView, "rev" | "phase" | "output" | "sentAt"> & {
    // Client time when a poll said the daemon never saw this run while the row still claimed running.
    lostAt: number | null;
    lastOutputAt: number | null;
    // serverNow - clientNow at the last reply; 0 before any reply.
    clockOffset: number;
  };

export interface Action {
  id: ActionId;
  label: string;
  primary: boolean;
  disabled: boolean;
}

export type Well =
  | { kind: "output"; skipped: number }
  | { kind: "message"; text: string }
  | { kind: "empty"; text: string };

export interface Presentation {
  // proposed: dashed card with the full command. card: the receipt. dismissed: one muted line.
  layout: "proposed" | "card" | "dismissed";
  tone: Tone;
  badge: Badge;
  // "Done", "Exit 1", "Killed (SIGKILL)", "Stopped", "Interrupted", "Couldn't start", "Stopping", "" while running.
  label: string;
  // Fixed once ended: "12.4 s" | "850 ms" | "1 m 05 s". null while running or before.
  elapsed: string | null;
  // Set while running: the start instant in the client's clock, for a ticking timer.
  timerFrom: number | null;
  // In order, left to right. At most one is primary.
  actions: Action[];
  foldable: boolean;
  // How many lines the collapsed well shows.
  peekLines: number;
  // Left footer chips, most specific first; at most two.
  notes: Array<{ icon: NoteIcon; text: string }>;
  // At most one, below the notes.
  hint: string | null;
  well: Well | null;
}

const INPUT_PATTERNS = /password.*:\s*$|passphrase|not a tty|terminal is required|Inappropriate ioctl|input device is not a TTY/im;
const NO_SHELL_FILES_HINT = "/sh runs your shell without its startup files, so aliases aren't loaded.";
const NO_KEYBOARD_HINT = "This command wants input, and /sh has no keyboard. Run it in a terminal tab.";

// Paseo's built-in provider labels (protocol/src/provider-manifest.ts); anything else is "the agent".
const AGENT_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", copilot: "Copilot", opencode: "OpenCode", pi: "Pi", omp: "Oh My Pi" };

export function agentName(provider: string | null | undefined): string {
  return (provider && AGENT_NAMES[provider]) || "the agent";
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describe(run: ResolvedRun, now: number, opts: { expanded?: boolean; agent?: string } = {}): Presentation {
  const agent = opts.agent ?? "the agent";
  const phase = effectivePhase(run);
  const peekLines = phase.kind === "failed" ? LIMITS.failedPeekLines : LIMITS.peekLines;
  const { lines, total } = run.output;
  const skipped = Math.max(0, total - lines.length);
  const visible = trimBlankEnds(lines, skipped === 0).length;
  const shown = opts.expanded ? visible : peekWindow(lines, skipped === 0, peekLines).length;
  const foldable = visible > peekLines || skipped > 0 || run.command.includes("\n") || run.command.length > LIMITS.headerCommandChars;
  const outputText = lines.map(lineText).join("\n");

  if (phase.kind === "proposed") {
    return {
      layout: "proposed", tone: "muted", badge: "play", label: `Suggested by ${agent}`, elapsed: null, timerFrom: null,
      actions: [action("run", "Run", true), action("copy", "Copy"), action("dismiss", "Dismiss")],
      foldable: false, peekLines, hint: null, well: null,
      notes: [{ icon: "eye-off", text: `${capitalize(agent)} sees the output only if you send it` }, { icon: "folder", text: basename(run.cwd) }],
    };
  }
  if (phase.kind === "dismissed") {
    return { layout: "dismissed", tone: "muted", badge: "x", label: "Dismissed", elapsed: null, timerFrom: null, actions: [], foldable: false, peekLines, notes: [], hint: null, well: null };
  }
  if (phase.kind === "running") {
    const stopping = phase.stopRequestedAt !== null;
    const forceReady = stopping && now + run.clockOffset - phase.stopRequestedAt! >= LIMITS.forceStopAfterMs;
    const silentFor = run.lastOutputAt === null ? now + run.clockOffset - phase.startedAt : now + run.clockOffset - run.lastOutputAt;
    const lastLine = lines.length > 0 ? lineText(lines[lines.length - 1]).trimEnd() : "";
    const wantsInput = INPUT_PATTERNS.test(outputText) || (silentFor >= LIMITS.inputHintMs && /[:?]$/.test(lastLine));
    const quiet = silentFor >= LIMITS.quietNoteMs ? ` · quiet for ${Math.floor(silentFor / 1000)}s` : "";
    return {
      layout: "card", tone: "active", badge: "spinner",
      label: stopping ? "Stopping" : "",
      elapsed: null,
      timerFrom: phase.startedAt - run.clockOffset,
      actions: forceReady ? [action("force-stop", "Force stop", true)] : stopping ? [{ ...action("stop", "Stopping…", true), disabled: true }] : [action("stop", "Stop", true)],
      foldable,
      peekLines,
      notes: [{ icon: "clock", text: total === 0 ? "No output yet" : `${formatCount(total)} ${total === 1 ? "line" : "lines"}${quiet}` }],
      hint: wantsInput ? NO_KEYBOARD_HINT : null,
      well: total === 0 ? null : { kind: "output", skipped },
    };
  }

  const elapsed = formatDuration(phase.endedAt - phase.startedAt);
  const sendIsPrimary = run.sentAt === null && (run.origin === "claude" || phase.kind === "failed");
  const send = action("send", run.sentAt === null ? `Send to ${agent}` : "Send again", sendIsPrimary);
  const actions = sendIsPrimary ? [send, action("copy", "Copy"), action("rerun", "Rerun")] : [action("copy", "Copy"), action("rerun", "Rerun"), send];
  const notes: Presentation["notes"] = [
    run.sentAt === null ? { icon: "eye-off", text: `${capitalize(agent)} can't see this` } : { icon: "eye", text: `Sent to ${agent} ${formatClock(run.sentAt)}` },
  ];
  if (shown < visible || skipped > 0) notes.push({ icon: "scissors", text: `Last ${formatCount(shown)} of ${formatCount(total)} lines` });
  const notFound = (phase.kind === "failed" && phase.exitCode === 127) || /command not found/i.test(outputText);
  const hint = notFound ? NO_SHELL_FILES_HINT : INPUT_PATTERNS.test(outputText) ? NO_KEYBOARD_HINT : null;

  const base = { layout: "card" as const, elapsed, timerFrom: null, actions, foldable, peekLines, notes, hint };
  const well: Well | null = phase.kind === "failed" && phase.message !== null
    ? { kind: "message", text: phase.message }
    : total === 0 ? { kind: "empty", text: "No output" } : { kind: "output", skipped };
  switch (phase.kind) {
    case "ok":
      return { ...base, tone: "success", badge: "check", label: "Done", well };
    case "failed":
      if (phase.message !== null) return { ...base, tone: "danger", badge: "x", label: "Couldn't start", elapsed: null, well };
      return { ...base, tone: "danger", badge: "x", label: phase.signal ? `Killed (${phase.signal})` : `Exit ${phase.exitCode ?? "?"}`, well };
    case "stopped":
      return { ...base, tone: "warning", badge: "square", label: "Stopped", well };
    case "interrupted":
      return { ...base, tone: "warning", badge: "unplug", label: "Interrupted", well, notes: [...notes, { icon: "info" as const, text: "Stopped when the plugin restarted" }].slice(0, 2) };
  }
}

// A running row the daemon no longer knows about ended when the poll said so.
function effectivePhase(run: ResolvedRun): Phase {
  if (run.phase.kind === "running" && run.lostAt !== null) {
    return { kind: "interrupted", startedAt: run.phase.startedAt, endedAt: run.lostAt + run.clockOffset };
  }
  return run.phase;
}

function action(id: ActionId, label: string, primary = false): Action {
  return { id, label, primary, disabled: false };
}

// Programs often open or close with blank lines (npm prints one before its "> script" banner).
// Leading ones only go when the first kept line is the program's first line.
export function trimBlankEnds(lines: readonly Line[], atStart: boolean): readonly Line[] {
  const blank = (line: Line) => lineText(line).trim() === "";
  let from = 0;
  let to = lines.length;
  while (atStart && from < to && blank(lines[from])) from++;
  while (to > from && blank(lines[to - 1])) to--;
  return from === 0 && to === lines.length ? lines : lines.slice(from, to);
}

// The lines the collapsed well shows: the last `peekLines` after trimming, never starting blank.
export function peekWindow(lines: readonly Line[], atStart: boolean, peekLines: number): readonly Line[] {
  const trimmed = trimBlankEnds(lines, atStart);
  return trimmed.length <= peekLines ? trimmed : trimBlankEnds(trimmed.slice(-peekLines), true);
}

// Same format as playwright-pulse: "0.8s", "9.9s", "12s", "1m 05s", "1h 02m".
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `${(Math.floor(safe / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// The header's status text, for the live region and for tests.
export function statusText(p: Presentation): string {
  return [p.label, p.elapsed].filter(Boolean).join(" · ");
}
