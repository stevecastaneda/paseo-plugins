import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Limits } from "../shared/limits.ts";
import { lineText, type RunRow } from "../shared/row.ts";
import { commandEnv, createRunRegistry, type RunRegistry } from "./runs.ts";
import { jsonBytes } from "./screen.ts";

const AGENT = "agent-1";
const dir = () => mkdtempSync(join(tmpdir(), "shell-yeah-"));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error("timed out waiting");
    await delay(15);
  }
}

function harness(opts: { limits?: Partial<Limits>; publish?: (row: RunRow) => Promise<void> | void; env?: NodeJS.ProcessEnv } = {}) {
  const published: RunRow[] = [];
  const registry = createRunRegistry({
    publish: async (_agentId, row) => {
      await opts.publish?.(row);
      published.push(row);
    },
    now: Date.now,
    env: opts.env ?? process.env,
    limits: opts.limits,
  });
  const rows = (id: string) => published.filter((row) => row.runId === id);
  const phases = (id: string) => rows(id).map((row) => row.phase.kind);
  const text = (id: string) => registry.snapshot(id, 400)!.output.lines.map(lineText);
  return { registry, published, rows, phases, text };
}

async function run(registry: RunRegistry, command: string, cwd = dir(), extra: { runId?: string; origin?: "user" | "claude" } = {}) {
  const { runId } = await registry.start({ agentId: AGENT, cwd, command, origin: extra.origin ?? "user", runId: extra.runId });
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

test("exit codes and signals map to ok, failed and stopped", { timeout: 15_000 }, async () => {
  const h = harness();
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

test("stdout and stderr arrive in the order the command wrote them", async () => {
  const h = harness();
  const id = await run(h.registry, "echo a; echo b >&2; echo c");
  await ended(h.registry, id);
  assert.deepEqual(h.text(id), ["a", "b", "c"]);
  await h.registry.shutdown();
});

test("commands run in the given folder, with color forced, Paseo's worker variables gone, and no keyboard", { timeout: 15_000 }, async () => {
  const cwd = dir();
  const h = harness({ env: { ...process.env, PASEO_NODE_ENV: "x", ELECTRON_RUN_AS_NODE: "1", NO_COLOR: "1" } });
  const env = await ended(h.registry, await run(h.registry, "printenv FORCE_COLOR PASEO_NODE_ENV ELECTRON_RUN_AS_NODE NO_COLOR; echo end", cwd));
  assert.deepEqual(h.text(env.runId), ["1", "end"]);
  const where = await ended(h.registry, await run(h.registry, "pwd -P", cwd));
  assert.equal(h.text(where.runId)[0], realpathSync(cwd));
  const cat = await ended(h.registry, await run(h.registry, "cat; echo eof", cwd));
  assert.deepEqual([cat.phase.kind, h.text(cat.runId)], ["ok", ["eof"]]);
  const tty = await ended(h.registry, await run(h.registry, "tty", cwd));
  assert.match(h.text(tty.runId)[0], /not a tty/);
  await h.registry.shutdown();
});

test("commandEnv keeps the user's PATH and git color, and does not override a git config the user set", () => {
  const env = commandEnv({ PATH: "/usr/bin", GIT_CONFIG_COUNT: "2" }, "/w");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(env.PWD, "/w");
  assert.equal(commandEnv({}, "/w").GIT_CONFIG_VALUE_0, "always");
});

test("a missing folder is a failed row with a plain reason, published once, and nothing runs", async () => {
  const h = harness();
  const id = await run(h.registry, "echo hi", "/nonexistent/folder/for/shell-yeah");
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "failed");
  assert.equal((row.phase as { message: string }).message, "Folder not found: /nonexistent/folder/for/shell-yeah");
  assert.deepEqual(h.phases(id), ["failed"]);
  await h.registry.shutdown();
});

test("stop kills the whole process tree, including a background job the shell left behind, and the force path kills one that ignores signals", { timeout: 15_000 }, async () => {
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

test("a command that traps SIGINT and SIGTERM is killed by the escalation timer", { timeout: 15_000 }, async () => {
  const h = harness({ limits: { stopToTermMs: 50, stopToKillMs: 150 } });
  const id = await run(h.registry, 'trap "" INT TERM; sleep 60');
  await delay(100);
  h.registry.stop(id, false);
  const row = await ended(h.registry, id);
  assert.equal(row.phase.kind, "stopped");
  assert.equal((row.phase as { signal: string }).signal, "SIGKILL");
  await h.registry.shutdown();
});

test("the row is published at start and at the end, never while output streams, and stays under the byte cap", { timeout: 20_000 }, async () => {
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

test("property: random output never produces a row over 64 KiB of UTF-8 JSON", { timeout: 30_000 }, async () => {
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

test("a failing publish is retried; a start whose first publish fails runs nothing", { timeout: 15_000 }, async () => {
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

test("starting the same run id twice spawns once; ending twice publishes once with the first outcome", { timeout: 15_000 }, async () => {
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

test("shutdown marks running runs interrupted, publishes them, and leaves no process group, inside 1.5 s", { timeout: 15_000 }, async () => {
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

test("shutdown still returns inside the budget when the daemon never answers the publish", { timeout: 15_000 }, async () => {
  let calls = 0;
  const h = harness({ publish: () => (++calls > 1 ? new Promise<void>(() => undefined) : undefined) });
  const id = await run(h.registry, "sleep 60 & echo $!; wait");
  const pid = await printedPid(h, id);
  const started = Date.now();
  await h.registry.shutdown();
  assert.ok(Date.now() - started < 1_500);
  await until(() => pidGone(pid), 500);
});

test("binary output is hidden behind one line; a flood stops being captured while the command keeps running", { timeout: 15_000 }, async () => {
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

test("only so many commands run at once", async () => {
  const h = harness({ limits: { maxLive: 2 } });
  await run(h.registry, "sleep 30");
  await run(h.registry, "sleep 30");
  await assert.rejects(run(h.registry, "sleep 30"), /2 commands are already running/);
  await h.registry.shutdown();
});

test("tail: unknown for an unseen run, unchanged after the wait, wakes on a burst and on the end", { timeout: 15_000 }, async () => {
  const h = harness();
  assert.deepEqual(await h.registry.tail("never-seen-0001", 10, null, 0), { state: "unknown" });
  const id = await run(h.registry, "sleep 0.3; for i in 1 2 3; do echo $i; sleep 0.01; done; sleep 0.3");
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

test("markSent publishes the row again with the time; recent lists running runs first", { timeout: 15_000 }, async () => {
  const h = harness();
  const done = await ended(h.registry, await run(h.registry, "true"));
  const live = await run(h.registry, "sleep 30");
  h.registry.markSent(done.runId);
  await until(() => h.rows(done.runId).some((row) => row.sentAt !== null));
  assert.deepEqual(h.registry.recent(5).map(({ row }) => row.runId), [live, done.runId]);
  await h.registry.shutdown();
});

test("proposals and dismissals go through the same publish path, and a stale proposal never overwrites a later state", async () => {
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
