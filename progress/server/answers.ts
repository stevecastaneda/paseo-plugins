// Answers on their way from the dashboard to the agent that asked. Answers for a
// working agent wait here until its turn ends.
// COMPAT(humanQueue): Paseo 0.17 queues messages between agents only, and the
// app's own queue isn't open to plugins. Once Paseo takes `queue` from plugins,
// deliver() can hand it the message and this queue can go.
import type { PluginHandlerContext, PluginSettings, PluginTurnOutcome } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Answer, answerMessage, answerSchema, type AnswerState, ANSWER_STATES, type GivenAnswer, sameAnswer, type SendResult } from "../shared/answers.ts";
import type { Dashboard, Question } from "../shared/dashboard.ts";
import type { answerSettings } from "../shared/settings.ts";
import { findRoot } from "./paths.ts";
import { readProgress } from "./progress-file.ts";
import { findStore, stateRoot } from "./store.ts";
import { writeFileIn } from "./system.ts";

type Paseo = PluginHandlerContext["paseo"];

const FILE_NAME = "answers.json";
// Settled answers only label the buttons, so a few are enough.
const KEEP = 200;
// Catches a turn that ended while the plugin wasn't listening.
export const RETRY_MS = 10_000;

const entrySchema = z.object({
  root: z.string(),
  workspaceId: z.string(),
  questionId: z.string(),
  askedAt: z.string(),
  answer: answerSchema,
  state: z.enum(ANSWER_STATES),
});
type Entry = z.infer<typeof entrySchema> & { agentId?: string };

export type AnswerTarget = { workspaceId: string; workspaceDirectory: string; questionId: string; askedAt: string };

export class AnswerQueue {
  private entries: Entry[] = [];
  private paseo: Paseo | null = null;
  // One thing at a time, so an answer is never sent twice.
  private work: Promise<unknown>;
  private readonly whenWorking: () => Promise<"queue" | "now">;
  private readonly home: string;

  constructor(whenWorking: () => Promise<"queue" | "now">, home = homedir()) {
    this.whenWorking = whenWorking;
    this.home = home;
    this.work = this.load();
  }

  // Paseo hands its API to handlers and hooks only; the retry borrows the last one.
  capture(paseo: Paseo): void {
    this.paseo = paseo;
  }

  // `now` skips the wait for the turn to end.
  send(target: AnswerTarget, answer: Answer, now = false): Promise<SendResult> {
    return this.run(async () => {
      const root = findRoot(target.workspaceDirectory);
      const question = await openQuestion(root, target);
      if (!question) return "closed";
      if (!question.agentId || !answerMessage(question, answer)) return "gone";
      const before = this.find(root, target);
      if (before?.state === "sent" && sameAnswer(before.answer, answer)) return "sent";
      const entry: Entry = {
        root,
        workspaceId: target.workspaceId,
        questionId: target.questionId,
        askedAt: target.askedAt,
        answer,
        state: "queued",
        agentId: question.agentId,
      };
      this.entries = [...this.entries.filter((other) => other !== before), entry];
      const result = await this.deliver([entry], now || (await this.whenWorking()) === "now");
      await this.save();
      return result;
    });
  }

  cancel(target: AnswerTarget): Promise<void> {
    return this.run(async () => {
      const entry = this.find(findRoot(target.workspaceDirectory), target);
      if (!entry || entry.state === "sent") return;
      this.drop(entry);
      await this.save();
    });
  }

  // A turn the user stopped isn't started again by an answer that was waiting for it.
  turnEnded(agentId: string, outcome: PluginTurnOutcome["kind"]): Promise<void> {
    return this.run(async () => {
      const waiting = this.waitingFor(agentId);
      if (!waiting.length) return;
      if (outcome === "canceled") for (const entry of waiting) entry.state = "held";
      else await this.deliver(waiting, false);
      await this.save();
    });
  }

  agentGone(agentId: string): Promise<void> {
    return this.run(async () => {
      const waiting = this.waitingFor(agentId);
      for (const entry of waiting) entry.state = "held";
      if (waiting.length) await this.save();
    });
  }

  retry(): Promise<void> {
    if (!this.paseo || !this.entries.some((entry) => entry.state === "queued")) return Promise.resolve();
    return this.run(async () => {
      const agents = new Set(this.entries.flatMap((entry) => (entry.state === "queued" && entry.agentId ? [entry.agentId] : [])));
      for (const agentId of agents) await this.deliver(this.waitingFor(agentId), false);
      await this.save();
    });
  }

