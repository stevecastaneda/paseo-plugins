import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { defaultShortcut, shortcutSchema, type ShortcutSettings } from "../shared/shortcut.ts";
import { writeFileAtomicIn } from "./system.ts";

const writes = new Map<string, Promise<void>>();

export function settingsRootFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export function settingsFilePath(root: string): string {
  return join(root, "plugin-data", "workspace-links", "settings.json");
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

async function readFileSettings(filePath: string): Promise<ShortcutSettings> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultShortcut };
    throw new Error(`Unable to read workspace-links settings at ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in workspace-links settings at ${filePath}`, { cause: error });
  }
  const result = shortcutSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid workspace-links settings at ${filePath}: ${result.error.message}`);
  }
  return result.data;
}

async function writeFileSettings(filePath: string, settings: ShortcutSettings): Promise<void> {
  try {
    await writeFileAtomicIn(dirname(filePath), basename(filePath), `${JSON.stringify(settings)}\n`);
  } catch (error) {
    throw new Error(`Unable to write workspace-links settings at ${filePath}`, { cause: error });
  }
}

export function createSettingsStore(root: string) {
  const filePath = settingsFilePath(root);
  return {
    filePath,
    get(): Promise<ShortcutSettings> {
      return withWriteLock(filePath, () => readFileSettings(filePath));
    },
    update(partial: Partial<ShortcutSettings>): Promise<ShortcutSettings> {
      return withWriteLock(filePath, async () => {
        const current = await readFileSettings(filePath);
        const next = shortcutSchema.parse({ ...current, ...partial });
        await writeFileSettings(filePath, next);
        return next;
      });
    },
  };
}

export const settingsStore = createSettingsStore(settingsRootFromEnvironment());
