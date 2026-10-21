import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { LIMITS, type Limits } from "../shared/limits.ts";
import { cardIdOf, isEnded, runNumberOf, type LiveView, type PastRun, type Phase, type RunRow } from "../shared/row.ts";
import { createScreen, fitLines, jsonBytes, looksBinary, type Screen } from "./screen.ts";
import { pickSpawner, type Proc, type Spawner } from "./proc.ts";
import { shellCommand } from "./shells.ts";

export interface RunsDeps {
  // Append-or-replace this run's card in the timeline (id = cardIdOf(row)). Rejects if the agent isn't loaded.
  publish(agentId: string, row: RunRow): Promise<void>;
  now(): number;
  env: NodeJS.ProcessEnv;
  limits?: Partial<Limits>;
  // "auto" runs commands in a real terminal when this machine can; "off" never does.
  terminal?: "auto" | "off";
}

export interface StartInput {
  agentId: string;
  cwd: string;
  command: string;
  origin: "user" | "claude";
  runId?: string;
  // The card Rerun was pressed on.
  rerunOf?: RunRow;
}

export type TailResult = { state: "unknown" } | { state: "unchanged"; rev: number } | { state: "view"; view: LiveView };

export interface RunRegistry {
  // Idempotent on runId, and on rerunOf while this daemon knows the card. The row is
  // published before the process exists, so a command is never running invisibly.
  start(input: StartInput): Promise<{ runId: string }>;
  stop(runId: string, force: boolean): void;
  // Types a line into a running command's terminal, then Enter. Throws when it can't take typing.
  // Keys as the terminal gets them: "\r" is Enter, "\x7f" Backspace.
  input(runId: string, keys: string): void;
  tail(runId: string, lines: number, since: number | null, waitMs: number): Promise<TailResult>;
  // The row as the daemon sees it now, with up to `lines` lines. Not size-fitted.
  snapshot(runId: string, lines: number): RunRow | null;
  fullText(runId: string): { text: string; complete: boolean } | null;
  // Running first, then newest. For the attach menu.
  recent(limit: number): Array<{ agentId: string; row: RunRow }>;
  // Also takes an earlier run of a card: the card's history records it.
  markSent(runId: string): void;
  // A proposal card. Dropped if a run with that id already exists.
  propose(agentId: string, row: RunRow): Promise<void>;
  dismiss(input: { agentId: string; runId: string; command: string; cwd: string }): Promise<void>;
  // Marks running runs interrupted, publishes them, kills every process group. Finishes inside the cleanup budget.
  shutdown(): Promise<void>;
}

// Everything the registry knows about one run. Only this file reads or writes it.
interface Run {
  readonly id: string;
  readonly agentId: string;
  readonly origin: "user" | "claude";
  readonly command: string;
  readonly cwd: string;
  readonly cardId: string;
  // Its number in the card, from 1.
  readonly run: number;
  past: PastRun[];
  phase: Phase;
  rev: number;
  readonly screen: Screen;
  sentAt: number | null;
  lastOutputAt: number | null;
  // Kept after the command exits, so a Stop can still reach background jobs it left behind.
  proc: Proc | null;
  // Runs in a real terminal (see proc.ts), so it can take typing.
  readonly terminal: boolean;
  capturedBytes: number;
  binary: boolean;
  capStopped: boolean;
  waiters: Set<() => void>;
  timers: NodeJS.Timeout[];
  // Stop's SIGTERM and SIGKILL follow-ups. Not cancelled when the shell exits: a background
  // job ignores the SIGINT and survives the shell, and these are what end it.
  escalation: NodeJS.Timeout[];
}

// One publish queue per card: single flight, trailing coalescing, and a rank that
// never goes backwards, so a late proposal can't overwrite a running row and an
// earlier run can't overwrite a later one.
interface Slot {
  rank: number;
  pending: { row: RunRow; retry: boolean } | null;
  chain: Promise<void> | null;
}

