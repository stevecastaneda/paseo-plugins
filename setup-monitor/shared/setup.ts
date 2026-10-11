import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const setupStatusSchema = z.enum(["running", "completed", "failed"]);

// Setup as a whole can also be blocked: Paseo holds back setup for a pull
// request from another repository until you choose to run it.
export const setupRunStatusSchema = z.enum(["running", "completed", "failed", "blocked"]);

export const setupCommandSchema = z.object({
  index: z.number().int().positive(),
  command: z.string(),
  cwd: z.string(),
  log: z.string().default(""),
  status: setupStatusSchema,
  exitCode: z.number().nullable(),
  durationMs: z.number().nonnegative().optional(),
});

export const setupDetailSchema = z.object({
  type: z.literal("worktree_setup"),
  worktreePath: z.string(),
  branchName: z.string(),
  log: z.string(),
  commands: z.array(setupCommandSchema),
  truncated: z.boolean().optional(),
});

export const setupSnapshotSchema = z.object({
  status: setupRunStatusSchema,
  detail: setupDetailSchema,
  error: z.string().nullable(),
  /** Where a blocked setup's pull request comes from, like "acme-contrib/billing-api". */
  blockedSource: z.object({ headRepository: z.string() }).optional(),
});

export type SetupStatus = z.infer<typeof setupRunStatusSchema>;
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export type SetupDetail = z.infer<typeof setupDetailSchema>;
export type SetupSnapshot = z.infer<typeof setupSnapshotSchema>;

export const runSetup = defineRpc({
  name: "setup-monitor.setup.run",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ started: z.boolean(), error: z.string().nullable() }),
});

export const getSetupStatus = defineRpc({
  name: "setup-monitor.status.get",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({
    snapshot: setupSnapshotSchema.nullable(),
    error: z.string().nullable(),
    /** How long setup has been running, by the server's clock; null when it isn't. */
    runningForMs: z.number().nonnegative().nullable(),
  }),
});
