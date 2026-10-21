import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Limits } from "../shared/limits.ts";
import { cardIdOf, lineText, type RunRow } from "../shared/row.ts";
import { commandEnv, createRunRegistry, type RunRegistry } from "./runs.ts";
import { jsonBytes } from "./screen.ts";
import { loadPty } from "./proc.ts";

const AGENT = "agent-1";
const dir = () => mkdtempSync(join(tmpdir(), "shell-yeah-"));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noTerminal = loadPty() === null;
// The commands below are POSIX shell; Windows runs PowerShell and gets its own tests at the end.
const WINDOWS = process.platform === "win32";
const posixTest = WINDOWS ? test.skip : test;
const windowsTest = WINDOWS ? test : test.skip;

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting");
    await delay(15);
  }
}

function harness(opts: { limits?: Partial<Limits>; publish?: (row: RunRow) => Promise<void> | void; env?: NodeJS.ProcessEnv; terminal?: "auto" | "off" } = {}) {
  const published: RunRow[] = [];
  const registry = createRunRegistry({
    publish: async (_agentId, row) => {
      await opts.publish?.(row);
      published.push(row);
    },
    now: Date.now,
    env: opts.env ?? process.env,
    limits: opts.limits,
    terminal: opts.terminal,
  });
  const rows = (id: string) => published.filter((row) => row.runId === id);
  // What the card shows: the last row published under its timeline id.
  const card = (id: string) => published.filter((row) => cardIdOf(row) === id).at(-1)!;
  const phases = (id: string) => rows(id).map((row) => row.phase.kind);
  const text = (id: string) => registry.snapshot(id, 400)!.output.lines.map(lineText);
  return { registry, published, rows, card, phases, text };
}

async function run(registry: RunRegistry, command: string, cwd = dir(), extra: { runId?: string; origin?: "user" | "claude" } = {}) {
  const { runId } = await registry.start({ agentId: AGENT, cwd, command, origin: extra.origin ?? "user", runId: extra.runId });
  return runId;
}

async function rerun(registry: RunRegistry, of: RunRow, extra: { runId?: string } = {}) {
  const { runId } = await registry.start({ agentId: AGENT, cwd: of.cwd, command: of.command, origin: of.origin, runId: extra.runId, rerunOf: of });
  return runId;
}

async function ended(registry: RunRegistry, runId: string): Promise<RunRow> {
  await until(() => registry.snapshot(runId, 1)?.phase.kind !== "running");
  return registry.snapshot(runId, 400)!;
}

function pidGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

// The pid a `cmd & echo $!` command printed on its first line.
async function printedPid(h: ReturnType<typeof harness>, id: string): Promise<number> {
  await until(() => h.text(id).length > 0);
  return Number(h.text(id)[0]);
}

posixTest("without a terminal, exit codes and signals map to ok, failed and stopped", { timeout: 15_000 }, async () => {
  const h = harness({ terminal: "off" });
  const ok = await ended(h.registry, await run(h.registry, "exit 0"));
  assert.equal(ok.phase.kind, "ok");
  const failed = await ended(h.registry, await run(h.registry, "exit 3"));
  assert.deepEqual([failed.phase.kind, (failed.phase as { exitCode: number }).exitCode], ["failed", 3]);
  const killed = await ended(h.registry, await run(h.registry, "kill -9 $$"));
  assert.deepEqual([killed.phase.kind, (killed.phase as { signal: string }).signal], ["failed", "SIGKILL"]);
  const sleeping = await run(h.registry, "sleep 30");
  await delay(50);
  h.registry.stop(sleeping, false);
  const stopped = await ended(h.registry, sleeping);
  assert.equal(stopped.phase.kind, "stopped");
  await h.registry.shutdown();
});

posixTest("stdout and stderr arrive in the order the command wrote them", async () => {
  const h = harness();
  const id = await run(h.registry, "echo a; echo b >&2; echo c");
  await ended(h.registry, id);
  assert.deepEqual(h.text(id), ["a", "b", "c"]);
  await h.registry.shutdown();
});

