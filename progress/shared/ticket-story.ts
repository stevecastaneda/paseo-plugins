import type { Activity, Deliverable, Question, Ticket } from "./dashboard.ts";
import type { TicketStatus } from "./events.ts";

// One span in a ticket's life: from a status or stage change to the next one.
export interface TimelineStep {
  at: string;
  // When the next step began; null while this one is still going (or it's the end).
  until: string | null;
  label: string;
  status: TicketStatus;
  notes: string[];
  // Length of the step; null for a finished ticket's last step, which has no end.
  minutes: number | null;
}

// Where a related item came from: tagged with `--ticket`, or logged while the
// ticket was the one working (older entries, recorded before tags existed).
export type Link = "tagged" | "by-time";

export interface TicketStory {
  timeline: TimelineStep[];
  workedMin: number;
  deliverables: Deliverable[];
  questions: Array<Question & { link: Link }>;
  activity: Array<Activity & { link: Link }>;
}

const OPEN_ENDED: TicketStatus[] = ["working", "blocked", "not_started"];

function labelFor(status: TicketStatus, stage: string | undefined, first: boolean): string {
  if (first && status === "not_started") return "Added";
  switch (status) {
    case "working": return stage ? `${stage} stage` : "Working";
    case "blocked": return "Blocked";
    case "done": return "Done";
    case "skipped": return "Skipped";
    default: return "Back to not started";
  }
}

export function ticketTimeline(ticket: Ticket, nowMs: number): TimelineStep[] {
  const steps: TimelineStep[] = [];
  let status: TicketStatus = "not_started";
  let stage: string | undefined;
  ticket.history.forEach((change, index) => {
    const statusChanged = change.status !== undefined && change.status !== status;
    const stageChanged = change.stage !== undefined && (change.stage || undefined) !== stage;
    if (change.status !== undefined) status = change.status;
    if (change.stage !== undefined) stage = change.stage || undefined;
    // A new step when the status changes, or the stage changes while working.
    if (index === 0 || statusChanged || (stageChanged && status === "working")) {
      steps.push({ at: change.at, until: null, label: labelFor(status, stage, index === 0), status, notes: [], minutes: null });
    }
    if (change.note) steps[steps.length - 1].notes.push(change.note);
  });
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    step.until = next?.at ?? null;
    const end = next ? Date.parse(next.at) : OPEN_ENDED.includes(step.status) ? nowMs : null;
    step.minutes = end === null ? null : Math.max(0, (end - Date.parse(step.at)) / 60_000);
  });
  return steps;
}

// Spans when this ticket was the one working, for matching untagged entries by time.
// Each includes its start but not its end, so an entry logged at a handoff
// belongs to the ticket that just started.
function workingWindows(steps: TimelineStep[], nowMs: number): Array<[number, number]> {
  return steps
    .filter((step) => step.status === "working")
    .map((step) => [Date.parse(step.at), step.until ? Date.parse(step.until) : nowMs + 1]);
}

export function ticketStory(ticket: Ticket, related: { deliverables: Deliverable[]; questions: Question[]; activity: Activity[] }, nowMs: number): TicketStory {
  const timeline = ticketTimeline(ticket, nowMs);
  const windows = workingWindows(timeline, nowMs);
  const during = (iso: string) => windows.some(([from, to]) => Date.parse(iso) >= from && Date.parse(iso) < to);
  const link = <T extends { ticketId?: string }>(item: T, at: string): Link | null =>
    item.ticketId ? (item.ticketId === ticket.id ? "tagged" : null) : during(at) ? "by-time" : null;
  return {
    timeline,
    workedMin: timeline.filter((step) => step.status === "working").reduce((sum, step) => sum + (step.minutes ?? 0), 0),
    deliverables: related.deliverables.filter((deliverable) => deliverable.ticketId === ticket.id),
    questions: related.questions.flatMap((question) => {
      const found = link(question, question.askedAt);
      return found ? [{ ...question, link: found }] : [];
    }),
    activity: related.activity.flatMap((entry) => {
      const found = link(entry, entry.at);
      return found ? [{ ...entry, link: found }] : [];
    }),
  };
}
