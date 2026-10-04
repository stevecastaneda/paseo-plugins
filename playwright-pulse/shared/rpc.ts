import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { RunSnapshot } from "./run.ts";

// The reporter copy Playwright loads, at a fixed path a config can name.
// "foreign" means another file already sits there; the plugin leaves it alone.
// "unknown": Paseo could not say where the plugin is, so it can't compare.
export const reporterStatus = z.object({
  path: z.string(),
  state: z.enum(["missing", "current", "outdated", "foreign", "unknown"]),
});
export type ReporterStatus = z.infer<typeof reporterStatus>;

// `run`: the latest run in this worktree, or null before the first one. A run
// whose process died without ending reads as interrupted.
// `file`: where the run is kept, for people. `version` changes whenever
// anything else in the result does.
export type PulseResult = {
  run: RunSnapshot | null;
  file: string;
  root: string;
  reporter: ReporterStatus;
  version: string;
};

const workspace = {
  workspaceId: z.string().min(1),
  workspaceDirectory: z.string().min(1),
};

export const getPulse = defineRpc({
  name: "pulse.get",
  input: z.object({
    ...workspace,
    // The version the caller already has; if it's current, the reply is `unchanged`.
    since: z.string().optional(),
  }),
  output: z.custom<PulseResult | { unchanged: true; version: string }>(),
});

// Runs only when the user presses Set up in the panel.
export const installReporter = defineRpc({
  name: "pulse.reporter.install",
  input: z.object({}),
  output: reporterStatus,
});

// An attachment of a test in the latest run, by position, so the panel can
// never reach an arbitrary path.
const attachmentRef = z.object({
  ...workspace,
  runId: z.string().min(1),
  testId: z.string().min(1),
  index: z.number().int().min(0),
});

export const previewAttachment = defineRpc({
  name: "pulse.attachment.preview",
  input: attachmentRef,
  output: z.object({ dataUri: z.string(), bytes: z.number() }),
});

// Traces open in Playwright's trace viewer; anything else as a double-click would.
export const openAttachment = defineRpc({
  name: "pulse.attachment.open",
  input: attachmentRef,
  output: z.object({ opened: z.string() }),
});

// Stops a live run as Ctrl+C would. Pressed again while the run winds down, it
// forces the stop, as a second Ctrl+C does.
export const stopRun = defineRpc({
  name: "pulse.run.stop",
  input: z.object({
    ...workspace,
    runId: z.string().min(1),
  }),
  output: z.object({ stopped: z.literal(true) }),
});
