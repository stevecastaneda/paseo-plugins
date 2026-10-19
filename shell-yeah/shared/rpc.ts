import { defineAttachmentSource, defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LIMITS } from "./limits.ts";
import { liveView, runRow } from "./row.ts";

const runId = z.string().regex(/^[a-z0-9-]{6,64}$/);
const agentId = z.string().min(1);

// The only way a command starts: /sh, the Run button and Rerun all call this.
// `runId` is given when a proposal card becomes a run (same id, so the row is
// replaced in place). Idempotent on `runId`. Returns once the row exists and the
// process is launched.
export const start = defineRpc({
  name: "shell-yeah.start",
  input: z.object({
    agentId,
    cwd: z.string().min(1),
    command: z.string().trim().min(1).max(LIMITS.commandChars),
    origin: z.enum(["user", "claude"]),
    runId: runId.optional(),
  }),
  output: z.object({ runId }),
});

// First call = Ctrl+C (SIGINT to the process group). `force` or a later call = SIGKILL.
export const stop = defineRpc({
  name: "shell-yeah.stop",
  input: z.object({ runId, force: z.boolean().default(false) }),
  output: z.object({ ok: z.literal(true) }),
});

// Sends keys to a running command's terminal as they're pressed, the way a terminal does:
// "\r" is Enter. The terminal decides what shows, so a password prompt shows nothing.
// Fails when the command has no terminal.
export const input = defineRpc({
  name: "shell-yeah.input",
  input: z.object({ runId, keys: z.string().min(1).max(LIMITS.inputChars) }),
  output: z.object({ ok: z.literal(true) }),
});

// The live channel, a coalescing long poll. Answers at once if `since` is not the
// current rev; otherwise holds up to `waitMs` for a change, then a little longer
// so a burst batches into one reply. "unknown" = this daemon process never saw
// the run (plugin reloaded): the row calls it interrupted.
export const tail = defineRpc({
  name: "shell-yeah.tail",
  input: z.object({
    runId,
    lines: z.number().int().min(1).max(400),
    since: z.number().int().nullable(),
    waitMs: z.number().int().min(0).max(LIMITS.tailWaitMaxMs),
  }),
  output: z.discriminatedUnion("state", [
    z.object({ state: z.literal("unknown") }),
    z.object({ state: z.literal("unchanged"), rev: z.number().int() }),
    z.object({ state: z.literal("view"), view: liveView }),
  ]),
});

// Full plain text for Copy. `complete: false` when the daemon trimmed or capped it. null = not held.
export const fullOutput = defineRpc({
  name: "shell-yeah.output",
  input: z.object({ runId }),
  output: z.object({ text: z.string(), complete: z.boolean() }).nullable(),
});

// Send to Claude. `fallback` is the row the user is looking at, used only when the
// daemon no longer holds the run (plugin reloaded, run evicted).
export const send = defineRpc({
  name: "shell-yeah.send",
  input: z.object({ agentId, runId, fallback: runRow.optional() }),
  output: z.object({ delivery: z.enum(["turn", "steered"]) }),
});

// Recent runs for the composer's attach menu. Receives only the query: no agent, no cwd.
export const attachSearch = defineRpc({
  name: "shell-yeah.attach.search",
  input: z.object({ query: z.string() }),
  output: z.object({
    items: z.array(z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      subtitle: z.string().optional(),
      url: z.url(),
      text: z.string(),
      resourceType: z.string(),
    })),
  }),
});

// `/sh` with no command: rescan Claude's latest reply for commands and propose them.
export const scan = defineRpc({
  name: "shell-yeah.scan",
  input: z.object({ agentId }),
  output: z.object({ found: z.number().int().nonnegative() }),
});

// The Run window's list: every command in the agent's latest reply, prose included.
export const suggest = defineRpc({
  name: "shell-yeah.suggest",
  input: z.object({ agentId }),
  output: z.object({ commands: z.array(z.string()) }),
});

// Dismiss a proposal card. The card's data is enough; the server holds no proposal state.
export const dismiss = defineRpc({
  name: "shell-yeah.dismiss",
  input: z.object({ agentId, runId, command: z.string(), cwd: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

export const commandOutputSource = defineAttachmentSource({
  id: "command-output",
  title: "Command output",
  icon: "SquareTerminal",
  pickerTitle: "Attach output of a /sh command",
  searchPlaceholder: "Search your /sh commands",
  search: attachSearch,
});