posixTest("commands run in the given folder, with color forced and Paseo's worker variables gone", { timeout: 15_000 }, async () => {
  const cwd = dir();
  const h = harness({ env: { ...process.env, PASEO_NODE_ENV: "x", ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" } });
  const env = await ended(h.registry, await run(h.registry, "printenv FORCE_COLOR PASEO_NODE_ENV ELECTRON_RUN_AS_NODE NO_COLOR; echo end", cwd));
  assert.deepEqual(h.text(env.runId), ["1", "end"]);
  const where = await ended(h.registry, await run(h.registry, "pwd -P", cwd));
  assert.equal(h.text(where.runId)[0], realpathSync(cwd));
  await h.registry.shutdown();
});

posixTest("without a terminal, a command gets no keyboard", { timeout: 15_000 }, async () => {
  const cwd = dir();
  const h = harness({ terminal: "off" });
  const cat = await ended(h.registry, await run(h.registry, "cat; echo eof", cwd));
  assert.deepEqual([cat.phase.kind, h.text(cat.runId)], ["ok", ["eof"]]);
  const tty = await ended(h.registry, await run(h.registry, "tty", cwd));
  assert.match(h.text(tty.runId)[0], /not a tty/);
  await h.registry.shutdown();
});

posixTest("commandEnv keeps the user's PATH and git color, and does not override a git config the user set", () => {
  const env = commandEnv({ PATH: "/usr/bin", GIT_CONFIG_COUNT: "2" }, "/w");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.PWD, "/w");
  assert.equal(commandEnv({}, "/w").GIT_CONFIG_VALUE_0, "always");
});

posixTest("a missing folder is a failed row with a plain reason, published once, and nothing runs", async () => {
  const h = harness();
  const id = await run(h.registry, "echo hi", "/nonexistent/folder/for/shell-yeah");
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "failed");
  assert.equal((row.phase as { message: string }).message, "Folder not found: /nonexistent/folder/for/shell-yeah");
  assert.deepEqual(h.phases(id), ["failed"]);
  await h.registry.shutdown();
});

posixTest("stop kills the whole process tree, including a background job the shell left behind, and the force path kills one that ignores signals", { timeout: 15_000 }, async () => {
  // A non-interactive shell makes `&` jobs ignore SIGINT, so Stop's follow-up SIGTERM is what ends them.
  const h = harness({ limits: { stopToTermMs: 300, stopToKillMs: 600 } });
  const polite = await run(h.registry, "sleep 60 & echo $!; wait");
  const politePid = await printedPid(h, polite);
  h.registry.stop(polite, false);
  await until(() => pidGone(politePid), 2_000);
  assert.equal((await ended(h.registry, polite)).phase.kind, "stopped");

  const stubborn = await run(h.registry, 'trap "" INT TERM; sleep 60 & echo $!; wait');
  const stubbornPid = await printedPid(h, stubborn);
  h.registry.stop(stubborn, false);
  await delay(100);
  assert.equal(pidGone(stubbornPid), false, "SIGINT alone does not kill it");
  h.registry.stop(stubborn, true);
  await until(() => pidGone(stubbornPid), 2_000);
  assert.equal((await ended(h.registry, stubborn)).phase.kind, "stopped");
  assert.equal(pidGone(process.pid), false, "our own process group is untouched");
  await h.registry.shutdown();
});

posixTest("without a terminal, a command that traps SIGINT and SIGTERM is killed by the escalation timer", { timeout: 15_000 }, async () => {
  const h = harness({ terminal: "off", limits: { stopToTermMs: 50, stopToKillMs: 150 } });
  const id = await run(h.registry, 'trap "" INT TERM; sleep 60');
  await delay(100);
  h.registry.stop(id, false);
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "stopped");
  assert.equal((row.phase as { signal: string }).signal, "SIGKILL");
  await h.registry.shutdown();
});

