import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { LIMITS, type Limits } from "../shared/limits.ts";
import type { LiveView, Phase, RunRow } from "../shared/row.ts";
import { createScreen, fitLines, jsonBytes, looksBinary, type Screen } from "./screen.ts";

export interface RunsDeps {
  // Append-or-replace this run's timeline row (id = runId). Rejects if the agent isn't loaded.
  publish(agentId: string, row: RunRow): Promise<void>;
  now(): number;
  env: NodeJS.ProcessEnv;
  limits?: Partial<Limits>;
}

export interface StartInput {
  agentId: string;
  cwd: string;
  command: string;
  origin: "user" | "claude";
  runId?: string;
}

export type TailResult = { state: "unknown" } | { state: "unchanged"; rev: number } | { state: "view"; view: LiveView };

export interface RunRegistry {
  // Idempotent on runId. The row is published before the process exists, so a command is never running invisibly.
  start(input: StartInput): Promise<{ runId: string }>;
  stop(runId: string, force: boolean): void;
  tail(runId: string, lines: number, since: number | null, waitMs: number): Promise<TailResult>;
  // The row as the daemon sees it now, with up to `lines` lines. Not size-fitted.
  snapshot(runId: string, lines: number): RunRow | null;
  fullText(runId: string): { text: string; complete: boolean } | null;
  // Running first, then newest. For the attach menu.
  recent(limit: number): RunRow[];
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
  phase: Phase;
  rev: number;
  readonly screen: Screen;
  sentAt: number | null;
  lastOutputAt: number | null;
  child: ChildProcess | null;
  // The process group (= the child's pid, since it is a session leader). Kept after exit so
  // a Stop can still reach background jobs the shell left behind.
  pgid: number | null;
  capturedBytes: number;
  binary: boolean;
  capStopped: boolean;
  waiters: Set<() => void>;
  timers: NodeJS.Timeout[];
  // Stop's SIGTERM and SIGKILL follow-ups. Not cancelled when the shell exits: a background
  // job ignores the SIGINT and survives the shell, and these are what end it.
  escalation: NodeJS.Timeout[];
}

