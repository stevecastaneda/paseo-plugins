import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const settingsSchema = z.object({
  showIcon: z.boolean(),
  showAgo: z.boolean(),
});

export const defaultSettings = {
  showIcon: true,
  showAgo: false,
} satisfies TimeSinceSettings;

export type TimeSinceSettings = z.infer<typeof settingsSchema>;

export const getSettings = defineRpc({
  name: "time-since.settings.get",
  input: z.object({}),
  output: settingsSchema,
});

export const updateSettings = defineRpc({
  name: "time-since.settings.update",
  input: z.object({
    showIcon: z.boolean().optional(),
    showAgo: z.boolean().optional(),
  }),
  output: settingsSchema,
});