posixTest("the row is published at start and at the end, never while output streams, and stays under the byte cap", { timeout: 20_000 }, async () => {
  const h = harness();
  const id = await run(h.registry, "for i in $(seq 1 10000); do printf '\\033[1;31m%s\\033[0m \\033[32mok\\033[0m \"quoted\" é🎉\\n' \"line $i\"; done");
  const row = await ended(h.registry, id);
  await until(() => h.phases(id).length === 2);
  assert.deepEqual(h.phases(id), ["running", "ok"]);
  assert.equal(row.output.total, 10_000);
  const final = h.rows(id)[1];
  assert.ok(jsonBytes(final) <= 60 * 1024, `row is ${jsonBytes(final)} bytes`);
  assert.ok(final.output.lines.length > 0);
  assert.equal(final.output.total, 10_000);
  await h.registry.shutdown();
});

posixTest("property: random output never produces a row over 64 KiB of UTF-8 JSON", { timeout: 30_000 }, async () => {
  const h = harness();
  const alphabet = ["a", "é", "🎉", '"', "\\", "\t", "\x1b[31m", "\x1b[0m", "\r", "\x01", " ", "z", " "];
  let seed = 1234;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cwd = dir();
  for (let round = 0; round < 4; round++) {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      const length = random() < 0.1 ? 10_000 : Math.floor(random() * 200);
      let text = "";
      while (text.length < length) text += alphabet[Math.floor(random() * alphabet.length)];
      lines.push(text);
    }
    const file = join(cwd, `random-${round}.txt`);
    writeFileSync(file, lines.join("\n") + "\n");
    const id = await run(h.registry, `cat ${JSON.stringify(file)}`, cwd);
    await ended(h.registry, id);
    await until(() => h.phases(id).length === 2);
  }
  for (const row of h.published) assert.ok(jsonBytes(row) < 64 * 1024, `${row.runId} is ${jsonBytes(row)} bytes`);
  await h.registry.shutdown();
});

posixTest("a failing publish is retried; a start whose first publish fails runs nothing", { timeout: 15_000 }, async () => {
  let failures = 2;
  const h = harness({
    limits: { publishRetryMs: [10, 20, 30] },
    publish: (row) => {
      if (row.phase.kind === "ok" && failures-- > 0) throw new Error("flaky");
    },
  });
  const id = await run(h.registry, "true");
  await ended(h.registry, id);
  await until(() => h.phases(id).length === 2);
  assert.deepEqual(h.phases(id), ["running", "ok"]);

  const cwd = dir();
  const gone = harness({ publish: () => { throw new Error("Unknown agent"); } });
  await assert.rejects(gone.registry.start({ agentId: "nope", cwd, command: "touch ran.marker", origin: "user", runId: "abcdef123456" }), /Unknown agent/);
  await delay(300);
  assert.equal(existsSync(join(cwd, "ran.marker")), false);
  assert.equal(gone.registry.snapshot("abcdef123456", 1), null);
  await h.registry.shutdown();
  await gone.registry.shutdown();
});

posixTest("starting the same run id twice spawns once; ending twice publishes once with the first outcome", { timeout: 15_000 }, async () => {
  const h = harness();
  const cwd = dir();
  const input = { agentId: AGENT, cwd, command: "echo once >> count.txt", origin: "user" as const, runId: "same-run-000001" };
  await Promise.all([h.registry.start(input), h.registry.start(input)]);
  await ended(h.registry, input.runId);
  await delay(100);
  assert.equal(h.rows(input.runId).length, 2);
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(join(cwd, "count.txt"), "utf8"), "once\n");
  await h.registry.shutdown();
  assert.deepEqual(h.phases(input.runId), ["running", "ok"], "shutdown does not re-publish an ended run");
});

