import { z } from "zod";
import type { Question } from "./dashboard.ts";

// An answer the user gives from the dashboard: one of the choices.
export const answerSchema = z.object({ choice: z.string().regex(/^[A-Z]$/) }).strict();
export type Answer = z.infer<typeof answerSchema>;

// `queued` waits for the agent's turn to end. `held` waits for the user: the
// turn was stopped, the send failed, or the plugin restarted.
export const ANSWER_STATES = ["queued", "held", "sent"] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

// The user's latest answer to an open question, until the agent records it.
export type GivenAnswer = { answer: Answer; state: AnswerState };

// What happened to an answer. `gone`: the agent that asked is no longer in this
// workspace. `closed`: the question is no longer open.
export type SendResult = AnswerState | "gone" | "closed";

export function sameAnswer(a: Answer, b: Answer): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The message the agent gets, or null when the question isn't one to send for.
// It goes out in the user's name, so it carries no words an agent wrote: not
// the title Copy puts in front, and no id or letter that isn't plain.
export function answerMessage(question: Pick<Question, "id" | "options">, answer: Answer): string | null {
  if (!/^Q\d{1,6}$/.test(question.id)) return null;
  return /^[A-Z]$/.test(answer.choice) && question.options.some((option) => option.letter === answer.choice) ? `${question.id} ${answer.choice}` : null;
}
