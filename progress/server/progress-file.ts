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
import { EVENT_VERSION, eventSchema, PANEL_OPENED_NAME, PROGRESS_FILE_NAME, repeatKey, type ProgressEvent } from "../shared/events.ts";
import type { WorkspaceId } from "../shared/workspace.ts";
import { withLock } from "./lock.ts";
import type { DashboardAt } from "./paths.ts";
import { stateRoot } from "./store.ts";
import { appendFileIn, makeFolder, writeFileIn } from "./system.ts";

const LOCK_NAME = `${PROGRESS_FILE_NAME}.lock`;

export type EventDraft = { [K in ProgressEvent["type"]]: Omit<Extract<ProgressEvent, { type: K }>, "v" | "ts" | "ws"> }[ProgressEvent["type"]];

// A draft the event schema rejects. The message names each bad field.
export class InvalidEvent extends Error {}

export interface ProgressRead {
  configured: boolean;
  dashboard: Dashboard;
  panelOpened: boolean;
  file: string;
}

export interface SavedRun {
  startedAt: string;
  title: string;
  lines: string[];
}

interface ParsedFile {
  events: ParsedLine[];
  issues: FileIssue[];
  raw: string[];
}

interface View {
  events: ParsedLine[];
  issues: FileIssue[];
}

type Views = { shown: View; buildsOn: View };

type Store = { directory: string; shown: string };

export function outsideDirectory(root: string, home = homedir()): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {}
  const hash = createHash("sha1").update(real).digest("hex").slice(0, 8);
  return join(stateRoot(home), `${basename(real)}-${hash}`);
}

function findStore(root: string, home = homedir()): Store {
  const directory = outsideDirectory(root, home);
  return { directory, shown: directory.startsWith(home) ? `~${directory.slice(home.length)}` : directory };
}

// The parsed file per folder, kept until its size, change time or file moves.
// The file grows, or a repeated report replaces it (see `compactRepeated`), and
// the panel and pills read it every few seconds.
const parsedFiles = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; ino: number; parsed: ParsedFile }>();
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
  const configured = shown.events.length > 0 || shown.issues.length > 0 || parsed.events.length === 0;
  return { configured, dashboard: cached.dashboard, panelOpened, file };
}

// The events of the latest run, oldest first.
export async function readLatestRun(at: DashboardAt): Promise<ProgressEvent[]> {
  const parsed = await readParsed(findStore(at.root).directory);
  return latestRun(parsed ? viewOf(parsed, at.workspace).shown.events : []).map(({ event }) => event);
}

