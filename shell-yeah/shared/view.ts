import { LIMITS } from "./limits.ts";
import { basename, risksOf, splitTitle } from "./text.ts";
import { cardIdOf, lineText, runNumberOf, type Line, type LiveView, type PastRun, type Phase, type RunRow } from "./row.ts";

export type Tone = "muted" | "active" | "success" | "danger" | "warning";
export type Badge = "play" | "spinner" | "check" | "x" | "square" | "unplug";
export type ActionId = "run" | "dismiss" | "stop" | "force-stop" | "copy" | "rerun" | "send";
export type NoteIcon = "eye-off" | "eye" | "scissors" | "clock" | "info" | "folder";

// A row after merging its data with the freshest live reply (see client/live.ts).
export type ResolvedRun = Pick<RunRow, "runId" | "origin" | "command" | "cwd"> & { terminal: boolean } &
  Pick<LiveView, "rev" | "phase" | "output" | "sentAt" | "cursor"> & {
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
  // The agent's one-line summary of a command it suggested; null for everything else.
  title: string | null;
  // The command as shown and copied, without its title line.
  script: string;
  // On a suggestion that does something hard to undo: what, in plain words.
  warning: string | null;
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
  // Rows the output box shows before it scrolls.
  boxLines: number;
  // Left footer chips, most specific first; at most two.
  notes: Array<{ icon: NoteIcon; text: string }>;
  // At most one, below the notes.
  hint: string | null;
  // Show the box for typing into the command's terminal.
  keyboard: boolean;
  well: Well | null;
}

const INPUT_PATTERNS = /password.*:\s*$|passphrase|not a tty|terminal is required|Inappropriate ioctl|input device is not a TTY/im;
const NO_SHELL_FILES_HINT = "/sh runs your shell without its startup files, so aliases aren't loaded.";
const NO_KEYBOARD_HINT = "This command wants input, and /sh has no keyboard here. Run it in a terminal tab.";
const TYPE_HINT = "This command may be waiting for you. Click the output and type your answer.";

// Paseo's built-in provider labels (protocol/src/provider-manifest.ts); anything else is "the agent".
const AGENT_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", copilot: "Copilot", opencode: "OpenCode", pi: "Pi", omp: "Oh My Pi" };

