import { z } from "zod";
import { QUESTION_MODES } from "./question-modes.ts";

// One line of `progress.jsonl`. The command-line tool writes these; the
// dashboard reducer reads them. `v` lets later versions change a shape without
// misreading old files. Which folder holds it is set up per repo.
export const PROGRESS_FILE_NAME = "progress.jsonl";
// Present once someone has opened the Progress panel for this worktree.
export const PANEL_OPENED_NAME = "progress-panel-opened";
// Where 0.1.x kept each worktree's files. store.ts moves them out.
export const LEGACY_FOLDER = ".scratch";
export const EVENT_VERSION = 1;

export const TICKET_STATUSES = ["not_started", "working", "blocked", "done", "skipped"] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

const text = z.string().trim().min(1);
const minutes = z.number().int().positive().max(100_000);
// `by` is the Paseo agent that wrote the event, absent when run outside Paseo.
const base = { v: z.literal(EVENT_VERSION), ts: z.iso.datetime(), by: text.optional() };

export const questionOptionSchema = z.object({
  letter: z.string().regex(/^[A-Z]$/),
  label: text,
  consequence: text.optional(),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

const httpUrl = z.url().refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS URL");

// Something attached to a question: a local path or a web link.
export const fileLinkSchema = z
  .object({ path: text.optional(), url: httpUrl.optional(), label: text.optional() })
  .refine((file) => Boolean(file.path) !== Boolean(file.url), "Give a path or a URL");
export type FileLink = z.infer<typeof fileLinkSchema>;

export const DELIVERABLE_KINDS = ["file", "folder", "report", "screenshot", "link"] as const;

export const eventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("run.start"),
    title: text,
    subtitle: text.optional(),
    itemLabel: text.optional(),
  }),
  // Closes the run. Nothing more is recorded on it; new work needs `run.start`.
  z.object({ ...base, type: z.literal("run.finish"), outcome: text }),
  z.object({
    ...base,
    type: z.literal("ticket.add"),
    id: text,
    title: text,
    estimateMin: minutes,
    status: ticketStatusSchema.optional(),
    // Another ticket in the run this one can't start until it's done.
    waitsFor: text.optional(),
    // Where the ticket is written up: a spec file or an issue link.
    source: fileLinkSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("ticket.update"),
    id: text,
    title: text.optional(),
    estimateMin: minutes.optional(),
    status: ticketStatusSchema.optional(),
    // The step inside the ticket, like "Build" or "Fixes". Empty clears it.
    stage: z.string().trim().optional(),
    note: z.string().trim().optional(),
    // Empty clears it.
    waitsFor: z.string().trim().optional(),
    // Empty clears it.
    source: z.union([fileLinkSchema, z.literal("")]).optional(),
  }),
  z.object({ ...base, type: z.literal("ticket.remove"), id: text }),
  // A blocker that is not a ticket status, like a failing external service.
  z.object({ ...base, type: z.literal("stuck.set"), id: text, reason: text, ticket: text.optional() }),
  z.object({ ...base, type: z.literal("stuck.clear"), id: text }),
  // The agent asks and recommends an option. `mode` is the question mode when
  // asked; without it (0.3.0 to 1.3.x) the agent built nothing before the
  // answer, like "work-around". `big` says why the question holds even in
  // "keep-building" mode. Questions from before 0.3.0 carry `default`, the
  // option the agent carried on with unless it `waits`.
  z.object({
    ...base,
    type: z.literal("question.ask"),
    id: text,
    title: text,
    question: text,
    options: z.array(questionOptionSchema).max(26).optional(),
    // The agent's pick: an option letter, or a word such as "Looks right" when there are no options.
    recommend: text.optional(),
    mode: z.enum(QUESTION_MODES).optional(),
    big: text.optional(),
    default: text.optional(),
    waits: z.boolean().optional(),
    background: text.optional(),
    files: z.array(fileLinkSchema).optional(),
    raisedBy: text.optional(),
    // The ticket this question came up on.
    ticket: text.optional(),
  }),
  z.object({
    ...base,
    type: z.literal("question.answer"),
    id: text,
    choice: text,
    // The user's own words, quoted under the answer.
    words: text.optional(),
    // True when the agent had to undo work built on another option.
    changedCourse: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("question.update"),
    id: text,
    question: text.optional(),
    background: text.optional(),
    files: z.array(fileLinkSchema).optional(),
    recommend: text.optional(),
  }),
  z.object({ ...base, type: z.literal("question.remove"), id: text }),
  // `path` is relative to the worktree root, or absolute when outside it.
  z.object({
    ...base,
    type: z.literal("deliverable.add"),
    id: text,
    title: text,
    path: text.optional(),
    url: httpUrl.optional(),
    ticket: text.optional(),
    kind: z.enum(DELIVERABLE_KINDS).optional(),
  }).refine((event) => Boolean(event.path) !== Boolean(event.url), "A deliverable has a path or a URL"),
  z.object({ ...base, type: z.literal("deliverable.remove"), id: text }),
  z.object({ ...base, type: z.literal("activity.add"), id: text, text, ticket: text.optional() }),
  z.object({ ...base, type: z.literal("activity.update"), id: text, text }),
  z.object({ ...base, type: z.literal("activity.remove"), id: text }),
  // One line at the top saying what the agent is doing right now.
  z.object({ ...base, type: z.literal("ticker.set"), text }),
  z.object({ ...base, type: z.literal("ticker.clear") }),
]);

export type ProgressEvent = z.infer<typeof eventSchema>;
export type ProgressEventType = ProgressEvent["type"];
