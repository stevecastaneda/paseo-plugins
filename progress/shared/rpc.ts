import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { Dashboard } from "./dashboard.ts";

// `panelOpened`: the Progress panel has been opened for this worktree before.
// `root`: the worktree root the file was read from, which stored paths are
// relative to. It can sit above the workspace directory.
// `setupNeeded`: the repo hasn't picked where progress files live, so the
// command won't write yet. `file`: where the progress file is, for people.
// `version` changes whenever anything else in the result does.
export type DashboardResult = {
  configured: boolean; dashboard: Dashboard; panelOpened: boolean; setupNeeded: boolean; file: string | null; root: string; version: string;
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

// A repo picks once where its progress files live. "folder" is relative to
// each worktree's root; `hide` says how to keep the files out of git:
// "computer" (git's local exclude file), "repo" (the root .gitignore), "none".
const hideChoice = z.enum(["computer", "repo", "none"]);
export type HideChoice = z.infer<typeof hideChoice>;
const setupChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("outside") }),
  z.object({ kind: z.literal("folder"), folder: z.string(), hide: hideChoice }),
]);
export type SetupChoice = z.infer<typeof setupChoice>;

// Checks a folder as the user types it: whether it's allowed, and whether git
// already ignores the plugin's files there (then setup skips that question).
export const checkSetupFolder = defineRpc({
  name: "progress.setup.check",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    folder: z.string(),
  }),
  output: z.object({ error: z.string().optional(), alreadyIgnored: z.boolean() }),
});

// The folders inside one folder of the worktree ("" is the top), for the setup picker.
export const listSetupFolders = defineRpc({
  name: "progress.setup.folders",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    folder: z.string(),
  }),
  output: z.object({ folder: z.string(), folders: z.array(z.string()) }),
});

export const saveSetup = defineRpc({
  name: "progress.setup.save",
  input: z.object({
    workspaceId: z.string().min(1),
    workspaceDirectory: z.string().min(1),
    choice: setupChoice,
  }),
  output: z.object({ shown: z.string() }),
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
