// Everything that reads or writes a worktree's progress files: the event log
// the command appends to and the panel-opened marker. Each function takes the
// dashboard it's for and finds the store itself, so no caller can read a
// worktree's file without saying whose view of it. The command and the panel's
// RPC handlers go through here, so they agree on how it's read.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  EMPTY_DASHBOARD,
  latestRun,
  parseProgress,
  reduceProgress,
  type Dashboard,
  type FileIssue,
  type NextIds,
  type ParsedLine,
} from "../shared/dashboard.ts";
import { EVENT_VERSION, eventSchema, PANEL_OPENED_NAME, PROGRESS_FILE_NAME, type ProgressEvent } from "../shared/events.ts";
import type { WorkspaceId } from "../shared/workspace.ts";
import { withLock } from "./lock.ts";
import type { DashboardAt } from "./paths.ts";
import { stateRoot } from "./store.ts";
import { appendFileIn, makeFolder, writeFileIn } from "./system.ts";

const LOCK_NAME = `${PROGRESS_FILE_NAME}.lock`;

// An event as a command builds it; `append` stamps the version, the time and
// the workspace.
export type EventDraft = { [K in ProgressEvent["type"]]: Omit<Extract<ProgressEvent, { type: K }>, "v" | "ts" | "ws"> }[ProgressEvent["type"]];

// A draft the event schema rejects. The message names each bad field.
export class InvalidEvent extends Error {}

export interface ProgressRead {
  // Whether this dashboard has a progress file at all.
  configured: boolean;
  dashboard: Dashboard;
  panelOpened: boolean;
  // The file, as people see its path. Every workspace on a folder shares it.
  file: string;
}

// The latest run of a dashboard as saved run history keeps it: the lines as
// the commands wrote them.
export interface SavedRun {
  startedAt: string;
  title: string;
  lines: string[];
}

// One snapshot of a store's file, parsed once and shared by every view of it.
interface ParsedFile {
  events: ParsedLine[];
  issues: FileIssue[];
  // The file's lines as written, line 1 first.
  raw: string[];
}

// The lines one dashboard holds, in file order.
interface View {
  events: ParsedLine[];
  issues: FileIssue[];
}

// `shown` is what the dashboard displays; `base` is what its next command
// builds on. They differ only while a workspace's display hides a run.
type Views = { shown: View; base: View };

// `directory` holds the working files. `shown` names it for people.
type Store = { directory: string; shown: string };

// One folder per worktree on this computer, named so a person can tell which
// worktree it belongs to.
export function outsideDirectory(root: string, home = homedir()): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(stateRoot(home), `${basename(real)}-${hash}`);
}

// The worktree's working files, always outside the repo. Progress never reads
// a repo's .scratch, where 0.1.x kept them: a cloned repo could put anything there.
function findStore(root: string, home = homedir()): Store {
  const directory = outsideDirectory(root, home);
  return { directory, shown: directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory };
}

// The parsed file per store, kept until its size or change time moves. The
// file only grows, and the panel and pills read it every few seconds.
const parsedFiles = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; parsed: ParsedFile }>();
// Views and dashboards hang off the snapshot they came from, so a replaced
// snapshot takes them along when it's collected.
const views = new WeakMap<ParsedFile, Map<WorkspaceId | null, Views>>();
const dashboards = new WeakMap<View, { dashboard: Dashboard; from: number; until: number }>();

// The dashboard at `now`, for the panel, the pills and `show`. Repeated reads
// reuse the last one until the file changes or a stale or overdue time passes.
// Stale and overdue checks use the daemon host's clock, the same clock the
// command stamps events with.
export async function readProgress(at: DashboardAt, now = new Date()): Promise<ProgressRead> {
  const store = findStore(at.root);
  const file = join(store.shown, PROGRESS_FILE_NAME);
  const parsed = await readParsed(store.directory);
  const panelOpened = await exists(join(store.directory, PANEL_OPENED_NAME));
  if (parsed === null) return { configured: false, dashboard: EMPTY_DASHBOARD, panelOpened, file };
  const { shown } = viewOf(parsed, at.workspace);
  let cached = dashboards.get(shown);
  // A backwards clock jump must also re-evaluate stale/overdue state.
  if (!cached || now.getTime() < cached.from || now.getTime() >= cached.until) {
    const { dashboard, validUntil } = reduceProgress(shown, now);
    cached = { dashboard, from: now.getTime(), until: validUntil };
    dashboards.set(shown, cached);
  }
  // A file holding only other workspaces' runs is no file yet to this dashboard.
  const configured = shown.events.length > 0 || shown.issues.length > 0 || parsed.events.length === 0;
  return { configured, dashboard: cached.dashboard, panelOpened, file };
}

// The events of the latest run, oldest first.
export async function readLatestRun(at: DashboardAt): Promise<ProgressEvent[]> {
  const parsed = await readParsed(findStore(at.root).directory);
  return latestRun(parsed ? viewOf(parsed, at.workspace).shown.events : []).map(({ event }) => event);
}

