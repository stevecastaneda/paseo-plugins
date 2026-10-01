import { EVENT_VERSION, eventSchema, type DELIVERABLE_KINDS, type FileLink, type ProgressEvent, type QuestionOption, type TicketStatus } from "./events.ts";

// One recorded change to a ticket, oldest first. `stage: ""` clears the stage.
export interface TicketChange {
  at: string;
  status?: TicketStatus;
  stage?: string;
  note?: string;
}

export interface Ticket {
  id: string;
  title: string;
  estimateMin: number;
  status: TicketStatus;
  // When the ticket entered its current status.
  statusSince: string;
  // When the ticket last started working.
  workingSince?: string;
  stage?: string;
  stageSince?: string;
  note?: string;
  // The ticket this one waits for, while that ticket isn't done or skipped yet.
  // Waiting is the order of work, not a problem, so it never counts as stuck.
  waitingFor?: { id: string; title: string };
  waitsFor?: string;
  // Every status, stage and note change, starting with when it was added.
  history: TicketChange[];
}

export type StuckItem =
  | { kind: "blocked"; key: string; ticketId: string; title: string; since: string; note?: string }
  // A working ticket with no update for longer than its estimate. `since` is its last update.
  | { kind: "overdue"; key: string; ticketId: string; title: string; since: string; estimateMin: number }
  | { kind: "manual"; key: string; id: string; ticketId?: string; title: string; reason: string; since: string };

export interface Question {
  id: string;
  title: string;
  question: string;
  options: QuestionOption[];
  default: string;
  waits: boolean;
  background?: string;
  files: FileLink[];
  raisedBy?: string;
  ticketId?: string;
  askedAt: string;
  answer?: { choice: string; words?: string; changedCourse: boolean; at: string };
}

export interface Deliverable {
  id: string;
  title: string;
  path?: string;
  url?: string;
  ticketId?: string;
  // Short name of the ticket, like "Ticket 03", when the ticket still exists.
  ticketLabel?: string;
  kind?: (typeof DELIVERABLE_KINDS)[number];
  addedAt: string;
}

export interface Activity {
  id: string;
  text: string;
  ticketId?: string;
  at: string;
  editedAt?: string;
}

// One comma-separated part of the headline, e.g. "1 stuck" in the alert color.
export interface HeadlinePart {
  text: string;
  tone: "normal" | "danger";
}

// Something in the file the dashboard could not use. The panel lists these so
// one bad write is visible without hiding the rest.
export interface FileIssue {
  line: number;
  reason: string;
}

export interface ProgressSegment {
  id: string;
  estimateMin: number;
  status: TicketStatus;
  waiting?: boolean;
}

export interface Dashboard {
  run: {
    title: string;
    subtitle?: string;
    itemLabel: string;
    startedAt: string;
    // Set by `finish`: the run is over and the next work starts a new one.
    finished?: { at: string; outcome: string };
  } | null;
  updatedAt: string | null;
  // Nothing recorded for STALE_AFTER_MIN while tickets remain: the work may have stopped.
  stale: boolean;
  headline: HeadlinePart[];
  stuck: StuckItem[];
  // Open questions in ask order; answered ones, most recently answered first.
  questions: { open: Question[]; answered: Question[] };
  // Newest first.
  deliverables: Deliverable[];
  // Newest first.
  activity: Activity[];
  ticker: { text: string; since: string } | null;
  // Share of estimated minutes in done tickets. Skipped tickets are left out.
  // `tookMin`: once every counted ticket is done, the real time from the run's
  // start to the last one finishing.
  progress: { percent: number; doneMin: number; totalMin: number; tookMin?: number; segments: ProgressSegment[] };
  tickets: Ticket[];
  issues: FileIssue[];
}

// The id the next add of each kind gets. Ids are never reused, even after a
// remove. Question ids stay unique across runs, so an answer like "Q7 A" can't
// land on a question from an earlier run; the rest restart with each run.
export interface NextIds {
  ticket: string;
  question: string;
  deliverable: string;
  activity: string;
  stuck: string;
}

export interface ParsedLine {
  line: number;
  event: ProgressEvent;
}

// Reads the JSONL text. A last line without a newline may be half written by
// a command that is still running, so it is skipped without an issue.
export function parseProgress(text: string): { events: ParsedLine[]; issues: FileIssue[] } {
  const events: ParsedLine[] = [];
  const issues: FileIssue[] = [];
  // Whether or not the text ends in a newline, the last split piece is either
  // empty or unfinished.
  text.split("\n").slice(0, -1).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      issues.push({ line, reason: "not valid JSON" });
      return;
    }
    const parsed = eventSchema.safeParse(json);
    if (parsed.success) events.push({ line, event: parsed.data });
    else issues.push({ line, reason: describeInvalid(json) });
  });
  return { events, issues };
}

