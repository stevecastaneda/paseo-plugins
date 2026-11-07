import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { defaultSettings, settingsSchema, type TimeSinceSettings } from "../shared/settings.ts";
import { withWriteLock } from "./write-lock.ts";
import { writeFileAtomicIn } from "./system.ts";

export function settingsRootFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function settingsFilePath(root: string): string {
  return join(root, "plugin-data", "time-since", "settings.json");
}

async function readFileSettings(filePath: string): Promise<TimeSinceSettings> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
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
  try {
    await writeFileAtomicIn(dirname(filePath), basename(filePath), `${JSON.stringify(settings)}\n`);
  } catch (error) {
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