posixTest("shutdown marks running runs interrupted, publishes them, and leaves no process group, inside 1.5 s", { timeout: 15_000 }, async () => {
  const h = harness();
  const id = await run(h.registry, 'trap "" INT TERM; sleep 60 & echo $!; wait');
  const pid = await printedPid(h, id);
  const started = Date.now();
  await h.registry.shutdown();
  const took = Date.now() - started;
  assert.ok(took < 1_500, `shutdown took ${took} ms`);
  assert.equal(h.phases(id).at(-1), "interrupted");
  await until(() => pidGone(pid), 500);
  assert.equal(h.registry.snapshot(id, 1)!.phase.kind, "interrupted");
});

posixTest("shutdown still returns inside the budget when the daemon never answers the publish", { timeout: 15_000 }, async () => {
  let calls = 0;
  const h = harness({ publish: () => (++calls > 1 ? new Promise<void>(() => undefined) : undefined) });
  const id = await run(h.registry, "sleep 60 & echo $!; wait");
  const pid = await printedPid(h, id);
  const started = Date.now();
  await h.registry.shutdown();
  assert.ok(Date.now() - started < 1_500);
  await until(() => pidGone(pid), 500);
});

posixTest("binary output is hidden behind one line; a flood stops being captured while the command keeps running", { timeout: 15_000 }, async () => {
  const h = harness({ limits: { captureBytes: 1024 * 1024 } });
  const binary = await ended(h.registry, await run(h.registry, "head -c 4096 /dev/urandom; echo text-after"));
  assert.ok(h.text(binary.runId).includes("[binary output hidden]"));
  assert.equal(h.registry.fullText(binary.runId)!.complete, false);
  const flood = await ended(h.registry, await run(h.registry, "yes | head -c 3000000; echo after-cap"));
  assert.equal(flood.phase.kind, "ok");
  assert.match(h.text(flood.runId).at(-1)!, /capture stopped/);
  assert.equal(h.registry.fullText(flood.runId)!.complete, false);
  await h.registry.shutdown();
});

posixTest("only so many commands run at once", async () => {
  const h = harness({ limits: { maxLive: 2 } });
  await run(h.registry, "sleep 30");
  await run(h.registry, "sleep 30");
  await assert.rejects(run(h.registry, "sleep 30"), /2 commands are already running/);
  await h.registry.shutdown();
});

posixTest("tail: unknown for an unseen run, unchanged after the wait, wakes on a burst and on the end", { timeout: 15_000 }, async () => {
  // A wider coalescing window than the default, so a slow machine still delivers the burst in one reply.
  const h = harness({ limits: { tailCoalesceMs: 150 } });
  assert.deepEqual(await h.registry.tail("never-seen-0001", 10, null, 0), { state: "unknown" });
  const id = await run(h.registry, "sleep 0.3; for i in 1 2 3; do echo $i; sleep 0.01; done; sleep 0.6");
  const first = await h.registry.tail(id, 10, null, 0);
  assert.equal(first.state, "view");
  const rev = (first as { view: { rev: number } }).view.rev;
  const quiet = await h.registry.tail(id, 10, rev, 100);
  assert.deepEqual(quiet, { state: "unchanged", rev });
  const woke = await h.registry.tail(id, 10, rev, 1_500);
  assert.equal(woke.state, "view");
  const view = (woke as { view: { output: { lines: unknown[] }; phase: { kind: string } } }).view;
  assert.deepEqual(view.output.lines, ["1", "2", "3"], "a burst 10 ms apart arrives as one reply");
  assert.equal(view.phase.kind, "running");
  const before = Date.now();
  const end = await h.registry.tail(id, 10, (woke as { view: { rev: number } }).view.rev, 1_500);
  assert.equal(end.state, "view");
  assert.equal((end as { view: { phase: { kind: string } } }).view.phase.kind, "ok");
  assert.ok(Date.now() - before < 1_000, "the parked poll woke when the command ended");
  await h.registry.shutdown();
});

