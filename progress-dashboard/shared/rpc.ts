import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { Dashboard } from "./dashboard.ts";

export const getDashboard = defineRpc({
  name: "progress-dashboard.get",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
  }),
  output: z.custom<{ configured: boolean; dashboard: Dashboard }>(),
});

// The `paseo-progress` launcher on the daemon host. "foreign" means another
// file already sits at that path; the plugin leaves it alone.
const launcherStatus = z.object({
  path: z.string(),
  state: z.enum(["missing", "current", "outdated", "foreign"]),
  onPath: z.boolean(),
});
export type LauncherStatus = z.infer<typeof launcherStatus>;

export const getLauncherStatus = defineRpc({
  name: "progress-dashboard.launcher.status",
  input: z.object({}),
  output: launcherStatus,
});

export const installLauncher = defineRpc({
  name: "progress-dashboard.launcher.install",
  input: z.object({}),
  output: launcherStatus,
});

// The paseo-progress skill, linked into each agent's skills folder.
const skillState = z.enum(["missing", "current", "outdated", "foreign"]);
const skillStatus = z.object({
  state: skillState,
  targets: z.array(z.object({ path: z.string(), state: skillState })),
});
export type SkillStatus = z.infer<typeof skillStatus>;

export const getSkillStatus = defineRpc({
  name: "progress-dashboard.skill.status",
  input: z.object({}),
  output: skillStatus,
});

export const installSkill = defineRpc({
  name: "progress-dashboard.skill.install",
  input: z.object({}),
  output: skillStatus,
});

// Opens a recorded local deliverable on the daemon host with its default app.
export const openDeliverable = defineRpc({
  name: "progress-dashboard.deliverable.open",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    deliverableId: z.string().min(1),
  }),
  output: z.object({ opened: z.string() }),
});

// An image deliverable's bytes, for the preview dialog.
export const previewDeliverable = defineRpc({
  name: "progress-dashboard.deliverable.preview",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    deliverableId: z.string().min(1),
  }),
  output: z.object({ dataUri: z.string(), bytes: z.number() }),
});
