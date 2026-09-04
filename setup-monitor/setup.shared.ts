import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const setupStatusSchema = z.enum(["running", "completed", "failed"]);

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
  status: setupStatusSchema,
  detail: setupDetailSchema,
  error: z.string().nullable(),
});

export type SetupStatus = z.infer<typeof setupStatusSchema>;
export type SetupCommand = z.infer<typeof setupCommandSchema>;
export type SetupDetail = z.infer<typeof setupDetailSchema>;
export type SetupSnapshot = z.infer<typeof setupSnapshotSchema>;

export const getSetupStatus = defineRpc({
  name: "setup-monitor.status.get",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({
    snapshot: setupSnapshotSchema.nullable(),
    error: z.string().nullable(),
  }),
});
