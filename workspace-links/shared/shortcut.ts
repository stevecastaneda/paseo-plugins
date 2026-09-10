export const PLACEMENT_OPTIONS = [
  { value: "composer", label: "Composer Pill" },
  { value: "header", label: "Header Button" },
] as const;

export type ShortcutPlacement = (typeof PLACEMENT_OPTIONS)[number]["value"];

export type ShortcutSettings = {
  placement: ShortcutPlacement;
  headerShowsLabel: boolean;
};

export const defaultShortcut = {
  placement: "composer",
  headerShowsLabel: false,
} satisfies ShortcutSettings;

export function headerButtonLabel(showLabel: boolean) {
  return showLabel ? "Links" : undefined;
}
