// The plugin's options, one file per Paseo home, shared by every workspace.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultSettings, settingsSchema, type PulseSettings } from "../shared/settings.ts";

export function settingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.PASEO_HOME ?? join(homedir(), ".paseo"), "plugin-data", "playwright-pulse", "settings.json");
}

async function read(file: string): Promise<PulseSettings> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultSettings };
    throw new Error(`Could not read Pulse's options at ${file}.`, { cause: error });
  }
  // Fields added later take their defaults.
  const parsed = settingsSchema.partial().safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Pulse's options at ${file} are not valid: ${parsed.error.message}`);
  return { ...defaultSettings, ...parsed.data };
}

// Read-modify-write cycles run one at a time.
let queue: Promise<unknown> = Promise.resolve();

function serially<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

export function createSettingsStore(file = settingsFile()) {
  return {
    file,
    get: () => serially(() => read(file)),
    update: (patch: Partial<PulseSettings>) => serially(async () => {
      const next = settingsSchema.parse({ ...(await read(file)), ...patch });
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next)}\n`);
        await rename(temporary, file);
      } catch (error) {
        await rm(temporary, { force: true });
        throw new Error(`Could not save Pulse's options at ${file}.`, { cause: error });
      }
      return next;
    }),
  };
}