posixTest("markSent publishes the row again with the time; recent lists running runs first", { timeout: 15_000 }, async () => {
  const h = harness();
  const done = await ended(h.registry, await run(h.registry, "true"));
  const live = await run(h.registry, "sleep 30");
  h.registry.markSent(done.runId);
  await until(() => h.rows(done.runId).some((row) => row.sentAt !== null));
  assert.deepEqual(h.registry.recent(5).map(({ row }) => row.runId), [live, done.runId]);
  await h.registry.shutdown();
});

posixTest("proposals and dismissals go through the same publish path, and a stale proposal never overwrites a later state", async () => {
  const h = harness();
  const card = (runId: string): RunRow => ({ runId, rev: 0, origin: "claude", command: "gh auth login", cwd: "/w", phase: { kind: "proposed" }, output: { lines: [], total: 0 }, sentAt: null });
  await h.registry.propose(AGENT, card("p-aaaaaaaaaaaa"));
  await h.registry.dismiss({ agentId: AGENT, runId: "p-aaaaaaaaaaaa", command: "gh auth login", cwd: "/w" });
  await h.registry.propose(AGENT, card("p-aaaaaaaaaaaa"));
  assert.deepEqual(h.phases("p-aaaaaaaaaaaa"), ["proposed", "dismissed"]);
  const dismissed = h.rows("p-aaaaaaaaaaaa")[1];
  assert.equal(dismissed.command, "gh auth login");
  // A card that became a run: the card's id is now a run, so another proposal or a dismiss is ignored.
  await h.registry.propose(AGENT, card("p-bbbbbbbbbbbb"));
  await ended(h.registry, await run(h.registry, "true", dir(), { runId: "p-bbbbbbbbbbbb", origin: "claude" }));
  await h.registry.propose(AGENT, card("p-bbbbbbbbbbbb"));
  await h.registry.dismiss({ agentId: AGENT, runId: "p-bbbbbbbbbbbb", command: "x", cwd: "/w" });
  await until(() => h.phases("p-bbbbbbbbbbbb").length === 3);
  assert.deepEqual(h.phases("p-bbbbbbbbbbbb"), ["proposed", "running", "ok"]);
  await h.registry.shutdown();
});

posixTest("in a terminal: a real tty 100 columns wide, the exit code, no pager, and nothing after the command ends", { skip: noTerminal, timeout: 15_000 }, async () => {
  const h = harness();
  const tty = await ended(h.registry, await run(h.registry, "test -t 0 && test -t 1 && echo tty; tput cols 2>/dev/null || stty size; echo \"$PAGER $GIT_PAGER\"; exit 3"));
  assert.equal(tty.terminal, true);
  assert.deepEqual([tty.phase.kind, (tty.phase as { exitCode: number }).exitCode], ["failed", 3]);
  const [first, size, pager, ...rest] = h.text(tty.runId);
  assert.equal(first, "tty");
  assert.match(size, /\b100$/);
  assert.equal(pager, "cat cat");
  assert.deepEqual(rest, []);
  const ok = await ended(h.registry, await run(h.registry, "echo done"));
  assert.deepEqual([ok.phase.kind, h.text(ok.runId)], ["ok", ["done"]]);
  await h.registry.shutdown();
});

posixTest("in a terminal: typing answers a prompt, and a hidden prompt doesn't show what was typed", { skip: noTerminal, timeout: 15_000 }, async () => {
  const h = harness();
  const id = await run(h.registry, "printf 'Code: '; read code; echo \"got $code\"; stty -echo; printf 'Password: '; read pw; stty echo; echo; echo \"${#pw} chars\"");
  await until(() => h.text(id).at(-1)?.startsWith("Code:") === true);
  h.registry.input(id, "123456\r");
  await until(() => h.text(id).at(-1)?.startsWith("Password:") === true);
  h.registry.input(id, "hunter2\r");
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "ok");
  assert.deepEqual(h.text(id), ["Code: 123456", "got 123456", "Password: ", "7 chars"]);
  assert.throws(() => h.registry.input(id, "late"), /already ended/);
  await h.registry.shutdown();
});