const RANK: Record<Phase["kind"], number> = { proposed: 0, running: 1, ok: 2, failed: 2, stopped: 2, interrupted: 2, dismissed: 2 };
const MAX_SLOTS = 500;

export function createRunRegistry(deps: RunsDeps): RunRegistry {
  const limits: Limits = { ...LIMITS, ...deps.limits };
  const runs = new Map<string, Run>();
  const slots = new Map<string, Slot>();
  // Each card's latest run.
  const cards = new Map<string, string>();
  const timers = new Set<NodeJS.Timeout>();
  let closed = false;

  function after(ms: number, fn: () => void): NodeJS.Timeout {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function cancel(timer: NodeJS.Timeout) {
    clearTimeout(timer);
    timers.delete(timer);
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => after(ms, resolve));

  const spawnerReady = pickSpawner(deps.env, deps.terminal ?? "auto");

  // ---- the one publish path ----

  function publishRow(agentId: string, row: RunRow, retry: boolean): Promise<void> {
    const cardId = cardIdOf(row);
    let slot = slots.get(cardId);
    if (!slot) {
      pruneSlots();
      slot = { rank: -1, pending: null, chain: null };
      slots.set(cardId, slot);
    }
    const rank = runNumberOf(row) * 3 + RANK[row.phase.kind];
    if (rank < slot.rank) return Promise.resolve();
    slot.rank = rank;
    slot.pending = { row, retry };
    if (!slot.chain) slot.chain = drain(agentId, slot);
    return slot.chain;
  }

  async function drain(agentId: string, slot: Slot): Promise<void> {
    let failure: unknown = null;
    while (slot.pending) {
      const { row, retry } = slot.pending;
      slot.pending = null;
      try {
        await attempt(agentId, row, retry);
      } catch (error) {
        failure = error;
      }
    }
    slot.chain = null;
    if (failure) throw failure;
  }

  async function attempt(agentId: string, row: RunRow, retry: boolean): Promise<void> {
    const delays = retry ? limits.publishRetryMs : [];
    for (let i = 0; ; i++) {
      try {
        await deps.publish(agentId, row);
        return;
      } catch (error) {
        if (i >= delays.length || closed) throw error;
        await sleep(delays[i]);
        if (closed) throw error;
      }
    }
  }

  function pruneSlots() {
    if (slots.size < MAX_SLOTS) return;
    for (const [id, slot] of slots) {
      if (!slot.chain && !cards.has(id)) slots.delete(id);
      if (slots.size < MAX_SLOTS / 2) break;
    }
  }

  function rowOf(run: Run, lines: number): RunRow {
    return {
      runId: run.id, rev: run.rev, origin: run.origin, command: run.command, cwd: run.cwd, phase: run.phase, output: run.screen.tail(lines), sentAt: run.sentAt, terminal: run.terminal,
      cardId: run.cardId, run: run.run, ...(run.past.length > 0 ? { past: run.past } : {}),
    };
  }

  // A run as a card's history keeps it. A run the daemon lost while it ran ended then.
  function pastOf(row: RunRow): PastRun | null {
    const phase = row.phase.kind === "running" ? { kind: "interrupted" as const, startedAt: row.phase.startedAt, endedAt: deps.now() } : row.phase;
    if (!isEnded(phase)) return null;
    return { runId: row.runId, run: runNumberOf(row), phase, output: { lines: fitLines(row.output.lines, limits.pastRunOutputBytes), total: row.output.total }, sentAt: row.sentAt };
  }

  const isLatest = (run: Run) => cards.get(run.cardId) === run.id;

  function fitRow(row: RunRow): RunRow {
    const rest = jsonBytes({ ...row, output: { lines: [], total: row.output.total } });
    const budget = Math.min(limits.rowOutputBytes, limits.rowTotalBytes - rest);
    return { ...row, output: { lines: fitLines(row.output.lines, budget), total: row.output.total } };
  }

  function publishRun(run: Run, retry: boolean): Promise<void> {
    return publishRow(run.agentId, fitRow(rowOf(run, limits.scrollbackLines)), retry);
  }

  // ---- the state machine ----

  function bump(run: Run) {
    run.rev++;
    wake(run);
  }

  function wake(run: Run) {
    for (const waiter of [...run.waiters]) waiter();
  }

  function transition(run: Run, next: Phase) {
    run.phase = next;
    for (const timer of run.timers) cancel(timer);
    run.timers = [];
    bump(run);
    publishRun(run, true).catch(() => undefined);
  }

  function settle(run: Run, code: number | null, signal: NodeJS.Signals | null) {
    if (run.phase.kind !== "running") return;
    const clock = { startedAt: run.phase.startedAt, endedAt: deps.now() };
    const next: Phase =
      run.phase.stopRequestedAt !== null ? { kind: "stopped", ...clock, exitCode: code, signal }
      : code === 0 ? { kind: "ok", ...clock }
      : { kind: "failed", ...clock, exitCode: code, signal, message: null };
    transition(run, next);
    evict();
  }

  function failToStart(run: Run, message: string) {
    if (run.phase.kind !== "running") return;
    transition(run, { kind: "failed", startedAt: run.phase.startedAt, endedAt: deps.now(), exitCode: null, signal: null, message });
    evict();
  }

  function ingest(run: Run, text: string) {
    if (!text) return;
    run.lastOutputAt = deps.now();
    const bytes = Buffer.byteLength(text);
    run.capturedBytes += bytes;
    if (run.capStopped) return;
    if (run.capturedBytes > limits.captureBytes) {
      run.capStopped = true;
      run.screen.note(`[output capture stopped after ${Math.round(limits.captureBytes / 1024 / 1024)} MiB]`);
      bump(run);
      return;
    }
    if (looksBinary(text)) {
      if (!run.binary) {
        run.binary = true;
        run.screen.note("[binary output hidden]");
        bump(run);
      }
      return;
    }
    run.screen.write(text);
    bump(run);
  }

  function launch(run: Run, spawner: Spawner) {
    try {
      run.proc = spawner.start(
        { ...shellCommand(deps.env, run.command), cwd: run.cwd, env: commandEnv(deps.env, run.cwd, spawner.terminal), flushMs: limits.exitFlushMs },
        {
          data: (text) => ingest(run, text),
          exit: (code, signal) => settle(run, code, signal),
          error: (problem) => failToStart(run, `Couldn't start: ${problem}`),
        },
      );
    } catch (error) {
      failToStart(run, `Couldn't start a shell: ${message(error)}`);
    }
  }

  function evict() {
    const ended = [...runs.values()].filter((run) => run.phase.kind !== "running");
    if (ended.length <= limits.keepFinished) return;
    ended.sort((a, b) => endedAt(a) - endedAt(b));
    for (const run of ended.slice(0, ended.length - limits.keepFinished)) {
      runs.delete(run.id);
      if (isLatest(run)) cards.delete(run.cardId);
    }
  }

  function liveCount(): number {
    let n = 0;
    for (const run of runs.values()) if (run.phase.kind === "running") n++;
    return n;
  }

  function park(run: Run, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        cancel(timer);
        run.waiters.delete(done);
        resolve();
      };
      const timer = after(ms, done);
      run.waiters.add(done);
    });
  }

  function viewOf(run: Run, lines: number): LiveView {
    const tail = run.screen.tail(lines);
    return {
      rev: run.rev,
      phase: run.phase,
      output: { lines: fitLines(tail.lines, limits.liveReplyBytes), total: tail.total },
      cursor: tail.cursor,
      sentAt: run.sentAt,
      lastOutputAt: run.lastOutputAt,
      serverNow: deps.now(),
    };
  }

  return {
    async start(input) {
      const id = input.runId ?? newRunId();
      if (runs.has(id)) return { runId: id };
      const { rerunOf } = input;
      const cardId = rerunOf ? cardIdOf(rerunOf) : id;
      const before = cards.get(cardId);
      // A second Rerun of the same card (double click, another window) gets the run the first one started.
      if (rerunOf && before !== undefined && before !== rerunOf.runId) return { runId: before };
      const previous = rerunOf ? runs.get(rerunOf.runId) : undefined;
      if (previous?.phase.kind === "running") throw new Error("This command is still running. Stop it first.");
      if (Buffer.byteLength(input.command) > limits.commandBytes) throw new Error("That command is too long to run.");
      if (liveCount() >= limits.maxLive) throw new Error(`${limits.maxLive} commands are already running. Stop one first.`);
      // Claimed before the first await, so two reruns of one card can't both start.
      cards.set(cardId, id);
      const release = () => {
        if (cards.get(cardId) !== id) return;
        if (before === undefined) cards.delete(cardId);
        else cards.set(cardId, before);
      };
      const spawner = await spawnerReady;
      if (runs.has(id)) return { runId: id };
      const last = rerunOf && pastOf(previous ? rowOf(previous, limits.scrollbackLines) : rerunOf);
      const past = rerunOf ? [...(previous?.past ?? rerunOf.past ?? []), ...(last ? [last] : [])].slice(-limits.pastRuns) : [];
      const startedAt = deps.now();
      const run: Run = {
        id, agentId: input.agentId, origin: input.origin, command: input.command, cwd: input.cwd,
        cardId, run: rerunOf ? runNumberOf(rerunOf) + 1 : 1, past,
        phase: { kind: "running", startedAt, stopRequestedAt: null },
        rev: 0, screen: createScreen({ maxLines: limits.linesKept, maxLineChars: limits.lineChars }),
        sentAt: null, lastOutputAt: null, proc: null, terminal: spawner.terminal, capturedBytes: 0, binary: false, capStopped: false,
        waiters: new Set(), timers: [], escalation: [],
      };
      runs.set(id, run);
      const problem = await folderProblem(input.cwd);
      if (problem) run.phase = { kind: "failed", startedAt, endedAt: deps.now(), exitCode: null, signal: null, message: problem };
      try {
        await publishRun(run, false);
      } catch (error) {
        runs.delete(id);
        release();
        throw error;
      }
      if (run.phase.kind === "running") launch(run, spawner);
      evict();
      return { runId: id };
    },

    stop(runId, force) {
      const run = runs.get(runId);
      const proc = run?.proc;
      if (!run || !proc || run.phase.kind !== "running") return;
      const again = run.phase.stopRequestedAt !== null;
      if (!again) {
        run.phase = { ...run.phase, stopRequestedAt: deps.now() };
        bump(run);
      }
      if (force || again) {
        proc.kill("SIGKILL");
        return;
      }
      proc.interrupt();
      run.escalation = [
        after(limits.stopToTermMs, () => proc.kill("SIGTERM")),
        after(limits.stopToKillMs, () => {
          proc.kill("SIGKILL");
          run.escalation = [];
        }),
      ];
    },

    input(runId, keys) {
      const run = runs.get(runId);
      if (!run || run.phase.kind !== "running") throw new Error("This command has already ended.");
      if (!run.terminal || !run.proc) throw new Error("This command can't take typing.");
      run.proc.write(keys);
    },

    async tail(runId, lines, since, waitMs) {
      const run = runs.get(runId);
      if (!run) return { state: "unknown" };
      if (since === run.rev && waitMs > 0 && run.phase.kind === "running") {
        await park(run, waitMs);
        if (run.rev !== since) await sleep(limits.tailCoalesceMs);
      }
      if (since === run.rev) return { state: "unchanged", rev: run.rev };
      return { state: "view", view: viewOf(run, lines) };
    },

    snapshot(runId, lines) {
      const run = runs.get(runId);
      return run ? rowOf(run, lines) : null;
    },

    fullText(runId) {
      const run = runs.get(runId);
      if (!run) return null;
      return { text: run.screen.text(), complete: run.screen.dropped === 0 && !run.binary && !run.capStopped };
    },

    recent(limit) {
      return [...runs.values()]
        .sort((a, b) => Number(b.phase.kind === "running") - Number(a.phase.kind === "running") || startedAt(b) - startedAt(a))
        .slice(0, limit)
        .map((run) => ({ agentId: run.agentId, row: rowOf(run, limits.scrollbackLines) }));
    },

    markSent(runId) {
      const at = deps.now();
      const run = runs.get(runId);
      if (run) {
        run.sentAt = at;
        bump(run);
      }
      // Only a card's latest run publishes; an earlier one is recorded in the latest's history.
      if (run && isLatest(run)) return void publishRun(run, true).catch(() => undefined);
      const latest = [...runs.values()].find((r) => isLatest(r) && r.past.some((p) => p.runId === runId));
      if (!latest) return;
      latest.past = latest.past.map((p) => (p.runId === runId ? { ...p, sentAt: at } : p));
      bump(latest);
      publishRun(latest, true).catch(() => undefined);
    },

    propose(agentId, row) {
      if (runs.has(row.runId)) return Promise.resolve();
      return publishRow(agentId, row, true);
    },

    dismiss({ agentId, runId, command, cwd }) {
      if (runs.has(runId)) return Promise.resolve();
      return publishRow(agentId, { runId, rev: 1, origin: "claude", command, cwd, phase: { kind: "dismissed" }, output: { lines: [], total: 0 }, sentAt: null }, true);
    },

    async shutdown() {
      closed = true;
      const publishes: Promise<void>[] = [];
      const groups: Run[] = [];
      for (const run of runs.values()) {
        for (const timer of [...run.timers, ...run.escalation]) cancel(timer);
        run.timers = [];
        if (run.escalation.length > 0) run.proc?.kill("SIGKILL");
        run.escalation = [];
        if (run.phase.kind !== "running") continue;
        run.phase = { kind: "interrupted", startedAt: run.phase.startedAt, endedAt: deps.now() };
        bump(run);
        publishes.push(publishRun(run, false).catch(() => undefined));
        groups.push(run);
        run.proc?.kill("SIGTERM");
      }
      const all = Promise.all(publishes).then(() => undefined);
      await Promise.race([all, rawDelay(limits.shutdownPublishMs)]);
      for (const run of groups) run.proc?.kill("SIGKILL");
      await Promise.race([all, rawDelay(limits.shutdownKillWaitMs)]);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

function endedAt(run: Run): number {
  return "endedAt" in run.phase ? run.phase.endedAt : 0;
}

function startedAt(run: Run): number {
  return "startedAt" in run.phase ? run.phase.startedAt : 0;
}

function rawDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function newRunId(): string {
  return randomBytes(6).toString("hex");
}

async function folderProblem(cwd: string): Promise<string | null> {
  try {
    const info = await stat(cwd);
    return info.isDirectory() ? null : `Not a folder: ${cwd}`;
  } catch {
    return `Folder not found: ${cwd}`;
  }
}

const STRIP = ["PASEO_NODE_ENV", "PASEO_DESKTOP_MANAGED", "PASEO_SUPERVISED", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "ESBUILD_BINARY_PATH", "BASH_ENV", "NO_COLOR"];

// The user's environment minus what Paseo's worker put in, plus what makes tools
// print color to a pipe. FORCE_COLOR=1 means 16 colors on purpose: the row
// re-themes exactly those 16; 256-color and truecolor would bypass the theme.
export function commandEnv(base: NodeJS.ProcessEnv, cwd: string, terminal = false): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of STRIP) delete env[key];
  Object.assign(env, {
    PWD: cwd,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
    CARGO_TERM_COLOR: "always",
    PY_COLORS: "1",
    PYTHONUNBUFFERED: "1",
    TERM: "xterm-256color",
    COLUMNS: "100",
    // npm prints its "new version available" banner when it thinks a person is watching.
    npm_config_update_notifier: "false",
  });
  // A terminal makes git, man and the like open a pager and wait for a keypress.
  if (terminal) Object.assign(env, { PAGER: "cat", GIT_PAGER: "cat" });
  if (env.GIT_CONFIG_COUNT === undefined) {
    Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "color.ui", GIT_CONFIG_VALUE_0: "always" });
  }
  return env;
}
