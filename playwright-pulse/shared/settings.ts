import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// `sidebar`: list workspaces with a test run going at the top of Paseo's
// sidebar, so a run is visible from any workspace.
export const settingsSchema = z.object({
  sidebar: z.boolean(),
});

export type PulseSettings = z.infer<typeof settingsSchema>;

export const defaultSettings = {
  sidebar: true,
} satisfies PulseSettings;

export const getSettings = defineRpc({
  name: "pulse.settings.get",
  input: z.object({}),
  output: settingsSchema,
});

export const updateSettings = defineRpc({
  name: "pulse.settings.update",
  input: settingsSchema.partial(),
  output: settingsSchema,
});
