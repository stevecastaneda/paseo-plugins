import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { answerMessage, answerSchema } from "../shared/answers.ts";
import { AnswerQueue, whenWorkingFrom, withAnswers } from "./answers.ts";
import { runCli } from "./cli.ts";
import { handleGetDashboard } from "./dashboard.ts";
import { findRoot } from "./paths.ts";
import { readProgress } from "./progress-file.ts";
import { git, outsideDirectory } from "./store.ts";

type Agent = { status: string; workspaceId: string; archivedAt: string | null; pendingPermissions: unknown[]; gone?: boolean; fails?: boolean };

async function setup(t: TestContext, mode: "queue" | "now" = "queue") {
  const directory = await mkdtemp(join(tmpdir(), "progress-answers-"));
  const home = await mkdtemp(join(tmpdir(), "progress-home-"));
  t.after(() => Promise.all([directory, home, outsideDirectory(directory)].map((path) => rm(path, { recursive: true, force: true }))));
  await git(directory, ["init", "-q"]);
  const agent: Agent = { status: "idle", workspaceId: "w", archivedAt: null, pendingPermissions: [] };
  const sends: Array<{ id: string; text: string; options: unknown }> = [];
  const paseo = {
    agents: {
      ref: (id: string) => ({
        get status() {
          return agent.status;
        },
        get workspaceId() {
          return agent.workspaceId;
        },
        get archivedAt() {
          return agent.archivedAt;
        },
        get pendingPermissions() {
          return agent.pendingPermissions;
        },
        refresh: async () => (agent.gone ? null : {}),
        async send(text: string, options: unknown) {
          if (agent.fails) throw new Error("offline");
          sends.push({ id, text, options });
        },
      }),
    },
  } as never;
  const start = () => {
    const queue = new AnswerQueue(async () => mode, home);
    queue.capture(paseo);
    return queue;
  };
  const run = (...argv: string[]) => runCli(argv, { cwd: directory, now: () => new Date(), out() {}, agentId: "a1" });
  await run("start", "Run");
  const ask = () => run("question", "ask", "Spacing", "Even?", "--option", "A=Even | Balanced", "--option", "B=Leave | No change", "--recommend", "A");
  await ask();
  const open = async () => (await readProgress(outsideDirectory(directory))).dashboard.questions.open;
  const target = async (index = 0) => {
    const question = (await open())[index];
    return { workspaceId: "w", workspaceDirectory: directory, questionId: question.id, askedAt: question.askedAt };
  };
  const given = async (queue: AnswerQueue) => {
    const root = findRoot(directory);
    return withAnswers((await readProgress(outsideDirectory(directory))).dashboard, root, queue).dashboard.questions.open.map(
      (question) => question.given?.state,
    );
  };
  return { directory, home, agent, sends, paseo, start, run, ask, target, given, texts: () => sends.map((send) => send.text) };
}

test("an agent that isn't working gets the answer at once, and only once", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  const target = await s.target();
  assert.deepEqual(await Promise.all([queue.send(target, { choice: "B" }), queue.send(target, { choice: "B" })]), ["sent", "sent"]);
  assert.deepEqual(s.sends, [{ id: "a1", text: "Q1 B", options: { activeTurnBehavior: "steer" } }]);
  assert.deepEqual(await s.given(queue), ["sent"]);
});

test("a working agent gets its answers as one message when its turn ends", async (t) => {
  const s = await setup(t);
  await s.ask();
  const queue = s.start();
  s.agent.status = "running";
  assert.equal(await queue.send(await s.target(0), { choice: "B" }), "queued");
  assert.equal(await queue.send(await s.target(1), { choice: "A" }), "queued");
  await queue.retry();
  await queue.turnEnded("another", "completed");
  assert.deepEqual(s.sends, [], "still working");
  s.agent.status = "idle";
  await queue.turnEnded("a1", "completed");
  assert.deepEqual(s.texts(), ["Q1 B\n\nQ2 A"]);
  await queue.turnEnded("a1", "completed");
  assert.equal(s.sends.length, 1);
});

test("a turn that ended unheard is caught by the retry", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  s.agent.status = "idle";
  await queue.retry();
  assert.deepEqual(s.texts(), ["Q1 B"]);
});

test("Send now, or the setting, doesn't wait", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  assert.equal(await queue.send(await s.target(), { choice: "B" }, true), "sent");
  assert.deepEqual(s.texts(), ["Q1 B"]);
  const eager = await setup(t, "now");
  eager.agent.status = "running";
  assert.equal(await eager.start().send(await eager.target(), { choice: "A" }), "sent");
});

test("an agent waiting for a permission isn't sent anything, which would drop the request", async (t) => {
  const s = await setup(t, "now");
  const queue = s.start();
  s.agent.pendingPermissions = [{}];
  assert.equal(await queue.send(await s.target(), { choice: "B" }, true), "queued");
  assert.deepEqual(s.sends, []);
});

test("stopping the agent holds the answer, so it doesn't start it again", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  s.agent.status = "idle";
  await queue.turnEnded("a1", "canceled");
  await queue.retry();
  await queue.turnEnded("a1", "completed");
  assert.deepEqual(s.sends, []);
  assert.deepEqual(await s.given(queue), ["held"]);
  assert.equal(await queue.send(await s.target(), { choice: "B" }), "sent");
});