posixTest("in a terminal: keys arrive as pressed, so a one-key menu takes one key and Backspace edits", { skip: noTerminal, timeout: 15_000 }, async () => {
  const h = harness();
  const cwd = dir();
  writeFileSync(join(cwd, "menu.sh"), "printf '[y] yes [q] quit '; read -rsn1 k; echo; echo \"key $k\"; printf 'Project: '; read -r p; echo \"using $p\"\n");
  const id = await run(h.registry, "bash menu.sh", cwd);
  await until(() => h.text(id).at(-1)?.startsWith("[y]") === true);
  h.registry.input(id, "y");
  await until(() => h.text(id).at(-1)?.startsWith("Project:") === true);
  assert.equal(h.registry.snapshot(id, 1)!.phase.kind, "running", "the one key didn't also answer the next prompt");
  h.registry.input(id, "stx");
  h.registry.input(id, "\x7f");
  h.registry.input(id, "aging\r");
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "ok");
  assert.deepEqual(h.text(id).slice(-3), ["key y", "Project: staging", "using staging"]);
  await h.registry.shutdown();
});

posixTest("in a terminal: Stop is Ctrl+C, and a command that ignores it still ends", { skip: noTerminal, timeout: 15_000 }, async () => {
  const h = harness({ limits: { stopToTermMs: 5_000, stopToKillMs: 6_000 } });
  const polite = await run(h.registry, "echo ready; sleep 60");
  await until(() => h.text(polite)[0] === "ready");
  const stoppedAt = Date.now();
  h.registry.stop(polite, false);
  const stopped = await ended(h.registry, polite);
  assert.equal(stopped.phase.kind, "stopped");
  assert.ok(Date.now() - stoppedAt < 2_000, "Ctrl+C ended it, not the SIGTERM that follows");

  const stubborn = await run(h.registry, 'trap "" INT TERM; sleep 60 & echo $!; wait');
  const pid = await printedPid(h, stubborn);
  h.registry.stop(stubborn, false);
  await until(() => pidGone(pid), 8_000);
  assert.equal((await ended(h.registry, stubborn)).phase.kind, "stopped");
  await h.registry.shutdown();
});

posixTest("without a terminal, typing is refused", { timeout: 15_000 }, async () => {
  const h = harness({ terminal: "off" });
  const id = await run(h.registry, "sleep 5");
  assert.equal(h.registry.snapshot(id, 1)!.terminal, false);
  assert.throws(() => h.registry.input(id, "x"), /can't take typing/);
  h.registry.stop(id, true);
  assert.equal((await ended(h.registry, id)).phase.kind, "stopped", "forcing a stop straight away still reads as stopped");
  await h.registry.shutdown();
});

// ---- Windows: PowerShell in a ConPTY terminal ----

windowsTest("on Windows: exit codes, UTF-8 output and the folder", { timeout: 60_000 }, async () => {
  const cwd = dir();
  const h = harness();
  const ok = await ended(h.registry, await run(h.registry, "Write-Output 'h\u00e9llo \u2713'", cwd));
  assert.equal(ok.terminal, true);
  assert.equal(ok.phase.kind, "ok");
  assert.ok(h.text(ok.runId).includes("h\u00e9llo \u2713"), JSON.stringify(h.text(ok.runId)));
  const three = await ended(h.registry, await run(h.registry, "exit 3", cwd));
  assert.deepEqual([three.phase.kind, (three.phase as { exitCode: number }).exitCode], ["failed", 3]);
  const native = await ended(h.registry, await run(h.registry, "cmd /c exit 5", cwd));
  assert.deepEqual([native.phase.kind, (native.phase as { exitCode: number }).exitCode], ["failed", 5], "a failing program's own exit code, not PowerShell's 1");
  const where = await ended(h.registry, await run(h.registry, "Split-Path -Leaf (Get-Location)", cwd));
  assert.ok(h.text(where.runId).includes(cwd.split(/[\\/]/).pop()!), JSON.stringify(h.text(where.runId)));
  await h.registry.shutdown();
});

windowsTest("on Windows: typing answers Read-Host, and a hidden prompt doesn't show what was typed", { timeout: 60_000 }, async () => {
  const h = harness();
  const id = await run(h.registry, "$c = Read-Host 'Code'; Write-Output \"got $c\"; $p = Read-Host 'Password' -AsSecureString; Write-Output \"$($p.Length) chars\"");
  await until(() => h.text(id).some((line) => line.startsWith("Code")), 30_000);
  h.registry.input(id, "123456\r");
  await until(() => h.text(id).some((line) => line.startsWith("Password")), 30_000);
  h.registry.input(id, "hunter2\r");
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "ok");
  const text = h.text(id);
  assert.ok(text.includes("got 123456"), JSON.stringify(text));
  assert.ok(text.includes("7 chars"), JSON.stringify(text));
  assert.ok(!text.some((line) => line.includes("hunter2")), "the password stays hidden");
  await h.registry.shutdown();
});

