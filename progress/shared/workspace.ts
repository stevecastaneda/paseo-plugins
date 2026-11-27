import { z } from "zod";

// A Paseo workspace ID, stable across restarts. Several workspaces can be open
// on one folder, and each gets its own dashboard.
export const workspaceIdSchema = z
  .string()
  .regex(/^wks_[a-f0-9]{16}$/)
  .brand<"WorkspaceId">();
export type WorkspaceId = z.output<typeof workspaceIdSchema>;

// Null for a missing or malformed ID, which reads and writes the folder's
// dashboard, as every workspace did before dashboards were per workspace.
export function parseWorkspaceId(raw: unknown): WorkspaceId | null {
  const parsed = workspaceIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
