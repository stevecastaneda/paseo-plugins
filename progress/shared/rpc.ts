import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { Dashboard } from "./dashboard.ts";

// `panelOpened`: the Progress panel has been opened for this worktree before.
// `root`: the worktree root the file was read from, which stored paths are
// relative to. It can sit above the workspace directory.
// `file`: where the progress file is, for people. `savedTo`: the repo folder
// each run is saved to, or null when history stays on this computer.
// `inRepo`: saving history needs a git repo to keep the choice in.
// `version` changes whenever anything else in the result does.
export type DashboardResult = {
  configured: boolean; dashboard: Dashboard; panelOpened: boolean; file: string; savedTo: string | null; inRepo: boolean; root: string; version: string;
};

export const getDashboard = defineRpc({
  name: "progress.get",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    // The version the caller already has; if it's current, the reply is `unchanged`.
    since: z.string().optional(),
  }),
  output: z.custom<DashboardResult | { unchanged: true; version: string }>(),
});

// What a message-box pill shows: counts that need the user, and whether a run
// is open in a worktree whose panel has never been opened.
export type AttentionResult = { configured: boolean; questions: number; stuck: number; runOpen: boolean; panelOpened: boolean };

export const getAttention = defineRpc({
  name: "progress.attention",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
  }),
  output: z.custom<AttentionResult>(),
});

// Records that the Progress panel was opened, so the "Progress" pill goes away for good.
export const markPanelOpened = defineRpc({
  name: "progress.panel.opened",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
  }),
  output: z.object({}),
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
  name: "progress.launcher.status",
  input: z.object({}),
  output: launcherStatus,
});

export const installLauncher = defineRpc({
  name: "progress.launcher.install",
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
  name: "progress.skill.status",
  input: z.object({}),
  output: skillStatus,
});

export const installSkill = defineRpc({
  name: "progress.skill.install",
  input: z.object({}),
  output: skillStatus,
});

// The folders inside one folder of the worktree ("" is the top), for the
// folder picker.
export const listFolders = defineRpc({
  name: "progress.folders.list",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    folder: z.string(),
  }),
  output: z.object({ folder: z.string(), folders: z.array(z.string()) }),
});

// Starts saving each run to a folder in the repo (relative to the worktree
// root), for every worktree of the repo, or stops when `folder` is null.
export const setHistoryFolder = defineRpc({
  name: "progress.history.set",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    folder: z.string().nullable(),
  }),
  output: z.object({ savedTo: z.string().nullable() }),
});

// Opens a recorded local deliverable on the daemon host with its default app.
export const openDeliverable = defineRpc({
  name: "progress.deliverable.open",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    // A deliverable ("D3") or a question attachment ("Q7.2").
    ref: z.string().min(1),
  }),
  output: z.object({ opened: z.string() }),
});

// An image or text file's contents, for the preview dialog.
export const previewDeliverable = defineRpc({
  name: "progress.deliverable.preview",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    // A deliverable ("D3") or a question attachment ("Q7.2").
    ref: z.string().min(1),
  }),
  output: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("image"), dataUri: z.string(), bytes: z.number() }),
    z.object({ kind: z.literal("text"), text: z.string(), bytes: z.number(), truncated: z.boolean() }),
  ]),
});
