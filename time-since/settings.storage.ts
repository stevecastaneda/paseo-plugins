import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultSettings, settingsSchema, type TimeSinceSettings } from "./settings.shared.ts";

const writes = new Map<string, Promise<void>>();

export function settingsRootFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function settingsFilePath(root: string): string {
  return join(root, "plugin-data", "time-since", "settings.json");
}

function withWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writes.get(filePath) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const finished = current.then(
    () => undefined,
    () => undefined,
  );
  writes.set(filePath, finished);
  return current.finally(() => {
    if (writes.get(filePath) === finished) writes.delete(filePath);
  });
}

async function readFileSettings(filePath: string): Promise<TimeSinceSettings> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultSettings };
    throw new Error(`Unable to read time-since settings at ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in time-since settings at ${filePath}`, { cause: error });
  }
  const result = settingsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid time-since settings at ${filePath}: ${result.error.message}`);
  }
  return result.data;
}

async function writeFileSettings(filePath: string, settings: TimeSinceSettings): Promise<void> {
  const directory = join(filePath, "..");
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(`Unable to write time-since settings at ${filePath}`, { cause: error });
  }
}

export function createSettingsStore(root: string) {
  const filePath = settingsFilePath(root);
  return {
    filePath,
    get(): Promise<TimeSinceSettings> {
      return withWriteLock(filePath, () => readFileSettings(filePath));
    },
    update(partial: Partial<TimeSinceSettings>): Promise<TimeSinceSettings> {
      return withWriteLock(filePath, async () => {
        const current = await readFileSettings(filePath);
        const next = settingsSchema.parse({ ...current, ...partial });
        await writeFileSettings(filePath, next);
        return next;
      });
    },
  };
}

export const settingsStore = createSettingsStore(settingsRootFromEnvironment());