function describeInvalid(json: unknown): string {
  const version = typeof json === "object" && json !== null && "v" in json ? (json as { v: unknown }).v : undefined;
  if (typeof version === "number" && version !== EVENT_VERSION) return `written by a newer version of the plugin (v${version})`;
  const type = typeof json === "object" && json !== null && "type" in json ? String((json as { type: unknown }).type) : null;
  return type ? `invalid ${type} event` : "not a progress event";
}

export const STALE_AFTER_MIN = 15;

// Every time-dependent rule asks `reached(at)` instead of comparing with `now`
// itself. Each answer also records the moment it would flip, so `validUntil`
// is the first millisecond at which the same events can produce a different
// dashboard, and a new rule can't forget to tell the cache.
function clock(now: Date) {
  let validUntil = Infinity;
  return {
    reached(at: number): boolean {
      if (now.getTime() >= at) return true;
      validUntil = Math.min(validUntil, at);
      return false;
    },
    get validUntil() {
      return validUntil;
    },
  };
}

export function isSettled(ticket: Ticket): boolean {
  return ticket.status === "done" || ticket.status === "skipped";
}

// Folds the events of the latest run into what the panel shows at `now`, how
// long that stays true while the events don't change, and the ids new items get.
// Everything before the last `run.start` belongs to earlier runs and is ignored.
export function reduceProgress(parsed: { events: ParsedLine[]; issues: FileIssue[] }, now: Date): { dashboard: Dashboard; validUntil: number; nextIds: NextIds } {
  const time = clock(now);
  let start = 0;
  parsed.events.forEach(({ event }, index) => {
    if (event.type === "run.start") start = index;
  });
  const events = parsed.events.slice(start);
  const issues = [...parsed.issues];
  let run: Dashboard["run"] = null;
  const tickets = new Map<string, Ticket>();
  const questions = new Map<string, Question>();
  const deliverables = new Map<string, Deliverable>();
  const activity = new Map<string, Activity>();
  let ticker: Dashboard["ticker"] = null;
  const manualStuck = new Map<string, { id: string; reason: string; ticket?: string; since: string }>();
  let updatedAt: string | null = null;

  for (const { line, event } of events) {
    updatedAt = event.ts;
    switch (event.type) {
      case "run.start":
        run = { title: event.title, subtitle: event.subtitle, itemLabel: event.itemLabel ?? "Ticket", startedAt: event.ts };
        break;
      case "run.finish":
        if (run) run.finished = { at: event.ts, outcome: event.outcome };
        ticker = null;
        break;
      case "ticket.add":
        tickets.set(event.id, {
          id: event.id,
          title: event.title,
          estimateMin: event.estimateMin,
          status: event.status ?? "not_started",
          statusSince: event.ts,
          workingSince: event.status === "working" ? event.ts : undefined,
          history: [{ at: event.ts, status: event.status ?? "not_started" }],
          waitsFor: event.waitsFor,
        });
        break;
      case "ticket.update": {
        const ticket = tickets.get(event.id);
        if (!ticket) {
          issues.push({ line, reason: `unknown ticket ${event.id}` });
          break;
        }
        if (event.title !== undefined) ticket.title = event.title;
        if (event.estimateMin !== undefined) ticket.estimateMin = event.estimateMin;
        const change: TicketChange = { at: event.ts };
        if (event.status !== undefined && event.status !== ticket.status) change.status = event.status;
        if (event.stage !== undefined && event.stage !== (ticket.stage ?? "")) change.stage = event.stage;
        if (event.note) change.note = event.note;
        if (Object.keys(change).length > 1) ticket.history.push(change);
        if (event.status !== undefined && event.status !== ticket.status) {
          ticket.status = event.status;
          ticket.statusSince = event.ts;
          if (event.status === "working") ticket.workingSince = event.ts;
        }
        if (event.stage !== undefined && event.stage !== (ticket.stage ?? "")) {
          ticket.stage = event.stage || undefined;
          ticket.stageSince = event.stage ? event.ts : undefined;
        }
        if (event.note !== undefined) ticket.note = event.note || undefined;
        if (event.waitsFor !== undefined) ticket.waitsFor = event.waitsFor || undefined;
        break;
      }
      case "ticket.remove":
        if (!tickets.delete(event.id)) issues.push({ line, reason: `unknown ticket ${event.id}` });
        break;
      case "question.ask":
        questions.set(event.id, {
          id: event.id,
          title: event.title,
          question: event.question,
          options: event.options ?? [],
          default: event.default,
          waits: event.waits ?? false,
          background: event.background,
          files: event.files ?? [],
          raisedBy: event.raisedBy,
          ticketId: event.ticket,
          askedAt: event.ts,
        });
        break;
      case "question.answer": {
        const question = questions.get(event.id);
        if (!question) issues.push({ line, reason: `unknown question ${event.id}` });
        else question.answer = { choice: event.choice, words: event.words, changedCourse: event.changedCourse, at: event.ts };
        break;
      }
      case "question.update": {
        const question = questions.get(event.id);
        if (!question) {
          issues.push({ line, reason: `unknown question ${event.id}` });
          break;
        }
        if (event.question !== undefined) question.question = event.question;
        if (event.background !== undefined) question.background = event.background;
        if (event.files !== undefined) question.files = [...question.files, ...event.files];
        break;
      }
      case "question.remove":
        if (!questions.delete(event.id)) issues.push({ line, reason: `unknown question ${event.id}` });
        break;
      case "deliverable.add":
        deliverables.set(event.id, {
          id: event.id,
          title: event.title,
          path: event.path,
          url: event.url,
          ticketId: event.ticket,
          kind: event.kind,
          addedAt: event.ts,
        });
        break;
      case "deliverable.remove":
        if (!deliverables.delete(event.id)) issues.push({ line, reason: `unknown deliverable ${event.id}` });
        break;
      case "activity.add":
        activity.set(event.id, { id: event.id, text: event.text, ticketId: event.ticket, at: event.ts });
        break;
      case "activity.update": {
        const entry = activity.get(event.id);
        if (!entry) issues.push({ line, reason: `unknown activity ${event.id}` });
        else Object.assign(entry, { text: event.text, editedAt: event.ts });
        break;
      }
      case "activity.remove":
        if (!activity.delete(event.id)) issues.push({ line, reason: `unknown activity ${event.id}` });
        break;
      case "ticker.set":
        ticker = { text: event.text, since: event.ts };
        break;
      case "ticker.clear":
        ticker = null;
        break;
      case "stuck.set":
        manualStuck.set(event.id, { id: event.id, reason: event.reason, ticket: event.ticket, since: event.ts });
        break;
      case "stuck.clear":
        if (!manualStuck.delete(event.id)) issues.push({ line, reason: `unknown stuck item ${event.id}` });
        break;
    }
  }

  const list = [...tickets.values()];
  for (const ticket of list) {
    const other = ticket.waitsFor ? tickets.get(ticket.waitsFor) : undefined;
    ticket.waitingFor = other && !isSettled(other) && !isSettled(ticket)
      ? { id: other.id, title: other.title }
      : undefined;
  }
  const itemLabel = run?.itemLabel ?? "Ticket";
  const stuck = stuckItems(list, [...activity.values()], [...manualStuck.values()], time.reached);
  const allQuestions = [...questions.values()];
  const open = allQuestions.filter((question) => !question.answer);
  // A finished run has nothing left to stall, so it never goes stale.
  const finished = Boolean(run?.finished) || (list.length > 0 && list.every(isSettled));
  const answered = allQuestions
    .filter((question) => question.answer)
    .sort((a, b) => Date.parse(b.answer!.at) - Date.parse(a.answer!.at));
  const dashboard: Dashboard = {
    run,
    updatedAt,
    stale: !finished && updatedAt !== null && time.reached(Date.parse(updatedAt) + STALE_AFTER_MIN * 60_000),
    headline: headline(list, itemLabel, open.length, stuck.length),
    stuck,
    questions: { open, answered },
    activity: [...activity.values()].reverse(),
    ticker,
    deliverables: [...deliverables.values()].reverse().map((deliverable) => {
      const ticket = deliverable.ticketId ? tickets.get(deliverable.ticketId) : undefined;
      return ticket ? { ...deliverable, ticketLabel: shortTitle(ticket.title) } : deliverable;
    }),
    progress: progress(list, run?.startedAt),
    tickets: list,
    issues: issues.sort((a, b) => a.line - b.line),
  };
  return { dashboard, validUntil: time.validUntil, nextIds: nextIds(parsed.events.map(({ event }) => event), events.map(({ event }) => event)) };
}

