import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLACEMENT_OPTIONS = [
  { value: "composer", label: "Composer Pill" },
  { value: "header", label: "Header Button" },
] as const;

export const shortcutSchema = z.object({
  placement: z.enum(["composer", "header"]),
  headerShowsLabel: z.boolean(),
});

export type ShortcutSettings = z.infer<typeof shortcutSchema>;
export type ShortcutPlacement = ShortcutSettings["placement"];

export const defaultShortcut = {
  placement: "composer",
  headerShowsLabel: false,
} satisfies ShortcutSettings;

export function headerButtonLabel(showLabel: boolean) {
  return showLabel ? "Links" : undefined;
}

export const getShortcutSettings = defineRpc({
  name: "workspace-links.shortcut.get",
  input: z.object({}),
  output: shortcutSchema,
});

export const updateShortcutSettings = defineRpc({
  name: "workspace-links.shortcut.update",
  input: z.object({
    placement: z.enum(["composer", "header"]).optional(),
    headerShowsLabel: z.boolean().optional(),
  }),
  output: shortcutSchema,
});
