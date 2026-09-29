// Everything that reads or writes a worktree's progress files: the event log
// the command appends to, the panel-opened marker, and the .gitignore that keeps
// both out of git. The command and the panel's RPC handlers go through here, so
// they always agree on where the files are and how they're read.
import { access, appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { EMPTY_DASHBOARD, parseProgress, reduceProgress, type Dashboard, type NextIds } from "../shared/dashboard.ts";
import { EVENT_VERSION, eventSchema, PANEL_OPENED_FILE, PROGRESS_FILE, type ProgressEvent } from "../shared/events.ts";
import { withLock } from "./lock.ts";

const SCRATCH_DIR = dirname(PROGRESS_FILE);
const LOCK_FILE = `${PROGRESS_FILE}.lock`;

// Names only this plugin's files, so they stay out of git without the user
// editing their own .gitignore. Other files in .scratch/ are left to the repo.
export const SCRATCH_GITIGNORE = `# Added by the progress plugin for Paseo so its files stay out of git.
${basename(PROGRESS_FILE)}
${basename(LOCK_FILE)}/
${basename(PANEL_OPENED_FILE)}
.gitignore
`;

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

// The parsed file per worktree, kept until its size or change time moves. The
// file only grows, and the panel and pills read it every few seconds.
const parsedFiles = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; parsed: ReturnType<typeof parseProgress> }>();
// Replaced file snapshots and their derived data can be collected together.
const dashboards = new WeakMap<ReturnType<typeof parseProgress>, { dashboard: Dashboard; from: number; until: number }>();

// The dashboard at `now`, for the panel, the pills and `show`. Repeated reads
// reuse the last one until the file changes or a stale or overdue time passes.
// Stale and overdue checks use the daemon host's clock, the same clock the
// command stamps events with.
export async function readProgress(root: string, now = new Date()): Promise<ProgressRead> {
  const parsed = await readParsed(root);
  const panelOpened = await exists(join(root, PANEL_OPENED_FILE));
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

// Appends the one event `write` builds from the file as it is now. Commands
// that run at once take turns, so each sees the others' events and no two hand
// out the same id. `write` may throw to append nothing.
export async function appendProgress<T>(
  root: string,
  now: () => Date,
  write: (state: { dashboard: Dashboard; nextIds: NextIds }) => { event: EventDraft; result: T },
): Promise<T> {
  await prepareScratch(root);
  return withLock(join(root, LOCK_FILE), async () => {
    const text = (await readText(root)) ?? "";
    const { dashboard, nextIds } = reduceProgress(parseProgress(text), now());
    const { event, result } = write({ dashboard, nextIds });
    const checked = eventSchema.safeParse({ v: EVENT_VERSION, ts: now().toISOString(), ...withoutUndefined(event) });
    if (!checked.success) {
      throw new InvalidEvent(checked.error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; "));
    }
    // A line cut short (a killed command, a hand edit) would swallow this event, so start a new line.
    const lead = text && !text.endsWith("\n") ? "\n" : "";
    await appendFile(join(root, PROGRESS_FILE), `${lead}${JSON.stringify(checked.data)}\n`);
    return result;
  });
}

export async function markPanelOpened(root: string): Promise<void> {
  await prepareScratch(root);
  await writeFile(join(root, PANEL_OPENED_FILE), "");
}

// Creates .scratch/ in the worktree and, the first time, its .gitignore. An
// existing .gitignore is the user's, so it is never touched.
async function prepareScratch(root: string): Promise<void> {
  const directory = join(root, SCRATCH_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".gitignore"), SCRATCH_GITIGNORE, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}

async function readText(root: string): Promise<string | null> {
  try {
    return await readFile(join(root, PROGRESS_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readParsed(root: string): Promise<ReturnType<typeof parseProgress> | null> {
  const info = await stat(join(root, PROGRESS_FILE)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) {
    parsedFiles.delete(root);
    return null;
  }
  const cached = parsedFiles.get(root);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs && cached.ctimeMs === info.ctimeMs) return cached.parsed;
  // Stat before reading: if the file grows in between, the next stat won't match and it's read again.
  const text = await readText(root);
  if (text === null) {
    parsedFiles.delete(root);
    return null;
  }
  const parsed = parseProgress(text);
  parsedFiles.set(root, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, parsed });
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