windowsTest("on Windows: Stop is Ctrl+C, and the force path ends the program the command started", { timeout: 60_000 }, async () => {
  const h = harness({ limits: { stopToTermMs: 20_000, stopToKillMs: 25_000 } });
  const polite = await run(h.registry, "Write-Output ready; Start-Sleep 60");
  await until(() => h.text(polite).includes("ready"), 30_000);
  const stoppedAt = Date.now();
  h.registry.stop(polite, false);
  assert.equal((await ended(h.registry, polite)).phase.kind, "stopped");
  assert.ok(Date.now() - stoppedAt < 10_000, "Ctrl+C ended it");

  const child = await run(h.registry, "$p = Start-Process -PassThru -NoNewWindow ping -ArgumentList '-n','60','127.0.0.1'; Write-Output \"pid $($p.Id)\"; Wait-Process -Id $p.Id");
  await until(() => h.text(child).some((line) => /^pid \d+$/.test(line)), 30_000);
  const pid = Number(h.text(child).find((line) => /^pid \d+$/.test(line))!.slice(4));
  h.registry.stop(child, true);
  await until(() => pidGone(pid), 10_000);
  assert.equal((await ended(h.registry, child)).phase.kind, "stopped");
  await h.registry.shutdown();
});

windowsTest("on Windows: without PowerShell 7, Windows PowerShell runs the command", { timeout: 60_000 }, async () => {
  const path = (process.env.Path ?? process.env.PATH ?? "").split(";").filter((entry) => !/PowerShell[\\/]7/i.test(entry)).join(";");
  const h = harness({ env: { ...process.env, Path: path, PATH: path } });
  const row = await ended(h.registry, await run(h.registry, "Write-Output $PSVersionTable.PSEdition; exit 4"));
  assert.ok(h.text(row.runId).includes("Desktop"), JSON.stringify(h.text(row.runId)));
  assert.equal((row.phase as { exitCode: number }).exitCode, 4);
  await h.registry.shutdown();
});

posixTest("Rerun runs again in the same card: run 2 on top, run 1 kept below with its status and the end of its output", { timeout: 15_000 }, async () => {
  const h = harness({ limits: { pastRunOutputBytes: 64 } });
  const first = await ended(h.registry, await run(h.registry, "seq 1 50; exit 3"));
  const second = await rerun(h.registry, first);
  assert.notEqual(second, first.runId);
  await ended(h.registry, second);
  await until(() => h.card(first.runId).phase.kind !== "running");
  const shown = h.card(first.runId);
  assert.deepEqual([shown.runId, shown.run, shown.past?.length], [second, 2, 1]);
  const [past] = shown.past!;
  assert.deepEqual([past.runId, past.run, past.phase.kind, past.output.total], [first.runId, 1, "failed", 50]);
  assert.equal(past.output.lines.map(lineText).at(-1), "50");
  assert.ok(past.output.lines.length < 50 && JSON.stringify(past.output.lines).length <= 64, "the past run keeps only the end of its output");
  const sleeping = await rerun(h.registry, { ...shown, command: "sleep 30" });
  await assert.rejects(rerun(h.registry, { ...shown, runId: sleeping, run: 3 }), /still running/);
  await h.registry.shutdown();
});