  given(root: string, question: Question): GivenAnswer | undefined {
    const entry = this.find(root, { questionId: question.id, askedAt: question.askedAt });
    return entry && { answer: entry.answer, state: entry.state };
  }

  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.work.then(work);
    this.work = result.catch(() => {});
    return result;
  }

  private find(root: string, { questionId, askedAt }: Pick<AnswerTarget, "questionId" | "askedAt">): Entry | undefined {
    return this.entries.find((entry) => entry.root === root && entry.questionId === questionId && entry.askedAt === askedAt);
  }

  private waitingFor(agentId: string): Entry[] {
    return this.entries.filter((entry) => entry.state === "queued" && entry.agentId === agentId);
  }

  private drop(entry: Entry): void {
    this.entries = this.entries.filter((other) => other !== entry);
  }

  // Sends one agent's answers as one message, or leaves them queued while it works.
  private async deliver(entries: Entry[], now: boolean): Promise<SendResult> {
    const messages: string[] = [];
    const going: Entry[] = [];
    for (const entry of entries) {
      // Answered in the chat, withdrawn, or left behind by a new run meanwhile.
      const question = await openQuestion(entry.root, entry);
      const message = question?.agentId === entry.agentId && question ? answerMessage(question, entry.answer) : null;
      if (message) {
        messages.push(message);
        going.push(entry);
      } else this.drop(entry);
    }
    if (!going.length) return "closed";
    const set = (state: AnswerState) => {
      for (const entry of going) entry.state = state;
      return state;
    };
    try {
      if (!this.paseo) return "queued";
      const agent = this.paseo.agents.ref(going[0].agentId!);
      const found = await agent.refresh();
      // Paseo would bring an archived agent back. The progress file names the
      // agent, and another workspace's agent has no business with this answer.
      if (!found || agent.archivedAt || going.some((entry) => entry.workspaceId !== agent.workspaceId)) {
        for (const entry of going) this.drop(entry);
        return "gone";
      }
      const working = agent.status === "running" || agent.status === "initializing";
      // A message would drop the permission request the agent is waiting on.
      if ((working && !now) || agent.pendingPermissions?.length) return set("queued");
      // Joins a running turn instead of interrupting it, where the provider can.
      await agent.send(messages.join("\n\n"), { activeTurnBehavior: "steer" });
      return set("sent");
    } catch {
      return set("held");
    }
  }

  // What was waiting when the plugin stopped is held, not sent: the file sits
  // where any program of the user's can write, so the user sees each answer first.
  private async load(): Promise<void> {
    try {
      const saved = z.array(entrySchema).parse(JSON.parse(await readFile(join(stateRoot(this.home), FILE_NAME), "utf8")));
      this.entries = saved.map((entry) => (entry.state === "queued" ? { ...entry, state: "held" } : entry));
    } catch {
      this.entries = [];
    }
  }

  private async save(): Promise<void> {
    const settled = this.entries.filter((entry) => entry.state === "sent");
    const dropped = new Set(settled.slice(0, Math.max(0, settled.length - KEEP)));
    this.entries = this.entries.filter((entry) => !dropped.has(entry));
    // The answer still goes out when it can't be saved.
    await writeFileIn(stateRoot(this.home), FILE_NAME, `${JSON.stringify(z.array(entrySchema).parse(this.entries))}\n`, { atomic: true }).catch(() => {});
  }
}

async function openQuestion(root: string, { questionId, askedAt }: Pick<AnswerTarget, "questionId" | "askedAt">): Promise<Question | undefined> {
  const { dashboard } = await readProgress(findStore(root).directory);
  return dashboard.questions.open.find((question) => question.id === questionId && question.askedAt === askedAt);
}

// The dashboard with the user's answer on each open question that has one.
export function withAnswers(dashboard: Dashboard, root: string, queue?: AnswerQueue): { dashboard: Dashboard; key: string } {
  const given = dashboard.questions.open.map((question) => queue?.given(root, question));
  if (!given.some(Boolean)) return { dashboard, key: "" };
  const open = dashboard.questions.open.map((question, index) => (given[index] ? { ...question, given: given[index] } : question));
  return { dashboard: { ...dashboard, questions: { ...dashboard.questions, open } }, key: JSON.stringify(given) };
}

type Settings = Pick<PluginSettings<(typeof answerSettings)["schema"]>, "read">;

// Waiting is the default, also when the settings can't be read.
export function whenWorkingFrom(settings: Settings): () => Promise<"queue" | "now"> {
  return async () => {
    const state = await settings.read().catch(() => null);
    return state?.status === "ready" ? state.values.whenWorking : "queue";
  };
}
