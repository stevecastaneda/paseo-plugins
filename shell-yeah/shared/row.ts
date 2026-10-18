import { z } from "zod";

export const PLUGIN_ID = "shell-yeah";
export const RUN_KIND = "run";
export const RUN_VERSION = 1;

// One styled stretch of a line: [text, sgr]. `sgr` is a canonical SGR parameter
// string such as "1;31" or "38;2;10;20;30"; "" is the default style. Canonical
// means attributes ascending, then foreground, then background, so equal styles
// are equal strings.
export const segment = z.tuple([z.string(), z.string()]);
export type Segment = z.infer<typeof segment>;

// A bare string is a line in the default style: the common case and the cheapest on the wire.
export const line = z.union([z.string(), z.array(segment)]);
export type Line = z.infer<typeof line>;

const clock = { startedAt: z.number(), endedAt: z.number() };

// The run's state machine, one variant per visual state. `proposed` and `running`
// are the only non-terminal ones; the rest are absorbing.
//   proposed -> running -> ok | failed | stopped | interrupted
//   proposed -> dismissed
export const phase = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("proposed") }),
  z.object({ kind: z.literal("running"), startedAt: z.number(), stopRequestedAt: z.number().nullable() }),
  z.object({ kind: z.literal("ok"), ...clock }),
  z.object({
    kind: z.literal("failed"),
    ...clock,
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    // Set when the command never started (bad folder, no shell).
    message: z.string().nullable(),
  }),
  z.object({ kind: z.literal("stopped"), ...clock, exitCode: z.number().int().nullable(), signal: z.string().nullable() }),
  z.object({ kind: z.literal("interrupted"), ...clock }),
  z.object({ kind: z.literal("dismissed") }),
]);
export type Phase = z.infer<typeof phase>;
export type PhaseKind = Phase["kind"];
export type Ended = Extract<Phase, { kind: "ok" | "failed" | "stopped" | "interrupted" }>;

export const isEnded = (p: Phase): p is Ended => p.kind === "ok" || p.kind === "failed" || p.kind === "stopped" || p.kind === "interrupted";

// The tail of what the command printed. `total` counts every line it printed,
// including the ones no longer held; lines not shown = total - lines.length.
export const output = z.object({ lines: z.array(line), total: z.number().int().nonnegative() });
export type Output = z.infer<typeof output>;

// The timeline row's `data`, schema version 1. Everything but `rev` is a projection
// of the server's run (server/runs.ts owns it). A finished row renders from this alone.
export const runRow = z.object({
  runId: z.string(),
  // Bumps on every observable change. Row data and live replies are ordered by it.
  rev: z.number().int().nonnegative(),
  // Who started it. Decides the primary button and one line of copy, nothing else.
  origin: z.enum(["user", "claude"]),
  command: z.string(),
  cwd: z.string(),
  phase,
  output,
  // When the user last sent this output to Claude; null if never.
  sentAt: z.number().nullable(),
  // The command ran in a real terminal, so it could take typing. Absent on older rows.
  terminal: z.boolean().optional(),
});
export type RunRow = z.infer<typeof runRow>;

// What a live reply carries: the moving parts of a RunRow, plus two clocks.
export const liveView = z.object({
  rev: z.number().int(),
  phase,
  output,
  sentAt: z.number().nullable(),
  lastOutputAt: z.number().nullable(),
  // The daemon's clock when the reply was built; the row corrects its timers by it.
  serverNow: z.number(),
});
export type LiveView = z.infer<typeof liveView>;

export function lineText(l: Line): string {
  return typeof l === "string" ? l : l.map(([text]) => text).join("");
}

export function plainText(lines: readonly Line[]): string {
  return lines.map(lineText).join("\n");
}