// One publish queue per row id: single flight, trailing coalescing, and a rank
// that never goes backwards, so a late proposal can't overwrite a running row.
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

  // ---- the one publish path ----

  function publishRow(agentId: string, row: RunRow, retry: boolean): Promise<void> {
    let slot = slots.get(row.runId);
    if (!slot) {
      pruneSlots();
      slot = { rank: -1, pending: null, chain: null };
      slots.set(row.runId, slot);
    }
    const rank = RANK[row.phase.kind];
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
      if (!slot.chain && !runs.has(id)) slots.delete(id);
      if (slots.size < MAX_SLOTS / 2) break;
    }
  }

  function rowOf(run: Run, lines: number): RunRow {
    return { runId: run.id, rev: run.rev, origin: run.origin, command: run.command, cwd: run.cwd, phase: run.phase, output: run.screen.tail(lines), sentAt: run.sentAt };
  }

  function fitRow(row: RunRow): RunRow {
    const rest = jsonBytes({ ...row, output: { lines: [], total: row.output.total } });
    const budget = Math.min(limits.rowOutputBytes, limits.rowTotalBytes - rest);
    return { ...row, output: { lines: fitLines(row.output.lines, budget), total: row.output.total } };
  }

  function publishRun(run: Run, retry: boolean): Promise<void> {
    return publishRow(run.agentId, fitRow(rowOf(run, limits.expandedLines)), retry);
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
    run.child = null;
    transition(run, next);
    evict();
  }

  function failToStart(run: Run, message: string) {
    if (run.phase.kind !== "running") return;
    run.child = null;
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

  function launch(run: Run) {
    let child: ChildProcess;
    try {
      child = spawnShell(run.command, run.cwd, deps.env);
    } catch (error) {
      failToStart(run, `Couldn't start a shell: ${message(error)}`);
      return;
    }
    run.child = child;
    run.pgid = child.pid ?? null;
    const out = new StringDecoder("utf8");
    const err = new StringDecoder("utf8");
    child.stdout?.on("data", (chunk: Buffer) => ingest(run, out.write(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => ingest(run, err.write(chunk)));
    child.on("error", (error) => failToStart(run, `Couldn't start: ${message(error)}`));
    child.on("exit", (code, signal) => {
      // A background job can hold the pipe open after the shell exits: flush briefly, then let go.
      run.timers.push(after(limits.exitFlushMs, () => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        settle(run, code, signal);
      }));
    });
    child.on("close", (code, signal) => {
      ingest(run, out.end() + err.end());
      settle(run, code, signal);
    });
  }

  function evict() {
    const ended = [...runs.values()].filter((run) => run.phase.kind !== "running");
    if (ended.length <= limits.keepFinished) return;
    ended.sort((a, b) => endedAt(a) - endedAt(b));
    for (const run of ended.slice(0, ended.length - limits.keepFinished)) runs.delete(run.id);
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
      sentAt: run.sentAt,
      lastOutputAt: run.lastOutputAt,
      serverNow: deps.now(),
    };
  }

  return {
    async start(input) {
      const id = input.runId ?? newRunId();
      if (runs.has(id)) return { runId: id };
      if (process.platform === "win32") throw new Error("Shell Yeah doesn't support Windows yet.");
      if (Buffer.byteLength(input.command) > limits.commandBytes) throw new Error("That command is too long to run.");
      if (liveCount() >= limits.maxLive) throw new Error(`${limits.maxLive} commands are already running. Stop one first.`);
      const startedAt = deps.now();
      const run: Run = {
        id, agentId: input.agentId, origin: input.origin, command: input.command, cwd: input.cwd,
        phase: { kind: "running", startedAt, stopRequestedAt: null },
        rev: 0, screen: createScreen({ maxLines: limits.linesKept, maxLineChars: limits.lineChars }),
        sentAt: null, lastOutputAt: null, child: null, pgid: null, capturedBytes: 0, binary: false, capStopped: false,
        waiters: new Set(), timers: [], escalation: [],
      };
      runs.set(id, run);
      const problem = await folderProblem(input.cwd);
      if (problem) run.phase = { kind: "failed", startedAt, endedAt: deps.now(), exitCode: null, signal: null, message: problem };
      try {
        await publishRun(run, false);
      } catch (error) {
        runs.delete(id);
        throw error;
      }
      if (run.phase.kind === "running") launch(run);
      evict();
      return { runId: id };
    },

    stop(runId, force) {
      const run = runs.get(runId);
      if (!run || run.phase.kind !== "running" || run.pgid === null) return;
      const pgid = run.pgid;
      if (force || run.phase.stopRequestedAt !== null) {
        signalGroup(pgid, "SIGKILL");
        return;
      }
      run.phase = { ...run.phase, stopRequestedAt: deps.now() };
      bump(run);
      signalGroup(pgid, "SIGINT");
      run.escalation = [
        after(limits.stopToTermMs, () => signalGroup(pgid, "SIGTERM")),
        after(limits.stopToKillMs, () => {
          signalGroup(pgid, "SIGKILL");
          run.escalation = [];
        }),
      ];
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
        .map((run) => rowOf(run, limits.expandedLines));
    },

    markSent(runId) {
      const run = runs.get(runId);
      if (!run) return;
      run.sentAt = deps.now();
      bump(run);
      publishRun(run, true).catch(() => undefined);
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
      const groups: number[] = [];
      for (const run of runs.values()) {
        for (const timer of [...run.timers, ...run.escalation]) cancel(timer);
        run.timers = [];
        if (run.escalation.length > 0 && run.pgid !== null) signalGroup(run.pgid, "SIGKILL");
        run.escalation = [];
        if (run.phase.kind !== "running") continue;
        run.phase = { kind: "interrupted", startedAt: run.phase.startedAt, endedAt: deps.now() };
        bump(run);
        publishes.push(publishRun(run, false).catch(() => undefined));
        if (run.pgid !== null) {
          groups.push(run.pgid);
          signalGroup(run.pgid, "SIGTERM");
        }
      }
      const all = Promise.all(publishes).then(() => undefined);
      await Promise.race([all, rawDelay(limits.shutdownPublishMs)]);
      for (const pgid of groups) signalGroup(pgid, "SIGKILL");
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

const SHELLS = new Set(["zsh", "bash", "sh", "dash", "ksh", "fish"]);

export function pickShell(preferred: string | undefined): string {
  const candidates = [preferred && SHELLS.has(basename(preferred)) ? preferred : null, "/bin/bash", "/bin/sh"];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return "/bin/sh";
}

// `/bin/sh -c 'exec "$0" "$@" 2>&1' $SHELL -c <command>`: one pipe for both streams
// so their interleaving is the kernel's, and the command text is never rewritten.
// detached = its own session and process group, no controlling terminal.
export function spawnShell(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  return spawn("/bin/sh", ["-c", 'exec "$0" "$@" 2>&1', pickShell(env.SHELL), "-c", command], {
    cwd,
    env: commandEnv(env, cwd),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const STRIP = ["PASEO_NODE_ENV", "PASEO_DESKTOP_MANAGED", "PASEO_SUPERVISED", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "ESBUILD_BINARY_PATH", "BASH_ENV", "NO_COLOR"];

// The user's environment minus what Paseo's worker put in, plus what makes tools
// print color to a pipe. FORCE_COLOR=1 means 16 colors on purpose: the row
// re-themes exactly those 16; 256-color and truecolor would bypass the theme.
export function commandEnv(base: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv {
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
  if (env.GIT_CONFIG_COUNT === undefined) {
    Object.assign(env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "color.ui", GIT_CONFIG_VALUE_0: "always" });
  }
  return env;
}

// Signals the whole group, even after its leader (the shell) has exited, so background jobs
// it left behind are reached too. An empty group is ESRCH, which is fine.
export function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is already gone.
  }
}
