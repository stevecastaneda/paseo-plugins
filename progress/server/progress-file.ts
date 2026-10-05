// Everything that reads or writes a worktree's progress files: the event log
// the command appends to and the panel-opened marker. Each function takes the
// folder that holds them, which `findStore` in store.ts picks. The command and
// the panel's RPC handlers go through here, so they agree on how they're read.
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_DASHBOARD, latestRun, parseProgress, reduceProgress, type Dashboard, type NextIds } from "../shared/dashboard.ts";
import { EVENT_VERSION, eventSchema, PANEL_OPENED_NAME, PROGRESS_FILE_NAME, type ProgressEvent } from "../shared/events.ts";
import { withLock } from "./lock.ts";

const LOCK_NAME = `${PROGRESS_FILE_NAME}.lock`;

// An event as a command builds it; `append` stamps the version and time.
export type EventDraft = { [K in ProgressEvent["type"]]: Omit<Extract<ProgressEvent, { type: K }>, "v" | "ts"> }[ProgressEvent["type"]];

// A draft the event schema rejects. The message names each bad field.
export class InvalidEvent extends Error {}

export interface ProgressRead {
  // Whether the worktree has a progress file at all.
  configured: boolean;
  dashboard: Dashboard;
  panelOpened: boolean;
}

// The parsed file per folder, kept until its size or change time moves. The
// file only grows, and the panel and pills read it every few seconds.
const parsedFiles = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; parsed: ReturnType<typeof parseProgress> }>();
// Replaced file snapshots and their derived data can be collected together.
const dashboards = new WeakMap<ReturnType<typeof parseProgress>, { dashboard: Dashboard; from: number; until: number }>();

// The dashboard at `now`, for the panel, the pills and `show`. Repeated reads
// reuse the last one until the file changes or a stale or overdue time passes.
// Stale and overdue checks use the daemon host's clock, the same clock the
// command stamps events with.
export async function readProgress(directory: string, now = new Date()): Promise<ProgressRead> {
  const parsed = await readParsed(directory);
  const panelOpened = await exists(join(directory, PANEL_OPENED_NAME));
  if (parsed === null) return { configured: false, dashboard: EMPTY_DASHBOARD, panelOpened };
  let cached = dashboards.get(parsed);
  // A backwards clock jump must also re-evaluate stale/overdue state.
  if (!cached || now.getTime() < cached.from || now.getTime() >= cached.until) {
    const { dashboard, validUntil } = reduceProgress(parsed, now);
    cached = { dashboard, from: now.getTime(), until: validUntil };
    dashboards.set(parsed, cached);
  }
  return { configured: true, dashboard: cached.dashboard, panelOpened };
}

// The events of the latest run, oldest first.
export async function readLatestRun(directory: string): Promise<ProgressEvent[]> {
  return latestRun((await readParsed(directory))?.events ?? []).map(({ event }) => event);
}

// Appends the one event `write` builds from the file as it is now. Commands
// that run at once take turns, so each sees the others' events and no two hand
// out the same id. `write` may throw to append nothing.
export async function appendProgress<T>(
  directory: string,
  now: () => Date,
  // `events` is the latest run as it is now, oldest first.
  write: (state: { dashboard: Dashboard; nextIds: NextIds; events: ProgressEvent[] }) => { event: EventDraft; result: T },
  // Runs before the lock is released, with the whole file as it now is.
  after?: (text: string) => Promise<void>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  return withLock(join(directory, LOCK_NAME), async () => {
    const text = (await readText(directory)) ?? "";
    const parsed = parseProgress(text);
    const { dashboard, nextIds } = reduceProgress(parsed, now());
    const { event, result } = write({ dashboard, nextIds, events: latestRun(parsed.events).map((line) => line.event) });
    const checked = eventSchema.safeParse({ v: EVENT_VERSION, ts: now().toISOString(), ...withoutUndefined(event) });
    if (!checked.success) {
      throw new InvalidEvent(checked.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; "));
    }
    // A line cut short (a killed command, a hand edit) would swallow this event, so start a new line.
    const lead = text && !text.endsWith("\n") ? "\n" : "";
    const line = `${lead}${JSON.stringify(checked.data)}\n`;
    await appendFile(join(directory, PROGRESS_FILE_NAME), line);
    await after?.(text + line);
    return result;
  });
}

export async function markPanelOpened(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, PANEL_OPENED_NAME), "");
}

async function readText(directory: string): Promise<string | null> {
  try {
    return await readFile(join(directory, PROGRESS_FILE_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readParsed(directory: string): Promise<ReturnType<typeof parseProgress> | null> {
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
  const parsed = parseProgress(text);
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