function nextIds(all: ProgressEvent[], inRun: ProgressEvent[]): NextIds {
  const used = (events: ProgressEvent[], type: ProgressEvent["type"]) => events.flatMap((event) => (event.type === type && "id" in event ? [event.id] : []));
  return {
    ticket: nextId("T", used(inRun, "ticket.add")),
    question: nextId("Q", used(all, "question.ask"), 1),
    deliverable: nextId("D", used(inRun, "deliverable.add"), 1),
    activity: nextId("A", used(inRun, "activity.add"), 1),
    stuck: nextId("S", used(inRun, "stuck.set"), 1),
  };
}

function progress(tickets: Ticket[], startedAt: string | undefined): Dashboard["progress"] {
  const counted = tickets.filter((ticket) => ticket.status !== "skipped");
  const totalMin = counted.reduce((sum, ticket) => sum + ticket.estimateMin, 0);
  const doneMin = counted.filter((ticket) => ticket.status === "done").reduce((sum, ticket) => sum + ticket.estimateMin, 0);
  // All done: the last ticket to settle, done or skipped, ended the work.
  const allDone = counted.length > 0 && counted.every((ticket) => ticket.status === "done") && tickets.every(isSettled);
  const endedAt = Math.max(...tickets.map((ticket) => Date.parse(ticket.statusSince)));
  return {
    percent: totalMin ? Math.round((doneMin / totalMin) * 100) : 0,
    doneMin,
    totalMin,
    tookMin: allDone && startedAt ? Math.max(0, (endedAt - Date.parse(startedAt)) / 60_000) : undefined,
    segments: counted.map(({ id, estimateMin, status, waitingFor }) => ({ id, estimateMin, status, waiting: Boolean(waitingFor) })),
  };
}

