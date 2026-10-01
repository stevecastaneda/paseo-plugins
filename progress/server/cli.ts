// The command agents run to record progress. Each command appends one event
// to the worktree's progress file and prints what it recorded.
import { realpathSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isSettled, type Dashboard, type NextIds } from "../shared/dashboard.ts";
import { DELIVERABLE_KINDS, TICKET_STATUSES } from "../shared/events.ts";
import { appendProgress, InvalidEvent, readProgress, type EventDraft } from "./progress-file.ts";
import { findRoot, outside } from "./paths.ts";
import { installLauncher } from "./launcher.ts";
import { findStore, saveRunCopy } from "./store.ts";
import { dashboardText } from "../shared/show.ts";
import { imageMimeType } from "../shared/attachments.ts";
import { homedir } from "node:os";

export interface CliOptions {
  cwd: string;
  now?: () => Date;
  out?: (line: string) => void;
}

class UsageError extends Error {}

interface State {
  dashboard: Dashboard;
  nextIds: NextIds;
}

interface Command {
  usage: string;
  summary: string;
  options?: Record<string, { type: "string" | "boolean"; multiple?: boolean }>;
  run(args: { positionals: string[]; values: Record<string, string | boolean | Array<string | boolean> | undefined>; state: State; cwd: string; root: string }): { event: EventDraft; message: string };
}

const USAGE_NAME = "paseo-progress";

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new UsageError(`Missing ${name}.`);
  return value.trim();
}

function minutesOption(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new UsageError(`--${name} must be a whole number of minutes, like 90.`);
  return number;
}

