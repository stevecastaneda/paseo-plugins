import { z } from "zod";

// A Paseo workspace ID, stable across restarts.
export const workspaceIdSchema = z
  .string()
  .regex(/^wks_[a-f0-9]{16}$/)
  .brand<"WorkspaceId">();
export type WorkspaceId = z.output<typeof workspaceIdSchema>;

export function parseWorkspaceId(raw: unknown): WorkspaceId | null {
  const parsed = workspaceIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