// Appends the one event `write` builds from the dashboard as it is now.
// Commands that run at once take turns, so each sees the others' events and no
// two hand out the same id. `write` may throw to append nothing.
export async function appendProgress<T>(
  at: DashboardAt,
  now: () => Date,
  // `events` is the latest run as it is now, oldest first.
  write: (state: { dashboard: Dashboard; nextIds: NextIds; events: ProgressEvent[] }) => { event: EventDraft; result: T },
  // Runs before the lock is released, with the dashboard's latest run as it
  // now is, or null when it has no readable start.
  after?: (run: SavedRun | null) => Promise<void>,
): Promise<T> {
  const { directory } = findStore(at.root);
  await makeFolder(directory);
  return withLock(directory, LOCK_NAME, async () => {
    const text = (await readText(directory)) ?? "";
    const { base } = workspaceView(parseFile(text), at.workspace);
    const { dashboard, nextIds } = reduceProgress(base, now());
    const { event, result } = write({ dashboard, nextIds, events: latestRun(base.events).map((line) => line.event) });
    const checked = eventSchema.safeParse({ v: EVENT_VERSION, ts: now().toISOString(), ...withoutUndefined({ ...event, ws: at.workspace ?? undefined }) });
    if (!checked.success) {
      throw new InvalidEvent(checked.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; "));
    }
    // A line cut short (a killed command, a hand edit) would swallow this event, so start a new line.
    const lead = text && !text.endsWith("\n") ? "\n" : "";
    const line = `${lead}${JSON.stringify(checked.data)}\n`;
    await appendFileIn(directory, PROGRESS_FILE_NAME, line);
    if (after) {
      const written = parseFile(text + line);
      await after(savedRun(written, workspaceView(written, at.workspace).base));
    }
    return result;
  });
}

// Per folder, not per workspace: the first-run pill retires once for the worktree.
export async function markPanelOpened(at: DashboardAt): Promise<void> {
  await writeFileIn(findStore(at.root).directory, PANEL_OPENED_NAME, "");
}

// Whose lines each dashboard holds. A line without `ws` is the folder's.
//
// - A workspace with lines of its own sees the folder's lines from before its
//   first one, then its own. Another workspace's lines never show, and nor do
//   folder lines written after it: a shell's `ticket update T03` must not land
//   on the workspace's own T03.
// - A workspace with none yet sees the folder's lines, but its display hides
//   the folder's latest run when another workspace carried that run on, or
//   when the run is finished and any workspace has lines of its own. Else the
//   last run from before workspaces had their own would show on every
//   workspace opened on the folder since. An unfinished run nobody carried on
//   stays, because its agent may be waiting on an answer. Its first command
//   still builds on all the folder's lines, so it can carry on a run it was in.
// - The folder's own dashboard sees the folder's lines.
//
// Unreadable lines name no workspace, so they show in every view.
function workspaceView(file: ParsedFile, workspace: WorkspaceId | null): Views {
  const { events, issues } = file;
  // Each workspace's first own line: where its dashboard forks off the folder's.
  const forks = new Map<WorkspaceId, ParsedLine>();
  for (const line of events) if (line.event.ws && !forks.has(line.event.ws)) forks.set(line.event.ws, line);

  const fork = workspace && forks.get(workspace);
  if (fork) {
    const own = { events: events.filter(({ line, event }) => event.ws === workspace || (!event.ws && line < fork.line)), issues };
    return { shown: own, base: own };
  }
  const folder = { events: events.filter(({ event }) => !event.ws), issues };
  if (!workspace) return { shown: folder, base: folder };

  const run = latestRun(folder.events);
  const runStart = run[0]?.event.type === "run.start" ? run[0].line : 0;
  // A workspace whose first line came during the run, and didn't start a new one, carried it on.
  const carriedOn = [...forks.values()].some(({ line, event }) => line > runStart && event.type !== "run.start");
  const finished = run.some(({ event }) => event.type === "run.finish");
  const hidden = carriedOn || (finished && forks.size > 0);
  return { shown: hidden ? { events: [], issues } : folder, base: folder };
}

function viewOf(file: ParsedFile, workspace: WorkspaceId | null): Views {
  let byWorkspace = views.get(file);
  if (!byWorkspace) views.set(file, (byWorkspace = new Map()));
  let found = byWorkspace.get(workspace);
  if (!found) byWorkspace.set(workspace, (found = workspaceView(file, workspace)));
  return found;
}

function savedRun(file: ParsedFile, view: View): SavedRun | null {
  // The run the dashboard shows. A start line it can't read is no run.
  const [start] = latestRun(view.events);
  if (start?.event.type !== "run.start") return null;
  const lines = [...view.events, ...view.issues]
    .map(({ line }) => line)
    .filter((line) => line >= start.line)
    .toSorted((a, b) => a - b)
    .map((line) => file.raw[line - 1]);
  return { startedAt: start.event.ts, title: start.event.title, lines };
}

function parseFile(text: string): ParsedFile {
  return { ...parseProgress(text), raw: text.split("\n") };
}

async function readText(directory: string): Promise<string | null> {
  try {
    return await readFile(join(directory, PROGRESS_FILE_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readParsed(directory: string): Promise<ParsedFile | null> {
  const info = await stat(join(directory, PROGRESS_FILE_NAME)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) {
    parsedFiles.delete(directory);
    return null;
  }
  const cached = parsedFiles.get(directory);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) return cached.parsed;
  // Stat before reading: if the file grows in between, the next stat won't match and it's read again.
  const text = await readText(directory);
  if (text === null) {
    parsedFiles.delete(directory);
    return null;
  }
  const parsed = parseFile(text);
  parsedFiles.set(directory, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, parsed });
  return parsed;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