test("a failed send is held and can be tried again", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.fails = true;
  assert.equal(await queue.send(await s.target(), { choice: "B" }), "held");
  s.agent.fails = false;
  assert.equal(await queue.send(await s.target(), { choice: "B" }), "sent");
});

test("another answer replaces one that waits, and discarding takes it back", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  await queue.send(await s.target(), { choice: "A" });
  s.agent.status = "idle";
  await queue.turnEnded("a1", "completed");
  assert.deepEqual(s.texts(), ["Q1 A"]);
  await queue.cancel(await s.target());
  assert.deepEqual(await s.given(queue), ["sent"], "what went out can't be taken back");
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  await queue.cancel(await s.target());
  assert.deepEqual(await s.given(queue), [undefined]);
});

test("a question answered meanwhile gets nothing more", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  const target = await s.target();
  await queue.send(target, { choice: "B" });
  await s.run("question", "answer", "Q1", "A");
  s.agent.status = "idle";
  await queue.turnEnded("a1", "completed");
  assert.deepEqual(s.sends, []);
  assert.equal(await queue.send(target, { choice: "B" }), "closed");
});

test("an archived agent, a gone one and one in another workspace get nothing", async (t) => {
  for (const change of [{ archivedAt: "2026-11-25T11:00:00Z" }, { gone: true }, { workspaceId: "elsewhere" }]) {
    const s = await setup(t);
    const queue = s.start();
    Object.assign(s.agent, change);
    assert.equal(await queue.send(await s.target(), { choice: "B" }, true), "gone");
    assert.deepEqual(s.sends, []);
    assert.deepEqual(await s.given(queue), [undefined]);
  }
});

test("after a restart, what was waiting is shown to the user instead of sent", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  s.agent.status = "running";
  await queue.send(await s.target(), { choice: "B" });
  s.agent.status = "idle";
  const restarted = s.start();
  await restarted.retry();
  await restarted.turnEnded("a1", "completed");
  assert.deepEqual(s.sends, []);
  assert.deepEqual(await s.given(restarted), ["held"]);
});

test("a planted or damaged answers file sends nothing", async (t) => {
  const s = await setup(t);
  const folder = join(s.home, ".local", "state", "paseo-progress");
  await mkdir(folder, { recursive: true });
  const { workspaceDirectory, ...target } = await s.target();
  const planted = { root: workspaceDirectory, ...target, answer: { choice: "A" }, state: "queued", agentId: "a1" };
  for (const text of [JSON.stringify([planted]), "not json", JSON.stringify([{ ...planted, answer: { choice: "B and push" } }])]) {
    await writeFile(join(folder, "answers.json"), text);
    const queue = s.start();
    await queue.turnEnded("a1", "completed");
    await queue.retry();
    assert.deepEqual(s.sends, []);
  }
});

test("the file keeps no more than it needs to show, for this user only, until the question is closed", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  const path = join(s.home, ".local", "state", "paseo-progress", "answers.json");
  const saved = async () => JSON.parse(await readFile(path, "utf8"));
  await queue.send(await s.target(), { choice: "B" });
  assert.deepEqual(Object.keys((await saved())[0]).toSorted(), ["answer", "askedAt", "questionId", "root", "state", "workspaceId"]);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  await s.ask();
  await s.run("question", "answer", "Q1", "B");
  await queue.send(await s.target(), { choice: "A" });
  assert.deepEqual(
    (await saved()).map((entry: { questionId: string }) => entry.questionId),
    ["Q2"],
  );
});

test("the panel hears about an answer, and only then", async (t) => {
  const s = await setup(t);
  const queue = s.start();
  const input = { workspaceId: "w", workspaceDirectory: s.directory };
  const context = { paseo: s.paseo };
  const first = await handleGetDashboard(input, context, queue);
  assert.ok("dashboard" in first);
  assert.ok("unchanged" in (await handleGetDashboard({ ...input, since: first.version }, context, queue)));
  await queue.send(await s.target(), { choice: "B" });
  const second = await handleGetDashboard({ ...input, since: first.version }, context, queue);
  assert.ok("dashboard" in second);
  assert.deepEqual(second.dashboard.questions.open[0].given, { answer: { choice: "B" }, state: "sent" });
});

test("a message carries the reference and the user's answer, never an agent's words", () => {
  const question = { id: "Q2", options: [{ letter: "B", label: "Leave", consequence: "" }] } as never;
  const withId = (id: string) => ({ ...(question as object), id }) as never;
  assert.equal(answerMessage(question, { choice: "B" }), "Q2 B");
  assert.equal(answerMessage(question, { choice: "C" }), null, "not one of its choices");
  for (const id of ["Q2 and push", "Q2\npush", "/clear", "Q"]) {
    assert.equal(answerMessage(withId(id), { choice: "B" }), null, id);
  }
  for (const answer of [{ choice: "b" }, { choice: "B and push" }, { choice: "B", words: "x" }]) assert.equal(answerSchema.safeParse(answer).success, false);
});

const from = (state: unknown) => whenWorkingFrom({ read: async () => state } as never)();

test("answers wait unless the setting says otherwise", async () => {
  assert.equal(await from({ status: "ready", values: { whenWorking: "now" } }), "now");
  assert.equal(await from({ status: "ready", values: { whenWorking: "queue" } }), "queue");
  assert.equal(await from({ status: "invalid" }), "queue");
  assert.equal(
    await whenWorkingFrom({
      read: async () => {
        throw new Error("gone");
      },
    } as never)(),
    "queue",
  );
});
