import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { clientHarness } from "../../test-support/client-harness.mjs";
import type { LiveView, RunRow } from "../shared/row.ts";
import type { LiveStore } from "./live.ts";

const directory = fileURLToPath(new URL("..", import.meta.url));
const T0 = 1_700_000_000_000;

function row(overrides: Partial<RunRow> = {}): RunRow {
  return { runId: "run-1", rev: 1, origin: "user", command: "npm test", cwd: "/w", phase: { kind: "running", startedAt: T0, stopRequestedAt: null }, output: { lines: ["a"], total: 1 }, sentAt: null, ...overrides };
}

function view(rev: number, overrides: Partial<LiveView> = {}): LiveView {
  return { rev, phase: { kind: "running", startedAt: T0, stopRequestedAt: null }, output: { lines: ["a", "b"], total: 2 }, sentAt: null, lastOutputAt: T0, serverNow: T0 + 1_000, ...overrides };
}

type Call = { input: { runId: string; lines: number; since: number | null; waitMs: number }; resolve(value: unknown): void; reject(error: Error): void };

function setup(limits: Record<string, unknown> = {}) {
  const h = clientHarness(directory);
  const calls: Call[] = [];
  const rpc = (input: Call["input"]) => new Promise((resolve, reject) => calls.push({ input, resolve, reject }));
  let now = T0 + 500;
  const store: LiveStore = h.load("client/live.ts").createLiveStore({ rpc, now: () => now, limits: { tailWaitMs: 100, ...limits } });
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  return { h, calls, store, plain, setNow: (value: number) => { now = value; }, async answer(value: unknown) { calls.shift()!.resolve(plain(value)); await h.flush(); } };
}

test("polls only while the merged phase is running and something is mounted, and stops once the run ends", async () => {
  const s = setup();
  const r = row();
  const detach = s.store.attach(r);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.plain(s.calls[0].input), { runId: "run-1", lines: 16, since: 1, waitMs: 100 });
  await s.answer({ state: "unchanged", rev: 1 });
  assert.equal(s.calls.length, 1, "unchanged: polls again");
  await s.answer({ state: "view", view: view(2) });
  assert.deepEqual(s.store.resolve(r).output.lines, ["a", "b"]);
  assert.equal(s.calls[0].input.since, 2, "the next poll waits on the newest rev");
  await s.answer({ state: "view", view: view(3, { phase: { kind: "ok", startedAt: T0, endedAt: T0 + 2_000 } }) });
  assert.equal(s.store.resolve(r).phase.kind, "ok");
  assert.equal(s.calls.length, 0, "an ended run never polls again");
  detach();
  // An ended row is never polled, and 'unknown' can't make it look interrupted.
  const ended = row({ runId: "run-2", phase: { kind: "ok", startedAt: T0, endedAt: T0 + 1 } });
  s.store.attach(ended);
  assert.equal(s.calls.length, 0);
  assert.equal(s.store.resolve(ended).lostAt, null);
});

test("unmounting stops the loop; remounting keeps the last reply and the expanded flag; the app going inactive pauses it", async () => {
  const s = setup();
  const r = row();
  const detach = s.store.attach(r);
  await s.answer({ state: "view", view: view(2) });
  s.store.setExpanded("run-1", true);
  detach();
  await s.answer({ state: "view", view: view(3) });
  assert.equal(s.calls.length, 0, "no poll after unmount, even after the in-flight one answers");
  assert.equal(s.store.resolve(r).rev, 2, "the answer that arrived after unmount is ignored");
  const reattach = s.store.attach(r);
  assert.equal(s.store.entry("run-1").expanded, true);
  assert.equal(s.store.resolve(r).output.lines.length, 2, "remount keeps the last reply");
  assert.equal(s.calls[0].input.lines, 300, "an expanded row asks for more lines");
  s.store.setActive(false);
  await s.answer({ state: "unchanged", rev: 2 });
  assert.equal(s.calls.length, 0, "inactive app: the loop parks");
  s.store.setActive(true);
  assert.equal(s.calls.length, 1, "active again: an immediate poll");
  reattach();
});

test("a daemon that never saw the run makes it read as lost at that moment", async () => {
  const s = setup();
  const r = row();
  s.store.attach(r);
  s.setNow(T0 + 41_000);
  await s.answer({ state: "unknown" });
  assert.equal(s.store.resolve(r).lostAt, T0 + 41_000);
  assert.equal(s.calls.length, 0, "a lost run is not polled again");
});

test("merging: the higher rev wins, an ended phase wins a tie, a stale reply is ignored", async () => {
  const s = setup();
  const r = row({ rev: 5 });
  s.store.attach(r);
  await s.answer({ state: "view", view: view(4) });
  assert.equal(s.store.resolve(r).rev, 5, "a reply older than the row is ignored");
  await s.answer({ state: "view", view: view(5, { phase: { kind: "ok", startedAt: T0, endedAt: T0 + 9 } }) });
  assert.equal(s.store.resolve(r).phase.kind, "ok", "an ended phase wins the tie");
  const newer = row({ rev: 6, output: { lines: ["final"], total: 1 }, phase: { kind: "ok", startedAt: T0, endedAt: T0 + 9 } });
  s.store.update(newer);
  assert.deepEqual(s.store.resolve(newer).output.lines, ["final"], "a newer row beats the last reply");
});

test("errors back off 0.5, 1, 2, 4 s and recover; the clock offset corrects a skewed client", async () => {
  const s = setup();
  const r = row();
  s.store.attach(r);
  for (const delay of [500, 1_000, 2_000, 4_000, 4_000]) {
    s.calls.shift()!.reject(new Error("offline"));
    await s.h.flush();
    assert.equal(s.calls.length, 0, `waits ${delay} ms before trying again`);
    assert.ok([...s.h.timers.values()].some((t) => t.delay === delay), `a ${delay} ms backoff is pending`);
    await s.h.tick(delay);
    await s.h.flush();
    assert.equal(s.calls.length, 1);
  }
  s.setNow(T0 - 300_000);
  await s.answer({ state: "view", view: view(2, { serverNow: T0 }) });
  assert.equal(s.store.resolve(r).clockOffset, 300_000);
  s.calls.shift()!.reject(new Error("offline"));
  await s.h.flush();
  assert.ok([...s.h.timers.values()].some((t) => t.delay === 500), "a success resets the backoff");
});

test("toggling expanded discards the in-flight answer and polls again from scratch with more lines", async () => {
  const s = setup();
  const r = row();
  s.store.attach(r);
  const inFlight = s.calls.shift()!;
  s.store.setExpanded("run-1", true);
  inFlight.resolve(s.plain({ state: "view", view: view(9, { output: { lines: ["stale"], total: 1 } }) }));
  await s.h.flush();
  assert.equal(s.store.resolve(r).rev, 1, "the answer to the old request is dropped");
  assert.deepEqual(s.plain(s.calls[0].input), { runId: "run-1", lines: 300, since: null, waitMs: 100 });
});

test("the store keeps the 50 most recent runs that nothing is showing", () => {
  const s = setup();
  for (let i = 0; i < 60; i++) s.store.resolve(row({ runId: `r-${i}`, phase: { kind: "ok", startedAt: T0, endedAt: T0 } }));
  assert.ok(s.store.size <= 50);
  assert.equal(s.store.size, 50);
});