export function agentName(provider: string | null | undefined): string {
  return (provider && AGENT_NAMES[provider]) || "the agent";
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describe(run: ResolvedRun, now: number, opts: { agent?: string } = {}): Presentation {
  const agent = opts.agent ?? "the agent";
  const phase = effectivePhase(run);
  const { lines, total } = run.output;
  const skipped = Math.max(0, total - lines.length);
  const boxLines = phase.kind === "failed" ? LIMITS.failedBoxLines : LIMITS.boxLines;
  const visible = trimBlankEnds(lines, skipped === 0).length;
  const { title, script } = splitTitle(run.command);
  const foldable = visible > boxLines || script.includes("\n") || script.length > LIMITS.headerCommandChars;
  const outputText = lines.map(lineText).join("\n");
  const shown = { title: null, script, warning: null };

  if (phase.kind === "proposed") {
    return {
      layout: "proposed", title, script, warning: warningFor(risksOf(script)), tone: "muted", badge: "play", label: `Suggested by ${agent}`, elapsed: null, timerFrom: null,
      actions: [action("run", "Run", true), action("copy", "Copy"), action("dismiss", "Dismiss")],
      foldable: false, boxLines, hint: null, well: null, keyboard: false,
      notes: [{ icon: "eye-off", text: `${capitalize(agent)} sees the output only if you send it` }, { icon: "folder", text: basename(run.cwd) }],
    };
  }
  if (phase.kind === "dismissed") {
    return { layout: "dismissed", ...shown, tone: "muted", badge: "x", label: "Dismissed", elapsed: null, timerFrom: null, actions: [], foldable: false, boxLines, notes: [], hint: null, well: null, keyboard: false };
  }
  if (phase.kind === "running") {
    const stopping = phase.stopRequestedAt !== null;
    const forceReady = stopping && now + run.clockOffset - phase.stopRequestedAt! >= LIMITS.forceStopAfterMs;
    const silentFor = run.lastOutputAt === null ? now + run.clockOffset - phase.startedAt : now + run.clockOffset - run.lastOutputAt;
    const lastLine = lines.length > 0 ? lineText(lines[lines.length - 1]).trimEnd() : "";
    const wantsInput = INPUT_PATTERNS.test(outputText) || (silentFor >= LIMITS.inputHintMs && /[:?]$/.test(lastLine));
    const quiet = silentFor >= LIMITS.quietNoteMs ? ` · quiet for ${Math.floor(silentFor / 1000)}s` : "";
    return {
      layout: "card", ...shown, tone: "active", badge: "spinner",
      label: stopping ? "Stopping" : "",
      elapsed: null,
      timerFrom: phase.startedAt - run.clockOffset,
      actions: forceReady ? [action("force-stop", "Force stop", true)] : stopping ? [{ ...action("stop", "Stopping…", true), disabled: true }] : [action("stop", "Stop", true)],
      foldable,
      boxLines,
      notes: [{ icon: "clock", text: total === 0 ? "No output yet" : `${formatCount(total)} ${total === 1 ? "line" : "lines"}${quiet}` }],
      hint: wantsInput ? (run.terminal ? TYPE_HINT : NO_KEYBOARD_HINT) : null,
      well: total === 0 ? null : { kind: "output", skipped },
      keyboard: run.terminal && !stopping,
    };
  }

  const elapsed = formatDuration(phase.endedAt - phase.startedAt);
  const sendIsPrimary = run.sentAt === null && (run.origin === "claude" || phase.kind === "failed");
  // A button drops the article: "Send to agent", not "Send to the agent".
  const send = action("send", run.sentAt === null ? `Send to ${agent.replace(/^the /, "")}` : "Send again", sendIsPrimary);
  const actions = sendIsPrimary ? [send, action("copy", "Copy"), action("rerun", "Rerun")] : [action("copy", "Copy"), action("rerun", "Rerun"), send];
  const notes: Presentation["notes"] = [
    run.sentAt === null ? { icon: "eye-off", text: `${capitalize(agent)} can't see this` } : { icon: "eye", text: `Sent to ${agent} ${formatClock(run.sentAt)}` },
  ];
  if (skipped > 0) notes.push({ icon: "scissors", text: `Last ${formatCount(lines.length)} of ${formatCount(total)} lines` });
  const notFound = (phase.kind === "failed" && phase.exitCode === 127) || /command not found/i.test(outputText);
  const hint = notFound ? NO_SHELL_FILES_HINT : !run.terminal && INPUT_PATTERNS.test(outputText) ? NO_KEYBOARD_HINT : null;

  const base = { layout: "card" as const, ...shown, elapsed, timerFrom: null, actions, foldable, boxLines, notes, hint, keyboard: false };
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

// An earlier run of a card as a row of its own, for Send's fallback.
export function pastRow(card: RunRow, past: PastRun): RunRow {
  return { runId: past.runId, rev: card.rev, origin: card.origin, command: card.command, cwd: card.cwd, phase: past.phase, output: past.output, sentAt: past.sentAt, terminal: card.terminal, cardId: cardIdOf(card), run: past.run };
}

// An earlier run of a card, ready for describe(). It ended, so nothing about it is live.
export function pastRunView(card: RunRow, past: PastRun): ResolvedRun {
  return { ...pastRow(card, past), terminal: card.terminal === true, cursor: null, lastOutputAt: null, lostAt: null, clockOffset: 0 };
}

// The header's "Run 2 of 3" and where its arrows go. `viewing` indexes `card.past`; null is the
// latest run. `prev` and `next` are what `viewing` becomes, undefined where there is no run.
export function switcher(card: Pick<RunRow, "run" | "past">, viewing: number | null): { label: string; prev: number | null | undefined; next: number | null | undefined } | null {
  const past = card.past ?? [];
  if (past.length === 0) return null;
  const at = viewing ?? past.length;
  const run = at < past.length ? past[at].run : runNumberOf(card);
  return {
    label: `Run ${run} of ${runNumberOf(card)}`,
    prev: at > 0 ? at - 1 : undefined,
    next: at < past.length ? (at + 1 < past.length ? at + 1 : null) : undefined,
  };
}

// "Deletes files and runs as administrator (sudo)"
function warningFor(risks: string[]): string | null {
  if (risks.length === 0) return null;
  const last = risks[risks.length - 1];
  return capitalize(risks.length === 1 ? last : `${risks.slice(0, -1).join(", ")} and ${last}`);
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

// Same format as playwright-pulse: "0.8s", "9.9s", "12s", "1m 05s", "1h 02m", with
// "<0.1s" for the instant ones, where "0.0s" would read as if nothing ran.
export function formatDuration(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 100) return "<0.1s";
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