function lastTicketUpdate(ticket: Ticket, activity: Activity[]): number {
  return Math.max(
    ...ticket.history.map((change) => Date.parse(change.at)),
    ...activity.filter((entry) => entry.ticketId === ticket.id).map((entry) => Date.parse(entry.at)),
  );
}

function stuckItems(tickets: Ticket[], activity: Activity[], manual: Array<{ id: string; reason: string; ticket?: string; since: string }>, reached: (at: number) => boolean): StuckItem[] {
  const items: StuckItem[] = [];
  for (const ticket of tickets) {
    // Blocked only on another ticket in the run is waiting, not stuck.
    if (ticket.status === "blocked" && !ticket.waitingFor) {
      items.push({ kind: "blocked", key: `blocked:${ticket.id}`, ticketId: ticket.id, title: ticket.title, since: ticket.statusSince, note: ticket.note });
    } else if (ticket.status === "working") {
      // Any sign of work resets the clock: a status, stage or note change, or activity tagged to the ticket.
      const lastUpdate = lastTicketUpdate(ticket, activity);
      // Overdue once more than the estimate has passed, so a millisecond after it.
      if (reached(lastUpdate + ticket.estimateMin * 60_000 + 1)) {
        items.push({
          kind: "overdue",
          key: `overdue:${ticket.id}`,
          ticketId: ticket.id,
          title: ticket.title,
          since: new Date(lastUpdate).toISOString(),
          estimateMin: ticket.estimateMin,
        });
      }
    }
  }
  for (const item of manual) {
    const ticket = item.ticket ? tickets.find((candidate) => candidate.id === item.ticket) : undefined;
    items.push({
      kind: "manual",
      key: `manual:${item.id}`,
      id: item.id,
      ticketId: item.ticket,
      title: ticket?.title ?? item.reason,
      reason: item.reason,
      since: item.since,
    });
  }
  return items;
}

// "Ticket 03: Frozen links survive deletes" → "Ticket 03".
export function shortTitle(title: string): string {
  const index = title.indexOf(":");
  return index > 0 && index <= 24 ? title.slice(0, index) : title;
}

// How many tickets at the top of the list are finished (done or skipped), so
// the panel can fold them into one row and the work still ahead sits near the
// top. Only the leading run folds: a ticket finished out of order stays in
// place, so the plan's order never looks shuffled. A single one isn't worth a
// fold row. Once every ticket is finished nothing is ahead, and the whole list
// is the record of the run, so nothing folds.
export function finishedAtTop(tickets: Ticket[]): number {
  const index = tickets.findIndex((ticket) => ticket.status !== "done" && ticket.status !== "skipped");
  return index >= 2 ? index : 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function headline(tickets: Ticket[], itemLabel: string, waiting: number, stuck: number): HeadlinePart[] {
  const counted = tickets.filter((ticket) => ticket.status !== "skipped");
  const done = counted.filter((ticket) => ticket.status === "done").length;
  const parts: HeadlinePart[] = [{ text: `${done} of ${plural(counted.length, itemLabel.toLowerCase())} done`, tone: "normal" }];
  if (waiting) parts.push({ text: `${plural(waiting, "question")} waiting for you`, tone: "normal" });
  if (stuck) parts.push({ text: `${stuck} stuck`, tone: "danger" });
  return parts;
}

export function headlineText(dashboard: Dashboard): string {
  return dashboard.headline.map((part) => part.text).join(", ");
}

function nextId(prefix: string, used: Iterable<string>, width = 2): string {
  let max = 0;
  for (const id of used) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

export const EMPTY_DASHBOARD: Dashboard = {
  run: null,
  updatedAt: null,
  stale: false,
  headline: [],
  stuck: [],
  questions: { open: [], answered: [] },
  deliverables: [],
  activity: [],
  ticker: null,
  progress: { percent: 0, doneMin: 0, totalMin: 0, segments: [] },
  tickets: [],
  issues: [],
};