function statusOption(value: unknown) {
  if (value === undefined) return undefined;
  const status = String(value).replace(/-/g, "_");
  if (!(TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new UsageError(`--status must be one of: ${TICKET_STATUSES.join(", ")}.`);
  }
  return status as (typeof TICKET_STATUSES)[number];
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function listOption(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// "A=Even out the spacing | Cards look balanced" → letter, label, consequence.
function parseOption(raw: string) {
  const match = /^\s*([A-Za-z])\s*=\s*(.+)$/.exec(raw);
  if (!match) throw new UsageError(`--option must look like "A=<label> | <consequence>", got "${raw}".`);
  const [label, ...rest] = match[2].split("|").map((part) => part.trim());
  if (!label) throw new UsageError(`--option ${match[1].toUpperCase()} needs a label.`);
  return { letter: match[1].toUpperCase(), label, consequence: rest.join(" | ") || undefined };
}

const URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;

// "path/to/file.png=Before and after" → root-relative path and optional label.
// "https://example.com/?q=1=Preview" → URL and label: an "=" right after a
// query key belongs to the URL.
function parseFile(raw: string, cwd: string, root: string) {
  const isUrl = URL_PATTERN.test(raw);
  let index = isUrl ? raw.lastIndexOf("=") : raw.indexOf("=");
  while (isUrl && index !== -1 && /[?&][^=&#]*$/.test(raw.slice(0, index))) index = raw.lastIndexOf("=", index - 1);
  const target = (index === -1 ? raw : raw.slice(0, index)).trim();
  const label = index === -1 ? undefined : raw.slice(index + 1).trim() || undefined;
  if (!target) throw new UsageError(`--file needs a path or URL, got "${raw}".`);
  if (!isUrl) return { path: rootRelative(target, cwd, root), label };
  if (!/^https?:\/\//i.test(target)) throw new UsageError("Only http(s) URLs are supported; give local files as a path.");
  return { url: target, label };
}

function existingActivity(state: State, id: string | undefined) {
  const wanted = required(id, "activity id").toUpperCase();
  const entry = state.dashboard.activity.find((candidate) => candidate.id === wanted);
  if (!entry) {
    const known = state.dashboard.activity.map((candidate) => candidate.id).join(", ") || "none";
    throw new UsageError(`No activity ${wanted} in this run. Activity: ${known}.`);
  }
  return entry;
}

function existingQuestion(state: State, id: string | undefined) {
  const wanted = required(id, "question id").toUpperCase();
  const { open, answered } = state.dashboard.questions;
  const question = [...open, ...answered].find((candidate) => candidate.id === wanted);
  if (!question) {
    const known = [...open, ...answered].map((candidate) => candidate.id).join(", ") || "none";
    throw new UsageError(`No question ${wanted} in this run. Questions: ${known}.`);
  }
  return question;
}

function existingTicket(state: State, id: string | undefined) {
  const wanted = required(id, "ticket id").toUpperCase();
  const ticket = state.dashboard.tickets.find((candidate) => candidate.id.toUpperCase() === wanted);
  if (!ticket) {
    const known = state.dashboard.tickets.map((candidate) => candidate.id).join(", ") || "none";
    throw new UsageError(`No ticket ${wanted} in this run. Tickets: ${known}.`);
  }
  return ticket;
}

// What still has to be settled before a run can finish.
function unfinishedWork(dashboard: Dashboard): string[] {
  const label = (dashboard.run?.itemLabel ?? "Ticket").toLowerCase();
  const tickets = dashboard.tickets.filter((ticket) => !isSettled(ticket));
  const flagged = dashboard.stuck.filter((item) => item.kind === "manual");
  return [
    dashboard.questions.open.length
      ? `open questions ${dashboard.questions.open.map((question) => question.id).join(", ")} (record the answer with "question answer", or withdraw with "question remove")`
      : "",
    tickets.length ? `${label}s not done or skipped: ${tickets.map((ticket) => ticket.id).join(", ")}` : "",
    flagged.length ? `flagged blockers ${flagged.map((item) => item.id).join(", ")} (clear with "stuck clear")` : "",
  ].filter(Boolean);
}

const commands: Record<string, Command> = {
  start: {
    usage: `start "<title>" [--subtitle <text>] [--item-label <word>]`,
    summary: "Start a new run. Earlier runs stay in the file but leave the dashboard.",
    options: { subtitle: { type: "string" }, "item-label": { type: "string" } },
    run({ positionals, values }) {
      const title = required(positionals[0], "run title");
      return {
        event: { type: "run.start", title, subtitle: stringOption(values.subtitle), itemLabel: stringOption(values["item-label"]) },
        message: `Started run: ${title}`,
      };
    },
  },
  finish: {
    usage: `finish "<outcome>"`,
    summary: "Close the run with a one-line outcome. Every ticket must be done or skipped, no question open, nothing flagged stuck. New work after this needs start.",
    run({ positionals, state }) {
      const outcome = required(positionals[0], "outcome");
      if (!state.dashboard.run) throw new UsageError("No run to finish.");
      const left = unfinishedWork(state.dashboard);
      if (left.length) throw new UsageError(`Can't finish yet. Still open: ${left.join("; ")}.`);
      return { event: { type: "run.finish", outcome }, message: `Finished run: ${state.dashboard.run.title}` };
    },
  },
  "ticket add": {
    usage: `ticket add "<title>" --estimate <minutes> [--status <status>] [--waits-for <id>]`,
    summary: "Add a ticket. Prints its id (T01, T02, ...). --waits-for names a ticket it can't start before; that is the order of work, not a blocker.",
    options: { estimate: { type: "string" }, status: { type: "string" }, "waits-for": { type: "string" } },
    run({ positionals, values, state }) {
      const waitsFor = values["waits-for"] === undefined ? undefined : existingTicket(state, stringOption(values["waits-for"])).id;
      const title = required(positionals[0], "ticket title");
      const estimateMin = minutesOption(values.estimate, "estimate");
      if (estimateMin === undefined) throw new UsageError("Missing --estimate <minutes>.");
      const id = state.nextIds.ticket;
      return {
        event: { type: "ticket.add", id, title, estimateMin, status: statusOption(values.status), waitsFor },
        message: `Added ${id}: ${title} (${estimateMin} min)${waitsFor ? `, waits for ${waitsFor}` : ""}`,
      };
    },
  },
  "ticket update": {
    usage: `ticket update <id> [--status <status>] [--stage <name>] [--title <text>] [--estimate <minutes>] [--note <text>] [--waits-for <id>]`,
    summary: `Change a ticket. Statuses: ${TICKET_STATUSES.join(", ")}. --stage names the step in progress, like Build or Fixes ("" clears it). --waits-for names a ticket it can't start before ("" clears it); waiting is not stuck, so don't mark it blocked for that.`,
    options: { status: { type: "string" }, stage: { type: "string" }, title: { type: "string" }, estimate: { type: "string" }, note: { type: "string" }, "waits-for": { type: "string" } },
    run({ positionals, values, state }) {
      const ticket = existingTicket(state, positionals[0]);
      const rawWaitsFor = values["waits-for"] === undefined ? undefined : String(values["waits-for"]).trim();
      const waitsFor = rawWaitsFor === undefined || rawWaitsFor === "" ? rawWaitsFor : existingTicket(state, rawWaitsFor).id;
      if (waitsFor && waitsFor === ticket.id) throw new UsageError(`${ticket.id} can't wait for itself.`);
      // Refuse a loop (T01 waits for T02 waits for T01): neither could ever start.
      for (let next = waitsFor ? state.dashboard.tickets.find((entry) => entry.id === waitsFor) : undefined, seen = 0; next?.waitsFor && seen < 1000; seen++) {
        if (next.waitsFor === ticket.id) throw new UsageError(`${ticket.id} can't wait for ${waitsFor}: ${next.id} already waits for ${ticket.id}, so neither could start.`);
        next = state.dashboard.tickets.find((entry) => entry.id === next!.waitsFor);
      }
      const event = {
        type: "ticket.update" as const,
        id: ticket.id,
        title: stringOption(values.title),
        estimateMin: minutesOption(values.estimate, "estimate"),
        status: statusOption(values.status),
        stage: stringOption(values.stage),
        note: stringOption(values.note),
        waitsFor,
      };
      const changes = Object.entries(event).filter(([key, value]) => key !== "type" && key !== "id" && value !== undefined);
      if (!changes.length) throw new UsageError("Nothing to change. Pass --status, --stage, --title, --estimate, --note, or --waits-for.");
      return { event, message: `Updated ${ticket.id}: ${changes.map(([key, value]) => `${key} ${value}`).join(", ")}` };
    },
  },
  "ticket remove": {
    usage: `ticket remove <id>`,
    summary: "Remove a ticket from the dashboard.",
    run({ positionals, state }) {
      const ticket = existingTicket(state, positionals[0]);
      return { event: { type: "ticket.remove", id: ticket.id }, message: `Removed ${ticket.id}: ${ticket.title}` };
    },
  },
  "question ask": {
    usage: `question ask "<short title>" "<question>" [--option "A=<label> | <consequence>" ...] --default <letter or word> [--waits] [--background <text>] [--file <path or http(s) URL>[=<label>] ...] [--raised-by <text>] [--ticket <id>]`,
    summary: "Ask the user a question. Prints its reference (Q1, Q2, ...). Keep working on the default until it is answered, unless --waits: then the default is only a suggestion and you wait.",
    options: {
      option: { type: "string", multiple: true },
      default: { type: "string" },
      waits: { type: "boolean" },
      background: { type: "string" },
      file: { type: "string", multiple: true },
      "raised-by": { type: "string" },
      ticket: { type: "string" },
    },
    run({ positionals, values, state, cwd, root }) {
      const title = required(positionals[0], "short title");
      const ticket = values.ticket === undefined ? undefined : existingTicket(state, stringOption(values.ticket));
      const question = required(positionals[1], "question");
      const options = listOption(values.option).map(parseOption);
      const letters = options.map((option) => option.letter);
      const duplicate = letters.find((letter, index) => letters.indexOf(letter) !== index);
      if (duplicate) throw new UsageError(`Option ${duplicate} is given twice.`);
      let fallback = required(stringOption(values.default), "--default");
      if (options.length) {
        if (!/^[A-Za-z]$/.test(fallback) || !letters.includes(fallback.toUpperCase())) {
          throw new UsageError(`--default must be one of the option letters: ${letters.join(", ")}.`);
        }
        fallback = fallback.toUpperCase();
      }
      const id = state.nextIds.question;
      return {
        event: {
          type: "question.ask",
          id,
          title,
          question,
          options: options.length ? options : undefined,
          default: fallback,
          waits: values.waits === true ? true : undefined,
          background: stringOption(values.background),
          files: listOption(values.file).length ? listOption(values.file).map((raw) => parseFile(raw, cwd, root)) : undefined,
          raisedBy: stringOption(values["raised-by"]),
          ticket: ticket?.id,
        },
        message: `Asked ${id} (${title}). Default: ${fallback}${values.waits === true ? " (waiting for the answer)" : ""}`,
      };
    },
  },
  "question answer": {
    usage: `question answer <id> <choice> [--words "<what the user said>"]`,
    summary: "Record the user's answer. Choice is an option letter or the user's own short answer.",
    options: { words: { type: "string" } },
    run({ positionals, values, state }) {
      const question = existingQuestion(state, positionals[0]);
      let choice = required(positionals[1], "choice");
      const letters = question.options.map((option) => option.letter);
      if (/^[A-Za-z]$/.test(choice)) {
        choice = choice.toUpperCase();
        if (letters.length && !letters.includes(choice)) throw new UsageError(`${question.id} has options ${letters.join(", ")}, not ${choice}.`);
      }
      const changedCourse = choice.toLowerCase() !== question.default.toLowerCase();
      return {
        event: { type: "question.answer", id: question.id, choice, words: stringOption(values.words), changedCourse },
        message: `Answered ${question.id}: ${choice}${changedCourse ? ` (differs from default ${question.default}: change course)` : " (same as the default)"}`,
      };
    },
  },
  "question update": {
    usage: `question update <id> [--background <text>] [--question <text>] [--file <path or http(s) URL>[=<label>] ...]`,
    summary: "Add detail to a question: replace its background or wording, or add files. Its reference and default stay.",
    options: { background: { type: "string" }, question: { type: "string" }, file: { type: "string", multiple: true } },
    run({ positionals, values, state, cwd, root }) {
      const question = existingQuestion(state, positionals[0]);
      const files = listOption(values.file).map((raw) => parseFile(raw, cwd, root));
      const event = {
        type: "question.update" as const,
        id: question.id,
        question: stringOption(values.question),
        background: stringOption(values.background),
        files: files.length ? files : undefined,
      };
      if (!event.question && !event.background && !event.files) throw new UsageError("Nothing to change. Pass --background, --question, or --file.");
      return { event, message: `Updated ${question.id} (${question.title})` };
    },
  },
  "question remove": {
    usage: `question remove <id>`,
    summary: "Withdraw a question. Its reference is not reused.",
    run({ positionals, state }) {
      const question = existingQuestion(state, positionals[0]);
      return { event: { type: "question.remove", id: question.id }, message: `Removed ${question.id} (${question.title})` };
    },
  },
  "deliverable add": {
    usage: `deliverable add "<title>" <path or http(s) URL> [--ticket <id>] [--kind ${DELIVERABLE_KINDS.join("|")}]`,
    summary: "Add something the user can review. Paths are relative to where you run the command. Prints its id (D1, D2, ...).",
    options: { ticket: { type: "string" }, kind: { type: "string" } },
    run({ positionals, values, state, cwd, root }) {
      const title = required(positionals[0], "deliverable title");
      const target = required(positionals[1], "path or URL");
      const ticket = values.ticket === undefined ? undefined : existingTicket(state, stringOption(values.ticket));
      const kind = stringOption(values.kind);
      if (kind !== undefined && !(DELIVERABLE_KINDS as readonly string[]).includes(kind)) {
        throw new UsageError(`--kind must be one of: ${DELIVERABLE_KINDS.join(", ")}.`);
      }
      const isUrl = URL_PATTERN.test(target);
      if (isUrl && !/^https?:\/\//i.test(target)) throw new UsageError("Only http(s) URLs are supported; give local files as a path.");
      const id = state.nextIds.deliverable;
      return {
        event: {
          type: "deliverable.add",
          id,
          title,
          ...(isUrl ? { url: target } : { path: rootRelative(target, cwd, root) }),
          ticket: ticket?.id,
          kind: (kind as (typeof DELIVERABLE_KINDS)[number] | undefined) ?? guessKind(target, isUrl, cwd),
        },
        message: `Added ${id}: ${title}`,
      };
    },
  },
  "deliverable remove": {
    usage: `deliverable remove <id>`,
    summary: "Remove a deliverable from the dashboard.",
    run({ positionals, state }) {
      const wanted = required(positionals[0], "deliverable id").toUpperCase();
      const deliverable = state.dashboard.deliverables.find((candidate) => candidate.id === wanted);
      if (!deliverable) {
        const known = state.dashboard.deliverables.map((candidate) => candidate.id).join(", ") || "none";
        throw new UsageError(`No deliverable ${wanted} in this run. Deliverables: ${known}.`);
      }
      return { event: { type: "deliverable.remove", id: deliverable.id }, message: `Removed ${deliverable.id}: ${deliverable.title}` };
    },
  },
  "activity add": {
    usage: `activity add "<text>" [--ticket <id>]`,
    summary: "Log a short note in the Activity feed, on the ticket it is about. Prints its id (A1, A2, ...).",
    options: { ticket: { type: "string" } },
    run({ positionals, values, state }) {
      const text = required(positionals[0], "activity text");
      const ticket = values.ticket === undefined ? undefined : existingTicket(state, stringOption(values.ticket));
      const id = state.nextIds.activity;
      return { event: { type: "activity.add", id, text, ticket: ticket?.id }, message: `Logged ${id}${ticket ? ` on ${ticket.id}` : ""}: ${text}` };
    },
  },
  "activity update": {
    usage: `activity update <id> "<text>"`,
    summary: "Reword an activity note.",
    run({ positionals, state }) {
      const entry = existingActivity(state, positionals[0]);
      const text = required(positionals[1], "activity text");
      return { event: { type: "activity.update", id: entry.id, text }, message: `Updated ${entry.id}: ${text}` };
    },
  },
  "activity remove": {
    usage: `activity remove <id>`,
    summary: "Remove an activity note.",
    run({ positionals, state }) {
      const entry = existingActivity(state, positionals[0]);
      return { event: { type: "activity.remove", id: entry.id }, message: `Removed ${entry.id}: ${entry.text}` };
    },
  },
  "ticker set": {
    usage: `ticker set "<text>"`,
    summary: "Show one line at the top saying what you are doing right now.",
    run({ positionals }) {
      const text = required(positionals[0], "ticker text");
      return { event: { type: "ticker.set", text }, message: `Ticker: ${text}` };
    },
  },
  "ticker clear": {
    usage: `ticker clear`,
    summary: "Hide the ticker line.",
    run() {
      return { event: { type: "ticker.clear" }, message: "Ticker cleared" };
    },
  },
  "stuck set": {
    usage: `stuck set "<reason>" [--ticket <id>]`,
    summary: "Flag a blocker that is not a ticket status. Prints its id (S1, S2, ...).",
    options: { ticket: { type: "string" } },
    run({ positionals, values, state }) {
      const reason = required(positionals[0], "reason");
      const ticket = values.ticket === undefined ? undefined : existingTicket(state, stringOption(values.ticket));
      const id = state.nextIds.stuck;
      return { event: { type: "stuck.set", id, reason, ticket: ticket?.id }, message: `Flagged ${id}: ${reason}` };
    },
  },
  "stuck clear": {
    usage: `stuck clear <id>`,
    summary: "Clear a flagged blocker.",
    run({ positionals, state }) {
      const wanted = required(positionals[0], "stuck id").toUpperCase();
      const item = state.dashboard.stuck.find((candidate) => candidate.kind === "manual" && candidate.id === wanted);
      if (!item || item.kind !== "manual") {
        const known = state.dashboard.stuck.flatMap((candidate) => (candidate.kind === "manual" ? [candidate.id] : [])).join(", ") || "none";
        throw new UsageError(`No flagged blocker ${wanted}. Flagged: ${known}.`);
      }
      return { event: { type: "stuck.clear", id: item.id }, message: `Cleared ${item.id}: ${item.reason}` };
    },
  },
};

// Stored relative to the worktree root so the panel can resolve it against
// the workspace directory; paths outside the worktree stay absolute.
function rootRelative(target: string, cwd: string, root: string): string {
  const absolute = resolve(cwd, target);
  const inside = relative(root, absolute);
  const suffix = /[\/]$/.test(target) ? "/" : "";
  if (!inside) return "./";
  return outside(inside) ? absolute + suffix : inside + suffix;
}

function guessKind(target: string, isUrl: boolean, cwd: string): (typeof DELIVERABLE_KINDS)[number] {
  if (isUrl) return "link";
  if (/[\/]$/.test(target) || statSync(resolve(cwd, target), { throwIfNoEntry: false })?.isDirectory()) return "folder";
  if (imageMimeType(target)) return "screenshot";
  return "file";
}

const SHOW_SUMMARY = "Print the dashboard as text: what the user sees in the Progress panel.";
const INSTALL_SUMMARY = "Write the paseo-progress launcher (default ~/.local/bin/paseo-progress). It runs this command from whichever copy of the plugin Paseo is running.";
const DEFAULT_LAUNCHER = "~/.local/bin/paseo-progress";

function help(): string {
  return [
    `Usage: ${USAGE_NAME} <command>`,
    "",
    `Records progress for this worktree, shown by the Progress panel in Paseo. The file lives outside the repo, so git never sees it.`,
    `Add --help after any command for its options.`,
    "",
    ...Object.values(commands).flatMap((command) => [`  ${command.usage}`, `      ${command.summary}`]),
    `  show`,
    `      ${SHOW_SUMMARY}`,
    `  install-launcher [path]`,
    `      ${INSTALL_SUMMARY}`,
  ].join("\n");
}

export async function runCli(argv: string[], options: CliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  const [first, second] = argv;
  if (!first || first === "--help" || first === "-h" || first === "help") {
    out(help());
    return first ? 0 : 1;
  }
  if (first === "show" || first === "install-launcher") {
    if (argv.slice(1).includes("--help") || argv.slice(1).includes("-h")) {
      out(first === "show" ? `Usage: ${USAGE_NAME} show\n\n${SHOW_SUMMARY}` : `Usage: ${USAGE_NAME} install-launcher [path]\n\n${INSTALL_SUMMARY}`);
      return 0;
    }
    if (first === "show") {
      const root = findRoot(options.cwd);
      const store = await findStore(root);
      out(`Worktree: ${root}\n\n${dashboardText((await readProgress(store.directory, now())).dashboard, now().getTime())}`);
      return 0;
    }
    const target = resolve(options.cwd, (argv[1] ?? DEFAULT_LAUNCHER).replace(/^~(?=$|\/)/, homedir()));
    out(await installLauncher(target) ? `Installed the launcher at ${target}` : `The launcher at ${target} is already current`);
    return 0;
  }
  const twoWord = commands[`${first} ${second}`];
  const command = twoWord ?? commands[first];
  if (!command) {
    out(`Unknown command: ${[first, second].filter(Boolean).join(" ")}\n\n${help()}`);
    return 1;
  }
  const rest = argv.slice(twoWord ? 2 : 1);
  if (rest.includes("--help") || rest.includes("-h")) {
    out(`Usage: ${USAGE_NAME} ${command.usage}\n\n${command.summary}`);
    return 0;
  }
  try {
    let parsed;
    try {
      parsed = parseArgs({ args: rest, options: command.options ?? {}, allowPositionals: true, strict: true });
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    const root = findRoot(options.cwd);
    const store = await findStore(root);
    const message = await appendProgress(store.directory, now, (state) => {
      const finished = state.dashboard.run?.finished;
      if (finished && command !== commands.start) {
        throw new UsageError(`The run "${state.dashboard.run!.title}" is finished. Start new work with: ${USAGE_NAME} start "<title>"`);
      }
      const { event, message } = command.run({ positionals: parsed.positionals, values: parsed.values, state, cwd: options.cwd, root });
      return { event, result: message };
    }, (text) => saveRunCopy(root, text));
    out(message);
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof InvalidEvent) {
      out(`${error.message}\nUsage: ${USAGE_NAME} ${command.usage}`);
      return 1;
    }
    throw error;
  }
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  runCli(process.argv.slice(2), { cwd: process.cwd() }).then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
