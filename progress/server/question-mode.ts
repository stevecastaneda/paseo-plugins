// The question mode lives in Paseo's settings, which only the plugin's server
// process can read. It mirrors the mode into a file the paseo-progress command
// can read on its own.
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { DEFAULT_QUESTION_MODE, QUESTION_MODES, type QuestionMode } from "../shared/question-modes.ts";
import type { questionSettings } from "../shared/settings.ts";
import { stateRoot, writeAtomic } from "./store.ts";

const mirrorSchema = z.object({ questionMode: z.enum(QUESTION_MODES) });

export function questionModePath(home = homedir()): string {
  return join(stateRoot(home), "settings.json");
}

// The default unless the mirror says otherwise, so a missing or damaged file
// never lets an agent build ahead of the user.
export async function readQuestionMode(home = homedir()): Promise<QuestionMode> {
  try {
    return mirrorSchema.parse(JSON.parse(await readFile(questionModePath(home), "utf8"))).questionMode;
  } catch {
    return DEFAULT_QUESTION_MODE;
  }
}

export async function writeQuestionMode(mode: QuestionMode, home = homedir()): Promise<void> {
  await writeAtomic(questionModePath(home), `${JSON.stringify({ questionMode: mode })}\n`);
}

type Settings = Pick<PluginSettings<(typeof questionSettings)["schema"]>, "read" | "subscribe">;
type State = Awaited<ReturnType<Settings["read"]>>;

// Writes the mode now and on every change. Stopping deletes the mirror, so
// agents fall back to the default while the plugin is off.
export function mirrorQuestionMode(settings: Settings, home = homedir()): { stop(): Promise<void>; settled: Promise<void> } {
  let writes = Promise.resolve();
  let changed = false;
  const write = (state: State | null) => {
    const mode = state?.status === "ready" ? state.values.mode : DEFAULT_QUESTION_MODE;
    writes = writes.then(() => writeQuestionMode(mode, home)).catch(() => {});
    return writes;
  };
  const unsubscribe = settings.subscribe((state) => {
    changed = true;
    return write(state);
  });
  // A change heard while the first read is in flight is newer than that read.
  const settled = settings.read().catch(() => null).then((state) => (changed ? writes : write(state)));
  return {
    settled,
    async stop() {
      await unsubscribe();
      await settled;
      await writes;
      await rm(questionModePath(home), { force: true });
    },
  };
}