export async function appendProgress<T>(
  at: DashboardAt,
  now: () => Date,
  // `events` is the latest run as it is now, oldest first.
  write: (state: { dashboard: Dashboard; nextIds: NextIds; events: ProgressEvent[] }) => { event: EventDraft; result: T },
  after?: (run: SavedRun | null) => Promise<void>,
): Promise<T> {
  const { directory } = findStore(at.root);
  await makeFolder(directory);
  return withLock(directory, LOCK_NAME, async () => {
    const text = (await readText(directory)) ?? "";
    const { buildsOn } = workspaceView(parseFile(text), at.workspace);
    const { dashboard, nextIds } = reduceProgress(buildsOn, now());
    const { event, result } = write({ dashboard, nextIds, events: latestRun(buildsOn.events).map((line) => line.event) });
    const checked = eventSchema.safeParse({ v: EVENT_VERSION, ts: now().toISOString(), ...withoutUndefined({ ...event, ws: at.workspace ?? undefined }) });
    if (!checked.success) {
      throw new InvalidEvent(checked.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; "));
    }
    const compacted = compactRepeated(text, checked.data);
    // A rename replaces the file whole, so a reader sees the old file or the new one.
    // Windows refuses the rename while another program holds the file open; append instead.
    let written = compacted === null ? null : await writeFileIn(directory, PROGRESS_FILE_NAME, compacted, { atomic: true }).then(() => compacted, () => null);
    if (written === null) {
      // A line cut short (a killed command, a hand edit) would swallow this event, so start a new line.
      const lead = text && !text.endsWith("\n") ? "\n" : "";
      const line = `${lead}${JSON.stringify(checked.data)}\n`;
      await appendFileIn(directory, PROGRESS_FILE_NAME, line);
      written = text + line;
    }
    if (after) {
      const parsed = parseFile(written);
      await after(savedRun(parsed, workspaceView(parsed, at.workspace).buildsOn));
    }
    return result;
  });
}

// A job that reports its progress every minute, often with a ticker line
// beside it, would fill the file with lines nobody reads again. So while only
// progress reports and ticker lines follow the last one of the same key (see
// `repeatKey`), a new one replaces that line. A report keeps any field only
// the old one set. Other workspaces' lines in between don't count, since they
// aren't on this one's dashboard. The file as it should be, or null to append.
export function compactRepeated(text: string, event: ProgressEvent): string | null {
  const key = repeatKey(event);
  if (key === null || !text.endsWith("\n")) return null;
  const lines = text.slice(0, -1).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!lines[index].trim()) continue;
    let earlier: ProgressEvent;
    try {
      earlier = eventSchema.parse(JSON.parse(lines[index]));
    } catch {
      return null;
    }
    if (earlier.ws !== event.ws) {
      // Moving a folder line past a workspace's lines could move it out of that workspace's view.
      if (!event.ws) return null;
      continue;
    }
    const earlierKey = repeatKey(earlier);
    if (earlierKey === null) return null;
    if (earlierKey !== key) continue;
    // A workspace's first line marks where it split off the folder's run (see `workspaceView`), so it stays put.
    if (event.ws && !lines.slice(0, index).some((line) => workspaceOf(line) === event.ws)) return null;
    lines.splice(index, 1);
    lines.push(JSON.stringify(event.type === "ticker.set" ? event : { ...earlier, ...withoutUndefined(event) }));
    return `${lines.join("\n")}\n`;
  }
  return null;
}

function workspaceOf(line: string): unknown {
  try {
    return JSON.parse(line).ws;
  } catch {
    return undefined;
  }
}

export async function markPanelOpened(root: string): Promise<void> {
  await writeFileIn(findStore(root).directory, PANEL_OPENED_NAME, "");
}

function workspaceView(file: ParsedFile, workspace: WorkspaceId | null): Views {
  const { events, issues } = file;
  const forks = new Map<WorkspaceId, ParsedLine>();
  for (const line of events) if (line.event.ws && !forks.has(line.event.ws)) forks.set(line.event.ws, line);

  const fork = workspace && forks.get(workspace);
  if (fork) {
    const own = { events: events.filter(({ line, event }) => event.ws === workspace || (!event.ws && line < fork.line)), issues };
    return { shown: own, buildsOn: own };
  }
  const folder = { events: events.filter(({ event }) => !event.ws), issues };
  if (!workspace) return { shown: folder, buildsOn: folder };
  return { shown: folderRunLeftBehind(folder.events, forks) ? { events: [], issues } : folder, buildsOn: folder };
}

function folderRunLeftBehind(folderEvents: ParsedLine[], forks: Map<WorkspaceId, ParsedLine>): boolean {
  const run = latestRun(folderEvents);
  const runStart = run[0]?.event.type === "run.start" ? run[0].line : 0;
  const carriedOn = [...forks.values()].some(({ line, event }) => line > runStart && event.type !== "run.start");
  const finished = run.some(({ event }) => event.type === "run.finish");
  return carriedOn || (finished && forks.size > 0);
}

function viewOf(file: ParsedFile, workspace: WorkspaceId | null): Views {
  let byWorkspace = views.get(file);
  if (!byWorkspace) views.set(file, (byWorkspace = new Map()));
  let found = byWorkspace.get(workspace);
  if (!found) byWorkspace.set(workspace, (found = workspaceView(file, workspace)));
  return found;
}

function savedRun(file: ParsedFile, view: View): SavedRun | null {
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
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs && cached.ino === info.ino)
    return cached.parsed;
  // Stat before reading: if the file grows in between, the next stat won't match and it's read again.
  const text = await readText(directory);
  if (text === null) {
    parsedFiles.delete(directory);
    return null;
  }
  const parsed = parseFile(text);
  parsedFiles.set(directory, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino, parsed });
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