posixTest("two Reruns of the same card start one command and both get its run", { timeout: 15_000 }, async () => {
  const h = harness();
  const cwd = dir();
  const first = await ended(h.registry, await run(h.registry, "echo x >> hits", cwd));
  const [a, b] = await Promise.all([rerun(h.registry, first), rerun(h.registry, first)]);
  assert.equal(a, b);
  await ended(h.registry, a);
  assert.equal(await rerun(h.registry, first), a, "a stale card's Rerun gets the card's latest run");
  await delay(100);
  assert.equal(readFileSync(join(cwd, "hits"), "utf8"), "x\nx\n");
  await h.registry.shutdown();
});

posixTest("after a restart, Rerun builds the card's history from the card itself, and keeps at most 10 earlier runs", { timeout: 15_000 }, async () => {
  const h = harness();
  const clock = { startedAt: 1, endedAt: 2 };
  const pastRuns = Array.from({ length: 10 }, (_, i) => ({ runId: `old-${i}`, run: i + 2, phase: { kind: "ok" as const, ...clock }, output: { lines: [`run ${i + 2}`], total: 1 }, sentAt: null }));
  const card: RunRow = { runId: "gone-run", cardId: "card-1", run: 12, past: pastRuns, rev: 4, origin: "user", command: "true", cwd: dir(), phase: { kind: "running", startedAt: 5, stopRequestedAt: null }, output: { lines: ["last words"], total: 1 }, sentAt: 7 };
  const id = await rerun(h.registry, card);
  await ended(h.registry, id);
  const shown = h.card("card-1");
  assert.deepEqual([shown.runId, shown.run], [id, 13]);
  assert.deepEqual(shown.past!.map((p) => p.run), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const last = shown.past!.at(-1)!;
  assert.deepEqual([last.runId, last.phase.kind, last.output.lines, last.sentAt], ["gone-run", "interrupted", ["last words"], 7]);
  await h.registry.shutdown();
});

posixTest("sending an earlier run records it in the card's history, and the card keeps showing the latest run", { timeout: 15_000 }, async () => {
  const h = harness();
  const first = await ended(h.registry, await run(h.registry, "echo one"));
  const second = await rerun(h.registry, first);
  await ended(h.registry, second);
  h.registry.markSent(first.runId);
  await until(() => h.card(first.runId).past?.[0].sentAt != null);
  const shown = h.card(first.runId);
  assert.deepEqual([shown.runId, shown.sentAt], [second, null]);
  assert.ok(h.published.every((row) => row.runId !== first.runId || row.run === 1 && row.past === undefined), "the earlier run's own row is never published again");
  await h.registry.shutdown();
});

posixTest("after a rerun, a late proposal for the card's first run never overwrites it", { timeout: 15_000 }, async () => {
  const h = harness({ limits: { keepFinished: 1 } });
  const id = "p-cccccccccccc";
  const proposal: RunRow = { runId: id, rev: 0, origin: "claude", command: "true", cwd: dir(), phase: { kind: "proposed" }, output: { lines: [], total: 0 }, sentAt: null };
  await h.registry.propose(AGENT, proposal);
  const first = await ended(h.registry, await run(h.registry, "true", proposal.cwd, { runId: id, origin: "claude" }));
  const second = await rerun(h.registry, first);
  await ended(h.registry, second);
  await until(() => h.card(id).phase.kind === "ok");
  assert.equal(h.registry.snapshot(id, 1), null, "the first run has left the registry");
  await h.registry.propose(AGENT, proposal);
  await h.registry.dismiss({ agentId: AGENT, runId: id, command: "true", cwd: proposal.cwd });
  assert.deepEqual([h.card(id).runId, h.card(id).phase.kind], [second, "ok"]);
  await h.registry.shutdown();
});
